const test=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
const express=require('express');
const delivered=new Map();
const mailer=require('../utils/mailer');
mailer.isEmailConfigured=()=>true;
mailer.sendOtpEmail=async(email,code)=>delivered.set(email,code);
const routes=require('../routes/auth');
const User=require('../models/User');
const Otp=require('../models/Otp');
const {OAuth2Client}=require('google-auth-library');
test('email signup verifies possession, rejects replay and unsafe account takeover; Google verifies audience and email',async()=>{
 process.env.JWT_SECRET='email-flow-test-secret';process.env.EMAIL_VERIFICATION_REQUIRED='true';process.env.GOOGLE_CLIENT_ID='test-client.apps.googleusercontent.com';
 const mongo=await MongoMemoryServer.create();let server;
 const originalVerify=OAuth2Client.prototype.verifyIdToken;
 try{
  await mongoose.connect(mongo.getUri());
  const app=express();app.use(express.json());app.use('/api/auth',routes);server=app.listen(0);
  const base='http://127.0.0.1:'+server.address().port;
  const post=async(path,body)=>{const r=await fetch(base+'/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const pending=await post('register',{email:'first@example.com',password:'securePassword123',fullName:'First Person',age:21,skinType:'Dry'});
  assert.equal(pending.status,202);assert.equal(pending.body.requiresVerification,true);assert.equal(pending.body.token,undefined);assert.equal(await User.countDocuments(),0);
  const doc=await Otp.findOne({identifier:'first@example.com'});assert.notEqual(doc.registration.passwordHash,'securePassword123');assert.equal((await post('request-otp',{email:'first@example.com'})).status,429);
  assert.equal((await post('verify-otp',{email:'first@example.com',code:'not-a-code'})).status,400);
  const code=delivered.get('first@example.com');
  const verified=await post('verify-otp',{email:'first@example.com',code,fullName:'Changed by client',skinType:'Oily'});
  assert.equal(verified.status,201);assert.equal(verified.body.user.fullName,'First Person');assert.equal(verified.body.user.skinType,'Dry');assert.equal(verified.body.user.emailVerified,true);assert.ok(verified.body.token);
  assert.equal((await post('verify-otp',{email:'first@example.com',code})).status,400);
  assert.equal((await post('login',{email:'first@example.com',password:'securePassword123'})).status,200);
  const existing=await User.create({identifier:'otp-only@example.com',identifierType:'email',fullName:'OTP user'});
  assert.equal((await post('register',{email:existing.identifier,password:'newPassword123',fullName:'Attacker'})).status,409);
  assert.equal((await User.findById(existing._id)).passwordHash,undefined);
  OAuth2Client.prototype.verifyIdToken = async options => {
    assert.equal(options.audience, process.env.GOOGLE_CLIENT_ID);
    if (options.idToken === 'invalid') throw Error('bad token');
    const claims = {
      valid: { sub: 'existing-google-user', email: 'first@example.com', hd: 'example.com' },
      unverified: { sub: 'unverified-google-user', email: 'first@example.com', email_verified: false },
      unrelated: { sub: 'unrelated-google-user', email: 'first@example.com' },
      signup: { sub: 'new-google-user', email: 'new@gmail.com' },
      changed: { sub: 'new-google-user', email: 'changed@gmail.com' },
      collision: { sub: 'other-google-user', email: 'new@gmail.com' }
    };
    return { getPayload: () => ({ name: 'Google Person', email_verified: true, ...claims[options.idToken] }) };
  };
  assert.equal((await post('google',{credential:'invalid'})).status,401);assert.equal((await post('google',{credential:'unverified'})).status,401);
  const google=await post('google',{credential:'valid'});assert.equal(google.status,200);assert.equal(google.body.user.id,verified.body.user.id);
  assert.equal(await User.countDocuments({identifier:'first@example.com'}),1);
  const signup = await Promise.all([post('google', { credential: 'signup' }), post('google', { credential: 'signup' })]);
  assert.deepEqual(signup.map(r => r.status).sort(), [200, 201]);
  assert.equal(signup[0].body.user.id, signup[1].body.user.id);
  const savedGoogle = await User.findOne({ googleSubject: 'new-google-user' });
  assert.equal(savedGoogle.identifier, 'new@gmail.com');
  assert.equal(savedGoogle.passwordHash, undefined);
  assert.equal((await post('google', { credential: 'changed' })).body.user.id, signup[0].body.user.id);
  assert.equal((await post('google', { credential: 'collision' })).status, 409);
  assert.equal((await post('google', { credential: 'unrelated' })).status, 409);
  const guest1=await post('guest',{}),guest2=await post('guest',{});assert.notEqual(guest1.body.user.id,guest2.body.user.id);
  await post('request-otp',{email:'expired@example.com'});await Otp.updateOne({identifier:'expired@example.com'},{$set:{createdAt:new Date(Date.now()-660000)}});
  assert.equal((await post('verify-otp',{email:'expired@example.com',code:delivered.get('expired@example.com')})).status,400);
  process.env.CUTIS_GOOGLE_ONLY = 'true';
  for (const route of ['register', 'login', 'guest', 'request-otp', 'verify-otp']) {
    assert.equal((await post(route, {})).status, 403);
  }
  assert.equal((await post('google', { credential: 'signup' })).status, 200);
 }finally{OAuth2Client.prototype.verifyIdToken=originalVerify;if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();await mongo.stop();}
});
