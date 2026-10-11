/**
 * Репозиторий управляемых каналов и структуры серверов
 */

const { getDb } = require('../index');

const channelsRepo = {
  getAll(guildId = null) {
    if (guildId) {
      return getDb().prepare('SELECT * FROM managed_channels WHERE guild_id = ? ORDER BY position ASC, id ASC').all(guildId);
    }
    return getDb().prepare('SELECT * FROM managed_channels ORDER BY guild_id ASC, position ASC, id ASC').all();
  },

  getEnforced(guildId = null) {
    if (guildId) {
      return getDb().prepare('SELECT * FROM managed_channels WHERE guild_id = ? AND is_enforced = 1').all(guildId);
    }
    return getDb().prepare('SELECT * FROM managed_channels WHERE is_enforced = 1').all();
  },

  getByChannelId(guildId, channelId) {
    return getDb().prepare('SELECT * FROM managed_channels WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId);
  },

  getById(id) {
    return getDb().prepare('SELECT * FROM managed_channels WHERE id = ?').get(id);
  },

  addManagedChannel({ guildId, channelId, name, type = 'text', groupType = 'general', categoryName = null, categoryId = null, position = 0, isEnforced = 1 }) {
    const stmt = getDb().prepare(`
      INSERT INTO managed_channels (guild_id, channel_id, name, type, group_type, category_name, category_id, position, is_enforced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, name, group_type) DO UPDATE SET
        channel_id = excluded.channel_id,
        type = excluded.type,
        category_name = excluded.category_name,
        category_id = excluded.category_id,
        position = excluded.position,
        is_enforced = excluded.is_enforced,
        updated_at = datetime('now')
    `);
    return stmt.run(guildId, channelId, name, type, groupType, categoryName, categoryId, position, isEnforced ? 1 : 0);
  },

  updateManagedChannel(id, { name, categoryName, categoryId, position, groupType, isEnforced }) {
    return getDb().prepare(`
      UPDATE managed_channels
      SET
        name = COALESCE(?, name),
        category_name = COALESCE(?, category_name),
        category_id = COALESCE(?, category_id),
        position = COALESCE(?, position),
        group_type = COALESCE(?, group_type),
        is_enforced = COALESCE(?, is_enforced),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(name, categoryName, categoryId, position, groupType, isEnforced !== undefined ? (isEnforced ? 1 : 0) : null, id);
  },

  updateChannelId(id, newChannelId) {
    return getDb().prepare(`
      UPDATE managed_channels
      SET channel_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newChannelId, id);
  },

  deleteManagedChannel(id) {
    return getDb().prepare('DELETE FROM managed_channels WHERE id = ?').run(id);
  },

  deleteByChannelId(guildId, channelId) {
    return getDb().prepare('DELETE FROM managed_channels WHERE guild_id = ? AND channel_id = ?').run(guildId, channelId);
  }
};

module.exports = channelsRepo;
