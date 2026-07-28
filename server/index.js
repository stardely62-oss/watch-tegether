import express from 'express';
import cors from 'cors';
import compression from 'compression';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import * as catalog from './catalog.js';
import { isTelegramConfigured, notifyTelegram, notifyUsersExcept } from './notify.js';
import {
  validateLoginWidget,
  validateWebAppInitData,
} from './telegramAuth.js';
import { requireAdmin, requireAuth, signSession } from './auth.js';
import {
  handleUpdate,
  setupBotProfile,
  verifyWebhookSecret,
  webAppUrl,
} from './telegramBot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root (no dotenv dependency)
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
loadEnvFile();

const app = express();
const PORT = process.env.PORT || 3001;
const distPath = path.join(__dirname, '..', 'dist');
const isProd =
  process.env.NODE_ENV === 'production' || fs.existsSync(distPath);

app.disable('x-powered-by');
app.use(compression({ threshold: 512 }));
app.use(cors());
app.use(express.json({ limit: '256kb' }));

// ——— Simple sliding-window rate limit (no redis) ———
function rateLimit({ windowMs = 60_000, max = 60, keyFn } = {}) {
  const hits = new Map(); // key -> number[]
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip || req.socket.remoteAddress || 'anon';
    const now = Date.now();
    let arr = hits.get(key) || [];
    arr = arr.filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Слишком много запросов, подожди' });
    }
    arr.push(now);
    hits.set(key, arr);
    // opportunistic cleanup
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        const live = v.filter((t) => now - t < windowMs);
        if (!live.length) hits.delete(k);
        else hits.set(k, live);
      }
    }
    next();
  };
}

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
  req.socket.remoteAddress ||
  'anon';

// ——— API ———

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: db.getVersion() });
});

// ——— Telegram auth (Mini App + Login Widget) ———
let botInfoCache = null;
async function getBotInfo() {
  if (botInfoCache) return botInfoCache;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.ok) {
      botInfoCache = data.result;
      return botInfoCache;
    }
  } catch (e) {
    console.warn('getMe failed:', e.message);
  }
  return null;
}

async function setupTelegramWebApp() {
  try {
    await setupBotProfile();
  } catch (e) {
    console.warn('telegram setup:', e.message);
  }
}

/** Telegram webhook — /start, /app open WebApp buttons */
app.post('/api/telegram/webhook', async (req, res) => {
  const secretHdr = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!verifyWebhookSecret(secretHdr)) {
    return res.status(401).json({ error: 'bad webhook secret' });
  }
  try {
    await handleUpdate(req.body || {});
  } catch (e) {
    console.warn('webhook handle:', e.message);
  }
  // Always 200 so Telegram does not retry forever
  res.json({ ok: true });
});

app.get('/api/auth/telegram/config', async (_req, res) => {
  const bot = await getBotInfo();
  const username =
    bot?.username || process.env.TELEGRAM_BOT_USERNAME || 'asjojfapfBot';
  const url = webAppUrl();
  res.json({
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    botUsername: username,
    webAppUrl: url,
    directLink: `https://t.me/${username}/app`,
    startAppLink: `https://t.me/${username}?startapp`,
    loginWidget: true,
  });
});

app.post('/api/auth/telegram', async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(503).json({ error: 'Telegram-бот не настроен' });
  }
  const { initData, widget } = req.body || {};

  let validated;
  if (initData) {
    validated = validateWebAppInitData(initData, token);
  } else if (widget && typeof widget === 'object') {
    validated = validateLoginWidget(widget, token);
  } else {
    return res.status(400).json({ error: 'Нужен initData или widget' });
  }

  if (!validated.ok) {
    return res.status(401).json({ error: validated.error });
  }

  const result = db.upsertTelegramUser(validated.user);
  if (result.error) {
    return res.status(403).json({ error: result.error });
  }

  if (!result.existing) {
    notifyTelegram(
      `👋 Новый пользователь: ${result.user.name}` +
        (result.user.username ? ` (@${result.user.username})` : '')
    ).catch(() => {});
  }

  const sessionToken = signSession(result.user.id);
  res.status(result.existing ? 200 : 201).json({
    user: result.user,
    token: sessionToken,
  });
});

// Users
app.get('/api/users', requireAuth, (_req, res) => {
  res.json(db.listUsers());
});

app.post('/api/users', (_req, res) => {
  return res.status(400).json({
    error: 'Вход только через Telegram. Открой мини-приложение в боте.',
  });
});

app.get('/api/users/:id', requireAuth, (req, res) => {
  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  res.json(user);
});

app.post('/api/users/me/ping', requireAuth, (req, res) => {
  const user = db.touchUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  res.json({ ok: true, lastSeenAt: user.lastSeenAt });
});

app.post('/api/users/:id/ban', requireAdmin, (req, res) => {
  const banned = req.body?.banned !== false;
  const result = db.setUserBanned(req.user.id, req.params.id, banned);
  if (result.error) return res.status(403).json({ error: result.error });
  res.json(result.user);
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const result = db.deleteUser(req.user.id, req.params.id);
  if (result.error) return res.status(403).json({ error: result.error });
  res.json({ ok: true });
});

app.get('/api/room', requireAuth, (req, res) => {
  const settings = db.getSettings();
  res.json({
    roomName: settings.roomName,
    telegram: isTelegramConfigured(),
    isAdmin: db.isAdmin(req.user.id),
  });
});

app.get('/api/taste', requireAuth, (req, res) => {
  const other = req.query.b || req.query.other;
  if (!other) return res.status(400).json({ error: 'Нужен other/b (userId)' });
  res.json(db.tasteCompare(req.user.id, other));
});

const POSTER_URL_MAX = 500;

function truncateText(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function computeStatsFromData(data) {
  const media = data.media || [];
  const users = (data.users || []).filter((u) => !u.banned);
  const ratings = data.ratings || [];
  return {
    total: media.length,
    movies: media.filter((m) => m.type === 'movie').length,
    series: media.filter((m) => m.type === 'series').length,
    anime: media.filter((m) => m.type === 'anime').length,
    watched: media.filter((m) => m.status === 'watched').length,
    want: media.filter((m) => m.status === 'want').length,
    watching: media.filter((m) => m.status === 'watching').length,
    tonight: media.filter((m) => m.suggestedTonight).length,
    users: users.length,
    ratings: ratings.length,
  };
}

function mediaExtraFields(item) {
  return {
    note: item.note || '',
    watchedAt: item.watchedAt || null,
    progressSeason: item.progressSeason ?? null,
    progressEpisode: item.progressEpisode ?? null,
    watchLinks: Array.isArray(item.watchLinks) ? item.watchLinks : [],
    trailerUrl: item.trailerUrl || '',
    genres: Array.isArray(item.genres) ? item.genres : [],
    suggestedTonight: Boolean(item.suggestedTonight),
    suggestedBy: item.suggestedBy || null,
    suggestedAt: item.suggestedAt || null,
    commentCount: 0,
  };
}

function groupBy(arr, key) {
  const map = new Map();
  for (const row of arr) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

function preferSmallPoster(url) {
  if (!url) return '';
  const s = String(url);
  // Kinopoisk CDN size suffixes: prefer 300x450 when a larger size is present
  return s
    .replace(/\/orig$/i, '/300x450')
    .replace(/\/\d{3,4}x\d{3,4}$/i, '/300x450')
    .slice(0, POSTER_URL_MAX);
}

/**
 * @param {object} opts
 * @param {boolean} [opts.full] include description + ratings
 * @param {boolean} [opts.list] card list: no description
 * @param {string|null} [opts.status]
 * @param {string|null} [opts.type]
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 */
function enrichMediaList(userId, opts = {}) {
  const {
    full = false,
    list = true,
    status = null,
    type = null,
    limit = null,
    offset = 0,
  } = opts;

  const data = db.peek();
  const usersById = new Map((data.users || []).map((u) => [u.id, u]));
  const ratingsByMedia = groupBy(data.ratings || [], 'mediaId');
  const favByMedia = groupBy(data.favorites || [], 'mediaId');
  const commentsByMedia = groupBy(data.comments || [], 'mediaId');

  let media = [...(data.media || [])].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  if (status && ['want', 'watching', 'watched'].includes(status)) {
    media = media.filter((m) => m.status === status);
  }
  if (type && ['movie', 'series', 'anime'].includes(type)) {
    media = media.filter((m) => m.type === type);
  }
  const total = media.length;
  const off = Math.max(0, Number(offset) || 0);
  if (limit != null && Number.isFinite(Number(limit))) {
    const lim = Math.min(200, Math.max(1, Number(limit)));
    media = media.slice(off, off + lim);
  }

  const items = media.map((item) => {
    const ratings = ratingsByMedia.get(item.id) || [];
    const avg =
      ratings.length > 0
        ? Math.round(
            (ratings.reduce((s, r) => s + r.score, 0) / ratings.length) * 10
          ) / 10
        : null;
    const myRating = userId
      ? ratings.find((r) => r.userId === userId) || null
      : null;
    const favs = favByMedia.get(item.id) || [];
    const isFavorite = userId
      ? favs.some((f) => f.userId === userId)
      : false;
    const addedByUser = usersById.get(item.addedBy) || null;
  const soloUser = item.soloUserId ? (usersById.get(item.soloUserId) || null) : null;
    const watchedByUsers = Array.isArray(item.watchedByUsers) ? item.watchedByUsers : (item.soloUserId ? [item.soloUserId] : []);
    const watchedByUsersDetails = watchedByUsers.map((uid) => usersById.get(uid)).filter(Boolean).map((u) => ({ id: u.id, name: u.name, color: u.color }));
    const comments = commentsByMedia.get(item.id) || [];

    const base = {
      id: item.id,
      title: item.title,
      type: item.type,
      year: item.year,
      posterUrl: preferSmallPoster(item.posterUrl),
      status: item.status,
      watchMode: item.watchMode || "together",
      soloUserId: item.soloUserId || null,
      soloUser: soloUser ? { id: soloUser.id, name: soloUser.name, color: soloUser.color } : null,
    watchedByUsers,
    watchedByUsersDetails,
    hasWatchedSolo: userId ? watchedByUsers.includes(userId) : false,
      addedBy: item.addedBy,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      avgRating: avg,
      ratingCount: ratings.length,
      myRating,
      isFavorite,
      favoriteCount: favs.length,
      ...mediaExtraFields(item),
      commentCount: comments.length,
      note: list && !full ? (item.note ? String(item.note).slice(0, 80) : '') : item.note || '',
      addedByUser: addedByUser
        ? {
            id: addedByUser.id,
            name: addedByUser.name,
            color: addedByUser.color,
            photoUrl: addedByUser.photoUrl || null,
          }
        : item.addedBy
          ? null
          : { id: null, name: 'неизвестно', color: '#64748b', photoUrl: null },
    };

    if (full || !list) {
      base.description = item.description || '';
      base.note = item.note || '';
    }

    if (full) {
      base.ratings = ratings.map((r) => ({
        ...r,
        review: truncateText(r.review, 500),
        user: usersById.get(r.userId)
          ? {
              id: usersById.get(r.userId).id,
              name: usersById.get(r.userId).name,
              color: usersById.get(r.userId).color,
            }
          : null,
      }));
      base.comments = comments.map((c) => ({
        ...c,
        user: usersById.get(c.userId)
          ? {
              id: usersById.get(c.userId).id,
              name: usersById.get(c.userId).name,
              color: usersById.get(c.userId).color,
            }
          : null,
      }));
    }
    return base;
  });

  return {
    items,
    total,
    offset: off,
    limit: limit != null ? Number(limit) : total,
    stats: computeStatsFromData(data),
    version: db.getVersion(),
    users: db.listUsers(),
    room: {
      roomName: db.getSettings().roomName,
      telegram: isTelegramConfigured(),
    },
  };
}



function enrichOne(item, userId, { full = true } = {}) {
  if (!item) return null;
  const data = db.peek();
  const usersById = new Map((data.users || []).map((u) => [u.id, u]));
  const ratings = (data.ratings || []).filter((r) => r.mediaId === item.id);
  const favs = (data.favorites || []).filter((f) => f.mediaId === item.id);
  const comments = (data.comments || []).filter((c) => c.mediaId === item.id);
  const avg =
    ratings.length > 0
      ? Math.round(
          (ratings.reduce((s, r) => s + r.score, 0) / ratings.length) * 10
        ) / 10
      : null;
  const myRating = userId
    ? ratings.find((r) => r.userId === userId) || null
    : null;
  const addedByUser = usersById.get(item.addedBy) || null;
  const soloUser = item.soloUserId ? (usersById.get(item.soloUserId) || null) : null;
    const watchedByUsers = Array.isArray(item.watchedByUsers) ? item.watchedByUsers : (item.soloUserId ? [item.soloUserId] : []);
    const watchedByUsersDetails = watchedByUsers.map((uid) => usersById.get(uid)).filter(Boolean).map((u) => ({ id: u.id, name: u.name, color: u.color }));
  const out = {
    id: item.id,
    title: item.title,
    type: item.type,
    year: item.year,
    description: full ? item.description || '' : undefined,
    posterUrl: preferSmallPoster(item.posterUrl),
    status: item.status,
    watchMode: item.watchMode || "together",
    soloUserId: item.soloUserId || null,
    soloUser: soloUser ? { id: soloUser.id, name: soloUser.name, color: soloUser.color } : null,
    watchedByUsers,
    watchedByUsersDetails,
    soloStatuses: item.soloStatuses || {},
    hasWatchedSolo: userId ? watchedByUsers.includes(userId) : false,
    addedBy: item.addedBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    avgRating: avg,
    ratingCount: ratings.length,
    myRating,
    isFavorite: userId ? favs.some((f) => f.userId === userId) : false,
    favoriteCount: favs.length,
    ...mediaExtraFields(item),
    commentCount: comments.length,
    addedByUser: addedByUser
      ? {
          id: addedByUser.id,
          name: addedByUser.name,
          color: addedByUser.color,
          photoUrl: addedByUser.photoUrl || null,
        }
      : item.addedBy
        ? null
        : { id: null, name: 'неизвестно', color: '#64748b', photoUrl: null },
  };
  if (full) {
    out.ratings = ratings.map((r) => {
      const u = usersById.get(r.userId);
      return {
        ...r,
        review: truncateText(r.review, 500),
        user: u ? { id: u.id, name: u.name, color: u.color } : null,
      };
    });
    out.comments = comments
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((c) => {
        const u = usersById.get(c.userId);
        return {
          ...c,
          user: u ? { id: u.id, name: u.name, color: u.color } : null,
        };
      });
  }
  return out;
}

function enrichMedia(item, userId, opts) {
  return enrichOne(item, userId, opts);
}

function makeEtag(version, userId, extra = '') {
  const h = crypto
    .createHash('sha1')
    .update(`${version}:${userId || ''}:${extra}`)
    .digest('hex')
    .slice(0, 16);
  return `W/"v${version}-${h}"`;
}

function maybeNotModified(req, res, etag) {
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  const inm = req.headers['if-none-match'];
  if (inm && inm === etag) {
    res.status(304).end();
    return true;
  }
  return false;
}

/** Clear bootstrap contract for the home screen */
app.get('/api/bootstrap', requireAuth, (req, res) => {
  const userId = req.user.id;
  const status = req.query.status || null;
  const type = req.query.type || null;
  const limit =
    req.query.limit != null ? parseInt(req.query.limit, 10) : null;
  const offset = parseInt(req.query.offset, 10) || 0;

  const payload = enrichMediaList(userId, {
    list: true,
    full: false,
    status,
    type,
    limit: Number.isFinite(limit) ? limit : null,
    offset,
  });

  const etag = makeEtag(
    payload.version,
    userId,
    `${status || ''}:${type || ''}:${limit || ''}:${offset}`
  );
  if (maybeNotModified(req, res, etag)) return;

  db.touchUser(userId);
  res.json({
    version: payload.version,
    stats: payload.stats,
    items: payload.items,
    total: payload.total,
    offset: payload.offset,
    limit: payload.limit,
    users: payload.users,
    room: payload.room,
  });
});

app.get('/api/media', requireAuth, (req, res) => {
  const userId = req.user.id;
  const withStats =
    req.query.withStats === '1' || req.query.withStats === 'true';
  const status = req.query.status || null;
  const type = req.query.type || null;
  const limit =
    req.query.limit != null ? parseInt(req.query.limit, 10) : null;
  const offset = parseInt(req.query.offset, 10) || 0;

  const payload = enrichMediaList(userId, {
    list: true,
    full: false,
    status,
    type,
    limit: Number.isFinite(limit) ? limit : null,
    offset,
  });

  if (withStats || limit != null || status || type) {
    const etag = makeEtag(
      payload.version,
      userId,
      `m:${status || ''}:${type || ''}:${limit || ''}:${offset}`
    );
    if (maybeNotModified(req, res, etag)) return;
    return res.json({
      items: payload.items,
      stats: payload.stats,
      total: payload.total,
      offset: payload.offset,
      limit: payload.limit,
      version: payload.version,
    });
  }

  res.json(payload.items);
});

app.get('/api/media/:id', requireAuth, (req, res) => {
  const item = db.getMedia(req.params.id);
  if (!item) return res.status(404).json({ error: 'Не найден' });
  res.json(enrichMedia(item, req.user.id, { full: true }));
});

app.post('/api/media', requireAuth, async (req, res) => {
  const body = req.body || {};
  const {
    title,
    type,
    year,
    description,
    posterUrl,
    status,
    note,
    genres,
    trailerUrl,
    watchLinks,
    progressSeason,
    progressEpisode,
    watchMode,
    soloUserId,
    force = false,
  } = body;
  const addedBy = req.user.id;
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'Укажи название' });
  }
  if (!['movie', 'series', 'anime'].includes(type)) {
    return res
      .status(400)
      .json({ error: 'Тип: movie, series или anime' });
  }
  const validStatus = ['want', 'watching', 'watched'].includes(status)
    ? status
    : 'want';

  if (!force) {
    const dup = db.findDuplicate({ title, year, type });
    if (dup) {
      return res.status(409).json({
        error: 'Такой тайтл уже есть в списке',
        code: 'duplicate',
        existing: enrichMedia(dup, addedBy, { full: false }),
      });
    }
  }

  const result = db.createMedia({
    title,
    type,
    year,
    description,
    posterUrl: preferSmallPoster(posterUrl),
    addedBy,
    status: validStatus,
    note,
    genres,
    trailerUrl,
    watchLinks,
    progressSeason,
    progressEpisode,
    watchMode,
    soloUserId,
    force: Boolean(force),
  });
  if (result.error === 'already_exists') {
    return res.status(409).json({
      error: 'Такой тайтл уже есть в списке',
      code: 'duplicate',
      existing: enrichMedia(result.existing, addedBy, { full: false }),
    });
  }
  const enriched = enrichMedia(result.item, addedBy, { full: false });
  notifyUsersExcept(
    req.user.id,
    `🎬 ${req.user.name} добавил(а): «${result.item.title}»${
      result.item.year ? ` (${result.item.year})` : ''
    }\nСтатус: ${result.item.status === 'watched' ? 'Просмотрено' : 'Хотим посмотреть'}`
  ).catch(() => {});
  res.status(201).json(enriched);
});

app.patch('/api/media/:id', requireAuth, async (req, res) => {
  const body = { ...(req.body || {}) };
  delete body.addedBy;
  delete body.userId;
  body.userId = req.user.id;
  if (body.posterUrl) body.posterUrl = preferSmallPoster(body.posterUrl);
  const prev = db.getMedia(req.params.id);
  const item = db.updateMedia(req.params.id, body);
  if (!item) return res.status(404).json({ error: 'Не найден' });
  if (body.suggestedTonight && !prev?.suggestedTonight) {
    notifyUsersExcept(
      req.user.id,
      `🌙 ${req.user.name} предлагает на вечер: «${item.title}»`
    ).catch(() => {});
  }
  res.json(enrichMedia(item, req.user.id, { full: false }));
});

app.delete('/api/media/:id', requireAuth, (req, res) => {
  const ok = db.deleteMedia(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Не найден' });
  res.json({ ok: true });
});

// Comments
app.get('/api/media/:id/comments', requireAuth, (req, res) => {
  const item = db.getMedia(req.params.id);
  if (!item) return res.status(404).json({ error: 'Не найден' });
  const rawUsers = new Map(db.peek().users.map((u) => [u.id, u]));
  const comments = db.listComments(req.params.id).map((c) => {
    const u = rawUsers.get(c.userId);
    return {
      ...c,
      user: u ? { id: u.id, name: u.name, color: u.color } : null,
    };
  });
  res.json(comments);
});

app.post('/api/media/:id/comments', requireAuth, async (req, res) => {
  const { text } = req.body || {};
  const result = db.addComment({
    mediaId: req.params.id,
    userId: req.user.id,
    text,
  });
  if (result.error) return res.status(400).json({ error: result.error });
  const media = db.getMedia(req.params.id);
  notifyUsersExcept(
    req.user.id,
    `💬 ${req.user.name} оставил(а) комментарий к «${media?.title}»:\n«${String(text).slice(0, 200)}»`
  ).catch(() => {});
  res.status(201).json({
    ...result.comment,
    user: {
      id: req.user.id,
      name: req.user.name,
      color: req.user.color,
    },
  });
});

app.delete(
  '/api/media/:id/comments/:commentId',
  requireAuth,
  (req, res) => {
    const result = db.deleteComment({
      commentId: req.params.commentId,
      userId: req.user.id,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  }
);

// Ratings
app.post('/api/media/:id/rating', requireAuth, async (req, res) => {
  const { score, review } = req.body || {};
  const userId = req.user.id;
  const result = db.upsertRating({
    mediaId: req.params.id,
    userId,
    score,
    review,
  });
  if (result.error) return res.status(400).json({ error: result.error });
  const media = db.getMedia(req.params.id);
  if (media && media.status !== 'watched') {
    db.updateMedia(req.params.id, { status: 'watched' });
  }
  const m = db.getMedia(req.params.id);
  notifyUsersExcept(
    req.user.id,
    `⭐ ${req.user.name} поставил(а) ${score}/10 тайтлу «${m?.title}»${
      review ? `\n«${String(review).slice(0, 150)}»` : ''
    }`
  ).catch(() => {});
  res.json(enrichMedia(db.getMedia(req.params.id), userId, { full: false }));
});

app.delete('/api/media/:id/rating', requireAuth, (req, res) => {
  const userId = req.user.id;
  db.deleteRating(req.params.id, userId);
  res.json(enrichMedia(db.getMedia(req.params.id), userId, { full: false }));
});


// Solo Status toggle
app.post('/api/media/:id/solo-status', requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!['watched', 'want', 'watching'].includes(status)) {
    return res.status(400).json({ error: 'Неверный статус' });
  }
  const item = db.setSoloStatus(req.params.id, req.user.id, status);
  if (!item) return res.status(404).json({ error: 'Не найден' });

  if (item.soloStatuses && item.soloStatuses[req.user.id] === 'watched') {
    notifyUsersExcept(
      req.user.id,
      `👀 ${req.user.name} отметил(а) «+ Я тоже посмотрел(а)» для «${item.title}»!`
    ).catch(() => {});
  }

  res.json(enrichMedia(item, req.user.id, { full: false }));
});

// Favorites
app.post('/api/media/:id/favorite', requireAuth, (req, res) => {
  const userId = req.user.id;
  const result = db.toggleFavorite(req.params.id, userId);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({
    ...result,
    media: enrichMedia(db.getMedia(req.params.id), userId, { full: false }),
  });
});

// Stats
app.get('/api/stats', requireAuth, (_req, res) => {
  res.json(computeStatsFromData(db.peek()));
});


// ——— Image proxy ———

const IMG_ALLOWED_HOSTS = new Set([
  'avatars.mds.yandex.net',
  'image.openmoviedb.com',
  'st.kp.yandex.net',
  'kinopoiskapiunofficial.tech',
  'www.kinopoisk.ru',
  'imagetmdb.com',
  'image.tmdb.org',
  'media.themoviedb.org',
]);

function isAllowedImageUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (IMG_ALLOWED_HOSTS.has(host)) return true;
    if (host.endsWith('.mds.yandex.net')) return true;
    if (host.endsWith('.yandex.net')) return true;
    if (host.endsWith('.kinopoisk.ru')) return true;
    if (host.endsWith('.themoviedb.org')) return true;
    return false;
  } catch {
    return false;
  }
}

const IMG_MEM_MAX = 100;
const imgMemCache = new Map();

function imgCacheGet(url) {
  const hit = imgMemCache.get(url);
  if (!hit) return null;
  imgMemCache.delete(url);
  imgMemCache.set(url, hit);
  return hit;
}

function imgCacheSet(url, buf, ct) {
  if (imgMemCache.has(url)) imgMemCache.delete(url);
  imgMemCache.set(url, { buf, ct, bytes: buf.length });
  while (imgMemCache.size > IMG_MEM_MAX) {
    const oldest = imgMemCache.keys().next().value;
    imgMemCache.delete(oldest);
  }
}

app.get(
  '/api/img',
  rateLimit({ windowMs: 60_000, max: 120, keyFn: clientIp }),
  async (req, res) => {
    const raw = String(req.query.url || '');
    if (!raw || !isAllowedImageUrl(raw)) {
      return res.status(400).json({ error: 'Недопустимый URL изображения' });
    }
    try {
      const cached = imgCacheGet(raw);
      if (cached) {
        res.setHeader('Content-Type', cached.ct);
        res.setHeader(
          'Cache-Control',
          'public, max-age=604800, stale-while-revalidate=86400, immutable'
        );
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('X-Img-Cache', 'HIT');
        return res.send(cached.buf);
      }

      const upstream = await fetch(raw, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; WatchTogether/1.0; +https://kino.barasek.net)',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          Referer: 'https://www.kinopoisk.ru/',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      if (!upstream.ok) {
        return res.status(upstream.status === 404 ? 404 : 502).json({
          error: `Upstream ${upstream.status}`,
        });
      }
      const ct = upstream.headers.get('content-type') || 'image/jpeg';
      if (!ct.startsWith('image/') && !ct.includes('octet-stream')) {
        return res.status(502).json({ error: 'Не изображение' });
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      const outCt = ct.startsWith('image/') ? ct : 'image/jpeg';
      if (buf.length <= 800 * 1024) {
        imgCacheSet(raw, buf, outCt);
      }
      res.setHeader('Content-Type', outCt);
      res.setHeader(
        'Cache-Control',
        'public, max-age=604800, stale-while-revalidate=86400, immutable'
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('X-Img-Cache', 'MISS');
      res.send(buf);
    } catch (e) {
      // quiet: high-volume endpoint, avoid log spam
      res.status(502).json({ error: 'Не удалось загрузить изображение' });
    }
  }
);

// ——— Catalog ———

const catalogLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyFn: clientIp,
});

app.get('/api/catalog/status', requireAuth, catalogLimit, (_req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.json(catalog.statusInfo());
});

app.get('/api/catalog/search', requireAuth, catalogLimit, async (req, res) => {
  try {
    if (!catalog.isConfigured()) {
      return res.status(503).json(catalog.statusInfo());
    }
    const q = String(req.query.q || req.query.query || '').trim();
    if (q.length < 1) {
      return res.status(400).json({ error: 'Укажи поисковый запрос q' });
    }
    const type = String(req.query.type || 'all');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const forceApi =
      req.query.forceApi === '1' || req.query.forceApi === 'true';
    const data = await catalog.searchCatalog(q, { type, page, forceApi });
    res.json({ ...data, configured: true });
  } catch (e) {
    console.error('catalog search:', e.message);
    res.status(e.status && e.status < 500 ? e.status : 502).json({
      error: e.message || 'Ошибка каталога',
    });
  }
});

app.get('/api/catalog/trending', requireAuth, catalogLimit, async (req, res) => {
  try {
    if (!catalog.isConfigured()) {
      return res.status(503).json(catalog.statusInfo());
    }
    const type = String(req.query.type || 'all');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const data = await catalog.trendingCatalog({ type, page });
    res.json({ ...data, configured: true });
  } catch (e) {
    console.error('catalog trending:', e.message);
    res.status(502).json({ error: e.message || 'Ошибка каталога' });
  }
});

app.get('/api/catalog/:mediaType/:id', requireAuth, catalogLimit, async (req, res) => {
  try {
    if (!catalog.isConfigured()) {
      return res.status(503).json({ error: 'Каталог не настроен' });
    }
    const item = await catalog.getDetails(req.params.mediaType, req.params.id);
    if (!item) return res.status(404).json({ error: 'Не найден' });
    res.json(item);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Ошибка каталога' });
  }
});

// Production: static SPA with long-cache hashed assets
if (isProd && fs.existsSync(distPath)) {
  app.use(
    express.static(distPath, {
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader(
            'Cache-Control',
            'public, max-age=31536000, immutable'
          );
        } else if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('sw.js') || filePath.endsWith('sw.js.map')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🎬 Watch Together → http://localhost:${PORT}`);
  const cat = catalog.statusInfo();
  console.log(
    cat.configured
      ? `   🎞  Каталог: ПоискКино (RU) ✓`
      : `   🎞  Каталог: нет POISKKINO_API_KEY`
  );
  setupTelegramWebApp().catch(() => {});
  if (!isProd) {
    console.log(`   API: http://localhost:${PORT}/api`);
    console.log(`   Frontend (Vite): http://localhost:5173`);
  }
});
