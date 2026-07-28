/**
 * Optional Telegram notifications.
 * Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env
 */

export function isTelegramConfigured() {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
  );
}

export async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { skipped: true };
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text).slice(0, 3500),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('telegram notify failed:', res.status, body.slice(0, 120));
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (e) {
    console.warn('telegram notify error:', e.message);
    return { ok: false, error: e.message };
  }
}
