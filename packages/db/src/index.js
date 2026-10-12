/**
 * @root-core/db - Инициализация SQLite базы данных (better-sqlite3)
 * Поддерживает WAL-режим, миграции, транзакции и репозитории.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

/**
 * Инициализация соединения с БД и выполнение миграций
 * @param {string} dbPath - Путь к файлу sqlite базы
 */
function initDatabase(dbPath = './data/shared.db') {
  if (db) return db;

  const resolvedPath = path.resolve(dbPath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedPath, {
    timeout: 10000,
    verbose: null,
  });

  // Включаем обязательные прагмы для отказоустойчивости и конкурентного доступа
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000');

  // Выполняем миграции
  runMigrations(db);

  // Заполняем дефолтные записи
  seedDefaults(db);

  return db;
}

/**
 * Выполнение файлов миграций из папки migrations/
 */
function runMigrations(database = null) {
  const targetDb = database || db;
  if (!targetDb) {
    throw new Error('База данных не инициализирована для выполнения миграций');
  }

  const migrationsDir = path.resolve(__dirname, '../migrations');
  if (!fs.existsSync(migrationsDir)) return;

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRows = targetDb.prepare('SELECT name FROM _migrations').all();
  const applied = new Set(appliedRows.map(r => r.name));

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (!applied.has(file)) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const applyTx = targetDb.transaction(() => {
        targetDb.exec(sql);
        targetDb.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      });
      applyTx();
    }
  }
}

/**
 * Заполнение стартовых данных (боты Root, Guard, базовые серверы и лимиты)
 */
function seedDefaults(database = null) {
  const targetDb = database || db;
  if (!targetDb) return;

  const staffGuild = process.env.STAFF_GUILD_ID || '1558608015148716062';
  const mainGuild  = process.env.MAIN_GUILD_ID  || '1558606862277017690';

  // Регистрация ботов Root и Guard
  const insertBot = targetDb.prepare(`
    INSERT INTO bots (name, type, client_id, description, pm2_name, status)
    VALUES (?, ?, ?, ?, ?, 'offline')
    ON CONFLICT(name) DO UPDATE SET
      client_id = excluded.client_id,
      description = excluded.description
  `);
  insertBot.run('root', 'internal', process.env.DISCORD_CLIENT_ID_ROOT || '1558812630368522300', 'Ядро системы, синхронизация и супервизор', 'root-core-root');
  insertBot.run('guard', 'external', process.env.GUARD_CLIENT_ID || '1558816485760303136', 'Внешний бот модерации и безопасности', 'root-core-guard');
  insertBot.run('warden', 'external', process.env.GUARD_CLIENT_ID || '1558816485760303136', 'Бот модерации Warden (/act, жалобы, веб-панель mod.ovrdose.bothost.tech)', 'root-moderator-bot');

  // Привязка ботов к серверам
  const insertBotServer = targetDb.prepare(`
    INSERT OR IGNORE INTO bot_servers (bot_name, guild_id, allowed)
    VALUES (?, ?, 1)
  `);
  insertBotServer.run('root', staffGuild);
  insertBotServer.run('root', mainGuild);
  insertBotServer.run('guard', staffGuild);
  insertBotServer.run('guard', mainGuild);
  insertBotServer.run('warden', staffGuild);
  insertBotServer.run('warden', mainGuild);

  // Регистрация владельца в панели (если задан)
  const ownerIds = (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const insertOwner = targetDb.prepare(`
    INSERT OR IGNORE INTO panel_users (discord_id, discord_tag, role, added_by)
    VALUES (?, 'System Owner', 'owner', 'seed')
  `);
  for (const ownerId of ownerIds) {
    insertOwner.run(ownerId);
  }
}

/**
 * Получить экземпляр БД
 */
function getDb() {
  if (!db) {
    throw new Error('База данных не инициализирована. Вызовите initDatabase() перед обращением к getDb()');
  }
  return db;
}

/**
 * Закрытие соединения
 */
function closeDatabase() {
  if (db && db.open) {
    db.close();
    db = null;
  }
}

module.exports = {
  initDatabase,
  getDb,
  closeDatabase,
  runMigrations,
  // Репозитории
  get settings()   { return require('./repositories/settings'); },
  get rolesync()   { return require('./repositories/rolesync'); },
  get economy()    { return require('./repositories/economy'); },
  get bots()       { return require('./repositories/bots'); },
  get moderation() { return require('./repositories/moderation'); },
  get antinuke()   { return require('./repositories/antinuke'); },
  get system()     { return require('./repositories/system'); },
  get channels()   { return require('./repositories/channels'); },
};
