const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { generateCode, hashCode, verifyCode } = require('../utils/otp');
const { sendOtpEmail } = require('../utils/mailer');
const { sendOtpSms, usesTwilioVerify, sendVerification, checkVerification } = require('../utils/sms');
const { requireAuth, signSession } = require('../middleware/auth');
const { requireDb } = require('../middleware/db');
const { emailVerificationRequired, issueEmailCode } = require('../utils/email-verification');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9]\d{7,14}$/;
const SKIN_TYPES = ['Oily', 'Dry', 'Combination', 'Normal', 'Sensitive', 'Not sure yet'];
const googleOnly = () => process.env.CUTIS_GOOGLE_ONLY === 'true';

// Accepts { email } or { phone } and returns { type, value } or null.
function parseIdentifier(body) {
  if (body.email) {
    const v = String(body.email).trim().toLowerCase();
    return EMAIL_RE.test(v) ? { type: 'email', value: v } : null;
  }
  if (body.phone) {
    const v = String(body.phone).replace(/[\s\-().]/g, '');
    return PHONE_RE.test(v) ? { type: 'phone', value: v } : null;
  }
  return null;
}

function validateIdentifier(req, res, next) {
  const id = parseIdentifier(req.body);
  if (!id) return res.status(400).json({ error: 'Enter a valid email address or a mobile number with country code (e.g. +919876543210).' });
  req.identifier = id;
  next();
}

router.get('/config', (req, res) => {
  const { isEmailConfigured } = require('../utils/mailer');
  const { isSmsConfigured } = require('../utils/sms');
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    emailEnabled: !googleOnly() && isEmailConfigured(),
    smsEnabled: !googleOnly() && isSmsConfigured(),
    passwordAuth: !googleOnly(),
    passwordSignup: !googleOnly() && (!emailVerificationRequired() || isEmailConfigured())
  });
});

// Keep the legacy endpoints available to installations that still use them.
router.post(['/register', '/login', '/guest', '/request-otp', '/verify-otp'], (req, res, next) => {
  if (googleOnly()) {
    return res.status(403).json({ error: 'Use Sign in with Google to access Cutis.' });
  }
  next();
});

// POST /api/auth/register { email, password, fullName, age, skinType }
// Saves email and bcrypt-hashed password credentials in MongoDB
router.post('/register', requireDb, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const fullName = String(req.body.fullName || '').trim();
    const age = req.body.age !== undefined && req.body.age !== '' ? Number(req.body.age) : undefined;
    const skinType = SKIN_TYPES.includes(req.body.skinType) ? req.body.skinType : 'Not sure yet';

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ error: 'Choose a shorter password (maximum 72 bytes).' });
    }
    if (!fullName || fullName.length > 100) {
      return res.status(400).json({ error: 'Enter a name between 1 and 100 characters.' });
    }
    if (age !== undefined && (Number.isNaN(age) || age < 13 || age > 120)) {
      return res.status(400).json({ error: 'Enter a valid age (13-120).' });
    }

    let existingUser = await User.findOne({ identifier: email });
    if (existingUser && existingUser.passwordHash) {
      return res.status(409).json({ error: 'An account already exists with this email. Please log in.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    if (existingUser) return res.status(409).json({error:'This email already has an account. Sign in using its original method.'});

    if(emailVerificationRequired()){
      await issueEmailCode(email,'registration',{fullName,age,skinType,passwordHash});
      return res.status(202).json({ok:true,requiresVerification:true,email,message:'Check your email for a verification code.'});
    }
    const newUser = await User.create({
      identifier: email,
      identifierType: 'email',
      passwordHash,
      fullName,
      age,
      skinType,
      createdAt: new Date(),
      lastLoginAt: new Date()
    });

    return res.status(201).json({
      ok: true,
      isNewUser: true,
      token: signSession(newUser._id),
      user: toPublicUser(newUser)
    });
  } catch (err) {
    if(err.code==='EMAIL_NOT_CONFIGURED')return res.status(503).json({error:'Email verification is temporarily unavailable. Please try mobile OTP.'});
    if(err.code==='EMAIL_SEND_FAILED')return res.status(502).json({error:'Verification email could not be delivered. Please try again later.'});
    if(err.code==='OTP_RATE_LIMIT')return res.status(429).json({error:err.message});

    if (err.code === 11000) return res.status(409).json({ error: 'An account already exists with this email.' });
    next(err);
  }
});

// POST /api/auth/login { email, password }
// Verifies credentials stored in MongoDB and returns a JWT session
router.post('/login', requireDb, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ identifier: email });
    if (!user) {
      return res.status(401).json({ error: 'No account found with this email. Please sign up first.' });
    }
    if (!user.passwordHash) return res.status(401).json({ error: 'This account uses a different sign-in method. Continue with the method you used to create it.' });

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    if(emailVerificationRequired()&&!user.emailVerified){
      await issueEmailCode(email,'email-verification');
      return res.status(202).json({ok:true,requiresVerification:true,email,message:'Verify this email before signing in.'});
    }
    user.lastLoginAt = new Date();
    await user.save();

    return res.json({
      ok: true,
      token: signSession(user._id),
      user: toPublicUser(user)
    });
  } catch (err) {
    if(err.code==='EMAIL_NOT_CONFIGURED')return res.status(503).json({error:'Email verification is temporarily unavailable. Please try mobile OTP.'});
    if(err.code==='EMAIL_SEND_FAILED')return res.status(502).json({error:'Verification email could not be delivered. Please try again later.'});
    if(err.code==='OTP_RATE_LIMIT')return res.status(429).json({error:err.message});

    next(err);
  }
});

// POST /api/auth/guest { fullName, age, skinType }
// Creates or returns a persistent guest user in MongoDB with a real JWT token
router.post('/guest', requireDb, async (req, res, next) => {
  try {
    const guestEmail = 'guest-' + require('crypto').randomUUID() + '@cutis.invalid';
    let user = await User.findOne({ identifier: guestEmail });
    if (!user) {
      user = await User.create({
        identifier: guestEmail,
        identifierType: 'email',
        fullName: req.body.fullName || 'Guest User',
        age: req.body.age ? Number(req.body.age) : 25,
        skinType: req.body.skinType || 'Combination'
      });
    } else {
      user.lastLoginAt = new Date();
      await user.save();
    }
    res.json({
      ok: true,
      isNewUser: false,
      token: signSession(user._id),
      user: toPublicUser(user)
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/request-otp { email } or { phone }
router.post('/request-otp', validateIdentifier, requireDb, async (req, res, next) => {
  try {
    const { type, value } = req.identifier;
    if (type === 'phone' && usesTwilioVerify()) {
      await sendVerification(value);
      return res.json({ok:true, channel:type, message:'Verification code sent to your mobile number.'});
    }
    if(type==='email'){
      const pending=await Otp.findOne({identifier:value,purpose:'registration'});
      await issueEmailCode(value,pending?'registration':'login',pending?.registration?.toObject());
      return res.json({ok:true,channel:type,message:'Verification code sent to your email.'});
    }
    const code = generateCode();
    const codeHash = await hashCode(code);
    await Otp.deleteMany({ identifier: value });
    await Otp.create({ identifier: value, codeHash });

    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.NETLIFY || !!process.env.VERCEL;
    const isDevFallback = !isProduction && process.env.DEV_OTP_FALLBACK === 'true';

    try {
      if (type === 'email') await sendOtpEmail(value, code);
      else await sendOtpSms(value, code);
      res.json({ ok: true, channel: type, message: `Verification code sent to ${value}.` });
    } catch (sendErr) {
      if (isDevFallback) {
        console.log(`[auth] Development OTP code for ${value}: ${code}`);
        return res.json({
          ok: true,
          channel: type,
          message: `Verification code generated for ${value}.`,
          devCode: code
        });
      }
      await Otp.deleteMany({ identifier: value });
      throw sendErr;
    }
  } catch (err) {
    if(err.code==='EMAIL_NOT_CONFIGURED')return res.status(503).json({error:'Email verification is temporarily unavailable. Please try mobile OTP.'});
    if(err.code==='EMAIL_SEND_FAILED')return res.status(502).json({error:'Verification email could not be delivered. Please try again later.'});
    if(err.code==='OTP_RATE_LIMIT')return res.status(429).json({error:err.message});

    if (err.code === 'EMAIL_NOT_CONFIGURED') return res.status(503).json({ error: 'Email delivery is not set up on the server yet.' });
    if (err.code === 'SMS_NOT_CONFIGURED') return res.status(503).json({ error: 'SMS delivery is not set up on the server yet. Use email, or add Twilio keys to the backend.' });
    if (err.code === 'SMS_SEND_FAILED') return res.status(err.status || 502).json({ error: err.status === 429 ? 'Too many requests. Wait a few minutes before retrying.' : 'SMS could not be sent. Trial accounts can only text verified testers. Please check the number or try again later.' });
    next(err);
  }
});

function validateVerify(req, res, next) {
  const id = parseIdentifier(req.body);
  const code = String(req.body.code || '').trim();
  if (!id || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Missing or invalid contact/code.' });
  req.identifier = id;
  req.code = code;
  req.profile = {
    fullName: String(req.body.fullName || '').trim(),
    age: req.body.age !== undefined && req.body.age !== '' ? Number(req.body.age) : undefined,
    skinType: SKIN_TYPES.includes(req.body.skinType) ? req.body.skinType : 'Not sure yet'
  };
  next();
}

// POST /api/auth/verify-otp { email|phone, code, fullName, age, skinType }
router.post('/verify-otp', validateVerify, requireDb, async (req, res, next) => {
  try {
    const { type, value } = req.identifier;
    let verifiedRegistration=null;
    if (type === 'phone' && usesTwilioVerify()) {
      if (!(await checkVerification(value, req.code))) return res.status(400).json({error:'Incorrect code. Please try again.'});
    } else {
    const otpDoc = await Otp.findOne({ identifier: value }).sort({ createdAt: -1 });
    if (!otpDoc || Date.now()-new Date(otpDoc.createdAt).getTime()>600000) return res.status(400).json({ error: 'No code found, or it expired. Request a new one.' });
    if (otpDoc.attempts >= 5) {
      await Otp.deleteMany({ identifier: value });
      return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
    }
    if (!(await verifyCode(req.code, otpDoc.codeHash))) {
      otpDoc.attempts += 1;
      await otpDoc.save();
      return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    }
    const consumed=await Otp.deleteOne({_id:otpDoc._id});
    if(consumed.deletedCount!==1)return res.status(400).json({error:'Code was already used. Request another.'});
    if(otpDoc.purpose==='registration')verifiedRegistration=otpDoc.registration.toObject();
    }

    let user = await User.findOne({ identifier: value });
    if (user) {
      if(type==='email')user.emailVerified=true;
      user.lastLoginAt = new Date();
      await user.save();
      return res.json({ ok: true, isNewUser: false, token: signSession(user._id), user: toPublicUser(user) });
    }
    const { fullName, age, skinType } = verifiedRegistration || req.profile;
    if (!fullName) return res.status(400).json({ error: 'Full name is required to create an account.' });
    if (age !== undefined && (Number.isNaN(age) || age < 13 || age > 120)) return res.status(400).json({ error: 'Enter a valid age (13-120).' });
    try {
      user = await User.create({ identifier: value, identifierType: type, fullName, age, skinType, emailVerified:type==='email',passwordHash:verifiedRegistration?.passwordHash });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'An account already exists for this contact.' });
      if (e.name === 'ValidationError') return res.status(400).json({ error: e.message });
      throw e;
    }
    return res.status(201).json({ ok: true, isNewUser: true, token: signSession(user._id), user: toPublicUser(user) });
  } catch (err) {
    if (err.code === 'SMS_SEND_FAILED') return res.status(err.status || 502).json({error:err.status === 429 ? 'Too many attempts. Request a new code after a few minutes.' : err.status === 400 ? 'Code expired or already used. Request a new code.' : 'SMS verification is unavailable. Please try again later.'});
    next(err);
  }
});

// POST /api/auth/google { credential } — Google Identity Services ID token
router.post('/google', async (req, res, next) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(503).json({ error: 'Google sign-in is not configured on the server (GOOGLE_CLIENT_ID).' });
    const credential = String(req.body.credential || '');
    if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });
    if (!(await require('../utils/database').connectDb())) return res.status(503).json({ error: 'Database is not connected right now. Please try again shortly.' });
    const { OAuth2Client } = require('google-auth-library');
    let payload;
    try {
      const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch (e) {
      return res.status(401).json({ error: 'Google sign-in could not be verified.' });
    }
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return res.status(401).json({ error: 'Your Google email could not be verified.' });
    }
    await User.init();
    const email = payload.email.trim().toLowerCase();
    const googleSubject = payload.sub;
    const loginUpdate = { lastLoginAt: new Date() };
    let user = await User.findOneAndUpdate({ googleSubject }, loginUpdate, { new: true });

    let isNewUser = false;
    if (!user) {
      try {
        if (email.endsWith('@gmail.com') || payload.hd) {
          // Match older accounts only when Google is authoritative for the email.
          user = await User.findOneAndUpdate({
            identifier: email,
            googleSubject: { $exists: false },
            $or: [{ emailVerified: true }, { passwordHash: { $exists: false } }]
          }, { ...loginUpdate, googleSubject, emailVerified: true }, { new: true });
        }
        if (!user) {
          user = await User.create({ identifier: email, googleSubject, emailVerified: true, fullName: payload.name?.trim() || email.split('@')[0] });
          isNewUser = true;
        }
      } catch (err) {
        if (err.code !== 11000) throw err;
        user = await User.findOneAndUpdate({ googleSubject }, loginUpdate, { new: true });
        if (!user) return res.status(409).json({ error: 'This email is already used by a different Cutis account.' });
      }
    }
    res.status(isNewUser ? 201 : 200).json({ ok: true, isNewUser, token: signSession(user._id), user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, requireDb, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    res.json({ ok: true, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

function toPublicUser(u) {
  return {
    id: u._id,
    identifier: u.identifier,
    identifierType: u.identifierType,
    emailVerified: !!u.emailVerified,
    fullName: u.fullName,
    age: u.age,
    skinType: u.skinType,
    gender: u.gender || '',
    shavesFace: u.shavesFace ?? false,
    concerns: u.concerns || [],
    weather: u.weather || 'mild',
    location: u.location || '',
    weatherReading: u.weatherReading || null,
    reminderTimes: {
      morning: u.reminderTimes?.morning || '',
      evening: u.reminderTimes?.evening || ''
    },
    hydrationCount: u.hydrationCount ?? 0,
    notices: u.notices || [],
    checkins: u.checkins || [],
    createdAt: u.createdAt
  };
}

module.exports = router;
module.exports.parseIdentifier = parseIdentifier;
module.exports.toPublicUser = toPublicUser;
