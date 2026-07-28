import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

/** Catch render crashes so mobile doesn't leave only the ambient background */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('App crash:', error);
  }

  render() {
    if (this.state.error) {
      const msg = String(this.state.error?.message || this.state.error);
      return (
        <div
          style={{
            minHeight: '100dvh',
            padding: 24,
            color: '#f8fafc',
            fontFamily: 'system-ui, sans-serif',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              maxWidth: 400,
              width: '100%',
              background: '#1b1b30',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 16,
              padding: 24,
            }}
          >
            <h1 style={{ fontSize: '1.2rem', marginBottom: 8 }}>
              Что-то сломалось
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: 16 }}>
              Обнови страницу. Если не поможет — очисти данные сайта для
              kino.barasek.net (кэш / Service Worker).
            </p>
            <pre
              style={{
                fontSize: 12,
                color: '#fda4af',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                marginBottom: 16,
              }}
            >
              {msg}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                width: '100%',
                minHeight: 44,
                border: 0,
                borderRadius: 12,
                background: '#e11d48',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.95rem',
              }}
            >
              Обновить
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Kill any previously installed service workers (they caused blank mobile screens)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister();
  });
  if (typeof caches !== 'undefined') {
    caches.keys().then((keys) => {
      for (const k of keys) caches.delete(k);
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
