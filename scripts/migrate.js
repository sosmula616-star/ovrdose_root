/**
 * Скрипт применения миграций базы данных
 * Запуск: npm run migrate
 */

require('dotenv').config();
const { initDatabase, closeDatabase } = require('../packages/db/src/index');

const dbPath = process.env.DB_PATH || './data/shared.db';
console.log(`[Migrate] Запуск миграций для базы: ${dbPath}`);

try {
  initDatabase(dbPath);
  console.log('[Migrate] Все миграции успешно применены.');
} catch (err) {
  console.error('[Migrate] Ошибка выполнения миграций:', err);
  process.exit(1);
} finally {
  closeDatabase();
}
