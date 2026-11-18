const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ---- Passwords: scrypt with a random salt per password ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [alg, saltHex, keyHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(keyHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

// ---- Signed login tokens (HMAC-SHA256, similar to a JWT) ----
let secret = null;
function getSecret() {
  if (secret) return secret;
  if (config.JWT_SECRET) return (secret = config.JWT_SECRET);
  const keyFile = path.join(config.DATA_DIR, 'secret.key');
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  if (fs.existsSync(keyFile)) secret = fs.readFileSync(keyFile, 'utf8').trim();
  else { secret = crypto.randomBytes(48).toString('hex'); fs.writeFileSync(keyFile, secret, { mode: 0o600 }); }
  return secret;
}

const sign = (body) => crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');

function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + config.TOKEN_TTL_HOURS * 3600 * 1000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp && payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
