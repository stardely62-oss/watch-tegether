import crypto from 'crypto';
import { db } from './db.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * DAY_MS;

function sessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    `${process.env.TELEGRAM_BOT_TOKEN || 'dev'}:watch-together-session`
  );
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(s, 'base64').toString('utf8');
}

export function signSession(userId) {
  const payload = {
    uid: userId,
    exp: Date.now() + SESSION_TTL_MS,
    iat: Date.now(),
  };
  const body = b64urlJson(payload);
  const sig = b64url(
    crypto.createHmac('sha256', sessionSecret()).update(body).digest()
  );
  return `${body}.${sig}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64url(
    crypto.createHmac('sha256', sessionSecret()).update(body).digest()
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(body));
    if (!payload.uid || !payload.exp || payload.exp < Date.now()) return null;
    const user = db.getUser(payload.uid);
    if (!user || user.banned) return null;
    return user;
  } catch {
    return null;
  }
}

/** Optional auth — sets req.user if valid token */
export function optionalAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  req.user = token ? verifySession(token) : null;
  next();
}

/** Required login */
export function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'Нужен вход через Telegram' });
    }
    next();
  });
}

/** Required admin */
export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!db.isAdmin(req.user.id)) {
      return res.status(403).json({ error: 'Нужны права админа' });
    }
    next();
  });
}
