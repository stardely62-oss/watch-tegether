/** Client-side sort / filter helpers */

export function sortMedia(list, sort) {
  const next = [...list];
  if (sort === 'rating') {
    next.sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0));
  } else if (sort === 'title') {
    next.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  } else if (sort === 'want-score') {
    // friends want: prefer want/watching + high rating potential
    next.sort((a, b) => {
      const score = (m) =>
        (m.status === 'want' ? 30 : m.status === 'watching' ? 20 : 0) +
        (m.favoriteCount || 0) * 5 +
        (m.avgRating || 0) * 2 +
        (m.suggestedTonight ? 50 : 0);
      return score(b) - score(a);
    });
  } else if (sort === 'watched-date') {
    next.sort(
      (a, b) =>
        new Date(b.watchedAt || b.updatedAt || 0) -
        new Date(a.watchedAt || a.updatedAt || 0)
    );
  } else if (sort === 'random') {
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
  } else {
    // new
    next.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return next;
}

export function formatProgress(item) {
  if (item.progressSeason == null && item.progressEpisode == null) return '';
  const s = item.progressSeason != null ? `S${String(item.progressSeason).padStart(2, '0')}` : '';
  const e =
    item.progressEpisode != null
      ? `E${String(item.progressEpisode).padStart(2, '0')}`
      : '';
  return `${s}${e}`;
}

export function formatWatchedAt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function isOnline(lastSeenAt, withinMs = 5 * 60 * 1000) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < withinMs;
}

export function pickRandom(list) {
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

export function densityClass(density) {
  if (density === 'compact') return 'density-compact';
  if (density === 'cozy') return 'density-cozy';
  return 'density-comfy';
}
