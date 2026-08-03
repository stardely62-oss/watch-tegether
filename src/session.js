import { USER_KEY } from './constants.js';
import { clearSession as clearToken, getToken } from './api.js';

export function statsFromMedia(media, prevStats) {
  const list = media || [];
  return {
    total: list.length,
    movies: list.filter((m) => m.type === 'movie').length,
    series: list.filter((m) => m.type === 'series').length,
    anime: list.filter((m) => m.type === 'anime').length,
    want: list.filter((m) => m.status === 'want').length,
    watching: list.filter((m) => m.status === 'watching').length,
    watched: list.filter((m) => m.status === 'watched').length,
    tonight: list.filter((m) => m.suggestedTonight).length,
    users: prevStats?.users ?? 0,
    ratings: list.reduce((s, m) => s + (m.ratingCount || 0), 0),
  };
}

export function loadUser() {
  try {
    // User without session token = not logged in (stale localStorage after auth change)
    if (!getToken()) return null;
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    if (!u || typeof u !== 'object' || !u.id || !u.name) return null;
    
    return u;
  } catch {
    return null;
  }
}

export function saveUser(user) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* private mode */
  }
}

export function clearAllSession() {
  saveUser(null);
  clearToken();
}

export function initial(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}
