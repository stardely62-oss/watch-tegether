import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  api,
  setSoloStatus,
  clearSession,
  ensureTelegramSession,
  getToken,
  onAuthLost,
} from './api.js';
import {
  densityClass,
  formatWatchedAt,
  isOnline,
  pickRandom,
  sortMedia,
} from './utils.js';
import {
  SECTION_PAGE_ALL,
  SECTION_PAGE_FOCUS,
  SECTION_PAGE_STEP,
  STATUS_SECTIONS,
} from './constants.js';
import {
  initial,
  loadUser,
  saveUser,
  clearAllSession,
  statsFromMedia,
} from './session.js';
import {
  IconClapper,
  IconFilm,
  IconHeart,
  IconLogoMark,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconTv,
  IconUsers,
} from './icons.jsx';
import Ambient from './components/Ambient.jsx';
import UserAvatar from './components/UserAvatar.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import MediaCard from './components/MediaCard.jsx';
import AddModal from './components/AddModal.jsx';
import RateModal from './components/RateModal.jsx';
import DetailModal from './components/DetailModal.jsx';
import TasteModal from './components/TasteModal.jsx';

export default function App() {
  const [user, setUser] = useState(loadUser);
  const [media, setMedia] = useState([]);
  const [stats, setStats] = useState(null);
  // While TG Mini App re-auths, don't flash old session / fire API without token
  const [authReady, setAuthReady] = useState(() => {
    if (typeof window === 'undefined') return true;
    const tg = window.Telegram?.WebApp;
    // Always re-auth inside Mini App so we get a fresh session token
    if (tg && tg.initData) return false;
    // Outside TG: ready only if we already have a token
    return Boolean(getToken());
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Prefer live Telegram session; always mint/refresh Bearer token when initData exists
  useEffect(() => {
    let cancelled = false;
    const tg = window.Telegram?.WebApp;

    (async () => {
      if (tg?.initData) {
        try {
          tg.ready();
          tg.expand();
        } catch {
          /* */
        }
        try {
          const data = await api.authTelegram({ initData: tg.initData });
          if (cancelled) return;
          const u = data.user || data;
          saveUser(u);
          setUser(u);
          setAuthReady(true);
          return;
        } catch {
          if (cancelled) return;
          clearAllSession();
          setUser(null);
          setAuthReady(true);
          return;
        }
      }

      // Browser: keep LS session only if token is present
      if (getToken() && loadUser()) {
        if (!cancelled) setAuthReady(true);
        return;
      }

      // Stale user without token
      if (!cancelled) {
        if (!getToken()) {
          saveUser(null);
          setUser(null);
        }
        setAuthReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // If any API hard-rejects the session, drop UI login state
  useEffect(() => {
    return onAuthLost(() => {
      saveUser(null);
      setUser(null);
      setMedia([]);
      setError('Сессия истекла — войди снова через Telegram');
    });
  }, []);

  const [filterType, setFilterType] = useState('all');
  const [filterWatchMode, setFilterWatchMode] = useState('all');
  const [selectedSoloUserId, setSelectedSoloUserId] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterFav, setFilterFav] = useState(false);
  const [filterMine, setFilterMine] = useState(false);
  const [filterUnrated, setFilterUnrated] = useState(false);

  const [filterGenre, setFilterGenre] = useState('all');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [sort, setSort] = useState('new');
  const [density, setDensity] = useState(() => {
    try {
      return localStorage.getItem('wt-density') || 'comfy';
    } catch {
      return 'comfy';
    }
  });
  /** Visible card count per section id (pagination / show more) */
  const [sectionLimit, setSectionLimit] = useState({});

  const [friends, setFriends] = useState([]);
  const [room, setRoom] = useState(null);
  const [showFriends, setShowFriends] = useState(false);
  const [showTaste, setShowTaste] = useState(false);
  const [tasteOther, setTasteOther] = useState('');
  const [tasteData, setTasteData] = useState(null);

  const [showAdd, setShowAdd] = useState(false);
  const [rateItem, setRateItem] = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deepLinkDone, setDeepLinkDone] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  // Debounce home search (180ms) — fewer re-filters while typing
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 180);
    return () => clearTimeout(t);
  }, [search]);

  const refresh = useCallback(async () => {
    if (!user) return;
    if (!getToken()) {
      const tok = await ensureTelegramSession();
      if (!tok) {
        setError('Нужен вход через Telegram');
        setLoading(false);
        return;
      }
    }
    try {
      const data = await api.bootstrap();
      const list = data.items || [];
      const st = data.stats;
      setMedia(list);
      if (st) setStats(st);
      else setStats((prev) => statsFromMedia(list, prev));
      if (data.users) setFriends(data.users);
      if (data.room) setRoom(data.room);
      setError('');
    } catch (e) {
      if (e.status === 401) {
        clearAllSession();
        setUser(null);
      }
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Wait for authReady so we never hit API without a session token
  useEffect(() => {
    if (!authReady) return;
    if (user && getToken()) {
      setLoading(true);
      refresh();
      api.getRoom().then(setRoom).catch(() => {});
    } else if (user && !getToken()) {
      // user object without token — try silent TG re-login
      ensureTelegramSession().then((tok) => {
        if (tok) refresh();
        else {
          clearAllSession();
          setUser(null);
          setLoading(false);
        }
      });
    } else {
      setLoading(false);
    }
  }, [user, refresh, authReady]);

  useEffect(() => {
    if (!authReady || !user || !getToken()) return undefined;
    const tick = () => api.ping().catch(() => {});
    tick();
    const t = setInterval(tick, 120000);
    return () => clearInterval(t);
  }, [user, authReady]);

  useEffect(() => {
    try {
      localStorage.setItem('wt-density', density);
    } catch {
      /* */
    }
  }, [density]);

  // Reset “show more” when filters / search change
  useEffect(() => {
    setSectionLimit({});
  }, [
    filterType,
    filterStatus,
    filterFav,
    filterMine,
    filterUnrated,
    filterGenre,
    searchDebounced,
    sort,
  ]);

  const sortList = useCallback((list) => sortMedia(list, sort), [sort]);

  const allGenres = useMemo(() => {
    const set = new Set();
    for (const m of media) {
      for (const g of m.genres || []) set.add(g);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [media]);

  /** Base filters without status — used to build sections */
  const baseFiltered = useMemo(() => {
    let list = [...media];
    if (filterWatchMode === 'together') {
      list = list.filter((m) => (m.watchMode || 'together') !== 'solo');
    } else if (filterWatchMode === 'solo') {
      const targetId = selectedSoloUserId || user?.id;
      list = list.filter((m) => {
        if (m.watchMode !== 'solo') return false;
        const watchers = Array.isArray(m.watchedByUsers) ? m.watchedByUsers : (m.soloUserId ? [m.soloUserId] : []);
        return watchers.includes(targetId) || m.addedBy === targetId;
      });
    }
    if (filterType !== 'all') list = list.filter((m) => m.type === filterType);
    if (filterFav) list = list.filter((m) => m.isFavorite);
    if (filterMine && user) list = list.filter((m) => m.addedBy === user.id);
    if (filterUnrated && user) list = list.filter((m) => !m.myRating);
    if (filterGenre !== 'all') {
      list = list.filter((m) => (m.genres || []).includes(filterGenre));
    }
    if (searchDebounced.trim()) {
      const q = searchDebounced.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          (m.note || '').toLowerCase().includes(q) ||
          (m.genres || []).some((g) => g.toLowerCase().includes(q))
      );
    }
    return list;
  }, [
    media,
    filterType,
    filterWatchMode,
    selectedSoloUserId,
    filterFav,
    filterMine,
    filterUnrated,

    filterGenre,
    searchDebounced,
    user,
  ]);

  const sections = useMemo(() => {
    const byStatus = {
      want: [],
      watching: [],
      watched: [],
    };
    for (let item of baseFiltered) {
      if (filterWatchMode === 'solo') {
        const targetId = selectedSoloUserId || user?.id;
        const st = item.soloStatuses?.[targetId] || item.status;
        item = { ...item, status: st };
      }
      const key = byStatus[item.status] ? item.status : 'want';
      byStatus[key].push(item);
    }
    const order =
      filterStatus === 'all'
        ? STATUS_SECTIONS
        : STATUS_SECTIONS.filter((s) => s.id === filterStatus);
    return order.map((meta) => ({
      ...meta,
      items: sortList(byStatus[meta.id] || []),
    }));
  }, [baseFiltered, filterStatus, sortList]);

  const totalVisible = useMemo(
    () => sections.reduce((n, s) => n + s.items.length, 0),
    [sections]
  );

  const statusCounts = useMemo(() => {
    const c = { want: 0, watching: 0, watched: 0 };
    for (const m of baseFiltered) {
      const targetId = selectedSoloUserId || user?.id;
      const st = (filterWatchMode === 'solo') ? (m.soloStatuses?.[targetId] || m.status) : m.status;
      if (c[st] != null) c[st] += 1;
    }
    return c;
  }, [baseFiltered, filterWatchMode, selectedSoloUserId, user]);

  /** Home = only counters; open a list by tapping a counter */
  const isHome =
    filterStatus === 'all' &&
    !filterFav &&
    !filterMine &&
    !filterUnrated &&
    filterGenre === 'all' &&
    !searchDebounced.trim();

  const defaultSectionPage =
    filterStatus === 'all' ? SECTION_PAGE_ALL : SECTION_PAGE_FOCUS;

  const listTitle =
    filterStatus === 'want'
        ? 'Хотим посмотреть'
        : filterStatus === 'watching'
          ? 'Смотрим сейчас'
          : filterStatus === 'watched'
            ? 'Уже посмотрели'
            : filterFav
              ? 'Избранное'
              : 'Список';

  const goHome = () => {
    setFilterStatus('all');
    setFilterFav(false);
    setFilterMine(false);
    setFilterUnrated(false);
    setFilterGenre('all');
    setSearch('');
  };

  const showMore = (sectionId, total) => {
    setSectionLimit((prev) => {
      const current = prev[sectionId] ?? defaultSectionPage;
      return {
        ...prev,
        [sectionId]: Math.min(total, current + SECTION_PAGE_STEP),
      };
    });
  };

  const openDetail = async (item) => {
    setDetailItem(item);
    setDetailLoading(true);
    try {
      const full = await api.getMediaItem(item.id);
      setDetailItem(full);
      setMedia((prev) =>
        prev.map((m) =>
          m.id === full.id
            ? {
                ...m,
                ...full,
                ratings: undefined,
                comments: undefined,
              }
            : m
        )
      );
    } catch {
      /* keep slim card data */
    } finally {
      setDetailLoading(false);
    }
  };

  // Deep link ?id=
  useEffect(() => {
    if (!user || deepLinkDone || loading) return;
    try {
      const id = new URLSearchParams(window.location.search).get('id');
      if (!id) {
        setDeepLinkDone(true);
        return;
      }
      const item = media.find((m) => m.id === id);
      if (item) openDetail(item);
      else if (media.length) {
        api.getMediaItem(id).then(setDetailItem).catch(() => {});
      }
      setDeepLinkDone(true);
    } catch {
      setDeepLinkDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, media, loading, deepLinkDone]);

  const handleLogin = (u) => {
    saveUser(u);
    setUser(u);
  };



  const handleRandomPick = () => {
    const pool = media.filter(
      (m) => m.status === 'want' || m.status === 'watching'
    );
    const pick = pickRandom(pool);
    if (!pick) {
      showToast('Нечего выбирать — добавьте в «Хотим»');
      return;
    }
    openDetail(pick);
    showToast(`Случайный выбор: «${pick.title}»`);
  };



  const handleSoloStatus = async (id, status) => {
    try {
      const res = await setSoloStatus(id, status);
      setMedia((prev) => prev.map((m) => (m.id === id ? res : m)));
      
      let label = status === 'watched' ? 'Уже посмотрели' : status === 'watching' ? 'Смотрим сейчас' : 'Хотим посмотреть';
      if (filterWatchMode === 'solo' && selectedSoloUserId && selectedSoloUserId !== user?.id) {
        showToast(`Добавлено в ваш личный список: ${label}`);
      } else {
        showToast(`Фильм перемещен в: ${label}`);
      }
    } catch (e) { console.error(e); }
  };

  const handleToggleFav = async (item) => {
    try {
      const res = await api.toggleFavorite(item.id);
      setMedia((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, ...res.media } : m))
      );
      if (detailItem?.id === item.id) {
        setDetailItem((d) => ({ ...d, ...res.media }));
      }
      showToast(res.favorited ? 'В избранном' : 'Убрано из избранного');
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleStatus = async (item, status) => {
    try {
      const updated = await api.updateMedia(item.id, {
        status,
      });
      setMedia((prev) => {
        const next = prev.map((m) =>
          m.id === item.id ? { ...m, ...updated } : m
        );
        setStats((st) => statsFromMedia(next, st));
        return next;
      });
      if (detailItem?.id === item.id) {
        setDetailItem((d) => ({ ...d, ...updated }));
      }
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleDelete = async (item) => {
    if (!confirm(`Удалить «${item.title}»?`)) return;
    try {
      await api.deleteMedia(item.id);
      setMedia((prev) => {
        const next = prev.filter((m) => m.id !== item.id);
        setStats((st) => statsFromMedia(next, st));
        return next;
      });
      setDetailItem(null);
      showToast('Удалено');
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleRated = (updated) => {
    setMedia((prev) => {
      const next = prev.map((m) =>
        m.id === updated.id ? { ...m, ...updated } : m
      );
      setStats((st) => statsFromMedia(next, st));
      return next;
    });
    if (detailItem?.id === updated.id) {
      setDetailItem((d) => ({ ...d, ...updated }));
    }
    setRateItem(null);
    showToast('Оценка сохранена');
  };

  const handleAdded = (item) => {
    setMedia((prev) => {
      const next = [item, ...prev];
      setStats((st) => statsFromMedia(next, st));
      return next;
    });
    setShowAdd(false);
    showToast('Добавлено в список');
  };

  if (!authReady) {
    return (
      <>
        <Ambient />
        <div className="login-screen">
          <div className="loading" role="status">
            <div className="spinner" />
            Вход через Telegram…
          </div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Ambient />
        <LoginScreen onLogin={handleLogin} toast={toast} />
      </>
    );
  }

  return (
    <>
      <Ambient />
      <div className={`app ${densityClass(density)}`}>
        <header className="header">
          <div className="logo">
            <div className="logo-icon" aria-hidden="true">
              <IconLogoMark />
            </div>
            <div>
              <h1>{room?.roomName || 'Watch Together'}</h1>
              <p>Смотрим вместе с друзьями</p>
            </div>
          </div>
          <div className="header-right">
            <div className="user-chip">
              <div className="avatar-wrap">
                <UserAvatar user={user} />
                {user.role === 'admin' ? (
                  <span className="admin-badge" title="Админ">
                    ★
                  </span>
                ) : null}
              </div>
              <span className="name">{user.name}</span>
            </div>
          </div>
        </header>

        {error && (
          <div className="error-msg" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="loading" role="status">
            <div className="spinner" />
            Загрузка…
          </div>
        ) : isHome ? (
          <>
            <div className="mode-filter-bar" role="tablist">
              <button
                type="button"
                className={`mode-filter-btn ${filterWatchMode === "all" ? "active" : ""}`}
                onClick={() => setFilterWatchMode("all")}
              >
                🎬 Все
              </button>
              <button
                type="button"
                className={`mode-filter-btn ${filterWatchMode === "together" ? "active" : ""}`}
                onClick={() => setFilterWatchMode("together")}
              >
                👥 Совместно
              </button>
              <button
                type="button"
                className={`mode-filter-btn ${filterWatchMode === "solo" ? "active" : ""}`}
                onClick={() => setFilterWatchMode("solo")}
              >
                👤 В одиночку
              </button>
            </div>

            {filterWatchMode === 'solo' && (
              <div className="solo-user-picker" role="tablist" aria-label="Выбор пользователя">
                <span className="solo-picker-label">👤 Личные списки:</span>
                <button
                  type="button"
                  className={`solo-user-chip ${(!selectedSoloUserId || selectedSoloUserId === user?.id) ? 'active' : ''}`}
                  onClick={() => setSelectedSoloUserId(user?.id || '')}
                >
                  <span className="mini-avatar" style={{ background: user?.color || '#3b82f6' }}>
                    {initial(user?.name)}
                  </span>
                  <span>Мой список (Вы)</span>
                </button>
                {(friends || []).filter(f => f.id !== user?.id).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`solo-user-chip ${selectedSoloUserId === f.id ? 'active' : ''}`}
                    onClick={() => setSelectedSoloUserId(f.id)}
                  >
                    <span className="mini-avatar" style={{ background: f.color || '#64748b' }}>
                      {initial(f.name)}
                    </span>
                    <span>{f.name}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="home-hero">
              <p className="home-lead">
                {stats
                  ? `В комнате ${stats.total} тайтлов · ${stats.users || friends.length || 0} друзей`
                  : 'Выберите список'}
              </p>
            </div>

            <div className="home-counters" role="navigation" aria-label="Списки">
              {[
                {
                  id: 'want',
                  label: 'Хотим посмотреть',
                  hint: 'Очередь',
                  count: statusCounts.want,
                  cls: 'want',
                  onClick: () => {
                    setFilterStatus('want');
                  },
                },
                {
                  id: 'watching',
                  label: 'Смотрим сейчас',
                  hint: 'В процессе',
                  count: statusCounts.watching,
                  cls: 'watching',
                  onClick: () => {
                    setFilterStatus('watching');
                  },
                },
                {
                  id: 'watched',
                  label: 'Уже посмотрели',
                  hint: 'Архив',
                  count: statusCounts.watched,
                  cls: 'watched',
                  onClick: () => {
                    setFilterStatus('watched');
                  },
                },
              ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`home-counter ${c.cls}`}
                  onClick={c.onClick}
                >
                  <span className="home-counter-value">{c.count}</span>
                  <span className="home-counter-label">{c.label}</span>
                  <span className="home-counter-hint">{c.hint}</span>
                </button>
              ))}
            </div>

            <div className="home-meta">
              <button
                type="button"
                className="home-mini-stat"
                onClick={() => {
                  setFilterStatus('all');
                  setFilterFav(true);
                }}
              >
                <IconHeart filled />
                <span>Избранное</span>
                <strong>
                  {media.filter((m) => m.isFavorite).length}
                </strong>
              </button>
              <div className="friends-dropdown-wrap">
                <button
                  type="button"
                  className={`home-mini-stat ${showFriends ? 'open' : ''}`}
                  onClick={() => setShowFriends((v) => !v)}
                  aria-expanded={showFriends}
                  aria-haspopup="listbox"
                >
                  <IconUsers />
                  <span>Друзей</span>
                  <strong>{stats?.users ?? friends.length}</strong>
                </button>
                {showFriends && (
                  <>
                    <button
                      type="button"
                      className="friends-dropdown-backdrop"
                      aria-label="Закрыть список друзей"
                      onClick={() => setShowFriends(false)}
                    />
                    <div className="friends-dropdown" role="listbox">
                      <div className="friends-dropdown-head">
                        <strong>В комнате</strong>
                        <span>{friends.length}</span>
                      </div>
                      {friends.length === 0 ? (
                        <p className="friends-dropdown-empty">
                          Пока никого — пусть друзья зайдут через Telegram-бот
                        </p>
                      ) : (
                        <ul className="friends-dropdown-list">
                          {friends.map((f) => {
                            const online = isOnline(f.lastSeenAt);
                            return (
                              <li key={f.id} className="friends-dropdown-item">
                                <UserAvatar user={f} size={36} />
                                <div className="friends-dropdown-meta">
                                  <span className="friends-dropdown-name">
                                    {f.name}
                                    {f.id === user.id ? ' (ты)' : ''}
                                    {f.role === 'admin' ? ' ★' : ''}
                                  </span>
                                  <span
                                    className={`friends-dropdown-status ${online ? 'on' : ''}`}
                                  >
                                    {online
                                      ? 'онлайн'
                                      : f.lastSeenAt
                                        ? `был(а) ${formatWatchedAt(f.lastSeenAt)}`
                                        : 'не в сети'}
                                  </span>
                                  {f.username && (
                                    <span className="friends-dropdown-user">
                                      @{f.username}
                                    </span>
                                  )}
                                </div>
                                {user.role === 'admin' &&
                                  f.id !== user.id &&
                                  !f.banned && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm friends-ban"
                                      onClick={async () => {
                                        if (
                                          !confirm(
                                            `Заблокировать ${f.name}?`
                                          )
                                        )
                                          return;
                                        try {
                                          await api.banUser(f.id, true);
                                          showToast(`${f.name} заблокирован`);
                                          refresh();
                                        } catch (e) {
                                          showToast(e.message);
                                        }
                                      }}
                                    >
                                      бан
                                    </button>
                                  )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="home-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowAdd(true)}
              >
                <IconPlus />
                Добавить
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleRandomPick}
              >
                🎲 Случайный
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowTaste(true)}
              >
                💞 Вкусы
              </button>
            </div>

            {media.length === 0 && (
              <div className="empty home-empty">
                <div className="empty-icon">
                  <IconClapper />
                </div>
                <h3>Пока пусто</h3>
                <p>
                  Добавьте первый фильм из поиска ПоискКино — он появится в
                  «Хотим посмотреть».
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="list-toolbar">
              <button
                type="button"
                className="btn btn-ghost btn-sm list-back"
                onClick={goHome}
              >
                ← Назад
              </button>
              <div className="list-toolbar-title">
                <h2>{listTitle}</h2>
                <span>{totalVisible}</span>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowAdd(true)}
              >
                <IconPlus />
                Добавить
              </button>
            </div>

            <div className="toolbar list-view-toolbar">
              <div className="search">
                <span className="icon" aria-hidden="true">
                  <IconSearch />
                </span>
                <input
                  type="search"
                  placeholder="Поиск в списке…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Поиск"
                />
              </div>

              <div className="filters" role="group" aria-label="Тип">
                {[
                  { id: 'all', label: 'Всё' },
                  { id: 'movie', label: 'Фильмы', Icon: IconFilm },
                  { id: 'series', label: 'Сериалы', Icon: IconTv },
                  { id: 'anime', label: 'Аниме', Icon: IconSparkles },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`chip ${filterType === t.id ? 'active' : ''}`}
                    onClick={() => setFilterType(t.id)}
                    aria-pressed={filterType === t.id}
                  >
                    {t.Icon && <t.Icon />}
                    {t.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`chip gold ${filterFav ? 'active' : ''}`}
                  onClick={() => setFilterFav((v) => !v)}
                  aria-pressed={filterFav}
                >
                  <IconHeart filled={filterFav} />
                  Избранное
                </button>
                <button
                  type="button"
                  className={`chip ${filterMine ? 'active' : ''}`}
                  onClick={() => setFilterMine((v) => !v)}
                  aria-pressed={filterMine}
                >
                  Мои
                </button>
                <button
                  type="button"
                  className={`chip ${filterUnrated ? 'active' : ''}`}
                  onClick={() => setFilterUnrated((v) => !v)}
                  aria-pressed={filterUnrated}
                >
                  Без оценки
                </button>
                {allGenres.length > 0 && (
                  <select
                    className="status-select inline"
                    value={filterGenre}
                    onChange={(e) => setFilterGenre(e.target.value)}
                    aria-label="Жанр"
                  >
                    <option value="all">Все жанры</option>
                    {allGenres.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <label className="sr-only" htmlFor="sort-select">
                Сортировка
              </label>
              <select
                id="sort-select"
                className="status-select inline toolbar-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="new">Сначала новые</option>
                <option value="rating">По оценке друзей</option>
                <option value="want-score">Что смотреть дальше</option>
                <option value="watched-date">По дате просмотра</option>
                <option value="title">По названию</option>
                <option value="random">Случайный порядок</option>
              </select>
              <label className="density-label">
                Карточки
                <select
                  className="status-select inline"
                  value={density}
                  onChange={(e) => setDensity(e.target.value)}
                >
                  <option value="compact">Компакт</option>
                  <option value="comfy">Обычно</option>
                  <option value="cozy">Крупно</option>
                </select>
              </label>
            </div>

            {totalVisible === 0 ? (
              <div className="empty">
                <div className="empty-icon">
                  <IconClapper />
                </div>
                <h3>Ничего нет</h3>
                <p>В этом списке пусто или фильтры ничего не нашли</p>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ marginTop: 12 }}
                  onClick={goHome}
                >
                  На главную
                </button>
              </div>
            ) : (
              <div className="lists">
                {sections.map((section) => {
                  const limit =
                    sectionLimit[section.id] ?? defaultSectionPage;
                  const visible = section.items.slice(0, limit);
                  const hidden = Math.max(
                    0,
                    section.items.length - visible.length
                  );
                  // When one status is open, still one section; when favorites from home etc.
                  if (filterStatus !== 'all' && section.id !== filterStatus) {
                    return null;
                  }
                  return (
                    <section
                      key={section.id}
                      className={`list-section list-section-${section.id}`}
                      aria-labelledby={`section-${section.id}`}
                    >
                      {filterStatus === 'all' && (
                        <header className="list-section-head">
                          <div className="list-section-titles">
                            <h2 id={`section-${section.id}`}>
                              {filterWatchMode === 'solo' ? (section.id === 'want' ? 'Хочу посмотреть' : section.id === 'watching' ? 'Смотрю сейчас' : 'Просмотрено') : section.title}
                            </h2>
                          </div>
                          <span className={`list-section-count ${section.id}`}>
                            {section.items.length}
                          </span>
                        </header>
                      )}
                      {section.items.length === 0 ? (
                        <div className="list-section-empty">
                          {section.empty}
                        </div>
                      ) : (
                        <>
                          <div className="grid">
                            {visible.map((item) => (
                              <MediaCard
                                key={item.id}
                                item={item}
                                isMyList={filterWatchMode !== 'solo' || (!selectedSoloUserId || selectedSoloUserId === user?.id)}
                                onSoloWatch={(id, status) => handleSoloStatus(id, status)}
                                currentUser={user}
                                onFav={() => handleToggleFav(item)}
                                onRate={() => setRateItem(item)}
                                onStatus={(s) => handleStatus(item, s)}
                                onOpen={() => openDetail(item)}
                              />
                            ))}
                          </div>
                          {hidden > 0 && (
                            <div className="list-section-more">
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() =>
                                  showMore(section.id, section.items.length)
                                }
                              >
                                Показать ещё{' '}
                                {Math.min(SECTION_PAGE_STEP, hidden)} из {hidden}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}

        {showAdd && (
          <AddModal
            onClose={() => setShowAdd(false)}
            onAdded={handleAdded}
          />
        )}

        {rateItem && (
          <RateModal
            item={rateItem}
            onClose={() => setRateItem(null)}
            onRated={handleRated}
          />
        )}

        {detailItem && (
          <DetailModal
            item={detailItem}
            loading={detailLoading}
            user={user}
            friends={friends}
            onClose={() => {
              setDetailItem(null);
              setDetailLoading(false);
              // clear ?id= from URL without reload
              try {
                const u = new URL(window.location.href);
                u.searchParams.delete('id');
                window.history.replaceState({}, '', u.pathname + u.search);
              } catch {
                /* */
              }
            }}
            onRate={() => setRateItem(detailItem)}
            onSoloWatch={(id, status) => handleSoloStatus(id, status)}
            currentUser={user}
            onFav={() => handleToggleFav(detailItem)}
            onStatus={(s) =>
              handleStatus(
                media.find((m) => m.id === detailItem.id) || detailItem,
                s
              )
            }
            onDelete={() =>
              handleDelete(
                media.find((m) => m.id === detailItem.id) || detailItem
              )
            }
            onUpdated={(updated) => {
              setDetailItem((d) => ({ ...d, ...updated }));
              setMedia((prev) =>
                prev.map((m) =>
                  m.id === updated.id ? { ...m, ...updated } : m
                )
              );
            }}
            onBanUser={async (targetId) => {
              try {
                await api.banUser(targetId, true);
                showToast('Пользователь заблокирован');
                refresh();
              } catch (e) {
                showToast(e.message);
              }
            }}
          />
        )}

        {showTaste && (
          <TasteModal
            user={user}
            friends={friends}
            onClose={() => {
              setShowTaste(false);
              setTasteData(null);
            }}
          />
        )}

        {toast && (
          <div className="toast" role="status" aria-live="polite">
            {toast}
          </div>
        )}
      </div>

      <style>{`
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0,0,0,0);
          white-space: nowrap;
          border: 0;
        }
      `}</style>
    </>
  );
}

