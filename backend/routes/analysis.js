const express = require('express');
const router = express.Router();
const ScanResult = require('../models/ScanResult');
const { requireAuth } = require('../middleware/auth');
const { requireDb } = require('../middleware/db');
const { summarize } = require('../utils/analysis');

// GET /api/analysis/daily?days=14&tzOffset=-330  (tzOffset = Date.getTimezoneOffset() minutes)
router.get('/daily', requireAuth, (req, res, next) => {
  const days = req.query.days === undefined ? 14 : Number(req.query.days);
  const tz = req.query.tzOffset === undefined ? 0 : Number(req.query.tzOffset);
  if (!Number.isInteger(days) || days < 1 || days > 365 || !Number.isFinite(tz) || Math.abs(tz) > 840) {
    return res.status(400).json({ error: 'days must be 1-365 and tzOffset a valid minute offset.' });
  }
  req.q = { days, tz }; next();
}, requireDb, async (req, res, next) => {
  try {
    const since = new Date(Date.now() - req.q.days * 86400000);
    const scans = await ScanResult.find({ userId: req.userId, createdAt: { $gte: since } }).sort({ createdAt: 1 }).limit(2000).lean();
    res.json({ ok: true, rangeDays: req.q.days, ...summarize(scans, req.q.tz) });
  } catch (err) { next(err); }
});
module.exports = router;
