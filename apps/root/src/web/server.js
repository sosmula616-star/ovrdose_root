/**
 * Веб-сервер панели управления Express
 * Поддерживает сессии, защиту Helmet, CSRF, Rate Limiting и REST API
 */

const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const csurf = require('csurf');

// Маршруты
const authRoutes = require('./routes/auth');
const eventsRoutes = require('./routes/events');
const internalRoutes = require('./routes/internal');
const dashboardRoutes = require('./routes/dashboard');
const botsRoutes = require('./routes/bots');
const roleSyncRoutes = require('./routes/rolesync');
const permissionsRoutes = require('./routes/permissions');
const moderationRoutes = require('./routes/moderation');
const economyRoutes = require('./routes/economy');
const anticrashRoutes = require('./routes/anticrash');
const logsRoutes = require('./routes/logs');
const logChannelsRoutes = require('./routes/logchannels');
const backupsRoutes = require('./routes/backups');
const settingsRoutes = require('./routes/settings');
const discordRoutes = require('./routes/discord');
const channelsRoutes = require('./routes/channels');
const { loadUser, requireAuth } = require('./middleware/auth');

function createWebServer(client, logger) {
  const app = express();

  // Доверяем обратному прокси Bothost (Nginx/Cloudflare) для передачи HTTPS заголовков
  app.set('trust proxy', 1);

  // Сохраняем ссылку на Discord клиент и SSE в app.locals
  app.locals.client = client;
  app.locals.logger = logger;
  app.locals.broadcastEvent = eventsRoutes.broadcastPanelEvent;
  app.locals.broadcastBotEvent = eventsRoutes.broadcastBotEvent;

  // 1. Helmet с настроенной Content Security Policy
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'", // необходимо для выражений Alpine.js
          'https://cdn.jsdelivr.net',
          'https://unpkg.com',
          'https://challenges.cloudflare.com',
        ],
        frameSrc: [
          "'self'",
          'https://challenges.cloudflare.com',
          'http://localhost:8000',
          'http://127.0.0.1:8000',
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
        ],
        fontSrc: [
          "'self'",
          'https://fonts.gstatic.com',
        ],
        imgSrc: [
          "'self'",
          'data:',
          'https://cdn.discordapp.com',
        ],
        connectSrc: [
          "'self'",
          'https://challenges.cloudflare.com',
        ],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Защита от автоматизированных ботов и сканеров Cloudflare
  const { cloudflareSecurity } = require('./middleware/cloudflare');
  app.use(cloudflareSecurity);

  // 2. Лимитер запросов (защита от брутфорса)
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много запросов. Подождите немного.' },
  });

  // 3. Парсеры тела запросов
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 4. Сессии (хранятся в SQLite сессионной базе данных)
  const sessionDir = path.resolve('./data');
  app.use(session({
    store: new SQLiteStore({
      dir: sessionDir,
      db: 'sessions.db',
    }),
    name: 'root_session',
    secret: process.env.SESSION_SECRET || 'root-core-super-secret-key-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: 'auto',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
    },
  }));

  // 5. Внутренний API для внешних ботов (без CSRF и сессий, проверяет токен)
  app.use('/internal', internalRoutes);

  // 6. Подгрузка профиля пользователя панели
  app.use(loadUser);

  // 7. CSRF защита (кроме внутренних вызовов и чтения SSE)
  const csrfProtection = csurf({ cookie: false });

  // Эндпоинт для получения CSRF токена фронтендом
  app.get('/api/csrf-token', csrfProtection, (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });

  // Подключаем CSRF на изменяющие методы для /api/
  app.use('/api', (req, res, next) => {
    // SSE стрим пропускает CSRF
    if (req.path.startsWith('/events')) {
      return next();
    }
    // GET, HEAD, OPTIONS безопасны
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }
    return csrfProtection(req, res, next);
  });

  // 8. Подключение маршрутов
  app.use('/auth', authRoutes);
  app.use('/api', apiLimiter);

  app.use('/api/events', eventsRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/bots', botsRoutes);
  app.use('/api/rolesync', roleSyncRoutes);
  app.use('/api/permissions', permissionsRoutes);
  app.use('/api/moderation', moderationRoutes);
  app.use('/api/economy', economyRoutes);
  app.use('/api/anticrash', anticrashRoutes);
  app.use('/api/logs', logsRoutes);
  app.use('/api/logchannels', logChannelsRoutes);
  app.use('/api/backups', backupsRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/discord', discordRoutes);
  app.use('/api/channels', channelsRoutes);

  // 9. Статические файлы фронтенда
  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir));

  // 10. SPA fallback для панели (требует авторизацию)
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/internal')) {
      return next();
    }
    if (!req.session?.user && req.path !== '/login') {
      return res.redirect('/auth/login');
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // 11. Обработчик ошибок CSRF и общих ошибок
  app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
      return res.status(403).json({ error: 'Недействительный или отсутствующий CSRF токен' });
    }
    logger.error(`[Web] Необработанная ошибка маршрута ${req.method} ${req.url}: ${err.message}`, err.stack);
    res.status(err.status || 500).json({ error: err.message || 'Внутренняя ошибка сервера' });
  });

  return app;
}

module.exports = { createWebServer };
