const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { requireDb } = require('../middleware/db');
const { toPublicUser } = require('./auth');
const { CONCERNS, WEATHER, SKIN_TYPES, UNKNOWN_SKIN, GENDERS, REMINDER_SLOTS, TIME_FORMAT } = require('../utils/skin-profile');

// Partial updates keep profile, water intake and reminder changes independent.
router.patch('/me', requireAuth, requireDb, async (req, res, next) => {
  try {
    const { skinType, fullName, age, gender, shavesFace, concerns, weather, location, weatherReading, hydrationCount, reminderTimes } = req.body;
    const set = {};
    const unset = {};
    if (skinType !== undefined && ![...SKIN_TYPES, UNKNOWN_SKIN].includes(skinType)) {
      return res.status(400).json({ error: 'Invalid skin type.' });
    }
    if (skinType !== undefined) set.skinType = skinType;
    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 100) {
        return res.status(400).json({ error: 'Enter a name between 1 and 100 characters.' });
      }
      set.fullName = fullName.trim();
    }
    if (age !== undefined) {
      const years = Number(age);
      if (!Number.isInteger(years) || years < 13 || years > 120) {
        return res.status(400).json({ error: 'Enter an age between 13 and 120.' });
      }
      set.age = years;
    }
    if (gender !== undefined) {
      if (gender === '') unset.gender = 1;
      else if (GENDERS.includes(gender)) set.gender = gender;
      else return res.status(400).json({ error: 'Choose a gender option from the profile form.' });
    }
    if (shavesFace !== undefined) {
      if (typeof shavesFace !== 'boolean') return res.status(400).json({ error: 'Invalid shaving preference.' });
      set.shavesFace = shavesFace;
    }
    if (concerns !== undefined) {
      if (!Array.isArray(concerns) || concerns.length > Object.keys(CONCERNS).length || concerns.some(value => typeof value !== 'string' || !Object.hasOwn(CONCERNS, value))) {
        return res.status(400).json({ error: 'Choose valid skin concerns.' });
      }
      set.concerns = [...new Set(concerns)];
    }
    if (weather !== undefined) {
      if (typeof weather !== 'string' || !Object.hasOwn(WEATHER, weather)) return res.status(400).json({ error: 'Choose a valid weather condition.' });
      set.weather = weather;
    }
    if (location !== undefined) {
      if (typeof location !== 'string' || location.trim().length > 120) {
        return res.status(400).json({ error: 'Enter a location of up to 120 characters.' });
      }
      set.location = location.trim();
    }
    if (weatherReading !== undefined) {
      const { temperature, humidity, code, observedAt, cityId } = weatherReading || {};
      const observedTime = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN;
      if (!set.location || !set.weather ||
          !Number.isFinite(temperature) || temperature < -100 || temperature > 70 ||
          !Number.isFinite(humidity) || humidity < 0 || humidity > 100 ||
          !Number.isInteger(code) || code < 0 || code > 99 ||
          !Number.isFinite(observedTime) || observedTime > Date.now() + 3600000 ||
          (cityId !== undefined && (!Number.isSafeInteger(cityId) || cityId < 1))) {
        return res.status(400).json({ error:'Invalid weather reading.' });
      }
      set.weatherReading = { temperature, humidity, code, observedAt:new Date(observedTime), cityId };
    } else if (location !== undefined || weather !== undefined) {
      unset.weatherReading = 1;
    }
    if (hydrationCount !== undefined) {
      const count = Number(hydrationCount);
      if (!Number.isFinite(count)) return res.status(400).json({ error: 'Invalid water intake count.' });
      set.hydrationCount = Math.max(0, Math.min(20, count));
    }
    if (reminderTimes !== undefined) {
      if (!reminderTimes || typeof reminderTimes !== 'object' || Array.isArray(reminderTimes)) {
        return res.status(400).json({ error: 'Choose valid reminder times.' });
      }
      for (const slot of REMINDER_SLOTS) {
        const time = reminderTimes[slot];
        if (time === undefined) continue;
        if (time === '') unset[`reminderTimes.${slot}`] = 1;
        else if (typeof time === 'string' && TIME_FORMAT.test(time)) set[`reminderTimes.${slot}`] = time;
        else return res.status(400).json({ error: 'Choose valid reminder times.' });
      }
    }
    const user = await User.findByIdAndUpdate(req.userId, { $set: set, $unset: unset }, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    res.json({ ok: true, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/notices
router.get('/notices', requireAuth, requireDb, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select('notices');
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    res.json({ ok: true, notices: user.notices || [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/notices { type, text, time }
router.post('/notices', requireAuth, requireDb, async (req, res, next) => {
  try {
    const { type, text, time } = req.body;
    if (!text) return res.status(400).json({ error: 'Notice text is required.' });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    user.notices = user.notices || [];
    user.notices.unshift({
      type: type || 'user',
      text: String(text),
      time: time || 'Just now',
      createdAt: new Date()
    });

    if (user.notices.length > 50) user.notices = user.notices.slice(0, 50);

    await user.save();
    res.json({ ok: true, notices: user.notices });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/checkin { sleep, stress, diet, sun, note }
router.post('/checkin', requireAuth, requireDb, async (req, res, next) => {
  try {
    const { sleep, stress, diet, sun, note } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    user.checkins = user.checkins || [];
    user.checkins.unshift({
      sleep: Number(sleep) || 0,
      stress: String(stress || ''),
      diet: String(diet || ''),
      sun: String(sun || ''),
      note: String(note || ''),
      createdAt: new Date()
    });

    if (user.checkins.length > 100) user.checkins = user.checkins.slice(0, 100);

    await user.save();
    res.json({ ok: true, checkins: user.checkins });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
