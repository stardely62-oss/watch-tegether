import { useState } from 'react';
import { api } from '../api.js';
import { saveUser } from '../session.js';

export default function NicknameModal({ user, onSave, onClose, isFirstSetup = false, showToast }) {
  const [nickname, setNickname] = useState(user?.hasCustomName ? (user?.name || '') : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e?.preventDefault();
    const clean = nickname.trim();
    if (!clean) {
      setError('Введите никнейм');
      return;
    }
    if (clean.length > 32) {
      setError('Максимум 32 символа');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await api.updateNickname(clean);
      if (res.user) {
        saveUser(res.user);
        if (onSave) onSave(res.user);
        if (showToast) showToast('Никнейм сохранен!');
        if (onClose) onClose();
      }
    } catch (err) {
      setError(err.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: '420px' }}>
        <div className="modal-head">
          <h2>{isFirstSetup ? '🎬 Встречают по одежке' : '✏️ Сменить никнейм'}</h2>
          {!isFirstSetup && onClose && (
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label="Закрыть"
            >
              ✕
            </button>
          )}
        </div>
        <p className="subtitle" style={{ marginBottom: '1rem', fontSize: '0.88rem', color: '#94a3b8' }}>
          {isFirstSetup
            ? 'Укажите никнейм, который будут видеть другие участники в комнате. Настоящий Telegram username и ID скрыты.'
            : 'Укажите новый никнейм для отображения в комнате.'}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label htmlFor="nickname-input" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
              Ваш никнейм
            </label>
            <input
              id="nickname-input"
              type="text"
              className="input-text"
              placeholder="Например: Киноман3000"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={32}
              autoFocus
              required
            />
          </div>

          {error && (
            <div className="error-msg" style={{ marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          <div className="modal-actions">
            {!isFirstSetup && onClose && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onClose}
                disabled={saving}
              >
                Отмена
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !nickname.trim()}
              style={{ flex: 1 }}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
