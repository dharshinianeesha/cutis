const mongoose = require('mongoose');
const { CONCERNS, WEATHER, SKIN_TYPES, UNKNOWN_SKIN, GENDERS, TIME_FORMAT } = require('../utils/skin-profile');

// One account per identifier (email or phone). Stores credentials (hashed password),
// profile information, and user application data.
const userSchema = new mongoose.Schema({
  identifier: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  identifierType: { type: String, enum: ['email', 'phone'], default: 'email' },
  emailVerified: { type: Boolean, default: false },
  googleSubject: { type: String, unique: true, sparse: true },
  passwordHash: { type: String }, // Bcrypt hash for password login credentials
  fullName: { type: String, required: true, trim: true },
  age: { type: Number, min: 13, max: 120 },
  skinType: { type: String, enum: [...SKIN_TYPES, UNKNOWN_SKIN], default: UNKNOWN_SKIN },
  gender: { type: String, enum: GENDERS },
  shavesFace: { type: Boolean, default: false },
  concerns: [{ type: String, enum: Object.keys(CONCERNS) }],
  weather: { type: String, enum: Object.keys(WEATHER), default: 'mild' },
  location: { type: String, trim: true, maxlength: 120, default: '' },
  weatherReading: {
    type: new mongoose.Schema({
      temperature: { type:Number, required:true, min:-100, max:70 },
      humidity: { type:Number, required:true, min:0, max:100 },
      code: { type:Number, required:true, min:0, max:99 },
      observedAt: { type:Date, required:true },
      cityId: { type:Number, min:1 }
    }, { _id:false }),
    default: undefined
  },
  reminderTimes: {
    morning: { type: String, match: TIME_FORMAT },
    evening: { type: String, match: TIME_FORMAT }
  },
  hydrationCount: { type: Number, default: 0, min: 0, max: 20 },
  notices: [
    {
      type: { type: String, default: 'user' },
      text: { type: String, required: true },
      time: { type: String, default: 'Just now' },
      createdAt: { type: Date, default: Date.now }
    }
  ],
  checkins: [
    {
      sleep: Number,
      stress: String,
      diet: String,
      sun: String,
      note: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
