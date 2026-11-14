const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function getSecret() {
  return process.env.JWT_SECRET || '';
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function login(req, res) {
  const secret = getSecret();
  const validUser = process.env.AUTH_USERNAME;
  const validPass = process.env.AUTH_PASSWORD;
  if (!secret || !validUser || !validPass) {
    return res.status(500).json({
      error: 'Login is not configured. Set JWT_SECRET, AUTH_USERNAME and AUTH_PASSWORD in server/.env',
    });
  }

  const { username, password } = req.body || {};
  const okUser = safeEqual(username ?? '', validUser);
  const okPass = safeEqual(password ?? '', validPass);
  if (!(okUser && okPass)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || '12h';
  const token = jwt.sign({ sub: validUser }, secret, { expiresIn });
  res.json({ token, user: { username: validUser } });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, getSecret());
    next();
  } catch (err) {
    res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

function me(req, res) {
  res.json({ user: { username: req.user.sub } });
}

module.exports = { login, requireAuth, me };
