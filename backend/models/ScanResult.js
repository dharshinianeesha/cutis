const mongoose = require('mongoose');

// Stores the metrics computed from a scan, tied to the logged-in user, so a
// person's history is real and persists across sessions/devices — not
// localStorage on one browser.
const scanResultSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  hydration: { type: Number, required: true, min: 0, max: 100 },
  oilLevel: { type: Number, required: true, min: 0, max: 100 },
  redness: { type: Number, required: true, min: 0, max: 100 },
  ita: { type: Number },
  toneCategory: { type: String, enum: ['Very light', 'Light', 'Intermediate', 'Tan', 'Brown', 'Dark', null] },
  detectedSkinType: { type: String, required: true },
  method: { type: String, default: 'cv-heuristic-v1' }, // see README: what this does and doesn't mean
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ScanResult', scanResultSchema);
