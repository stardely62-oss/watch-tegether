import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { IconLogoMark } from '../icons.jsx';

export default function LoginScreen({ onLogin, toast }) {
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [cfg, setCfg] = useState(null);
  const [inTelegram, setInTelegram] = useState(false);
  const widgetHost = useRef(null);

  const finishAuth = useCallback(
    async (payload) => {
      setBusy(true);
      setErr('');
      try {
        const data = await api.authTelegram(payload);
        onLogin(data.user || data);
      } catch (ex) {
        setErr(ex.message || 'Не удалось войти через Telegram');
        setBusy(false);
      }
    },
    [onLogin]
  );

  // Mini App auto-login
  useEffect(() => {
    let cancelled = false;
    const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;

    (async () => {
      try {
        const config = await api.telegramConfig();
        if (!cancelled) setCfg(config);
      } catch {
        if (!cancelled) setCfg({ configured: false });
      }

      if (tg) {
        try {
          tg.ready();
          tg.expand();
          if (tg.setHeaderColor) tg.setHeaderColor('#0f0f23');
          if (tg.setBackgroundColor) tg.setBackgroundColor('#0a0a12');
        } catch {
          /* older clients */
        }
        if (!cancelled) setInTelegram(true);
        if (tg.initData) {
          await finishAuth({ initData: tg.initData });
          return;
        }
      }
      if (!cancelled) setBusy(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [finishAuth]);

  // Login Widget (browser outside Telegram)
  useEffect(() => {
    if (busy || inTelegram || !cfg?.botUsername || !widgetHost.current) return;
    // Clear previous
    widgetHost.current.innerHTML = '';
    window.onTelegramAuth = (user) => {
      finishAuth({
        widget: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          username: user.username,
          photo_url: user.photo_url,
          auth_date: user.auth_date,
          hash: user.hash,
        },
      });
    };
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', cfg.botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    widgetHost.current.appendChild(script);
    return () => {
      try {
        delete window.onTelegramAuth;
      } catch {
        /* */
      }
    };
  }, [busy, inTelegram, cfg, finishAuth]);

  // Prefer Main Mini App direct link t.me/bot/app, then ?startapp
  const openInTelegram = () => {
    const href =
      cfg?.directLink ||
      (cfg?.botUsername ? `https://t.me/${cfg.botUsername}/app` : null) ||
      cfg?.startAppLink ||
      (cfg?.botUsername ? `https://t.me/${cfg.botUsername}?startapp` : null);
    if (!href) return;
    window.location.href = href;
  };

  return (
    <div className="login-screen">
      <div className="login-card tg-login-card">
        <div className="logo-icon" aria-hidden="true">
          <IconLogoMark />
        </div>
        <h1>Watch Together</h1>
        <p className="lead">
          Общий список фильмов с друзьями. Вход только через Telegram.
        </p>

        {err && (
          <div className="error-msg" role="alert">
            {err}
          </div>
        )}

        {busy ? (
          <div className="loading" role="status">
            <div className="spinner" />
            {inTelegram ? 'Входим через Telegram…' : 'Загрузка…'}
          </div>
        ) : (
          <>
            {inTelegram && !err && (
              <p className="field-hint" style={{ marginBottom: 12 }}>
                Не получили initData. Нажми ниже или перезапусти мини-приложение.
              </p>
            )}

            {inTelegram && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => {
                  const tg = window.Telegram?.WebApp;
                  if (tg?.initData) finishAuth({ initData: tg.initData });
                  else setErr('Открой приложение из меню бота в Telegram');
                }}
              >
                Войти через Telegram
              </button>
            )}

            {!inTelegram && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', marginBottom: 14 }}
                  onClick={openInTelegram}
                  disabled={!cfg?.botUsername}
                >
                  Открыть в Telegram
                </button>
                <p className="field-hint" style={{ marginBottom: 12 }}>
                  Или войди через виджет (если домен привязан к боту):
                </p>
                <div ref={widgetHost} className="tg-widget-host" />
                {!cfg?.configured && (
                  <p className="error-msg">Бот не настроен на сервере</p>
                )}
              </>
            )}
          </>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}


