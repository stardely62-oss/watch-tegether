import { useEffect, useState } from 'react';
import { api, youtubeEmbed } from '../api.js';
import { TYPE_LABEL, STATUS_LABEL } from '../constants.js';
import { formatProgress, formatWatchedAt } from '../utils.js';
import { initial } from '../session.js';
import { useEscape } from '../hooks.js';
import {
  IconFilm,
  IconHeart,
  IconSparkles,
  IconStar,
  IconTv,
  IconX,
} from '../icons.jsx';

const TYPE_ICON = {
  movie: IconFilm,
  series: IconTv,
  anime: IconSparkles,
};

export default function DetailModal({
  item,
  loading,
  user,
  friends,
  onClose,
  onRate,
  onFav,
  onStatus,
  onDelete,
  onTonight,
  onUpdated,
  onBanUser,
}) {
  useEscape(onClose);
  const TypeIcon = TYPE_ICON[item.type] || IconFilm;
  const [edit, setEdit] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [comment, setComment] = useState('');
  const [comments, setComments] = useState(item.comments || []);
  const [busy, setBusy] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const embed = youtubeEmbed(item.trailerUrl);

  useEffect(() => {
    setComments(item.comments || []);
    setDraft({
      description: item.description || '',
      note: item.note || '',
      genres: (item.genres || []).join(', '),
      trailerUrl: item.trailerUrl || '',
      watchLinks: (item.watchLinks || [])
        .map((l) => `${l.label}|${l.url}`)
        .join('\n'),
      progressSeason: item.progressSeason ?? '',
      progressEpisode: item.progressEpisode ?? '',
      watchedAt: item.watchedAt ? item.watchedAt.slice(0, 10) : '',
    });
  }, [item]);

  const saveEdit = async () => {
    setBusy(true);
    try {
      const links = String(draft.watchLinks || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [label, ...rest] = line.split('|');
          const url = rest.join('|').trim() || label;
          return { label: rest.length ? label.trim() : 'Ссылка', url };
        });
      const updated = await api.updateMedia(item.id, {
        description: draft.description,
        note: draft.note,
        genres: String(draft.genres || '')
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
        trailerUrl: draft.trailerUrl,
        watchLinks: links,
        progressSeason: draft.progressSeason,
        progressEpisode: draft.progressEpisode,
        watchedAt: draft.watchedAt
          ? new Date(draft.watchedAt).toISOString()
          : item.watchedAt,
      });
      onUpdated(updated);
      setEdit(false);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const sendComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    try {
      const c = await api.addComment(item.id, {
        text: comment.trim(),
      });
      setComments((prev) => [...prev, c]);
      setComment('');
      onUpdated({ ...item, commentCount: (item.commentCount || 0) + 1 });
    } catch (ex) {
      alert(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="detail-title">{item.title}</h2>
          <div className="modal-head-actions">
            <div className="detail-menu-wrap">
              <button
                type="button"
                className="icon-btn"
                aria-label="Ещё действия"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                title="Ещё"
              >
                ⋯
              </button>
              {menuOpen && (
                <>
                  <button
                    type="button"
                    className="detail-menu-backdrop"
                    aria-label="Закрыть меню"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="detail-menu sheet" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setEdit(true);
                      }}
                    >
                      ✏️ Править
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onTonight();
                      }}
                    >
                      🌙{' '}
                      {item.suggestedTonight
                        ? 'Убрать с вечера'
                        : 'На вечер'}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete();
                      }}
                    >
                      🗑 Удалить
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className="icon-btn modal-close"
              onClick={onClose}
              aria-label="Закрыть"
            >
              <IconX />
            </button>
          </div>
        </div>
        {loading && (
          <div className="detail-loading" role="status">
            <div className="spinner" />
            Загружаем детали…
          </div>
        )}
        <p className="subtitle">
          <TypeIcon style={{ width: 14, height: 14 }} />
          {TYPE_LABEL[item.type]}
          {item.year ? ` · ${item.year}` : ''}
          <span className={`status-pill ${item.status}`}>
            {STATUS_LABEL[item.status]}
          </span>
          {item.suggestedTonight && (
            <span className="status-pill watching">На вечер</span>
          )}
          {formatProgress(item) && (
            <span className="progress-pill">{formatProgress(item)}</span>
          )}
        </p>

        {!edit && item.description && (
          <p className="detail-desc">{item.description}</p>
        )}
        {!edit && item.note && (
          <p className="detail-note">📝 {item.note}</p>
        )}

        {edit && (
          <div className="edit-block">
            <div className="form-group">
              <label>Описание</label>
              <textarea
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Заметка</label>
              <input
                value={draft.note}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, note: e.target.value }))
                }
              />
            </div>
            <div className="form-group">
              <label>Жанры</label>
              <input
                value={draft.genres}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, genres: e.target.value }))
                }
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Сезон</label>
                <input
                  type="number"
                  min="0"
                  value={draft.progressSeason}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      progressSeason: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="form-group">
                <label>Серия</label>
                <input
                  type="number"
                  min="0"
                  value={draft.progressEpisode}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      progressEpisode: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="form-group">
                <label>Дата просмотра</label>
                <input
                  type="date"
                  value={draft.watchedAt}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, watchedAt: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="form-group">
              <label>Трейлер YouTube</label>
              <input
                value={draft.trailerUrl}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, trailerUrl: e.target.value }))
                }
              />
            </div>
            <div className="form-group">
              <label>Где смотреть (Название|url)</label>
              <textarea
                value={draft.watchLinks}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, watchLinks: e.target.value }))
                }
                rows={2}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setEdit(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={saveEdit}
              >
                Сохранить
              </button>
            </div>
          </div>
        )}

        <div className="rating-row" style={{ marginBottom: 12 }}>
          {item.avgRating != null ? (
            <span className="avg-score">
              <IconStar filled />
              {item.avgRating}
              <span className="count">из 10 · {item.ratingCount}</span>
            </span>
          ) : (
            <span className="my-score">Оценок пока нет</span>
          )}
          {item.myRating && (
            <span className="my-score">Твоя: {item.myRating.score}/10</span>
          )}
          {item.watchedAt && (
            <span className="my-score">
              Смотрели: {formatWatchedAt(item.watchedAt)}
            </span>
          )}
        </div>

        {(item.genres || []).length > 0 && (
          <div className="genre-row" style={{ marginBottom: 12 }}>
            {item.genres.map((g) => (
              <span key={g} className="genre-chip">
                {g}
              </span>
            ))}
          </div>
        )}

        {(item.watchLinks || []).length > 0 && (
          <div className="watch-links">
            <h3>Где смотреть</h3>
            <div className="link-row">
              {item.watchLinks.map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-sm"
                >
                  {l.label || 'Ссылка'}
                </a>
              ))}
            </div>
          </div>
        )}

        {embed && (
          <div className="trailer-block">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowTrailer((v) => !v)}
            >
              {showTrailer ? 'Скрыть трейлер' : '▶ Трейлер'}
            </button>
            {showTrailer && (
              <div className="trailer-frame">
                <iframe
                  title="trailer"
                  src={embed}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}
          </div>
        )}

        <div className="form-group">
          <label htmlFor="detail-status">Статус</label>
          <select
            id="detail-status"
            className="status-select"
            value={item.status}
            onChange={(e) => onStatus(e.target.value)}
          >
            <option value="want">Хотим посмотреть</option>
            <option value="watching">Смотрим сейчас</option>
            <option value="watched">Уже посмотрели</option>
          </select>
        </div>

        <div className="comments-block">
          <h3>Обсуждение</h3>
          {comments.length === 0 && (
            <p className="field-hint">Пока тихо — напиши первым</p>
          )}
          <div className="comments-list">
            {comments.map((c) => (
              <div key={c.id} className="comment-item">
                <span
                  className="mini-avatar"
                  style={{ background: c.user?.color || '#555' }}
                >
                  {initial(c.user?.name)}
                </span>
                <div>
                  <strong>{c.user?.name || 'Кто-то'}</strong>
                  <span className="comment-time">
                    {formatWatchedAt(c.createdAt)}
                  </span>
                  <p>{c.text}</p>
                </div>
              </div>
            ))}
          </div>
          <form className="comment-form" onSubmit={sendComment}>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="давайте на выходных…"
              maxLength={800}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              Отправить
            </button>
          </form>
        </div>

        {item.ratings?.length > 0 && (
          <div className="ratings-list">
            <h3>Оценки друзей</h3>
            {item.ratings.map((r) => (
              <div key={r.id} className="rating-item">
                <div
                  className="avatar"
                  style={{
                    background: r.user?.color || '#666',
                    width: 28,
                    height: 28,
                    fontSize: '0.75rem',
                  }}
                >
                  {initial(r.user?.name)}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <strong style={{ fontSize: '0.9rem' }}>
                      {r.user?.name || 'Кто-то'}
                    </strong>
                    <span className="score">{r.score}/10</span>
                    {user.role === 'admin' && r.userId !== user.id && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: '#fda4af' }}
                        onClick={() => {
                          if (
                            confirm(`Заблокировать ${r.user?.name || 'user'}?`)
                          ) {
                            onBanUser(r.userId);
                          }
                        }}
                      >
                        бан
                      </button>
                    )}
                  </div>
                  {r.review && <div className="review">{r.review}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions detail-primary-actions">
          <button type="button" className="btn btn-ghost" onClick={onFav}>
            <IconHeart filled={item.isFavorite} />
            {item.isFavorite ? 'В избранном' : 'В избранное'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onRate}>
            <IconStar />
            Оценить
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}


