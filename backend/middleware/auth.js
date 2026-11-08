const jwt = require('jsonwebtoken');

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' || process.env.NETLIFY || process.env.VERCEL) {
    throw new Error('JWT_SECRET must be configured on the server.');
  }
  return 'cutis-local-development-only';
};

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.userId = payload.sub;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

function signSession(userId) {
  return jwt.sign({ sub: String(userId) }, getJwtSecret(), { expiresIn: '7d' });
}

module.exports = { requireAuth, signSession };
