const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');

// We'll require app components
const authRoutes = require('../routes/auth');
const scanRoutes = require('../routes/scan');
const userRoutes = require('../routes/user');
const analysisRoutes = require('../routes/analysis');
const User = require('../models/User');
const ScanResult = require('../models/ScanResult');

test('E2E: Database storage, password auth, and full application data persistence', async () => {
  process.env.JWT_SECRET = 'super-test-secret-2026';
  const mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/scan', scanRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/analysis', analysisRoutes);
  app.use('/api/recommend', require('../routes/recommend'));

  let token = null;
  let userId = null;

  try {
    // 1. User Registration with Password
    const regRes = await fetch('http://127.0.0.1:0', {}).catch(() => null); // dummy check
    const appServer = app.listen(0);
    const port = appServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const reg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'priya@example.com',
        password: 'securePassword123',
        fullName: 'Priya Mehta',
        age: 26,
        skinType: 'Combination'
      })
    })).json();

    assert.equal(reg.ok, true);
    assert.equal(reg.isNewUser, true);
    assert.ok(reg.token);
    assert.equal(reg.user.identifier, 'priya@example.com');
    assert.equal(reg.user.fullName, 'Priya Mehta');
    token = reg.token;
    userId = reg.user.id;

    // Verify stored in MongoDB directly
    const dbUser = await User.findOne({ identifier: 'priya@example.com' });
    assert.ok(dbUser);
    assert.ok(dbUser.passwordHash);
    assert.notEqual(dbUser.passwordHash, 'securePassword123'); // must be hashed
    const requestRoutine = async (fields = {}) => {
      const response = await fetch(`${baseUrl}/api/recommend/routine`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body:JSON.stringify(fields)
      });
      return { status:response.status, data:await response.json() };
    };
    const forged = await requestRoutine({ skinType:'Oily', scan:{ hydration:0, oilLevel:100, redness:100 } });
    assert.equal(forged.data.state, 'needs_scan');
    assert.deepEqual(forged.data.products, []);

    // 2. Reject duplicate registration
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'priya@example.com',
        password: 'anotherPassword',
        fullName: 'Priya M'
      })
    });
    assert.equal(dupRes.status, 409);

    // 3. User Login with Wrong Password
    const wrongLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'priya@example.com',
        password: 'wrongPassword'
      })
    });
    assert.equal(wrongLogin.status, 401);

    // 4. User Login with Correct Password
    const correctLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'priya@example.com',
        password: 'securePassword123'
      })
    })).json();
    assert.equal(correctLogin.ok, true);
    assert.ok(correctLogin.token);

    // 5. Store Scan Results in Database
    const scanRes = await (await fetch(`${baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        hydration: 68,
        oilLevel: 42,
        redness: 18,
        detectedSkinType: 'Combination',
        ita: 35
      })
    })).json();
    assert.equal(scanRes.ok, true);
    assert.equal(scanRes.result.hydration, 68);

    // Verify ScanResult in MongoDB
    const dbScan = await ScanResult.findOne({ userId: dbUser._id });
    assert.ok(dbScan);
    assert.equal(dbScan.hydration, 68);
    const balanced = await requestRoutine();
    assert.equal(balanced.data.state, 'no_match');
    assert.deepEqual(balanced.data.products, []);
    assert.equal(dbScan.oilLevel, 42);

    // 6. Fetch Scan History from Database
    const historyRes = await (await fetch(`${baseUrl}/api/scan/history`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })).json();
    assert.equal(historyRes.ok, true);
    assert.equal(historyRes.results.length, 1);
    assert.equal(historyRes.results[0].hydration, 68);

    // 7. Daily Analysis from Database
    const analysisRes = await (await fetch(`${baseUrl}/api/analysis/daily?days=7`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })).json();
    assert.equal(analysisRes.ok, true);
    assert.equal(analysisRes.days.length, 1);
    assert.equal(analysisRes.days[0].hydration, 68);

    // 8. Update User Profile & Hydration Tracker
    const patchRes = await (await fetch(`${baseUrl}/api/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ skinType: 'Oily', hydrationCount: 7 })
    })).json();
    assert.equal(patchRes.ok, true);
    assert.equal(patchRes.user.skinType, 'Oily');
    assert.equal(patchRes.user.hydrationCount, 7);

    const patchProfile = async fields => {
      const response = await fetch(`${baseUrl}/api/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(fields)
      });
      return { status: response.status, data: await response.json() };
    };
    const [profile, reminders] = await Promise.all([
      patchProfile({ age: 28, gender: 'Non-binary', concerns: ['acne', 'dehydration'], weather: 'humid', location: ' Visakhapatnam, India ', shavesFace: true }),
      patchProfile({ reminderTimes: { morning: '08:30', evening: '21:00' } })
    ]);
    assert.equal(profile.status, 200);
    assert.equal(reminders.status, 200);
    assert.equal((await patchProfile({ reminderTimes: { evening: '24:00' } })).status, 400);
    assert.equal((await patchProfile({ concerns: ['bad-concern'] })).status, 400);
    assert.equal((await patchProfile({ location: { latitude: 17.7 } })).status, 400);
    assert.equal((await patchProfile({ reminderTimes: { morning: '' } })).status, 200);
    const savedProfile = await (await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })).json();
    assert.equal(savedProfile.user.age, 28);
    assert.equal(savedProfile.user.gender, 'Non-binary');
    assert.deepEqual(savedProfile.user.concerns, ['acne', 'dehydration']);
    assert.equal(savedProfile.user.weather, 'humid');
    assert.equal(savedProfile.user.location, 'Visakhapatnam, India');
    const weatherReading = { temperature:31.4, humidity:76, code:2, observedAt:new Date().toISOString(), cityId:1253102 };
    const weatherUpdate = await patchProfile({ location:'Visakhapatnam, India', weather:'humid', weatherReading });
    assert.equal(weatherUpdate.status, 200);
    assert.deepEqual(weatherUpdate.data.user.weatherReading, weatherReading);
    assert.equal((await patchProfile({ age:29 })).data.user.weatherReading.temperature, 31.4);
    assert.equal((await patchProfile({ location:'New Delhi, India' })).data.user.weatherReading, null);
    assert.equal(savedProfile.user.shavesFace, true);
    assert.deepEqual(savedProfile.user.reminderTimes, { morning: '', evening: '21:00' });
    assert.equal(savedProfile.user.hydrationCount, 7);

    const eligible = await ScanResult.create({
      userId, hydration:36, oilLevel:60, redness:30, detectedSkinType:'Dry'
    });
    const matched = await requestRoutine({ scanId:String(eligible._id), skinType:'Dry' });
    assert.equal(matched.data.state, 'matched');
    assert.equal(matched.data.skinType, 'Oily');
    assert.equal(matched.data.focus, 'Lower hydration estimate');
    assert.match(matched.data.products[0].product, /hydrating gel/i);
    const foreign = await ScanResult.create({
      userId:new mongoose.Types.ObjectId(), hydration:40, oilLevel:40, redness:66, detectedSkinType:'Sensitive'
    });
    assert.equal((await requestRoutine({ scanId:String(foreign._id) })).status, 404);
    assert.equal((await patchProfile({ skinType:'Not sure yet' })).status, 200);
    assert.equal((await requestRoutine()).data.state, 'needs_profile');

    // 9. Store Notices and Daily Checkin in Database
    const noticeRes = await (await fetch(`${baseUrl}/api/users/notices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ type: 'user', text: 'Checked in today: 8h sleep', time: '10:00 AM' })
    })).json();
    assert.equal(noticeRes.ok, true);
    assert.equal(noticeRes.notices[0].text, 'Checked in today: 8h sleep');

    const checkinRes = await (await fetch(`${baseUrl}/api/users/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ sleep: 8, stress: 'Low', diet: 'Balanced', sun: 'Moderate', note: 'Feeling fresh' })
    })).json();
    assert.equal(checkinRes.ok, true);
    assert.equal(checkinRes.checkins[0].sleep, 8);

    // 10. Guest Login creates real DB user and valid token
    const guestRes = await (await fetch(`${baseUrl}/api/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Guest Tester' })
    })).json();
    assert.equal(guestRes.ok, true);
    assert.ok(guestRes.token);

    // Guest user can save scan to MongoDB
    const guestScan = await (await fetch(`${baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${guestRes.token}`
      },
      body: JSON.stringify({
        hydration: 55,
        oilLevel: 50,
        redness: 25,
        detectedSkinType: 'Oily'
      })
    })).json();
    assert.equal(guestScan.ok, true);

    // A production deployment must never disclose OTPs when delivery is unavailable.
    const oldMode = process.env.NODE_ENV;
    const oldFallback = process.env.DEV_OTP_FALLBACK;
    process.env.NODE_ENV = 'production';
    process.env.DEV_OTP_FALLBACK = 'true';
    try {
      const otpResponse = await fetch(baseUrl + '/api/auth/request-otp', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({email:'otp-production-test@example.com'})
      });
      const otpBody = await otpResponse.json();
      assert.equal(otpResponse.status, 503);
      assert.equal(otpBody.devCode, undefined);
    } finally {
      if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
      if (oldFallback === undefined) delete process.env.DEV_OTP_FALLBACK; else process.env.DEV_OTP_FALLBACK = oldFallback;
    }
    appServer.close();
  } finally {
    await mongoose.connection.close();
    await mongoServer.stop();
  }
});
