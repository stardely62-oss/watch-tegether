/**
 * ПоискКино API — максимум экономии квоты (~200 req/сутки)
 *
 * Слои без API:
 *  1) Дисковый кэш точных запросов (7 дней)
 *  2) Локальный индекс всех когда-либо найденных фильмов
 *     (поиск «бэт» найдёт «Бэтмен» из прошлых ответов — 0 API)
 *  3) Дедуп inflight
 *
 * API только если локально пусто.
 * Details по умолчанию не дергаем (фронт).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://api.poiskkino.dev/v1.4';
const CACHE_FILE = path.join(__dirname, 'data', 'catalog-cache.json');
const INDEX_FILE = path.join(__dirname, 'data', 'catalog-index.json');
const USAGE_FILE = path.join(__dirname, 'data', 'api-usage.json');

const SEARCH_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const LIST_TTL = 3 * 24 * 60 * 60 * 1000;
const DETAIL_TTL = 14 * 24 * 60 * 60 * 1000;

/** Soft caps so catalog cache/index files stay bounded */
const CACHE_MAX_ENTRIES = 200;
const INDEX_MAX_ITEMS = 2500;

const mem = new Map();
const inflight = new Map();
/** @type {Map<string, object>} kpId -> item */
const index = new Map();

// ─── disk ─────────────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadDiskCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(raw.entries || {})) {
      if (v?.exp > now) {
        mem.set(k, v);
        // Rebuild local index from cached search payloads
        if (k.startsWith('app:search:') && Array.isArray(v.val?.results)) {
          for (const it of v.val.results) {
            const id = String(it.kpId || it.id || '');
            if (id) index.set(id, it);
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
}

function loadIndex() {
  try {
    if (!fs.existsSync(INDEX_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
    for (const [id, item] of Object.entries(raw.items || {})) {
      index.set(String(id), item);
    }
    if (index.size) {
      console.log(`   🎞  catalog index: ${index.size} titles (0-API local search)`);
    }
  } catch {
    /* ignore */
  }
}

let saveCacheTimer = null;
let saveIndexTimer = null;

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of mem.entries()) {
    if (!v || v.exp <= now) mem.delete(k);
  }
  while (mem.size > CACHE_MAX_ENTRIES) {
    mem.delete(mem.keys().next().value);
  }
}

function pruneIndex() {
  if (index.size <= INDEX_MAX_ITEMS) return;
  // Drop oldest insertions first (Map preserves insertion order; re-touch on update)
  const overflow = index.size - INDEX_MAX_ITEMS;
  let i = 0;
  for (const k of index.keys()) {
    if (i >= overflow) break;
    index.delete(k);
    i += 1;
  }
}

function atomicWrite(filePath, obj) {
  ensureDataDir();
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function scheduleSaveCache() {
  if (saveCacheTimer) return;
  saveCacheTimer = setTimeout(() => {
    saveCacheTimer = null;
    try {
      pruneCache();
      const now = Date.now();
      const entries = {};
      for (const [k, v] of mem.entries()) {
        if (v.exp > now) entries[k] = v;
      }
      atomicWrite(CACHE_FILE, {
        savedAt: new Date().toISOString(),
        entries,
      });
    } catch (e) {
      console.warn('cache save:', e.message);
    }
  }, 1500);
}

function scheduleSaveIndex() {
  if (saveIndexTimer) return;
  saveIndexTimer = setTimeout(() => {
    saveIndexTimer = null;
    try {
      pruneIndex();
      const items = {};
      for (const [id, item] of index.entries()) {
        // Drop long descriptions in index to save disk (search uses title)
        const slim = { ...item };
        if (slim.description && slim.description.length > 280) {
          slim.description = `${slim.description.slice(0, 279)}…`;
        }
        items[id] = slim;
      }
      atomicWrite(INDEX_FILE, {
        savedAt: new Date().toISOString(),
        count: index.size,
        items,
      });
    } catch (e) {
      console.warn('index save:', e.message);
    }
  }, 2000);
}

loadDiskCache();
loadIndex();

function cacheGet(k) {
  const h = mem.get(k);
  if (!h) return null;
  if (Date.now() > h.exp) {
    mem.delete(k);
    return null;
  }
  return h.val;
}

function cacheSet(k, v, ttl) {
  if (mem.has(k)) mem.delete(k); // LRU: re-insert as newest
  mem.set(k, { val: v, exp: Date.now() + ttl });
  pruneCache();
  scheduleSaveCache();
}

function indexAdd(items) {
  let added = 0;
  for (const it of items) {
    const id = String(it.kpId || it.id || '');
    if (!id) continue;
    const prev = index.get(id);
    if (!prev) added++;
    // re-insert so hot items stay near the end (survive prune)
    if (index.has(id)) index.delete(id);
    // keep richer description/poster; prefer small poster URL for bandwidth
    const posterSmall =
      it.posterUrlSmall || prev?.posterUrlSmall || it.posterUrl || prev?.posterUrl || '';
    index.set(id, {
      ...prev,
      ...it,
      description: it.description || prev?.description || '',
      posterUrl: posterSmall || it.posterUrl || prev?.posterUrl || '',
      posterUrlSmall: posterSmall,
    });
  }
  pruneIndex();
  if (added || items.length) scheduleSaveIndex();
}

function localSearch(q, type) {
  const nq = normalizeQuery(q);
  if (nq.length < 2) return [];

  const scored = [];
  for (const item of index.values()) {
    const title = normalizeQuery(item.title || '');
    const orig = normalizeQuery(item.originalTitle || '');
    let score = 0;
    if (title === nq || orig === nq) score = 100;
    else if (title.startsWith(nq) || orig.startsWith(nq)) score = 80;
    else if (title.includes(nq) || orig.includes(nq)) score = 50;
    else continue;

    if (type === 'movie' && item.type !== 'movie') continue;
    if (type === 'anime' && item.type !== 'anime') continue;
    if (type === 'series' && item.type !== 'series' && item.type !== 'anime')
      continue;

    // prefer items with poster
    if (item.posterUrl) score += 5;
    if (item.voteAverage) score += Math.min(item.voteAverage, 10);
    scored.push({ score, item });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 24).map((s) => s.item);
}

// ─── usage ────────────────────────────────────────────────

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readUsage() {
  try {
    if (!fs.existsSync(USAGE_FILE)) return { date: todayKey(), count: 0 };
    const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
    if (u.date !== todayKey()) return { date: todayKey(), count: 0 };
    return u;
  } catch {
    return { date: todayKey(), count: 0 };
  }
}

function bumpUsage() {
  ensureDataDir();
  const u = readUsage();
  u.count = (u.count || 0) + 1;
  u.date = todayKey();
  u.updatedAt = new Date().toISOString();
  try {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(u, null, 2), 'utf-8');
  } catch {
    /* ignore */
  }
  return u;
}

export function getUsage() {
  return readUsage();
}

// ─── key ──────────────────────────────────────────────────

export function getApiKey() {
  return (
    process.env.POISKKINO_API_KEY ||
    process.env.KINOPOISK_DEV_TOKEN ||
    process.env.KINOPOISK_API_KEY ||
    ''
  ).trim();
}

export function isConfigured() {
  return Boolean(getApiKey());
}

// ─── HTTP ─────────────────────────────────────────────────

async function apiGet(path, params = {}, ttl = SEARCH_TTL) {
  const key = getApiKey();
  if (!key) {
    const err = new Error('POISKKINO_API_KEY не задан');
    err.code = 'NO_KEY';
    throw err;
  }

  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }
  const cacheKey = `http:${url.toString()}`;

  const cached = cacheGet(cacheKey);
  if (cached !== null) return { data: cached, fromCache: true };

  if (inflight.has(cacheKey)) {
    const data = await inflight.get(cacheKey);
    return { data, fromCache: true };
  }

  const promise = (async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-API-KEY': key,
          'User-Agent': 'WatchTogether/1.0',
        },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(
          res.status === 401 || res.status === 403
            ? 'Неверный ключ ПоискКино'
            : res.status === 402
              ? 'Лимит запросов ПоискКино исчерпан'
              : `ПоискКино HTTP ${res.status}${body ? `: ${body.slice(0, 100)}` : ''}`
        );
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      bumpUsage();
      cacheSet(cacheKey, data, ttl);
      return data;
    } finally {
      clearTimeout(t);
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  const data = await promise;
  return { data, fromCache: false };
}

// ─── map ──────────────────────────────────────────────────

function mapType(doc) {
  const t = String(doc.type || '').toLowerCase();
  if (t === 'anime' || t === 'animated-series') return 'anime';
  if (
    t === 'tv-series' ||
    t === 'tv-show' ||
    t === 'mini-series' ||
    doc.isSeries === true
  ) {
    const genres = (doc.genres || []).map((g) =>
      String(g.name || g).toLowerCase()
    );
    if (genres.includes('аниме') || genres.includes('anime')) return 'anime';
    return 'series';
  }
  if (t === 'cartoon') {
    const genres = (doc.genres || []).map((g) =>
      String(g.name || g).toLowerCase()
    );
    if (genres.includes('аниме')) return 'anime';
    return 'movie';
  }
  return 'movie';
}

function mapDoc(doc) {
  if (!doc) return null;
  const title = (doc.name || doc.alternativeName || doc.enName || '').trim();
  if (!title) return null;
  const type = mapType(doc);
  const poster =
    doc.poster?.previewUrl || doc.poster?.url || doc.backdrop?.previewUrl || '';
  const rating = doc.rating?.kp || doc.rating?.imdb || null;

  return {
    id: `pk-${doc.id}`,
    kpId: doc.id,
    imdbId: doc.externalId?.imdb || null,
    tmdbId: doc.externalId?.tmdb || null,
    mediaType: type === 'movie' ? 'movie' : 'tv',
    type,
    title,
    originalTitle: doc.alternativeName || doc.enName || title,
    year: doc.year || null,
    description: (doc.description || doc.shortDescription || '').trim(),
    posterUrl: poster,
    posterUrlSmall: doc.poster?.previewUrl || poster,
    backdropUrl: doc.backdrop?.url || doc.backdrop?.previewUrl || '',
    voteAverage:
      rating != null && Number(rating) > 0
        ? Math.round(Number(rating) * 10) / 10
        : null,
    source: 'poiskkino',
  };
}

function filterByType(results, type) {
  if (!type || type === 'all') return results;
  if (type === 'movie') return results.filter((r) => r.type === 'movie');
  if (type === 'series')
    return results.filter((r) => r.type === 'series' || r.type === 'anime');
  if (type === 'anime') return results.filter((r) => r.type === 'anime');
  return results;
}

function normalizeQuery(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

// ─── public ───────────────────────────────────────────────

/**
 * opts.forceApi — игнорировать локальный индекс (редко)
 */
export async function searchCatalog(query, opts = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) {
    return pack([], { hint: 'Минимум 2 символа', source: 'none' });
  }

  const type = opts.type || 'all';
  const forceApi = opts.forceApi === true || opts.forceApi === '1';
  const nq = normalizeQuery(q);

  // 1) Exact query cache (unfiltered list)
  const exactKey = `app:search:${nq}`;
  const exact = cacheGet(exactKey);
  if (exact?.results) {
    indexAdd(exact.results);
    const filtered = filterByType(exact.results, type);
    return pack(filtered, {
      fromCache: true,
      source: 'query-cache',
      totalPages: exact.totalPages,
    });
  }

  // 2) Local index — 0 API
  if (!forceApi) {
    const local = localSearch(q, type === 'all' ? 'all' : type);
    // Strong match: enough hits OR exact title hit
    const hasExact = local.some(
      (i) =>
        normalizeQuery(i.title) === nq ||
        normalizeQuery(i.originalTitle || '') === nq
    );
    if (local.length >= 3 || (local.length >= 1 && hasExact && nq.length >= 4)) {
      return pack(local, {
        fromCache: true,
        source: 'local-index',
        hint:
          local.length < 5
            ? 'Из локального кэша. Enter+Shift или «в сети» — полный поиск'
            : undefined,
      });
    }
    // partial local still useful — return + skip API for short queries?
    // If we have some local hits and query is substring of known titles, prefer local
    if (local.length >= 1 && nq.length >= 5) {
      // For longer queries with any local hit, still try API only if zero exact-ish
      // Conservative: if 1-2 local hits for long query, use local only (user can force)
      return pack(local, {
        fromCache: true,
        source: 'local-index',
        hint: 'Локальный кэш. Нужно больше? Нажми «Искать в сети»',
      });
    }
  }

  // 3) Network API
  const { data, fromCache } = await apiGet(
    '/movie/search',
    { page: 1, limit: 24, query: q },
    SEARCH_TTL
  );

  const all = (data.docs || []).map(mapDoc).filter(Boolean);
  indexAdd(all);
  cacheSet(
    exactKey,
    { results: all, totalPages: data.pages || 1 },
    SEARCH_TTL
  );

  const filtered = filterByType(all, type);
  return pack(filtered, {
    fromCache,
    source: fromCache ? 'http-cache' : 'api',
  });
}

export async function trendingCatalog(opts = {}) {
  // Prefer never calling this from UI. Long cache if used.
  const type = opts.type || 'all';
  const appKey = `app:trend:${type}`;
  const hit = cacheGet(appKey);
  if (hit) return { ...hit, fromCache: true, usage: readUsage() };

  // Local index "popular" — by voteAverage
  if (index.size >= 10) {
    let list = [...index.values()];
    list = filterByType(list, type);
    list.sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0));
    const payload = pack(list.slice(0, 20), {
      fromCache: true,
      source: 'local-index',
    });
    cacheSet(appKey, payload, LIST_TTL);
    return payload;
  }

  const params = {
    page: 1,
    limit: 20,
    sortField: 'votes.kp',
    sortType: '-1',
  };
  if (type === 'movie') params.type = 'movie';
  if (type === 'series') params.type = 'tv-series';
  if (type === 'anime') params.type = 'anime';

  const { data, fromCache } = await apiGet('/movie', params, LIST_TTL);
  let results = (data.docs || []).map(mapDoc).filter(Boolean);
  indexAdd(results);
  const payload = pack(results, {
    fromCache,
    source: fromCache ? 'http-cache' : 'api',
  });
  cacheSet(appKey, payload, LIST_TTL);
  return payload;
}

/** Almost never needed — search payloads are rich enough */
export async function getDetails(itemOrType, id) {
  if (typeof itemOrType === 'object' && itemOrType) {
    return { ...itemOrType, fromCache: true };
  }
  const rawId = String(id).replace(/^pk-/, '');
  if (!/^\d+$/.test(rawId)) return null;
  // Prefer index
  const local = index.get(rawId) || index.get(`pk-${rawId}`);
  if (local?.description && local.description.length >= 40) {
    return { ...local, fromCache: true, source: 'local-index' };
  }
  const { data } = await apiGet(`/movie/${rawId}`, {}, DETAIL_TTL);
  const mapped = mapDoc(data);
  if (mapped) indexAdd([mapped]);
  return mapped;
}

function pack(results, extra = {}) {
  return {
    results,
    page: 1,
    totalPages: 1,
    totalResults: results.length,
    provider: 'poiskkino',
    usage: readUsage(),
    indexSize: index.size,
    ...extra,
  };
}

export function statusInfo() {
  const usage = readUsage();
  if (!isConfigured()) {
    return {
      configured: false,
      provider: 'poiskkino',
      language: 'ru',
      message: 'Добавь POISKKINO_API_KEY в .env',
      docs: 'https://poiskkino.dev/documentation',
      usage,
      indexSize: index.size,
    };
  }
  return {
    configured: true,
    provider: 'poiskkino',
    language: 'ru',
    message: `ПоискКино · сегодня ${usage.count} API · индекс ${index.size} тайтлов`,
    docs: 'https://poiskkino.dev/documentation',
    usage,
    indexSize: index.size,
    cacheEntries: mem.size,
  };
}
