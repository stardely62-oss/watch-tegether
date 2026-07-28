import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useEscape } from '../hooks.js';
import { IconX } from '../icons.jsx';

export default function TasteModal({ user, friends, onClose }) {
  useEscape(onClose);
  const others = friends.filter((f) => f.id !== user.id);
  const [otherId, setOtherId] = useState(others[0]?.id || '');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!otherId) return;
    setBusy(true);
    try {
      setData(await api.taste(otherId));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (otherId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherId]);

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Сравнение вкусов</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <IconX />
          </button>
        </div>
        {others.length === 0 ? (
          <p>Пока нет других друзей в комнате</p>
        ) : (
          <>
            <div className="form-group">
              <label>Сравнить с</label>
              <select
                className="status-select"
                value={otherId}
                onChange={(e) => setOtherId(e.target.value)}
              >
                {others.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            {busy && <p>Считаем…</p>}
            {data && !busy && (
              <div className="taste-result">
                <p className="taste-score">
                  Совпали на{' '}
                  <strong>
                    {data.agreement == null ? '—' : `${data.agreement}%`}
                  </strong>
                  <span className="field-hint">
                    {' '}
                    · общих оценок: {data.shared || 0}
                  </span>
                </p>
                {data.topAgree?.length > 0 && (
                  <>
                    <h3>Согласны</h3>
                    <ul>
                      {data.topAgree.map((x) => (
                        <li key={x.mediaId}>
                          {x.title}: {x.scoreA} / {x.scoreB}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {data.topDisagree?.length > 0 && (
                  <>
                    <h3>Расхождения</h3>
                    <ul>
                      {data.topDisagree.map((x) => (
                        <li key={x.mediaId}>
                          {x.title}: {x.scoreA} vs {x.scoreB} (Δ{x.diff})
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {!data.shared && (
                  <p className="field-hint">
                    Пока нет общих оценок — оцените одни и те же фильмы
                  </p>
                )}
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

