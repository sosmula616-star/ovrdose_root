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
function runMigrations(database) {
  const migrationsDir = path.resolve(__dirname, '../migrations');
  if (!fs.existsSync(migrationsDir)) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRows = database.prepare('SELECT name FROM _migrations').all();
  const applied = new Set(appliedRows.map(r => r.name));

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (!applied.has(file)) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const applyTx = database.transaction(() => {
        database.exec(sql);
        database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      });
      applyTx();
    }
  }
}

/**
 * Заполнение стартовых данных (боты Root, Guard, базовые серверы и лимиты)
 */
function seedDefaults(database) {
  const staffGuild = process.env.STAFF_GUILD_ID || '1558608015148716062';
  const mainGuild  = process.env.MAIN_GUILD_ID  || '1558606862277017690';

  // Регистрация ботов Root и Guard
  const insertBot = database.prepare(`
    INSERT OR IGNORE INTO bots (name, type, description, pm2_name, status)
    VALUES (?, ?, ?, ?, 'offline')
  `);
  insertBot.run('root', 'internal', 'Ядро системы, синхронизация и супервизор', 'root-core-root');
  insertBot.run('guard', 'external', 'Внешний бот модерации и безопасности', 'root-core-guard');

  // Привязка ботов к серверам
  const insertBotServer = database.prepare(`
    INSERT OR IGNORE INTO bot_servers (bot_name, guild_id, allowed)
    VALUES (?, ?, 1)
  `);
  insertBotServer.run('root', staffGuild);
  insertBotServer.run('root', mainGuild);
  insertBotServer.run('guard', staffGuild);
  insertBotServer.run('guard', mainGuild);

  // Регистрация владельца в панели (если задан)
  const ownerIds = (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const insertOwner = database.prepare(`
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
};
