const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const DEFAULT_ACCOUNTS_FILE = path.join(__dirname, 'data', 'accounts.json');
let accountsFilePath = DEFAULT_ACCOUNTS_FILE;
let accountOverridesCache = null;

function setAccountsFileForTesting(customPath) {
  accountsFilePath = customPath;
  accountOverridesCache = null;
}

function clearAccountsForTesting() {
  accountOverridesCache = {};
  if (accountsFilePath) {
    try {
      if (fs.existsSync(accountsFilePath)) fs.unlinkSync(accountsFilePath);
    } catch {
      // ignore
    }
  }
}

function loadOverrides() {
  if (accountOverridesCache !== null) return accountOverridesCache;
  if (!accountsFilePath) {
    accountOverridesCache = {};
    return accountOverridesCache;
  }
  try {
    if (fs.existsSync(accountsFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(accountsFilePath, 'utf8'));
      accountOverridesCache = parsed && typeof parsed === 'object' ? parsed : {};
    } else {
      accountOverridesCache = {};
    }
  } catch (err) {
    console.warn('[Auth] Failed to load accounts overrides:', err.message);
    accountOverridesCache = {};
  }
  return accountOverridesCache;
}

function saveOverrides(overrides) {
  accountOverridesCache = overrides;
  if (!accountsFilePath) return;
  try {
    fs.mkdirSync(path.dirname(accountsFilePath), { recursive: true });
    fs.writeFileSync(accountsFilePath, JSON.stringify(overrides, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Auth] Failed to save accounts overrides:', err.message);
  }
}

function getSecret() {
  return process.env.JWT_SECRET || '';
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Build configured accounts from environment variables:
 * - 1 Admin (ADMIN_USERNAME / ADMIN_PASSWORD)
 * - 2 Staff counters:
 *   - Staff 1 / Counter 1: STAFF1_USERNAME / STAFF1_PASSWORD (falls back to existing AUTH_USERNAME / AUTH_PASSWORD)
 *   - Staff 2 / Counter 2: STAFF2_USERNAME / STAFF2_PASSWORD
 */
function getConfiguredAccounts() {
  const accounts = [];
  const overrides = loadOverrides();

  const adminUser = (process.env.ADMIN_USERNAME || '').trim();
  const adminPass = process.env.ADMIN_PASSWORD || '';
  if (adminUser && adminPass) {
    accounts.push({
      id: 'admin',
      username: adminUser,
      password: adminPass,
      role: 'admin',
      name: (process.env.ADMIN_NAME || 'Admin').trim(),
      counter: null,
    });
  }

  const staff1BaseUser = (process.env.STAFF1_USERNAME || process.env.AUTH_USERNAME || '').trim();
  const staff1BasePass = process.env.STAFF1_PASSWORD || process.env.AUTH_PASSWORD || '';
  const s1Ov = overrides.staff1 || {};
  const staff1User = (s1Ov.username ?? staff1BaseUser).trim();
  const staff1Pass = s1Ov.password ?? staff1BasePass;
  if (staff1User && staff1Pass) {
    const baseCounter = (process.env.STAFF1_COUNTER || 'Counter 1').trim();
    const counter = (s1Ov.counter ?? baseCounter).trim();
    const name = (s1Ov.name ?? process.env.STAFF1_NAME ?? counter).trim();
    accounts.push({
      id: 'staff1',
      username: staff1User,
      password: staff1Pass,
      role: 'staff',
      name,
      counter,
    });
  }

  const staff2BaseUser = (process.env.STAFF2_USERNAME || '').trim();
  const staff2BasePass = process.env.STAFF2_PASSWORD || '';
  const s2Ov = overrides.staff2 || {};
  const staff2User = (s2Ov.username ?? staff2BaseUser).trim();
  const staff2Pass = s2Ov.password ?? staff2BasePass;
  if (staff2User && staff2Pass) {
    const baseCounter = (process.env.STAFF2_COUNTER || 'Counter 2').trim();
    const counter = (s2Ov.counter ?? baseCounter).trim();
    const name = (s2Ov.name ?? process.env.STAFF2_NAME ?? counter).trim();
    accounts.push({
      id: 'staff2',
      username: staff2User,
      password: staff2Pass,
      role: 'staff',
      name,
      counter,
    });
  }

  return accounts;
}

function getPublicAccounts() {
  return getConfiguredAccounts().map(({ password, ...rest }) => rest);
}

function updateStaffAccount(id, updates = {}) {
  if (id !== 'staff1' && id !== 'staff2') {
    const err = new Error('Staff account not found');
    err.statusCode = 404;
    throw err;
  }

  const accounts = getConfiguredAccounts();
  const current = accounts.find((a) => a.id === id);
  if (!current) {
    const err = new Error('Staff account not found');
    err.statusCode = 404;
    throw err;
  }

  const nextUsername =
    updates.username !== undefined ? String(updates.username).trim() : current.username;
  const nextName = updates.name !== undefined ? String(updates.name).trim() : current.name;
  const nextCounter =
    updates.counter !== undefined ? String(updates.counter).trim() : current.counter;
  const nextPassword =
    updates.password !== undefined && String(updates.password) !== ''
      ? String(updates.password)
      : current.password;

  if (!nextUsername) {
    const err = new Error('Username is required');
    err.statusCode = 400;
    throw err;
  }
  if (!nextName) {
    const err = new Error('Staff name is required');
    err.statusCode = 400;
    throw err;
  }
  if (!nextCounter) {
    const err = new Error('Counter name is required');
    err.statusCode = 400;
    throw err;
  }

  const conflict = accounts.find(
    (a) => a.id !== id && a.username.toLowerCase() === nextUsername.toLowerCase()
  );
  if (conflict) {
    const err = new Error(`Username "${nextUsername}" is already used by another account`);
    err.statusCode = 400;
    throw err;
  }

  const overrides = { ...loadOverrides() };
  overrides[id] = {
    username: nextUsername,
    password: nextPassword,
    name: nextName,
    counter: nextCounter,
  };
  saveOverrides(overrides);

  return {
    id,
    username: nextUsername,
    role: 'staff',
    name: nextName,
    counter: nextCounter,
  };
}

function login(req, res) {
  const secret = getSecret();
  const accounts = getConfiguredAccounts();
  if (!secret || accounts.length === 0) {
    return res.status(500).json({
      error:
        'Login is not configured. Set JWT_SECRET and ADMIN_USERNAME/ADMIN_PASSWORD (or AUTH_USERNAME/AUTH_PASSWORD) in server/.env',
    });
  }

  const { username, password } = req.body || {};
  const inputUser = String(username ?? '').trim();
  const inputPass = String(password ?? '');

  // Check all accounts in constant time per comparison without short-circuiting early
  let matched = null;
  for (const acc of accounts) {
    const okUser = safeEqual(inputUser, acc.username);
    const okPass = safeEqual(inputPass, acc.password);
    if (okUser && okPass && !matched) {
      matched = acc;
    }
  }

  if (!matched) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || '12h';
  const payload = {
    id: matched.id,
    sub: matched.username,
    role: matched.role,
    name: matched.name,
    counter: matched.counter,
  };
  const token = jwt.sign(payload, secret, { expiresIn });
  res.json({
    token,
    user: {
      id: matched.id,
      username: matched.username,
      role: matched.role,
      name: matched.name,
      counter: matched.counter,
    },
  });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, getSecret());
    req.user = {
      id: decoded.id || null,
      sub: decoded.sub,
      username: decoded.sub,
      role: decoded.role || 'admin',
      name: decoded.name || decoded.sub,
      counter: decoded.counter ?? null,
    };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function me(req, res) {
  res.json({
    user: {
      id: req.user.id || null,
      username: req.user.username,
      role: req.user.role,
      name: req.user.name,
      counter: req.user.counter,
    },
  });
}

module.exports = {
  login,
  requireAuth,
  requireAdmin,
  me,
  getPublicAccounts,
  updateStaffAccount,
  setAccountsFileForTesting,
  clearAccountsForTesting,
};
