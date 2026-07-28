import { useEffect, useState } from 'react';
import { api, posterSrc } from '../api.js';
import { useEscape } from '../hooks.js';
import {
  IconFilm,
  IconPlus,
  IconSearch,
  IconStar,
  IconX,
} from '../icons.jsx';

export default function AddModal({ onClose, onAdded }) {
  useEscape(onClose);
  const [tab, setTab] = useState('search'); // search | manual
  const [query, setQuery] = useState('');
  const [catalogType, setCatalogType] = useState('all');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [catalogOk, setCatalogOk] = useState(null);
  const [catalogMsg, setCatalogMsg] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({
    title: '',
    type: 'movie',
    year: '',
    description: '',
    posterUrl: '',
    status: 'want',
    watchMode: 'together',
    soloUserId: '',
    note: '',
    genres: '',
    trailerUrl: '',
    watchLinks: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dup, setDup] = useState(null);
  // Search only — no trending on open (saves API quota).
  // Type filter applied client-side (no extra request).
  const [rawResults, setRawResults] = useState([]);
  const [usageInfo, setUsageInfo] = useState(null);
  const [searchMeta, setSearchMeta] = useState(null); // source, hint

  useEffect(() => {
    // sessionStorage cache 8 min — no catalog API spam on every Add open
    api
      .catalogStatus()
      .then((s) => {
        setCatalogOk(s.configured);
        setCatalogMsg(s.message || '');
        if (s.usage) setUsageInfo(s.usage);
        if (!s.configured) setTab('manual');
      })
      .catch(() => {
        setCatalogOk(false);
        setTab('manual');
      });
  }, []);

  // Local type filter only (0 network)
  useEffect(() => {
    let list = rawResults;
    if (catalogType === 'movie') {
      list = rawResults.filter((r) => r.type === 'movie');
    } else if (catalogType === 'series') {
      list = rawResults.filter(
        (r) => r.type === 'series' || r.type === 'anime'
      );
    } else if (catalogType === 'anime') {
      list = rawResults.filter((r) => r.type === 'anime');
    }
    setResults(list);
  }, [rawResults, catalogType]);

  const runSearch = async (forceApi = false) => {
    const q = query.trim();
    if (q.length < 2) {
      setErr('Введи минимум 2 символа');
      return;
    }
    setSearching(true);
    setErr('');
    setSelected(null);
    try {
      const data = await api.catalogSearch(q, {
        type: 'all',
        forceApi,
      });
      setRawResults(data.results || []);
      setCatalogOk(true);
      if (data.usage) setUsageInfo(data.usage);
      setSearchMeta({
        source: data.source,
        hint: data.hint,
        fromCache: data.fromCache,
        indexSize: data.indexSize,
      });
    } catch (e) {
      setRawResults([]);
      setErr(e.message || 'Ошибка поиска');
    } finally {
      setSearching(false);
    }
  };

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const pickFromCatalog = (item) => {
    setSelected(item);
    setDup(null);
    const genres = (item.genres || [])
      .map((g) => (typeof g === 'string' ? g : g.name || ''))
      .filter(Boolean)
      .join(', ');
    setForm({
      title: item.title,
      type: item.type || 'movie',
      year: item.year || '',
      description: item.description || '',
      posterUrl: item.posterUrlSmall || item.posterUrl || '',
      status: 'want',
      note: '',
      genres,
      trailerUrl: item.trailerUrl || '',
      watchLinks: item.kpId
        ? `Кинопоиск|https://www.kinopoisk.ru/film/${item.kpId}/`
        : '',
    });
  };

  const parseLinks = (raw) =>
    String(raw || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, ...rest] = line.split('|');
        const url = rest.join('|').trim() || label;
        return { label: rest.length ? label.trim() : 'Ссылка', url };
      });

  const submit = async (e, force = false) => {
    if (e?.preventDefault) e.preventDefault();
    if (!form.title.trim()) {
      setErr('Укажи название');
      return;
    }
    setBusy(true);
    setErr('');
    setDup(null);
    try {
      const item = await api.createMedia({
        title: form.title,
        type: form.type,
        year: form.year,
        description: form.description,
        posterUrl: form.posterUrl,
        status: form.status,
        note: form.note,
        genres: form.genres
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
        trailerUrl: form.trailerUrl,
        watchLinks: parseLinks(form.watchLinks),
        force,
      });
      onAdded(item);
    } catch (ex) {
      if (ex.status === 409 && ex.data?.existing) {
        setDup(ex.data.existing);
        setErr(ex.message);
      } else {
        setErr(ex.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const TYPE_LABEL_SHORT = {
    movie: 'Фильм',
    series: 'Сериал',
    anime: 'Аниме',
  };

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="add-title">Добавить в список</h2>
          <button
            type="button"
            className="icon-btn modal-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <IconX />
          </button>
        </div>
        <p className="subtitle">
          Поиск по Enter · экономный режим (лимит API)
        </p>

        <div className="add-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'search'}
            className={`chip ${tab === 'search' ? 'active' : ''}`}
            onClick={() => setTab('search')}
            disabled={catalogOk === false}
          >
            <IconSearch />
            Каталог
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'manual'}
            className={`chip ${tab === 'manual' ? 'active' : ''}`}
            onClick={() => {
              setTab('manual');
              setSelected(null);
            }}
          >
            Вручную
          </button>
        </div>

        {catalogOk === false && (
          <div className="info-msg" role="status">
            {catalogMsg ||
              'Добавь POISKKINO_API_KEY в .env и перезапусти сервер'}
          </div>
        )}

        {err && (
          <div className="error-msg" role="alert">
            {err}
          </div>
        )}

        {tab === 'search' && catalogOk !== false && (
          <div className="catalog-panel">
            <div className="catalog-toolbar">
              <form
                className="catalog-search-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  runSearch(false);
                }}
              >
                <div className="search catalog-search">
                  <span className="icon" aria-hidden="true">
                    <IconSearch />
                  </span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSelected(null);
                    }}
                    placeholder="Название → Enter"
                    aria-label="Поиск в каталоге"
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={searching || query.trim().length < 2}
                >
                  {searching ? '…' : 'Найти'}
                </button>
              </form>
              <div className="filters">
                {[
                  { id: 'all', label: 'Всё' },
                  { id: 'movie', label: 'Фильмы' },
                  { id: 'series', label: 'Сериалы' },
                  { id: 'anime', label: 'Аниме' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`chip ${catalogType === t.id ? 'active' : ''}`}
                    onClick={() => {
                      setCatalogType(t.id);
                      setSelected(null);
                    }}
                    aria-pressed={catalogType === t.id}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="catalog-hint">
              Только по Enter / «Найти» · без автозапросов
              {usageInfo ? ` · сегодня ${usageInfo.count} API` : ''}
              {searchMeta?.source ? ` · ${searchMeta.source}` : ''}
              {searchMeta?.indexSize != null
                ? ` · индекс ${searchMeta.indexSize}`
                : ''}
              {results.length ? ` · ${results.length}` : ''}
            </p>
            {searchMeta?.hint && (
              <p className="catalog-hint" style={{ color: 'var(--text-muted)' }}>
                {searchMeta.hint}{' '}
                <button
                  type="button"
                  className="chip"
                  style={{ marginLeft: 4 }}
                  onClick={() => runSearch(true)}
                  disabled={searching}
                >
                  Искать в сети
                </button>
              </p>
            )}

            <div className="catalog-list" role="listbox" aria-label="Результаты">
              {searching && results.length === 0 && (
                <div className="catalog-empty">Ищем…</div>
              )}
              {!searching && results.length === 0 && (
                <div className="catalog-empty">
                  Введи название и нажми Enter — так почти не тратим лимит API
                </div>
              )}
              {results.map((item) => {
                const active = selected && selected.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={!!active}
                    className={`catalog-item ${active ? 'active' : ''}`}
                    onClick={() => pickFromCatalog(item)}
                  >
                    <div className="catalog-poster">
                      {item.posterUrlSmall || item.posterUrl ? (
                        <img
                          src={posterSrc(
                            item.posterUrlSmall || item.posterUrl
                          )}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="catalog-poster-ph">
                          <IconFilm />
                        </span>
                      )}
                    </div>
                    <div className="catalog-meta">
                      <div className="catalog-title">{item.title}</div>
                      <div className="catalog-sub">
                        <span
                          className={`status-pill ${
                            item.type === 'movie'
                              ? 'want'
                              : item.type === 'anime'
                                ? 'watching'
                                : 'watched'
                          }`}
                        >
                          {TYPE_LABEL_SHORT[item.type] || item.type}
                        </span>
                        {item.year && <span>{item.year}</span>}
                        {item.voteAverage != null && item.voteAverage > 0 && (
                          <span className="catalog-vote">
                            <IconStar
                              filled
                              style={{ width: 12, height: 12 }}
                            />
                            {Number(item.voteAverage).toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(tab === 'manual' || selected) && (
          <form onSubmit={submit}>
            {selected && tab === 'search' && (
              <div className="selected-banner">
                {(selected.posterUrlSmall || selected.posterUrl) && (
                  <img
                    src={posterSrc(
                      selected.posterUrlSmall || selected.posterUrl
                    )}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                )}
                <div>
                  <strong>Выбрано:</strong> {selected.title}
                  {selected.year ? ` (${selected.year})` : ''}
                  <div className="catalog-sub" style={{ marginTop: 4 }}>
                    Можно поправить поля и нажать «Добавить»
                  </div>
                </div>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="title">Название *</label>
              <input
                id="title"
                value={form.title}
                onChange={set('title')}
                placeholder="Название"
                autoFocus={tab === 'manual'}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="type">Тип</label>
                <select id="type" value={form.type} onChange={set('type')}>
                  <option value="movie">Фильм</option>
                  <option value="series">Сериал</option>
                  <option value="anime">Аниме</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="year">Год</label>
                <input
                  id="year"
                  type="number"
                  min="1900"
                  max="2100"
                  value={form.year}
                  onChange={set('year')}
                  placeholder="2014"
                />
              </div>
            </div>
                        <div className="form-group">
              <label>Режим просмотра</label>
              <div className="watch-mode-selector">
                <button
                  type="button"
                  className={`btn ${form.watchMode === "together" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setForm(f => ({ ...f, watchMode: "together" }))}
                >
                  👥 Вместе
                </button>
                <button
                  type="button"
                  className={`btn ${form.watchMode === "solo" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setForm(f => ({ ...f, watchMode: "solo" }))}
                >
                  👤 В одиночку
                </button>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="status">Статус</label>
              <select id="status" value={form.status} onChange={set('status')}>
                <option value="want">Хотим посмотреть</option>
                <option value="watching">Смотрим сейчас</option>
                <option value="watched">Уже посмотрели</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="desc">Описание</label>
              <textarea
                id="desc"
                value={form.description}
                onChange={set('description')}
                placeholder="Описание…"
              />
            </div>
            <div className="form-group">
              <label htmlFor="note">Заметка для друзей</label>
              <input
                id="note"
                value={form.note}
                onChange={set('note')}
                placeholder="смотреть с 3 серии, есть на Кинопоиске…"
              />
            </div>
            <div className="form-group">
              <label htmlFor="genres">Жанры (через запятую)</label>
              <input
                id="genres"
                value={form.genres}
                onChange={set('genres')}
                placeholder="фантастика, драма"
              />
            </div>
            <div className="form-group">
              <label htmlFor="trailer">Трейлер (YouTube)</label>
              <input
                id="trailer"
                value={form.trailerUrl}
                onChange={set('trailerUrl')}
                placeholder="https://youtu.be/…"
              />
            </div>
            <div className="form-group">
              <label htmlFor="links">Где смотреть (по строке: Название|url)</label>
              <textarea
                id="links"
                value={form.watchLinks}
                onChange={set('watchLinks')}
                placeholder={'Кинопоиск|https://…\nIVI|https://…'}
                rows={2}
              />
            </div>
            <div className="form-group">
              <label htmlFor="poster">Ссылка на постер</label>
              <input
                id="poster"
                type="url"
                value={form.posterUrl}
                onChange={set('posterUrl')}
                placeholder="https://…"
              />
              {form.posterUrl && (
                <img
                  className="poster-preview"
                  src={posterSrc(form.posterUrl)}
                  alt="Превью"
                  referrerPolicy="no-referrer"
                />
              )}
            </div>
            {dup && (
              <div className="error-msg" role="alert">
                Уже в списке: «{dup.title}».{' '}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => submit(null, true)}
                >
                  Всё равно добавить
                </button>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Отмена
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <IconPlus />
                {busy ? 'Сохраняем…' : 'Добавить'}
              </button>
            </div>
          </form>
        )}

        {tab === 'search' && catalogOk !== false && !selected && (
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setTab('manual')}
            >
              Добавить вручную
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


