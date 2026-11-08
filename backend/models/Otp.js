const mongoose = require('mongoose');

// The 6-digit code is never stored in plain text — only a bcrypt hash of it,
// same as a password would be. A document here expires (and Mongo auto-deletes
// it) 10 minutes after creation via the TTL index below.
const otpSchema = new mongoose.Schema({
  identifier: { type: String, required: true, lowercase: true, trim: true, index: true },
  purpose: { type: String, enum: ['login','registration','email-verification'], default: 'login' },
  registration: { fullName: String, age: Number, skinType: String, passwordHash: String },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: 600 } // 10-minute TTL
});

module.exports = mongoose.model('Otp', otpSchema);
