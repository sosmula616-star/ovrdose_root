/**
 * Единая точка входа "root-core"
 * Инициализирует: БД (SQLite WAL) -> Миграции -> Discord-бот Root -> Веб-панель -> Graceful Shutdown
 */

require('dotenv').config();
const path = require('path');
const { initDatabase, runMigrations, closeDatabase, system: systemRepo } = require('@root-core/db');
const { createLogger } = require('@root-core/shared');

// Discord бот
const { createBotClient } = require('./bot/client');
const { loadCommands } = require('./bot/commands');
const { loadEvents } = require('./bot/events');

// Модули
const LoggingModule = require('./modules/logging');
const RoleSyncModule = require('./modules/sync');
const EconomyModule = require('./modules/economy');
const AntinukeModule = require('./modules/antinuke');
const BotManagerModule = require('./modules/botmanager');
const SupervisorModule = require('./modules/supervisor');
const BackupModule = require('./modules/backup');
const ChannelsModule = require('./modules/channels');
const ModerationModule = require('./modules/moderation');

// Веб-панель
const { createWebServer } = require('./web/server');

const logger = createLogger('Root-Core');

async function bootstrap() {
  logger.info('=== Запуск Root-Core (Discord Бот + Веб-панель) ===');

  // 1. Инициализация базы данных и применение миграций
  const dbPath = path.resolve(process.env.DB_PATH || './data/shared.db');
  logger.info(`[DB] Подключение к базе данных: ${dbPath}`);
  const db = initDatabase(dbPath);
  logger.info('[DB] База данных успешно подключена, миграции применены.');

  // 2. Создание Discord-клиента Root
  logger.info('[Bot] Создание Discord-клиента Root...');
  const client = createBotClient();

  // 3. Создание и внедрение модулей ядра
  logger.info('[Modules] Инициализация модулей...');
  const loggingModule = new LoggingModule(client, logger);
  const syncModule = new RoleSyncModule(client, logger);
  const economyModule = new EconomyModule(client, logger);
  const antinukeModule = new AntinukeModule(client, logger, loggingModule);
  const botManagerModule = new BotManagerModule(client, logger, loggingModule);
  const supervisorModule = new SupervisorModule(client, logger, loggingModule, botManagerModule);
  const backupModule = new BackupModule(client, logger, loggingModule);
  const channelsModule = new ChannelsModule(client, logger, loggingModule);
  const moderationModule = new ModerationModule(client, logger, loggingModule);

  // Привязка модулей к клиенту для прямого доступа из команд и роутов веб-панели
  client.modules = {
    logging: loggingModule,
    sync: syncModule,
    economy: economyModule,
    antinuke: antinukeModule,
    botmanager: botManagerModule,
    supervisor: supervisorModule,
    backup: backupModule,
    channels: channelsModule,
    moderation: moderationModule,
  };

  // Запуск фоновых таймеров модулей
  syncModule.init();
  supervisorModule.init();
  backupModule.init();
  channelsModule.init();
  economyModule.init();
  moderationModule.init();

  // 4. Загрузка команд и событий бота
  logger.info('[Bot] Загрузка слэш-команд и обработчиков событий...');
  loadCommands(client, logger);
  loadEvents(client, logger);

  // 5. Запуск веб-панели Express
  const host = process.env.PANEL_HOST || '127.0.0.1';
  const port = parseInt(process.env.PANEL_PORT || '3000', 10);

  const app = createWebServer(client, logger);
  const httpServer = app.listen(port, host, () => {
    logger.info(`[Web] Веб-панель успешно запущена на http://${host}:${port}`);
    logger.info(`[Web] Внешний URL панели: ${process.env.PANEL_BASE_URL || `http://${host}:${port}`}`);
  });

  // 6. Авторизация Discord-бота Root
  const token = process.env.DISCORD_TOKEN_ROOT;
  if (!token) {
    logger.error('[Bot] КРИТИЧЕСКАЯ ОШИБКА: Переменная DISCORD_TOKEN_ROOT не задана в .env');
    process.exit(1);
  }

  logger.info('[Bot] Авторизация в Discord Gateway...');
  await client.login(token);

  // 7. Обработка завершения процесса (Graceful Shutdown)
  let isShuttingDown = false;
  async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.warn(`[System] Получен сигнал ${signal}. Завершение работы Root-Core...`);

    // Остановка веб-сервера
    httpServer.close(() => {
      logger.info('[Web] Веб-сервер остановлен');
    });

    // Остановка фоновых задач модулей
    syncModule.destroy();
    supervisorModule.destroy();
    backupModule.destroy();
    logger.info('[Modules] Фоновые таймеры остановлены');

    // Отключение Discord-клиента
    try {
      client.destroy();
      logger.info('[Bot] Discord клиент отключен');
    } catch (e) {}

    // Закрытие SQLite
    try {
      closeDatabase();
      logger.info('[DB] Соединение с базой данных закрыто');
    } catch (e) {}

    logger.info('[System] Процесс успешно завершен');
    process.exit(0);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // Глобальный перехват необработанных исключений
  process.on('uncaughtException', (err) => {
    logger.error(`[FATAL uncaughtException] ${err.message}`, err.stack);
    try {
      systemRepo.addError('root', null, 'uncaughtException', err.message, err.stack);
    } catch (e) {}
  });

  process.on('unhandledRejection', (reason, promise) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : '';
    logger.error(`[FATAL unhandledRejection] ${msg}`, stack);
    try {
      systemRepo.addError('root', null, 'unhandledRejection', msg, stack);
    } catch (e) {}
  });
}

bootstrap().catch(err => {
  logger.error(`[Bootstrap] Ошибка старта Root-Core: ${err.message}`, err.stack);
  process.exit(1);
});
