require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const scanRoutes = require('./routes/scan');
const userRoutes = require('./routes/user');
const recommendRoutes = require('./routes/recommend');
const analysisRoutes = require('./routes/analysis');
const { isEmailConfigured } = require('./utils/mailer');
const { isSmsConfigured } = require('./utils/sms');

const app = express();
app.use(express.json({ limit: '5mb' }));

const corsOrigin = process.env.CLIENT_ORIGIN && process.env.CLIENT_ORIGIN.trim()
  ? process.env.CLIENT_ORIGIN.split(',').map(s => s.trim())
  : '*';
app.use(cors({ origin: corsOrigin }));

// Serve frontend public assets directly if present
const possibleFrontendDirs = [
  path.join(__dirname, '..', 'frontend', 'public'),
  path.join(__dirname, 'frontend', 'public'),
  path.join(__dirname, 'public'),
  path.join(process.cwd(), 'frontend', 'public'),
  path.join(process.cwd(), 'cutis2', 'frontend', 'public')
];
const frontendDir = possibleFrontendDirs.find(d => fs.existsSync(d));
if (frontendDir) {
  app.use(express.static(frontendDir));
}

app.get('/api/health', async (req, res) => {
  await require('./utils/database').connectDb();
  res.json({
    ok: true,
    dbConnected: mongoose.connection.readyState === 1,
    emailConfigured: isEmailConfigured(),
    smsConfigured: isSmsConfigured(),
    googleConfigured: !!process.env.GOOGLE_CLIENT_ID,
    passwordAuth: process.env.CUTIS_GOOGLE_ONLY !== 'true',
    time: new Date().toISOString()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/users', userRoutes);
app.use('/api/recommend', recommendRoutes);
app.use('/api/analysis', analysisRoutes);

// Fallback for non-API web routes: serve frontend index.html
if (frontendDir && fs.existsSync(path.join(frontendDir, 'index.html'))) {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
}

// JSON 404 for unmatched API routes.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Centralized error handler.
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const { connectDb } = require('./utils/database');
module.exports = { app, connectDb };
