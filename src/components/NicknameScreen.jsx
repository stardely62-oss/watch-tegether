import { useState } from "react";
import { api } from "../api.js";
import { saveUser } from "../session.js";
import { IconLogoMark } from "../icons.jsx";

export default function NicknameScreen({ user, onSave, showToast }) {
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e?.preventDefault();
    const clean = nickname.trim();
    if (!clean) {
      setError("Введите никнейм");
      return;
    }
    if (clean.length > 32) {
      setError("Максимум 32 символа");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await api.updateNickname(clean);
      if (res.user) {
        saveUser(res.user);
        if (showToast) showToast("Профиль создан!");
        if (onSave) onSave(res.user);
      }
    } catch (err) {
      setError(err.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card tg-login-card" style={{ maxWidth: "440px", width: "100%" }}>
        <div className="logo-icon" aria-hidden="true">
          <IconLogoMark />
        </div>
        <h1>Создание профиля</h1>
        <p className="lead" style={{ marginBottom: "1.25rem" }}>
          Укажите никнейм, который будут видеть другие участники в комнате. Настоящий Telegram username и ID скрыты.
        </p>

        <form onSubmit={handleSubmit} style={{ width: "100%" }}>
          <div className="form-group" style={{ marginBottom: "1.25rem", textAlign: "left" }}>
            <label
              htmlFor="reg-nickname-input"
              style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.9rem" }}
            >
              Ваш никнейм
            </label>
            <input
              id="reg-nickname-input"
              type="text"
              className="input-text"
              placeholder="Например: Киноман3000"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={32}
              autoFocus
              required
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>

          {error && (
            <div className="error-msg" role="alert" style={{ marginBottom: "1rem" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || !nickname.trim()}
            style={{ width: "100%" }}
          >
            {saving ? "Сохранение…" : "Войти в комнату →"}
          </button>
        </form>
      </div>
    </div>
  );
}
