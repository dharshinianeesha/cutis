const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { toneFromITA } = require('../utils/recommend');
const { recommendRoutine } = require('../utils/product-routine');
const { summarize } = require('../utils/analysis');
const { parseIdentifier } = require('../routes/auth');

test('ITA maps to the six tone bands', () => {
  assert.equal(toneFromITA(60), 'Very light'); assert.equal(toneFromITA(45), 'Light'); assert.equal(toneFromITA(30), 'Intermediate');
  assert.equal(toneFromITA(15), 'Tan'); assert.equal(toneFromITA(0), 'Brown'); assert.equal(toneFromITA(-40), 'Dark');
});
test('product matching requires a selected skin type and a complete qualifying scan', () => {
  const scan = { hydration: 44, oilLevel: 66, redness: 20 };
  const profile = { skinType: 'Oily', age: 24, weather: 'humid', concerns: ['acne'] };
  assert.deepEqual(recommendRoutine(profile), { state:'needs_scan', products:[] });
  assert.deepEqual(recommendRoutine(profile, { hydration:44 }), { state:'needs_scan', products:[] });
  assert.deepEqual(recommendRoutine({ skinType:'Not sure yet' }, { ...scan, detectedSkinType:'Oily' }), { state:'needs_profile', products:[] });
  assert.deepEqual(recommendRoutine(profile, { hydration:70, oilLevel:22, redness:18 }), { state:'no_match', products:[] });
  const oily = recommendRoutine(profile, scan);
  assert.equal(oily.focus, 'Lower hydration estimate');
  assert.match(oily.products[0].product, /hydrating gel/i);
  assert.equal(oily.scanCues.length, 2);
  const dry = recommendRoutine({ ...profile, skinType:'Dry' }, scan);
  assert.notDeepEqual(dry.products, oily.products);
  const redness = recommendRoutine({ ...profile, age:16 }, { ...scan, redness:60 });
  assert.equal(redness.focus, 'Higher visible redness');
  assert.equal(redness.products.some(product => product.step === 'Serum'), false);
});
test('daily analysis groups by local day and reports change', () => {
  const mk = (iso, h, o, r) => ({ createdAt: iso, hydration: h, oilLevel: o, redness: r });
  const r = summarize([mk('2026-10-01T10:00:00Z', 50, 60, 40), mk('2026-10-01T20:00:00Z', 60, 50, 30), mk('2026-10-05T09:00:00Z', 70, 40, 20)]);
  assert.equal(r.days.length, 2); assert.equal(r.days[0].hydration, 55); assert.equal(r.days[0].count, 2);
  assert.equal(r.summary.change.hydration, 15); assert.match(r.summary.insight, /hydration rose 15/);
  // 23:30 UTC on Oct 1 is already Oct 2 in India (UTC+5:30 => offset -330)
  assert.equal(summarize([mk('2026-10-01T23:30:00Z', 1, 1, 1)], -330).days[0].date, '2026-10-02');
  assert.equal(summarize([]).days.length, 0);
});
test('contact parsing: email, phone, rejects junk', () => {
  assert.deepEqual(parseIdentifier({ email: ' A@B.co ' }), { type: 'email', value: 'a@b.co' });
  assert.deepEqual(parseIdentifier({ phone: '+91 98765-43210' }), { type: 'phone', value: '+919876543210' });
  assert.equal(parseIdentifier({ phone: '9876543210' }), null); assert.equal(parseIdentifier({ email: 'nope' }), null); assert.equal(parseIdentifier({}), null);
});
test('API without DB/credentials fails clearly, never crashes', async () => {
  const env = { ...process.env, PORT: '4177', JWT_SECRET: 'test', MONGODB_URI: '', EMAIL_USER: '', EMAIL_PASS: '', GOOGLE_CLIENT_ID: '', DISABLE_LOCAL_DB: 'true' };
  const srv = spawn(process.execPath, ['server.js'], { env, cwd: require('path').join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { srv.kill(); reject(new Error('API did not start within 15 seconds')); }, 15000);
    srv.stdout.on('data', chunk => { if (chunk.toString().includes('Cutis backend running')) { clearTimeout(timer); resolve(); } });
    srv.once('error', err => { clearTimeout(timer); reject(err); });
    srv.once('exit', code => { clearTimeout(timer); reject(new Error('API exited before startup: ' + code)); });
  });
  const call = async (path, body, headers = {}) => { const r = await fetch('http://localhost:4177' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); return [r.status, await r.json()]; };
  try {
    assert.equal((await call('/api/health'))[0], 200);
    assert.equal((await call('/api/auth/request-otp', { email: 'bad' }))[0], 400);
    assert.equal((await call('/api/auth/request-otp', { phone: '12345' }))[0], 400);
    assert.equal((await call('/api/auth/request-otp', { phone: '+919876543210' }))[0], 503);
    assert.equal((await call('/api/auth/verify-otp', { phone: '+919876543210', code: '12' }))[0], 400);
    assert.equal((await call('/api/auth/google', { credential: 'x' }))[0], 503);
    assert.equal((await call('/api/scan/history'))[0], 401);
    assert.equal((await call('/api/analysis/daily'))[0], 401);
    assert.equal((await call('/api/recommend', { skinType:'Oily' }))[0], 401);
    assert.equal((await call('/api/recommend/routine', {}))[0], 401);
    assert.equal((await call('/api/recommend/routine'))[0], 200);
    assert.equal((await call('/api/auth/register', { email: 'bad' }))[0], 503); // No DB in this test
    assert.equal((await call('/api/auth/login', { email: 'test@example.com', password: '123' }))[0], 503);
    const cfg = (await call('/api/auth/config'))[1]; assert.equal(cfg.googleClientId, null); assert.equal(cfg.smsEnabled, false); assert.equal(cfg.passwordAuth, true);
  } finally { srv.kill('SIGTERM'); }
});
