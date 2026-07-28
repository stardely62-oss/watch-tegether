import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const MAX_DESCRIPTION = 2000;
const MAX_POSTER_URL = 500;
const MAX_TITLE = 200;
const MAX_REVIEW = 500;
const MAX_NOTE = 500;
const MAX_COMMENT = 800;
const MAX_LINK = 8;
const FLUSH_MS = 80;

function clip(str, max) {
  const s = String(str ?? '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max);
}

const defaultDb = () => ({
  users: [],
  media: [],
  ratings: [],
  favorites: [],
  comments: [],
  settings: {
    roomName: 'Watch Together',
    createdAt: new Date().toISOString(),
  },
});

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function atomicWriteJson(filePath, obj) {
  ensureDir();
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function migrate(data) {
  const base = defaultDb();
  const out = {
    users: Array.isArray(data.users) ? data.users : [],
    media: Array.isArray(data.media) ? data.media : [],
    ratings: Array.isArray(data.ratings) ? data.ratings : [],
    favorites: Array.isArray(data.favorites) ? data.favorites : [],
    comments: Array.isArray(data.comments) ? data.comments : [],
    settings: {
      ...base.settings,
      ...(data.settings && typeof data.settings === 'object' ? data.settings : {}),
    },
  };
  // Drop legacy invite codes
  if (out.settings.inviteCode) delete out.settings.inviteCode;
  // Normalize media fields
  out.media = out.media.map((m) => ({
    note: '',
    watchedAt: m.status === 'watched' ? m.watchedAt || m.updatedAt || null : null,
    progressSeason: null,
    progressEpisode: null,
    watchLinks: [],
    trailerUrl: '',
    genres: [],
    suggestedTonight: false,
    suggestedBy: null,
    suggestedAt: null,
    watchMode: m.watchMode || "together",
    watchedByUsers: Array.isArray(m.watchedByUsers) ? m.watchedByUsers : (m.soloUserId ? [m.soloUserId] : []),
    soloUserId: m.soloUserId || null,
    ...m,
    watchLinks: Array.isArray(m.watchLinks) ? m.watchLinks : [],
    genres: Array.isArray(m.genres) ? m.genres : [],
    addedBy: m.addedBy || null,
  }));
  // First user is admin if none
  if (out.users.length && !out.users.some((u) => u.role === 'admin')) {
    out.users[0].role = 'admin';
  }
  out.users = out.users.map((u) => ({
    role: u.role === 'admin' ? 'admin' : 'user',
    banned: Boolean(u.banned),
    lastSeenAt: u.lastSeenAt || u.createdAt || null,
    ...u,
  }));
  // Re-attach orphan media to first admin/user when possible
  const owner =
    out.users.find((u) => u.role === 'admin' && !u.banned) ||
    out.users.find((u) => !u.banned) ||
    null;
  if (owner) {
    for (const m of out.media) {
      if (!m.addedBy || !out.users.some((u) => u.id === m.addedBy)) {
        m.addedBy = owner.id;
      }
    }
  }
  return out;
}

function loadFromDisk() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    const empty = defaultDb();
    atomicWriteJson(DB_PATH, empty);
    return empty;
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    return migrate(data);
  } catch (e) {
    console.error('db load failed:', e.message);
    return defaultDb();
  }
}

let cache = loadFromDisk();
let version = 1;
let dirty = false;
let flushTimer = null;

function bumpVersion() {
  version += 1;
}
function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushSync();
  }, FLUSH_MS);
}
function flushSync() {
  if (!dirty) return;
  try {
    atomicWriteJson(DB_PATH, cache);
    dirty = false;
  } catch (e) {
    console.error('db flush failed:', e.message);
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'beforeExit']) {
  process.on(sig, () => {
    try {
      flushSync();
    } catch {
      /* */
    }
  });
}

function clone(obj) {
  return typeof structuredClone === 'function'
    ? structuredClone(obj)
    : JSON.parse(JSON.stringify(obj));
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    color: u.color,
    role: u.role || 'user',
    banned: Boolean(u.banned),
    lastSeenAt: u.lastSeenAt || null,
    createdAt: u.createdAt,
    telegramId: u.telegramId ? String(u.telegramId) : null,
    username: u.username || null,
    photoUrl: u.photoUrl || null,
  };
}

function adminTelegramIds() {
  return String(
    process.env.ADMIN_TELEGRAM_ID || process.env.TELEGRAM_CHAT_ID || ''
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const db = {
  getVersion() {
    return version;
  },
  getAll() {
    return clone(cache);
  },
  peek() {
    return cache;
  },
  flush() {
    flushSync();
  },

  getSettings() {
    const s = { ...cache.settings };
    delete s.inviteCode;
    return s;
  },
  setRoomName(name) {
    cache.settings.roomName = clip(name, 48) || 'Watch Together';
    bumpVersion();
    scheduleFlush();
    return this.getSettings();
  },

  /** Assign media with missing/invalid addedBy to this user (e.g. after wipe). */
  claimOrphanMedia(userId) {
    if (!userId || !cache.users.some((u) => u.id === userId)) return 0;
    let n = 0;
    const validIds = new Set(cache.users.map((u) => u.id));
    for (const m of cache.media) {
      if (!m.addedBy || !validIds.has(m.addedBy)) {
        m.addedBy = userId;
        n += 1;
      }
    }
    if (n) {
      bumpVersion();
      scheduleFlush();
    }
    return n;
  },

  // Users
  listUsers({ includeBanned = false } = {}) {
    return cache.users
      .filter((u) => includeBanned || !u.banned)
      .map(publicUser);
  },

  /**
   * Login / register via Telegram (Mini App or Login Widget).
   * @param {{ id: number|string, first_name?: string, last_name?: string, username?: string, photo_url?: string }} tgUser
   * @param {{ name?: string, color?: string }} [opts]
   */
  upsertTelegramUser(tgUser, opts = {}) {
    const telegramId = String(tgUser.id);
    if (!telegramId || telegramId === 'undefined') {
      return { error: 'Нет Telegram id' };
    }
    const admins = adminTelegramIds();
    const isAdminTg = admins.includes(telegramId);

    let user = cache.users.find((u) => String(u.telegramId) === telegramId);
    // Legacy: match by name once to link old accounts
    if (!user && opts.linkName) {
      user = cache.users.find(
        (u) =>
          !u.telegramId &&
          u.name.toLowerCase() === String(opts.linkName).toLowerCase()
      );
    }

    const nameFromTg = (() => {
      const first = String(tgUser.first_name || '').trim();
      const last = String(tgUser.last_name || '').trim();
      const full = [first, last].filter(Boolean).join(' ').trim();
      if (full) return full.slice(0, 32);
      if (tgUser.username) return String(tgUser.username).slice(0, 32);
      return `tg_${telegramId}`.slice(0, 32);
    })();

    const color =
      opts.color ||
      user?.color ||
      pickColor(Math.abs(Number(telegramId)) % 8);

    if (user) {
      if (user.banned) {
        return { error: 'Этот пользователь заблокирован' };
      }
      user.telegramId = telegramId;
      user.name = nameFromTg || user.name;
      user.username = tgUser.username || user.username || null;
      user.photoUrl = tgUser.photo_url || user.photoUrl || null;
      user.color = color;
      if (isAdminTg) user.role = 'admin';
      user.lastSeenAt = new Date().toISOString();
      this.claimOrphanMedia(user.id);
      bumpVersion();
      scheduleFlush();
      return { user: publicUser(user), existing: true };
    }

    const userNew = {
      id: uuid(),
      name: nameFromTg,
      color,
      role: isAdminTg || cache.users.length === 0 ? 'admin' : 'user',
      banned: false,
      telegramId,
      username: tgUser.username || null,
      photoUrl: tgUser.photo_url || null,
      lastSeenAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    // Prefer explicit admin list: first user not auto-admin unless no admins configured
    if (admins.length && !isAdminTg) {
      userNew.role = 'user';
    }
    cache.users.push(userNew);
    // First / admin login claims orphan media (addedBy wiped earlier)
    if (userNew.role === 'admin' || cache.users.length === 1) {
      this.claimOrphanMedia(userNew.id);
    }
    bumpVersion();
    scheduleFlush();
    return { user: publicUser(userNew), existing: false };
  },

  getUser(id) {
    const u = cache.users.find((x) => x.id === id);
    return u ? publicUser(u) : null;
  },

  getUserRaw(id) {
    return cache.users.find((x) => x.id === id) || null;
  },

  touchUser(id) {
    const u = cache.users.find((x) => x.id === id);
    if (!u || u.banned) return null;
    u.lastSeenAt = new Date().toISOString();
    scheduleFlush();
    return publicUser(u);
  },

  isAdmin(userId) {
    const u = cache.users.find((x) => x.id === userId);
    return Boolean(u && u.role === 'admin' && !u.banned);
  },

  setUserBanned(adminId, targetId, banned) {
    if (!this.isAdmin(adminId)) return { error: 'Нужны права админа' };
    if (adminId === targetId) return { error: 'Нельзя забанить себя' };
    const u = cache.users.find((x) => x.id === targetId);
    if (!u) return { error: 'Не найден' };
    u.banned = Boolean(banned);
    bumpVersion();
    scheduleFlush();
    return { user: publicUser(u) };
  },

  deleteUser(adminId, targetId) {
    if (!this.isAdmin(adminId)) return { error: 'Нужны права админа' };
    if (adminId === targetId) return { error: 'Нельзя удалить себя' };
    const before = cache.users.length;
    cache.users = cache.users.filter((u) => u.id !== targetId);
    cache.ratings = cache.ratings.filter((r) => r.userId !== targetId);
    cache.favorites = cache.favorites.filter((f) => f.userId !== targetId);
    cache.comments = cache.comments.filter((c) => c.userId !== targetId);
    if (cache.users.length === before) return { error: 'Не найден' };
    bumpVersion();
    scheduleFlush();
    return { ok: true };
  },

  // Media
  listMedia() {
    return cache.media
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  getMedia(id) {
    return cache.media.find((m) => m.id === id) || null;
  },

  findDuplicate({ title, year, type }) {
    const t = String(title || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    return (
      cache.media.find((m) => {
        const mt = String(m.title || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');
        if (mt !== t) return false;
        if (type && m.type !== type) return false;
        if (year && m.year && Number(m.year) !== Number(year)) return false;
        return true;
      }) || null
    );
  },

  createMedia(payload) {
    const {
      title,
      type,
      year,
      description,
      posterUrl,
      addedBy,
      status = 'want',
      note = '',
      genres = [],
      trailerUrl = '',
      watchLinks = [],
      progressSeason = null,
      progressEpisode = null,
      watchMode = "together",
      soloUserId = null,
      watchedByUsers = [],
      force = false,
    } = payload;
    if (!force) {
      const dup = this.findDuplicate({ title, year, type });
      if (dup) {
        return { error: 'already_exists', existing: dup };
      }
    }
    const item = {
      id: uuid(),
      title: clip(title, MAX_TITLE),
      type,
      year: year ? Number(year) : null,
      description: clip(description, MAX_DESCRIPTION),
      posterUrl: clip(posterUrl, MAX_POSTER_URL),
      status,
      note: clip(note, MAX_NOTE),
      genres: (Array.isArray(genres) ? genres : [])
        .map((g) => clip(g, 40))
        .filter(Boolean)
        .slice(0, 12),
      trailerUrl: clip(trailerUrl, 300),
      watchLinks: normalizeLinks(watchLinks),
      progressSeason:
        progressSeason != null && progressSeason !== ''
          ? Number(progressSeason)
          : null,
      progressEpisode:
        progressEpisode != null && progressEpisode !== ''
          ? Number(progressEpisode)
          : null,
      watchedAt: status === 'watched' ? new Date().toISOString() : null,
      suggestedTonight: false,
      suggestedBy: null,
      suggestedAt: null,
      watchMode: ["together", "solo"].includes(watchMode) ? watchMode : "together",
      soloUserId: watchMode === "solo" ? (soloUserId || addedBy) : null,
      watchedByUsers: Array.isArray(watchedByUsers) && watchedByUsers.length > 0 ? watchedByUsers : (watchMode === "solo" ? [addedBy] : []),
      soloStatuses: watchMode === "solo" ? { [addedBy]: status } : {},
      addedBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    cache.media.push(item);
    bumpVersion();
    scheduleFlush();
    return { item };
  },

  updateMedia(id, updates) {
    const idx = cache.media.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    const m = cache.media[idx];
    const allowed = [
      'title',
      'type',
      'year',
      'description',
      'posterUrl',
      'status',
      'note',
      'trailerUrl',
      'progressSeason',
      'progressEpisode',
      'watchedAt',
      'genres',
      'watchLinks',
      'suggestedTonight',
    ];
    const prevStatus = m.status;
    for (const key of allowed) {
      if (updates[key] === undefined) continue;
      let val = updates[key];
      if (key === 'year' || key === 'progressSeason' || key === 'progressEpisode') {
        val =
          val === '' || val == null || Number.isNaN(Number(val))
            ? null
            : Number(val);
      } else if (key === 'genres') {
        val = (Array.isArray(val) ? val : String(val).split(','))
          .map((g) => clip(g, 40))
          .filter(Boolean)
          .slice(0, 12);
      } else if (key === 'watchLinks') {
        val = normalizeLinks(val);
      } else if (key === 'suggestedTonight') {
        val = Boolean(val);
        if (val) {
          m.suggestedBy = updates.userId || m.suggestedBy;
          m.suggestedAt = new Date().toISOString();
        } else {
          m.suggestedBy = null;
          m.suggestedAt = null;
        }
      } else if (typeof val === 'string') {
        if (key === 'title') val = clip(val, MAX_TITLE);
        if (key === 'description') val = clip(val, MAX_DESCRIPTION);
        if (key === 'posterUrl') val = clip(val, MAX_POSTER_URL);
        if (key === 'note') val = clip(val, MAX_NOTE);
        if (key === 'trailerUrl') val = clip(val, 300);
        if (key === 'watchedAt') val = val || null;
      }
      if (key !== 'suggestedTonight') m[key] = val;
      else m.suggestedTonight = val;
    }
    // Auto watchedAt when status → watched
    if (updates.status === 'watched' && prevStatus !== 'watched') {
      m.watchedAt = updates.watchedAt || new Date().toISOString();
    }
    if (updates.status && updates.status !== 'watched' && prevStatus === 'watched') {
      if (updates.watchedAt === undefined) m.watchedAt = null;
    }
    m.updatedAt = new Date().toISOString();
    cache.media[idx] = m;
    bumpVersion();
    scheduleFlush();
    return m;
  },


  setSoloStatus(id, userId, status) {
    const idx = cache.media.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    const m = cache.media[idx];
    if (!m.soloStatuses) m.soloStatuses = {};

    if (m.soloStatuses[userId] === status) {
      delete m.soloStatuses[userId];
    } else {
      m.soloStatuses[userId] = status;
    }

    const watchers = Object.keys(m.soloStatuses);
    if (m.addedBy && !watchers.includes(m.addedBy)) {
      watchers.push(m.addedBy); // ensure original author is part of watchers
    }

    m.watchedByUsers = watchers;
    m.watchMode = watchers.length > 0 ? "solo" : "together";
    m.soloUserId = watchers.length > 0 ? watchers[0] : null;
    m.updatedAt = new Date().toISOString();
    
    cache.media[idx] = m;
    bumpVersion();
    scheduleFlush();
    return m;
  },

  deleteMedia(id) {
    const before = cache.media.length;
    cache.media = cache.media.filter((m) => m.id !== id);
    cache.ratings = cache.ratings.filter((r) => r.mediaId !== id);
    cache.favorites = cache.favorites.filter((f) => f.mediaId !== id);
    cache.comments = cache.comments.filter((c) => c.mediaId !== id);
    if (cache.media.length < before) {
      bumpVersion();
      scheduleFlush();
      return true;
    }
    return false;
  },

  // Ratings
  listRatings(mediaId) {
    if (mediaId) return cache.ratings.filter((r) => r.mediaId === mediaId);
    return cache.ratings.slice();
  },

  upsertRating({ mediaId, userId, score, review }) {
    const media = cache.media.find((m) => m.id === mediaId);
    const user = cache.users.find((u) => u.id === userId);
    if (!media || !user || user.banned)
      return { error: 'Фильм или пользователь не найден' };
    const s = Number(score);
    if (!Number.isFinite(s) || s < 1 || s > 10) {
      return { error: 'Оценка должна быть от 1 до 10' };
    }
    const idx = cache.ratings.findIndex(
      (r) => r.mediaId === mediaId && r.userId === userId
    );
    const rating = {
      id: idx >= 0 ? cache.ratings[idx].id : uuid(),
      mediaId,
      userId,
      score: s,
      review: clip(review, MAX_REVIEW),
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) cache.ratings[idx] = rating;
    else cache.ratings.push(rating);
    bumpVersion();
    scheduleFlush();
    return { rating };
  },

  deleteRating(mediaId, userId) {
    const before = cache.ratings.length;
    cache.ratings = cache.ratings.filter(
      (r) => !(r.mediaId === mediaId && r.userId === userId)
    );
    if (cache.ratings.length < before) {
      bumpVersion();
      scheduleFlush();
      return true;
    }
    return false;
  },

  // Favorites
  listFavorites(userId) {
    if (userId) return cache.favorites.filter((f) => f.userId === userId);
    return cache.favorites.slice();
  },

  toggleFavorite(mediaId, userId) {
    const media = cache.media.find((m) => m.id === mediaId);
    const user = cache.users.find((u) => u.id === userId);
    if (!media || !user || user.banned)
      return { error: 'Фильм или пользователь не найден' };
    const idx = cache.favorites.findIndex(
      (f) => f.mediaId === mediaId && f.userId === userId
    );
    if (idx >= 0) {
      cache.favorites.splice(idx, 1);
      bumpVersion();
      scheduleFlush();
      return { favorited: false };
    }
    cache.favorites.push({
      id: uuid(),
      mediaId,
      userId,
      createdAt: new Date().toISOString(),
    });
    bumpVersion();
    scheduleFlush();
    return { favorited: true };
  },

  isFavorite(mediaId, userId) {
    return cache.favorites.some(
      (f) => f.mediaId === mediaId && f.userId === userId
    );
  },

  // Comments
  listComments(mediaId) {
    return cache.comments
      .filter((c) => c.mediaId === mediaId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  },

  addComment({ mediaId, userId, text }) {
    const media = cache.media.find((m) => m.id === mediaId);
    const user = cache.users.find((u) => u.id === userId);
    if (!media || !user || user.banned)
      return { error: 'Фильм или пользователь не найден' };
    const body = clip(text, MAX_COMMENT);
    if (!body) return { error: 'Пустой комментарий' };
    const comment = {
      id: uuid(),
      mediaId,
      userId,
      text: body,
      createdAt: new Date().toISOString(),
    };
    cache.comments.push(comment);
    // keep last 200 comments total
    if (cache.comments.length > 500) {
      cache.comments = cache.comments.slice(-500);
    }
    bumpVersion();
    scheduleFlush();
    return { comment };
  },

  deleteComment({ commentId, userId }) {
    const c = cache.comments.find((x) => x.id === commentId);
    if (!c) return { error: 'Не найден' };
    const admin = this.isAdmin(userId);
    if (c.userId !== userId && !admin) return { error: 'Нельзя удалить чужой' };
    cache.comments = cache.comments.filter((x) => x.id !== commentId);
    bumpVersion();
    scheduleFlush();
    return { ok: true };
  },

  // Taste comparison
  tasteCompare(userA, userB) {
    const a = cache.ratings.filter((r) => r.userId === userA);
    const b = cache.ratings.filter((r) => r.userId === userB);
    const mapB = new Map(b.map((r) => [r.mediaId, r]));
    const shared = [];
    for (const ra of a) {
      const rb = mapB.get(ra.mediaId);
      if (!rb) continue;
      shared.push({
        mediaId: ra.mediaId,
        scoreA: ra.score,
        scoreB: rb.score,
        diff: Math.abs(ra.score - rb.score),
      });
    }
    if (!shared.length) {
      return { overlap: 0, agreement: null, shared: 0, topAgree: [], topDisagree: [] };
    }
    // agreement: 100 - avg abs diff * 10
    const avgDiff =
      shared.reduce((s, x) => s + x.diff, 0) / shared.length;
    const agreement = Math.max(0, Math.round(100 - avgDiff * 10));
    const mediaById = new Map(cache.media.map((m) => [m.id, m]));
    const withTitle = shared.map((x) => ({
      ...x,
      title: mediaById.get(x.mediaId)?.title || '—',
    }));
    const topAgree = withTitle
      .filter((x) => x.diff <= 1)
      .sort((a, b) => a.diff - b.diff || b.scoreA - a.scoreA)
      .slice(0, 5);
    const topDisagree = withTitle
      .slice()
      .sort((a, b) => b.diff - a.diff)
      .slice(0, 5);
    return {
      overlap: shared.length,
      agreement,
      shared: shared.length,
      topAgree,
      topDisagree,
    };
  },

};

function normalizeLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .map((l) => {
      if (!l) return null;
      if (typeof l === 'string') {
        return { label: 'Ссылка', url: clip(l, 400) };
      }
      const url = clip(l.url, 400);
      if (!url) return null;
      return { label: clip(l.label || 'Ссылка', 40), url };
    })
    .filter(Boolean)
    .slice(0, MAX_LINK);
}

const COLORS = [
  '#e85d4c',
  '#f0a500',
  '#6bcb77',
  '#4d96ff',
  '#9b59b6',
  '#1abc9c',
  '#e91e63',
  '#00bcd4',
];

function pickColor(index) {
  return COLORS[index % COLORS.length];
}
