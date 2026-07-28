import crypto from 'crypto';

/**
 * Validate Telegram Mini App initData
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateWebAppInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) {
    return { ok: false, error: 'Нет initData или токена бота' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, error: 'Нет hash в initData' };

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const calculated = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculated !== hash) {
    return { ok: false, error: 'Подпись Telegram неверна' };
  }

  const authDate = Number(params.get('auth_date') || 0);
  if (authDate && maxAgeSec > 0) {
    const age = Math.floor(Date.now() / 1000) - authDate;
    if (age > maxAgeSec) {
      return { ok: false, error: 'Сессия Telegram устарела, открой снова' };
    }
  }

  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return { ok: false, error: 'Некорректный user в initData' };
  }
  if (!user || !user.id) {
    return { ok: false, error: 'Нет данных пользователя Telegram' };
  }

  return {
    ok: true,
    user,
    authDate,
    queryId: params.get('query_id') || null,
    startParam: params.get('start_param') || null,
  };
}

/**
 * Validate Login Widget payload
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function validateLoginWidget(payload, botToken, maxAgeSec = 86400) {
  if (!payload || !botToken) {
    return { ok: false, error: 'Нет данных виджета' };
  }
  const { hash, ...rest } = payload;
  if (!hash || !rest.id) {
    return { ok: false, error: 'Неполный payload Login Widget' };
  }

  const pairs = Object.keys(rest)
    .filter((k) => rest[k] !== undefined && rest[k] !== null && rest[k] !== '')
    .sort()
    .map((k) => `${k}=${rest[k]}`);
  const dataCheckString = pairs.join('\n');
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const calculated = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculated !== hash) {
    return { ok: false, error: 'Подпись Login Widget неверна' };
  }

  const authDate = Number(rest.auth_date || 0);
  if (authDate && maxAgeSec > 0) {
    const age = Math.floor(Date.now() / 1000) - authDate;
    if (age > maxAgeSec) {
      return { ok: false, error: 'Сессия Telegram устарела' };
    }
  }

  return {
    ok: true,
    user: {
      id: Number(rest.id),
      first_name: rest.first_name || '',
      last_name: rest.last_name || '',
      username: rest.username || '',
      photo_url: rest.photo_url || '',
      language_code: rest.language_code || '',
    },
    authDate,
  };
}

export function displayNameFromTg(tgUser) {
  const first = String(tgUser.first_name || '').trim();
  const last = String(tgUser.last_name || '').trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return full.slice(0, 32);
  if (tgUser.username) return String(tgUser.username).slice(0, 32);
  return `tg_${tgUser.id}`.slice(0, 32);
}

export function colorFromTgId(id) {
  const colors = [
    '#e11d48',
    '#eab308',
    '#34d399',
    '#60a5fa',
    '#a78bfa',
    '#14b8a6',
    '#f43f5e',
    '#6366f1',
  ];
  const n = Number(id) || 0;
  return colors[Math.abs(n) % colors.length];
}
