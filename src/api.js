const BASE = '/api';
const TOKEN_KEY = 'watch-together-token';

let bootstrapEtag = null;
let bootstrapCache = null;

/** In-memory fallback when localStorage is blocked (TG WebView / private). */
let memoryToken = '';
try {
  memoryToken = localStorage.getItem(TOKEN_KEY) || '';
} catch {
  memoryToken = '';
}

const authListeners = new Set();

/** Subscribe to hard auth loss (token cleared after rejected session). */
export function onAuthLost(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

function notifyAuthLost() {
  for (const fn of authListeners) {
    try {
      fn();
    } catch {
      /* */
    }
  }
}

export function getToken() {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    /* */
  }
  return memoryToken || '';
}

export function setToken(token) {
  memoryToken = token || '';
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* keep memoryToken even if storage fails */
  }
}

export function clearSession() {
  setToken('');
  bootstrapEtag = null;
  bootstrapCache = null;
}

async function rawFetch(path, options = {}, token) {
  const { signal, headers: extraHeaders, ...rest } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${BASE}${path}`, {
    headers,
    signal,
    ...rest,
  });
}

async function request(path, options = {}) {
  // Auth endpoints must not depend on / retry session
  const isAuthRoute =
    path.startsWith('/auth/telegram') && !path.includes('/config');

  let tokenAtStart = getToken();
  if (!tokenAtStart && !isAuthRoute) {
    tokenAtStart = (await ensureTelegramSession()) || '';
  }

  let res = await rawFetch(path, options, tokenAtStart || undefined);

  if (res.status === 304) {
    return { __notModified: true };
  }

  // One silent retry on 401 for normal API (not login itself)
  if (res.status === 401 && !isAuthRoute) {
    const tg =
      typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    if (tg?.initData) {
      // drop stale token, re-mint from Telegram, retry once
      if (!tokenAtStart || getToken() === tokenAtStart) {
        clearSession();
      }
      const fresh = await ensureTelegramSession();
      if (fresh) {
        res = await rawFetch(path, options, fresh);
      }
    }
  }

  if (res.status === 304) {
    return { __notModified: true };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !isAuthRoute) {
      const stillSame =
        tokenAtStart && getToken() === tokenAtStart;
      if (stillSame || !getToken()) {
        clearSession();
        notifyAuthLost();
      }
    }
    const err = new Error(data.error || data.message || `Ошибка ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function posterSrc(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (!s) return '';
  if (s.startsWith('/api/img')) return s;
  if (s.startsWith('data:') || s.startsWith('blob:')) return s;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    const u = new URL(
      s,
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    );
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return s;
    if (typeof window !== 'undefined' && u.origin === window.location.origin) {
      return s;
    }
    const href = u.href
      .replace(/\/orig$/i, '/300x450')
      .replace(/\/\d{3,4}x\d{3,4}$/i, '/300x450');
    return `${BASE}/img?url=${encodeURIComponent(href)}`;
  } catch {
    return s;
  }
}

const CATALOG_STATUS_KEY = 'wt-catalog-status';
const CATALOG_STATUS_TTL = 8 * 60 * 1000;

export function getCachedCatalogStatus() {
  try {
    const raw = sessionStorage.getItem(CATALOG_STATUS_KEY);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    if (!at || Date.now() - at > CATALOG_STATUS_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function setCachedCatalogStatus(data) {
  try {
    sessionStorage.setItem(
      CATALOG_STATUS_KEY,
      JSON.stringify({ at: Date.now(), data })
    );
  } catch {
    /* */
  }
}

export function youtubeEmbed(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    let id = '';
    if (u.hostname.includes('youtu.be')) id = u.pathname.slice(1);
    else if (u.hostname.includes('youtube.com')) {
      id = u.searchParams.get('v') || '';
      if (!id && u.pathname.startsWith('/embed/')) {
        id = u.pathname.split('/')[2] || '';
      }
    }
    if (!id) return '';
    return `https://www.youtube.com/embed/${id}`;
  } catch {
    return '';
  }
}

/** Single-flight silent re-login via Telegram Mini App initData */
let reauthPromise = null;

export async function ensureTelegramSession() {
  if (getToken()) return getToken();
  const tg =
    typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
  if (!tg?.initData) return '';
  if (reauthPromise) return reauthPromise;
  reauthPromise = (async () => {
    try {
      const data = await request('/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ initData: tg.initData }),
      });
      if (data.token) setToken(data.token);
      return data.token || getToken();
    } catch {
      return '';
    } finally {
      reauthPromise = null;
    }
  })();
  return reauthPromise;
}

export const api = {
  getUsers: () => request('/users'),

  telegramConfig: () => request('/auth/telegram/config'),

  authTelegram: async ({ initData, widget } = {}) => {
    const data = await request('/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData, widget }),
    });
    if (data.token) setToken(data.token);
    return data.user ? data : { user: data, token: getToken() };
  },

  ping: () => request('/users/me/ping', { method: 'POST' }),

  banUser: (targetId, banned = true) =>
    request(`/users/${encodeURIComponent(targetId)}/ban`, {
      method: 'POST',
      body: JSON.stringify({ banned }),
    }),

  deleteUser: (targetId) =>
    request(`/users/${encodeURIComponent(targetId)}`, {
      method: 'DELETE',
    }),

  getRoom: () => request('/room'),

  taste: (otherId) =>
    request(`/taste?b=${encodeURIComponent(otherId)}`),

  bootstrap: async ({ signal } = {}) => {
    const headers = {};
    if (bootstrapEtag) headers['If-None-Match'] = bootstrapEtag;

    const tokenAtStart = getToken();
    if (!tokenAtStart) {
      // Try silent TG re-auth before failing
      await ensureTelegramSession();
    }
    const token = getToken();
    if (!token) {
      const err = new Error('Нужен вход через Telegram');
      err.status = 401;
      throw err;
    }

    const res = await fetch(`${BASE}/bootstrap`, {
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`,
      },
      signal,
    });

    if (res.status === 304 && bootstrapCache) {
      return { ...bootstrapCache, notModified: true };
    }

    if (res.status === 401) {
      if (getToken() === token) {
        // one silent retry with fresh TG session
        clearSession();
        const fresh = await ensureTelegramSession();
        if (fresh) {
          const retry = await fetch(`${BASE}/bootstrap`, {
            headers: {
              ...headers,
              Authorization: `Bearer ${fresh}`,
            },
            signal,
          });
          if (retry.ok) {
            const data = await retry.json().catch(() => ({}));
            const etag = retry.headers.get('ETag');
            if (etag) bootstrapEtag = etag;
            bootstrapCache = {
              items: data.items || [],
              stats: data.stats || null,
              version: data.version,
              total: data.total,
              users: data.users || [],
              room: data.room || null,
            };
            return { ...bootstrapCache, notModified: false };
          }
        }
        notifyAuthLost();
      }
      throw Object.assign(new Error('Нужен вход через Telegram'), {
        status: 401,
      });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || `Ошибка ${res.status}`);
    }

    const etag = res.headers.get('ETag');
    if (etag) bootstrapEtag = etag;
    bootstrapCache = {
      items: data.items || [],
      stats: data.stats || null,
      version: data.version,
      total: data.total,
      users: data.users || [],
      room: data.room || null,
    };
    return { ...bootstrapCache, notModified: false };
  },

  invalidateBootstrapCache() {
    bootstrapEtag = null;
    bootstrapCache = null;
  },

  getMediaItem: (id) => request(`/media/${encodeURIComponent(id)}`),

  createMedia: (payload) => {
    api.invalidateBootstrapCache();
    const { addedBy, userId, ...rest } = payload || {};
    return request('/media', {
      method: 'POST',
      body: JSON.stringify(rest),
    });
  },

  updateMedia: (id, payload) => {
    api.invalidateBootstrapCache();
    const { userId, addedBy, ...rest } = payload || {};
    return request(`/media/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(rest),
    });
  },

  deleteMedia: (id) => {
    api.invalidateBootstrapCache();
    return request(`/media/${id}`, { method: 'DELETE' });
  },

  rate: (id, { score, review }) => {
    api.invalidateBootstrapCache();
    return request(`/media/${id}/rating`, {
      method: 'POST',
      body: JSON.stringify({ score, review }),
    });
  },

  toggleFavorite: (id) => {
    api.invalidateBootstrapCache();
    return request(`/media/${id}/favorite`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  getComments: (id) => request(`/media/${encodeURIComponent(id)}/comments`),

  addComment: (id, { text }) => {
    api.invalidateBootstrapCache();
    return request(`/media/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  deleteComment: (mediaId, commentId) => {
    api.invalidateBootstrapCache();
    return request(
      `/media/${encodeURIComponent(mediaId)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE', body: JSON.stringify({}) }
    );
  },

  getStats: () => request('/stats'),

  catalogStatus: async () => {
    const cached = getCachedCatalogStatus();
    if (cached) return { ...cached, fromCache: true };
    const data = await request('/catalog/status');
    setCachedCatalogStatus(data);
    return { ...data, fromCache: false };
  },

  catalogSearch: (q, { type = 'all', page = 1, forceApi = false, signal } = {}) => {
    const params = new URLSearchParams({
      q,
      type,
      page: String(page),
    });
    if (forceApi) params.set('forceApi', '1');
    return request(`/catalog/search?${params}`, { signal });
  },

  catalogTrending: ({ type = 'all', page = 1, signal } = {}) => {
    const params = new URLSearchParams({ type, page: String(page) });
    return request(`/catalog/trending?${params}`, { signal });
  },

  catalogDetails: (mediaType, id, { signal } = {}) =>
    request(
      `/catalog/${encodeURIComponent(mediaType)}/${encodeURIComponent(id)}`,
      { signal }
    ),
};
