const mongoose = require('mongoose');

// Mongoose queries hang/buffer indefinitely if the DB is disconnected.
// This returns a clear 503 instead of a silent timeout, and runs AFTER
// input validation in each route so bad input still gets a 400, not a 503.
async function requireDb(req, res, next) {
  await require('../utils/database').connectDb();
  if (mongoose.connection.readyState !== 1) {
    console.error('[db] MongoDB connection failed. Check Atlas credentials, network access and MONGODB_URI.');
    return res.status(503).json({ error: 'Database unavailable. Check the server MONGODB_URI, Atlas database user and network access settings.' });
  }
  next();
}

module.exports = { requireDb };
