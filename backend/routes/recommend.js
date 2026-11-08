const express = require('express');
const { isObjectIdOrHexString } = require('mongoose');
const User = require('../models/User');
const ScanResult = require('../models/ScanResult');
const { requireAuth } = require('../middleware/auth');
const { requireDb } = require('../middleware/db');
const { CONCERNS, WEATHER, SKIN_TYPES, UNKNOWN_SKIN, GENDERS } = require('../utils/skin-profile');
const { recommendRoutine } = require('../utils/product-routine');

const router = express.Router();

router.get('/routine', (req, res) => {
  res.json({ skinTypes:[...SKIN_TYPES, UNKNOWN_SKIN], concerns:CONCERNS, weather:WEATHER, genders:GENDERS });
});

// The request can select a saved scan. Profile values and readings come from MongoDB.
router.post(['/', '/routine'], requireAuth, requireDb, async (req, res, next) => {
  try {
    const { scanId } = req.body || {};
    if (scanId !== undefined && (typeof scanId !== 'string' || !isObjectIdOrHexString(scanId))) {
      return res.status(400).json({ error:'Invalid scan ID.' });
    }
    const scanFilter = { userId:req.userId };
    if (scanId) scanFilter._id = scanId;
    const [profile, scan] = await Promise.all([
      User.findById(req.userId).select('skinType weather age shavesFace').lean(),
      ScanResult.findOne(scanFilter).sort({createdAt:-1, _id:-1}).select('hydration oilLevel redness createdAt').lean()
    ]);
    if (!profile) return res.status(404).json({ error:'Account not found.' });
    if (scanId && !scan) return res.status(404).json({ error:'Scan not found.' });
    res.json({ ok:true, ...recommendRoutine(profile, scan) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
