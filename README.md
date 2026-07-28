# 🎬 Смотрим Вместе (Watch Together)

[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-purple.svg)](https://vitejs.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)

**«Смотрим Вместе»** — современное fullstack веб-приложение и **Telegram Mini App** для отслеживания, выбора, оценки и обсуждения фильмов, сериалов и аниме — как при совместном просмотре с друзьями, так и при индивидуальном просмотре.

---

## ✨ Основные возможности

- 🔍 **Быстрый поиск и импорт**: Интеграция с Кинопоиск API (`PoiskKino API`) — автозаполнение постеров, жанров, описаний и рейтингов.
- 👥 **Разделение режимов просмотра**:
  - **👥 Совместно**: Фильмы и сериалы, запланированные или просмотренные всей компанией.
  - **👤 В одиночку & «+ Я тоже посмотрел(а)»**: Возможность отмечать личные просмотры. Другие участники видят, кто именно посмотрел тайтл в одиночку, и могут в 1 клик нажать кнопку **«+ Я тоже посмотрел(а)»**, формируя общий список зрителей.
- 📌 **Кастомные статусы**: Отслеживание контента по категориям: *«Хотим посмотреть»*, *«Смотрим сейчас»*, *«Уже посмотрели»*.
- ⭐ **Оценки и рецензии**: Личные рейтинги (1-10), развернутые текстовые рецензии и обсуждения.
- 🎯 **Сравнение вкусов**: Алгоритм анализа совпадения кино-вкусов и поиска общих фильмов.
- 🤖 **Telegram Mini App & Авторизация**: Вход в 1 клик через Telegram (Widget и Mini App InitData) с криптографической валидацией HMAC-SHA256.
- 🔔 **Уведомления в Telegram**: Автоматические анонсы в Telegram-чат при добавлении новых фильмов или оценок друзьями.

---

## 🔒 Совместимость с VPN-нодами на одном сервере и другими проектами

> **Главное преимущество**: Приложение **НЕ занимает порт 443** (контейнер работает на внутреннем порту `3010`, а Nginx принимает SSL-трафик на порту `8443`).

Благодаря этой архитектуре вы можете развернуть **«Смотрим Вместе»** на **одном сервере вместе с VPN-нодой** (например, **Remnawave / VLESS Reality**) или другими веб-сервисами:
* Port `443` остаётся полностью свободным для службы VPN-маскировки VLESS Reality.
* Веб-браузеры, обращаясь к вашему домену по HTTPS на порт `443`, попадают на VPN-ноду. Нода по технологии **Self-Steal** считывает SNI вашего сайта и прозрачно перенаправляет HTTPS-трафик на Nginx (`127.0.0.1:8443`), который отдаёт веб-приложение.
* Для пользователя веб-сайт открывается как обычно по стандарту `https://kino.yourdomain.com/` без указания нештатных портов!

### ⚙️ Как работает скрипт Self-Steal (`reality-selfsteal.sh`)

В репозиторий включены автоматические скрипты маскировки:
- `reality-selfsteal.sh` — фоновый скрипт-демон (проверяет статус контейнера `remnanode`, патчит конфиг VLESS Reality и перезапускает ядро в случае сброса).
- `patch-reality.js` — Node.js скрипт, подключаемый к внутреннему сокету Remnawave и внедряющий домен вашего сайта в `serverNames` и целевой адрес `127.0.0.1:8443`.

#### Переменные в `.env` для Self-Steal:
```env
DOMAIN=kino.yourdomain.com
REALITY_TOKEN=your_remnawave_internal_token
```

#### Быстрый запуск Self-Steal демона:
```bash
# Даем права на исполнение
chmod +x /opt/watch-together/reality-selfsteal.sh

# Запуск в фоновом режиме
nohup /opt/watch-together/reality-selfsteal.sh > /var/log/reality-selfsteal.log 2>&1 &
```

#### Автозапуск через systemd (Рекомендуется):
Создайте файл службы `/etc/systemd/system/watch-selfsteal.service`:
```ini
[Unit]
Description=Watch Together Self-Steal Watcher for Remnawave
After=docker.service

[Service]
Type=simple
ExecStart=/opt/watch-together/reality-selfsteal.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Активируйте службу одной командой:
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now watch-selfsteal
```

---

## 🛠️ Технологический стек

- **Frontend**: React 18, Vite 6, Vanilla CSS (UI/UX Pro Max с темной темой).
- **Backend**: Node.js, Express, Compression, CORS.
- **Хранилище**: Атомарное JSON-хранилище (с гарантией защиты от повреждения при сбоях).
- **Безопасность**: Защищенные сессии HMAC-SHA256, встроенный Rate Limiter (30 зап/мин на поиск).

---

## 🚀 Пошаговое руководство по установке (с нуля до продакшна)

Инструкция составлена так, чтобы любой пользователь мог развернуть приложение, просто поочередно копируя и выполняя команды в терминале сервера.

### Шаг 1: Подготовка сервера и установка пакетов

Подключитесь к вашему Ubuntu/Debian серверу по SSH и выполните установку необходимых утилит:

```bash
sudo apt update && sudo apt install -y git curl nginx certbot python3-certbot-nginx docker.io docker-compose-v2
sudo systemctl enable --now docker nginx
```

---

### Шаг 2: Привязка домена и выпуск SSL-сертификата (Certbot)

1. Убедитесь, что в панели вашего доменного регистратора добавлена **A-запись**, указывающая `kino.yourdomain.com` на IP-адрес вашего сервера.
2. Выпустите бесплатный SSL-сертификат Let's Encrypt:

```bash
# Однократно останавливаем Nginx для выпуска сертификата
sudo systemctl stop nginx

# Замените kino.yourdomain.com и mail@yourdomain.com на ваши данные
sudo certbot certonly --standalone -d kino.yourdomain.com --non-interactive --agree-tos -m mail@yourdomain.com

# Запускаем Nginx обратно
sudo systemctl start nginx
```

---

### Шаг 3: Клонирование репозитория и запуск приложения

```bash
# Переходим в директорию /opt и клонируем репозиторий
cd /opt
git clone https://github.com/stardely62-oss/watch-tegether.git
cd watch-together

# Создаем файл конфигурации .env из примера
cp .env.example .env
```

Отредактируйте файл `.env` (например, командой `nano .env`) и заполните значения:
```env
PORT=3001
POISKKINO_API_KEY=ваш_ключ_poiskkino
TELEGRAM_BOT_TOKEN=ваш_токен_бота
TELEGRAM_CHAT_ID=ваш_chat_id
TELEGRAM_WEBAPP_URL=https://kino.yourdomain.com/
SESSION_SECRET=случайная_длинная_строка_секрета
```

Запустите контейнер приложения:
```bash
docker compose up -d
```
Приложение поднимется на внутреннем порту `127.0.0.1:3010`.

---

### Шаг 4: Настройка веб-сервера Nginx

1. Создайте файл конфигурации кэша `/etc/nginx/conf.d/kino-cache.conf`:
```bash
sudo bash -c 'cat << "NGINX_CONF" > /etc/nginx/conf.d/kino-cache.conf
proxy_cache_path /var/cache/nginx/kino_img levels=1:2 keys_zone=kino_img:10m max_size=1g inactive=7d use_temp_path=off;
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
NGINX_CONF'
```

2. Скопируйте готовый конфиг Nginx для вашего сайта:
```bash
sudo cp /opt/watch-together/nginx-kino.conf /etc/nginx/conf.d/kino.conf
```
*Если ваш домен отличается от `kino.barasek.net`, замените название домена в `/etc/nginx/conf.d/kino.conf`:*
```bash
sudo sed -i 's/kino.barasek.net/kino.yourdomain.com/g' /etc/nginx/conf.d/kino.conf
```

3. Проверьте конфигурацию Nginx и перезапустите его:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

Готово! Теперь ваше приложение доступно по защищённому адресу `https://kino.yourdomain.com/`.

---

## 🔑 Переменные окружения (`.env`)

| Переменная | Описание | Обязательно |
| :--- | :--- | :--- |
| `PORT` | Порт бэкенд-сервера внутри контейнера (по умолчанию `3001`) | Нет |
| `POISKKINO_API_KEY` | API ключ Кинопоиска ([poiskkino.dev](https://poiskkino.dev/)) | **Да** |
| `TELEGRAM_BOT_TOKEN` | Токен бота от [@BotFather](https://t.me/BotFather) | **Да** |
| `TELEGRAM_CHAT_ID` | ID чата/канала для отправки анонсов | Нет |
| `ADMIN_TELEGRAM_ID` | Telegram ID администратора приложения | Нет |
| `TELEGRAM_WEBAPP_URL` | Публичный HTTPS URL приложения | **Да** |
| `SESSION_SECRET` | Уникальная секретная строка для подписи сессий | **Да** |
| `DOMAIN` | Имя домена для скрипта Self-Steal | Опционально |
| `REALITY_TOKEN` | Внутренний токен Remnawave для Self-Steal | Опционально |

---

## 🤖 Настройка Telegram Mini App

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram.
2. Введите команду `/newapp` и выберите вашего бота.
3. Укажите имя и описание приложения.
4. В качестве **Web App URL** укажите ваш публичный HTTPS-адрес (например, `https://kino.yourdomain.com/`).
5. (Опционально) Установите команду `/start` или кнопку меню Web App.

---

## 🛡️ Безопасность

- Публичный репозиторий **не содержит** конфиденциальных данных, токенов ботов или ключей API.
- Аутентификация Telegram проверена с использованием стандартного алгоритма подписи HMAC-SHA256.
- Все чувствительные данные сессий подписываются уникальным `SESSION_SECRET`.

---

## 📄 Лицензия

MIT License. Свободно для использования и модификации.
