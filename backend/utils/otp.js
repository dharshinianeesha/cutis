const crypto = require('crypto');
const bcrypt = require('bcryptjs');

function generateCode() {
  // Cryptographically random 6-digit code, not Math.random().
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

async function hashCode(code) {
  return bcrypt.hash(code, 10);
}

async function verifyCode(code, hash) {
  return bcrypt.compare(code, hash);
}

module.exports = { generateCode, hashCode, verifyCode };
