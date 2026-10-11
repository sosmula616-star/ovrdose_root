/**
 * Скрипт создания/назначения первого владельца веб-панели
 * Использование: node scripts/create-owner.js [DISCORD_ID] [TAG]
 */

require('dotenv').config();
const { initDatabase, getDb, closeDatabase } = require('../packages/db/src/index');

const discordId = process.argv[2] || (process.env.OWNER_IDS || '').split(',')[0]?.trim();
const tag = process.argv[3] || 'Root Owner';

if (!discordId || !/^\d{17,20}$/.test(discordId)) {
  console.error('Ошибка: Укажите корректный Discord ID (17-20 цифр).');
  console.error('Пример: node scripts/create-owner.js 1558608015148716062 "Admin#0001"');
  process.exit(1);
}

try {
  initDatabase(process.env.DB_PATH || './data/shared.db');
  const db = getDb();

  db.prepare(`
    INSERT INTO panel_users (discord_id, discord_tag, role, added_by, updated_at)
    VALUES (?, ?, 'owner', 'cli', datetime('now'))
    ON CONFLICT(discord_id) DO UPDATE SET
      role = 'owner',
      discord_tag = excluded.discord_tag,
      updated_at = excluded.updated_at
  `).run(discordId, tag);

  console.log(`[Success] Пользователь с Discord ID ${discordId} (${tag}) успешно назначен OWNER панели.`);
} catch (err) {
  console.error('[Error] Ошибка добавления владельца:', err.message);
  process.exit(1);
} finally {
  closeDatabase();
}
