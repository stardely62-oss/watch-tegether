import { memo } from 'react';
import { posterSrc } from '../api.js';
import {
  TYPE_LABEL,
  STATUS_LABEL_SHORT,
  STATUS_LABEL,
} from '../constants.js';
import { formatProgress, formatWatchedAt } from '../utils.js';
import { initial } from '../session.js';
import {
  IconFilm,
  IconHeart,
  IconSparkles,
  IconStar,
  IconTv,
} from '../icons.jsx';

const TYPE_ICON = {
  movie: IconFilm,
  series: IconTv,
  anime: IconSparkles,
};

const MediaCard = memo(function MediaCard({
  item,
  onFav,
  onRate,
  onStatus,
  onSoloWatch,
  onOpen,
}) {
  const TypeIcon = TYPE_ICON[item.type] || IconFilm;
  const progress = formatProgress(item);

  return (
    <article className="card card-virtual">
      <div className="card-poster">
        {item.posterUrl ? (
          <img
            src={posterSrc(item.posterUrl)}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="placeholder">
            <TypeIcon />
          </span>
        )}
        <span className={`type-badge ${item.type}`}>
          <TypeIcon />
          {TYPE_LABEL[item.type]}
        </span>
        <span className={`watch-mode-badge ${item.watchMode === "solo" ? "solo" : "together"}`} title={item.watchMode === "solo" ? (item.soloUser ? `В одиночку (${item.soloUser.name})` : "В одиночку") : "Совместный просмотр"}>
          {item.watchMode === "solo" ? `👤 ${item.soloUser ? item.soloUser.name : "Соло"}` : "👥 Вместе"}
        </span>
        {item.suggestedTonight && (
          <span className="tonight-badge" title="На вечер">
            🌙
          </span>
        )}
        <button
          type="button"
          className={`fav-btn ${item.isFavorite ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onFav();
          }}
          aria-label={
            item.isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'
          }
          aria-pressed={item.isFavorite}
        >
          <IconHeart filled={item.isFavorite} />
        </button>
      </div>
      <div className="card-body">
        <h3 className="card-title">{item.title}</h3>
        <div className="card-meta">
          {item.year && <span>{item.year}</span>}
          <span className={`status-pill ${item.status}`}>
            {STATUS_LABEL_SHORT[item.status] || STATUS_LABEL[item.status]}
          </span>
          {progress && <span className="progress-pill">{progress}</span>}
          {item.watchedAt && item.status === 'watched' && (
            <span className="watched-date">
              {formatWatchedAt(item.watchedAt)}
            </span>
          )}
        </div>
        {item.note && <p className="card-note">{item.note}</p>}
        {item.watchMode === 'solo' && (
          <div className="solo-watchers-bar">
            <div className="solo-watchers-info">
              <span className="solo-label">👤 В одиночку:</span>
              <div className="solo-chips">
                {(item.watchedByUsersDetails || []).map((u) => (
                  <span key={u.id} className="solo-chip" style={{ background: u.color }}>
                    {u.name}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              className={`btn btn-xs ${item.hasWatchedSolo ? 'btn-primary' : 'btn-ghost'}`}
              onClick={(e) => {
                e.stopPropagation();
                onSoloWatch(item.id);
              }}
              title={item.hasWatchedSolo ? 'Снять отметку' : 'Отметить, что я тоже посмотрел(а)'}
            >
              {item.hasWatchedSolo ? '✓ Я посмотрел(а)' : '+ Я тоже посмотрел(а)'}
            </button>
          </div>
        )}
        {(item.genres || []).length > 0 && (
          <div className="genre-row">
            {(item.genres || []).slice(0, 3).map((g) => (
              <span key={g} className="genre-chip">
                {g}
              </span>
            ))}
          </div>
        )}
        <div className="rating-row">
          {item.avgRating != null ? (
            <span className="avg-score">
              <IconStar filled />
              {item.avgRating}
              <span className="count">({item.ratingCount})</span>
            </span>
          ) : (
            <span className="my-score">Ещё нет оценок</span>
          )}
          {item.myRating && (
            <span className="my-score">Твоя: {item.myRating.score}/10</span>
          )}
          {item.commentCount > 0 && (
            <span className="my-score">💬 {item.commentCount}</span>
          )}
        </div>
        {item.addedByUser && (
          <div className="added-by">
            <span
              className="mini-avatar"
              style={{ background: item.addedByUser.color }}
            >
              {initial(item.addedByUser.name)}
            </span>
            добавил(а) {item.addedByUser.name}
          </div>
        )}
        <div className="card-footer card-footer-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
            Подробнее
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onRate}>
            <IconStar />
            Оценить
          </button>
          <label className="sr-only" htmlFor={`status-${item.id}`}>
            Переместить «{item.title}»
          </label>
          <select
            id={`status-${item.id}`}
            className="status-select inline status-move"
            value={item.status}
            onChange={(e) => onStatus(e.target.value)}
            aria-label={`Переместить «${item.title}» в список`}
            title="Переместить в другой список"
          >
            <option value="want">→ Хотим посмотреть</option>
            <option value="watching">→ Смотрим сейчас</option>
            <option value="watched">→ Уже посмотрели</option>
          </select>
        </div>
      </div>
    </article>
  );
});

export default MediaCard;
