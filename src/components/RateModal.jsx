import { useState } from 'react';
import { api } from '../api.js';
import { useEscape } from '../hooks.js';
import { IconCheck, IconX } from '../icons.jsx';

export default function RateModal({ item, onClose, onRated }) {
  useEscape(onClose);
  const [score, setScore] = useState(item.myRating?.score || 8);
  const [review, setReview] = useState(item.myRating?.review || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const updated = await api.rate(item.id, { score, review });
      onRated(updated);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rate-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="rate-title">Оценить</h2>
          <button
            type="button"
            className="icon-btn modal-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <IconX />
          </button>
        </div>
        <p className="subtitle">{item.title}</p>
        <form onSubmit={submit}>
          {err && (
            <div className="error-msg" role="alert">
              {err}
            </div>
          )}
          <div className="form-group">
            <span id="score-label">Твоя оценка (1–10)</span>
            <div
              className="score-picker"
              role="group"
              aria-labelledby="score-label"
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`score-btn ${score === n ? 'selected' : ''}`}
                  onClick={() => setScore(n)}
                  aria-pressed={score === n}
                  aria-label={`${n} из 10`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="review">Короткий отзыв (необязательно)</label>
            <textarea
              id="review"
              value={review}
              onChange={(e) => setReview(e.target.value)}
              placeholder="Что понравилось / не понравилось…"
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <IconCheck />
              {busy ? 'Сохраняем…' : 'Сохранить оценку'}
            </button>
          </div>
        </form>
      </div>
      <style>{`
        #score-label {
          display: block;
          font-size: 0.78rem;
          font-weight: 500;
          color: var(--text-muted);
          margin-bottom: 6px;
        }
      `}</style>
    </div>
  );
}


