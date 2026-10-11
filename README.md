# root-core

Единая система управления серверами Discord: бот **Root** и встроенная **HTML-панель администратора** в **ОДНОМ процессе Node.js**, с одной базой данных SQLite (WAL) и единым конфигурационным файлом `.env`.

---

## 🏛 Архитектура

```
root-core/
├─ package.json, .env.example, .gitignore, .editorconfig, README.md
├─ ecosystem.config.js            # PM2: root-core-root, root-core-guard
├─ packages/
│  ├─ db/                         # Репозитории, SQLite WAL, миграции
│  ├─ shared/                     # Общие константы, валидаторы, логгер
│  └─ bot-client/                 # SDK для внешних ботов (Guard): heartbeat, hot reload, reporting
├─ apps/
│  ├─ root/
│  │  └─ src/
│  │     ├─ bot/ (client, commands/, events/)
│  │     ├─ modules/ (sync, economy, antinuke, botmanager, supervisor, backup, logging)
│  │     ├─ web/ (routes/, middleware/, public/)
│  │     └─ index.js              # Единый процесс: БД → миграции → Бот → Панель
│  └─ guard/                      # Внешний бот модерации (отдельный процесс)
└─ scripts/ (create-owner.js, backup.js, migrate.js)
```

- **Один процесс:** `apps/root/src/index.js` запускает одновременно и Discord-клиента Root, и Express веб-панель.
- **Прямой вызов:** Контроллеры веб-панели получают инстанс клиента через `req.app.locals.client` и вызывают методы модулей напрямую (`sync.fullResync()`, `antinuke.restoreSnapshot()`, `economy.addBalance()`, `botmanager.restart()`), исключая дублирование логики между слэш-командами и веб-интерфейсом.
- **Внешние боты (Guard):** Бот модерации Guard работает в отдельном процессе и связывается с Root через SDK `@root-core/bot-client` (отправка heartbeat раз в 15 секунд, hot reload настроек через SSE / опрос, публикация действий).
- **База данных:** SQLite 3 в WAL-режиме (`/data/shared.db`).

---

## 📋 Чек-лист первого запуска

### 1. Подготовка окружения
- Убедитесь, что установлена **Node.js 20+**:
  ```bash
  node -v
  npm -v
  ```

### 2. Клонирование и установка зависимостей
```bash
git clone <url_репозитория> root-core
cd root-core
npm install
```

### 3. Настройка конфигурации `.env`
Скопируйте пример окружения и заполните ваши секреты:
```bash
cp .env.example .env
```
Параметры в `.env`:
- `DISCORD_TOKEN_ROOT`: Токен Discord-бота Root
- `DISCORD_CLIENT_ID_ROOT`: Application ID бота Root
- `DISCORD_CLIENT_SECRET`: Client Secret для OAuth2 авторизации
- `OWNER_IDS`: Discord ID владельцев через запятую (например, `123456789012345678`)
- `STAFF_GUILD_ID`: `1558608015148716062` (Сервер стаффа)
- `MAIN_GUILD_ID`: `1558606862277017690` (Основной сервер)
- `SESSION_SECRET`: Длинная случайная строка для подписи сессий
- `INTERNAL_API_TOKEN`: Токен для связи внешних ботов с локальным API панели
- `PANEL_HOST`: `127.0.0.1` (слушает только локально, наружу проксируется через Nginx)
- `PANEL_PORT`: `3000`
- `PANEL_BASE_URL`: Внешний адрес панели (например, `https://panel.example.com`)

### 4. Настройка Discord Developer Portal
1. Перейдите в [Discord Developer Portal](https://discord.com/developers/applications) -> Ваше приложение Root.
2. В разделе **OAuth2 -> General**:
   - Добавьте Redirect URI: `https://panel.example.com/auth/callback` (или `http://localhost:3000/auth/callback` для dev).
3. В разделе **Bot -> Privileged Gateway Intents**:
   - Включите **PRESENCE INTENT**
   - Включите **SERVER MEMBERS INTENT**
   - Включите **MESSAGE CONTENT INTENT**
4. Пригласите бота на оба сервера (`STAFF_GUILD_ID` и `MAIN_GUILD_ID`) с правами `Administrator` (или правами из списка ниже).

### 5. Инициализация базы данных и создание владельца
Выполните накат схемы и зарегистрируйте первого супер-администратора панели:
```bash
# Применение миграций схемы БД
npm run migrate

# Добавление Discord ID первого владельца панели
npm run create-owner 123456789012345678 "OwnerTag#0000"
```

### 6. Запуск проекта
**Для разработки:**
```bash
npm run dev
```

**Для продакшена (через PM2):**
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## 🔒 Конфигурация Nginx (Reverse Proxy + HTTPS)

Разместите конфигурацию в `/etc/nginx/sites-available/root-panel.conf`:

```nginx
server {
    listen 80;
    server_name panel.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name panel.example.com;

    # SSL сертификаты (Let's Encrypt / Certbot)
    ssl_certificate /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Безопасные заголовки
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Статические ассеты (кэширование)
    location ~* \.(css|js|jpg|jpeg|png|gif|ico|svg|woff2)$ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        expires 7d;
        add_header Cache-Control "public, no-transform";
    }

    # Потоковые события Server-Sent Events (SSE)
    location /api/events {
        proxy_pass http://127.0.0.1:3000/api/events;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Критично для SSE: отключить буферизацию Nginx
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 24h;
    }

    # Основной прокси к приложению Express
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        client_max_body_size 50M;
    }
}
```

Активация конфига:
```bash
sudo ln -s /etc/nginx/sites-available/root-panel.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## ⚡ Discord Gateway Intents для бота Root

В `apps/root/src/bot/client.js` объявлены следующие намерения (Gateway Intents):

| Интент | Тип | Назначение в Root |
|---|---|---|
| `Guilds` | Стандартный | Базовые события серверов, каналов и ролей |
| `GuildMembers` | **Привилегированный** | Синхронизация ролей между Staff и Main, отслеживание входа для антирейда |
| `GuildModeration` | Стандартный | Мониторинг Audit Log для антикраша, супервизора ботов и обнаружения рейдов |
| `GuildEmojisAndStickers` | Стандартный | Защита от массового удаления эмодзи в модуле Антикраш |
| `GuildWebhooks` | Стандартный | Защита от спама вебхуками и их несанкционированного создания |
| `GuildInvites` | Стандартный | Защита от пачек спам-инвайтов |
| `GuildVoiceStates` | Стандартный | Мониторинг голосовых каналов |
| `GuildMessages` | Стандартный | Чтение лог-каналов и системных оповещений |
| `MessageContent` | **Привилегированный** | Анализ сообщений при необходимости автомодерации |

---

## 🛡 Права бота Root в Discord (Permissions)

Роль бота Root на серверах должна располагаться **выше ролей всех остальных ботов** для обеспечения работы супервизора и защиты от несанкционированных действий.

Рекомендуемые права роли Root:
- `Administrator` (Рекомендуется для полной защиты структуры и отката нарушений)

Либо минимальный набор прав:
- `ManageRoles` (Управление ролями — для синхронизации и снятия прав нарушителей)
- `ManageChannels` (Управление каналами — для создания, восстановления структуры и Lockdown)
- `KickMembers` (Кик участников и незарегистрированных ботов)
- `BanMembers` (Бан нарушителей лимитов антикраша)
- `ViewAuditLog` (Просмотр журнала аудита — критично для антикраша и супервизора)
- `ManageGuild` (Управление сервером — для отката смены имени/иконки)
- `ManageWebhooks` (Управление вебхуками)
- `ManageEmojisAndStickers` (Управление эмодзи)
- `ViewChannel` / `SendMessages` / `EmbedLinks` (Отправка логов в лог-каналы)

---

## 🔧 Доступные скрипты

| Скрипт | Описание |
|---|---|
| `npm run dev` | Запуск Root-Core в режиме разработки |
| `npm start` | Запуск Root-Core в production-режиме |
| `npm run migrate` | Применение SQL миграций к `/data/shared.db` |
| `npm run create-owner <id> [tag]` | Регистрация первого владельца веб-панели |
| `npm run backup` | Создание мгновенного снимка базы данных SQLite WAL |
| `pm2 start ecosystem.config.js` | Запуск под управлением демона PM2 |
