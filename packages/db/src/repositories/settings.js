/**
 * Репозиторий настроек settings
 */

const { getDb } = require('../index');

const settingsRepo = {
  get(guildId, bot, key) {
    const row = getDb().prepare(`
      SELECT value FROM settings WHERE guild_id = ? AND bot = ? AND key = ?
    `).get(guildId, bot, key);
    return row ? row.value : null;
  },

  getAll(guildId, bot = null) {
    if (bot) {
      return getDb().prepare(`
        SELECT key, value FROM settings WHERE guild_id = ? AND bot = ?
      `).all(guildId, bot);
    }
    return getDb().prepare(`
      SELECT bot, key, value FROM settings WHERE guild_id = ?
    `).all(guildId);
  },

  set(guildId, bot, key, value) {
    return getDb().prepare(`
      INSERT INTO settings (guild_id, bot, key, value, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(guild_id, bot, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(guildId, bot, key, String(value));
  },

  delete(guildId, bot, key) {
    return getDb().prepare(`
      DELETE FROM settings WHERE guild_id = ? AND bot = ? AND key = ?
    `).run(guildId, bot, key);
  }
};

module.exports = settingsRepo;
