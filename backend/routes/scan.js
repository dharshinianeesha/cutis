const express = require('express');
const router = express.Router();
const ScanResult = require('../models/ScanResult');
const { SKIN_TYPES } = require('../utils/skin-profile');
const { requireAuth } = require('../middleware/auth');
const { requireDb } = require('../middleware/db');

function clamp(n, lo, hi) {
  n = Number(n);
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// POST /api/scan  { hydration, oilLevel, redness, detectedSkinType }
// The frontend computes these from the actual captured photo (see client
// skin-analysis.js) and sends the numbers here to persist them against the
// logged-in account. Raw images are never uploaded — only the derived metrics.
router.post('/', requireAuth, requireDb, async (req, res, next) => {
  try {
    const { hydration, oilLevel, redness, detectedSkinType } = req.body || {};
    if (![hydration, oilLevel, redness].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) {
      return res.status(400).json({ error:'A completed scan must include valid hydration, shine and redness scores.' });
    }
    if (!SKIN_TYPES.includes(detectedSkinType)) return res.status(400).json({ error:'Invalid scan skin type.' });
    const { toneFromITA } = require('../utils/recommend');
    const ita = Number.isFinite(req.body.ita) ? clamp(req.body.ita, -90, 90) : undefined;
    const toneCategory = ita !== undefined ? toneFromITA(ita) : undefined;

    const result = await ScanResult.create({
      userId: req.userId,
      hydration,
      oilLevel,
      redness,
      detectedSkinType,
      ita,
      toneCategory
    });

    res.status(201).json({ ok: true, result });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// GET /api/scan/history  — most recent scans for the logged-in user, newest first.
router.get('/history', requireAuth, requireDb, async (req, res, next) => {
  try {
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return res.status(400).json({ error: 'Scan limit must be 1 to 50.' });
    const results = await ScanResult.find({ userId: req.userId }).sort({ createdAt: -1, _id: -1 }).limit(limit);
    res.json({ ok: true, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
