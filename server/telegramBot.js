/**
 * Telegram bot: menu button, webhook, /start+/app → WebApp keyboard.
 * Direct link https://t.me/<bot>/app needs Main Mini App (BotFather)
 * or Mini App short_name "app". Menu button + web_app keyboards work either way.
 */

import crypto from 'crypto';

const DEFAULT_WEBAPP = 'https://kino.barasek.net/';

export function webAppUrl() {
  const u = process.env.TELEGRAM_WEBAPP_URL || DEFAULT_WEBAPP;
  return u.endsWith('/') ? u : `${u}/`;
}

export function botToken() {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

async function tg(method, body = {}) {
  const token = botToken();
  if (!token) return { ok: false, description: 'no token' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      console.warn(`tg ${method}:`, data.description || res.status);
    }
    return data;
  } catch (e) {
    console.warn(`tg ${method} error:`, e.message);
    return { ok: false, description: e.message };
  }
}

export async function getMe() {
  return tg('getMe');
}

export function webAppKeyboards(url = webAppUrl()) {
  return {
    reply: {
      keyboard: [[{ text: '🎬 Открыть Watch Together', web_app: { url } }]],
      resize_keyboard: true,
      is_persistent: true,
    },
    inline: {
      inline_keyboard: [
        [{ text: '🎬 Открыть список фильмов', web_app: { url } }],
      ],
    },
  };
}

export async function sendWebAppInvite(chatId, { text } = {}) {
  const url = webAppUrl();
  const keys = webAppKeyboards(url);
  const me = await getMe();
  const username = me.result?.username || 'asjojfapfBot';
  const bodyText =
    text ||
    [
      '🎞 Watch Together',
      '',
      'Общий список фильмов с друзьями.',
      '',
      'Нажми кнопку — откроется мини‑приложение.',
      '',
      `Ссылка: https://t.me/${username}/app`,
      `Запасная: https://t.me/${username}?startapp`,
    ].join('\n');

  await tg('sendMessage', {
    chat_id: chatId,
    text: bodyText,
    disable_web_page_preview: true,
    reply_markup: keys.inline,
  });

  // Sticky reply keyboard
  await tg('sendMessage', {
    chat_id: chatId,
    text: 'Кнопка внизу всегда под рукой 👇',
    reply_markup: keys.reply,
  });

  return { ok: true };
}

export async function setupBotProfile() {
  const url = webAppUrl();
  if (!botToken()) {
    console.log('   📱 Telegram: нет TELEGRAM_BOT_TOKEN');
    return { ok: false };
  }

  const me = await getMe();
  const username = me.result?.username;
  if (username) {
    console.log(`   📱 Telegram bot: @${username} (id ${me.result.id})`);
  }

  await tg('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'Смотрим',
      web_app: { url },
    },
  });

  await tg('setMyCommands', {
    commands: [
      { command: 'start', description: 'Открыть Watch Together' },
      { command: 'app', description: 'Запустить мини‑приложение' },
      { command: 'help', description: 'Как пользоваться' },
    ],
  });

  await tg('setMyDescription', {
    description:
      'Общий список фильмов с друзьями. Жми «Смотрим» в меню, /start или открой t.me/' +
      (username || 'bot') +
      '/app',
  });

  await tg('setMyShortDescription', {
    short_description: 'Смотрим фильмы вместе · Watch Together',
  });

  // Stable webhook secret (env or derive from bot token so restarts verify)
  const secret =
    process.env.TELEGRAM_WEBHOOK_SECRET ||
    crypto
      .createHmac('sha256', botToken())
      .update('wt-webhook-v1')
      .digest('hex')
      .slice(0, 48);
  process.env.TELEGRAM_WEBHOOK_SECRET = secret;

  const hookBase = (
    process.env.TELEGRAM_WEBHOOK_BASE ||
    process.env.TELEGRAM_WEBAPP_URL ||
    DEFAULT_WEBAPP
  ).replace(/\/$/, '');
  const hookUrl = `${hookBase}/api/telegram/webhook`;

  const wh = await tg('setWebhook', {
    url: hookUrl,
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: false,
  });

  const info = await tg('getWebhookInfo');
  console.log(
    `   📱 WebApp → ${url}` +
      (username ? ` · https://t.me/${username}/app` : '') +
      (wh.ok ? ' · webhook ok' : ` · webhook fail: ${wh.description || ''}`)
  );
  if (info.result?.url) {
    console.log(`   📱 Webhook URL: ${info.result.url}`);
  }
  if (info.result?.last_error_message) {
    console.warn('   📱 Webhook last error:', info.result.last_error_message);
  }

  return {
    ok: true,
    username,
    webAppUrl: url,
    directLink: username ? `https://t.me/${username}/app` : null,
    startAppLink: username ? `https://t.me/${username}?startapp` : null,
    webhook: wh,
    webhookInfo: info.result,
  };
}

export async function handleUpdate(update) {
  const msg = update?.message;
  if (!msg?.chat?.id) return { handled: false };

  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');

  if (cmd === '/start' || cmd === '/app') {
    await sendWebAppInvite(chatId);
    return { handled: true, cmd };
  }

  if (cmd === '/help') {
    const username = (await getMe()).result?.username || 'asjojfapfBot';
    await tg('sendMessage', {
      chat_id: chatId,
      text: [
        'Как открыть Watch Together:',
        '',
        '1) Кнопка меню «Смотрим» слева от поля ввода',
        '2) Команда /start или /app',
        `3) https://t.me/${username}/app`,
        `4) https://t.me/${username}?startapp`,
      ].join('\n'),
      reply_markup: webAppKeyboards().inline,
    });
    return { handled: true, cmd: '/help' };
  }

  if (msg.chat.type === 'private' && text && !text.startsWith('/')) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Жми кнопку, чтобы открыть список 👇',
      reply_markup: webAppKeyboards().inline,
    });
    return { handled: true, cmd: 'nudge' };
  }

  return { handled: false };
}

export function verifyWebhookSecret(headerValue) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return true; // if not configured yet, accept (setup will set)
  if (!headerValue) return false;
  try {
    const a = Buffer.from(String(headerValue));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
