/**
 * Telegram notifications for watch-together.
 * Sends notifications to all registered users (PM) and to TELEGRAM_CHAT_ID (if set).
 */

import { db } from './db.js';
import { webAppKeyboards } from './telegramBot.js';

export function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/**
 * Send Telegram message to a specific chat ID (channel, group, or user PM)
 */
export async function sendTgMessage(chatId, text, extra = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
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
        reply_markup: webAppKeyboards().inline,
        ...extra,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('telegram sendTgMessage failed:', res.status, body.slice(0, 120));
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (e) {
    console.warn('telegram sendTgMessage error:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Send notification to general TELEGRAM_CHAT_ID channel/group if configured
 */
export async function notifyTelegram(text, extra = {}) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return { skipped: true };
  return sendTgMessage(chatId, text, extra);
}

/**
 * Notify all registered Telegram users (in PM) EXCEPT actorUserId,
 * plus send to main TELEGRAM_CHAT_ID channel if set.
 */
export async function notifyUsersExcept(actorUserId, text, extra = {}) {
  // 1. Channel / Group notification
  notifyTelegram(text, extra).catch(() => {});

  // 2. Direct PM notification to all other active Telegram users
  try {
    const users = db.peek()?.users || [];
    const recipients = users.filter(
      (u) => u.id !== actorUserId && u.telegramId && !u.banned
    );

    const promises = recipients.map((u) =>
      sendTgMessage(u.telegramId, text, extra).catch(() => {})
    );
    await Promise.allSettled(promises);
  } catch (e) {
    console.warn('notifyUsersExcept error:', e.message);
  }
}
