/**
 * Репозиторий антикраша и снапшотов (snapshots, incidents)
 */

const { getDb } = require('../index');

const antinukeRepo = {
  // --- Снапшоты ---
  createSnapshot(guildId, name, dataJson, sizeBytes, createdBy) {
    return getDb().prepare(`
      INSERT INTO snapshots (guild_id, name, data, size_bytes, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(guildId, name, dataJson, sizeBytes, createdBy);
  },

  getSnapshots(guildId) {
    return getDb().prepare(`
      SELECT id, guild_id, name, size_bytes, created_by, created_at
      FROM snapshots
      WHERE guild_id = ?
      ORDER BY created_at DESC
    `).all(guildId);
  },

  getSnapshotById(id) {
    return getDb().prepare('SELECT * FROM snapshots WHERE id = ?').get(id);
  },

  deleteSnapshot(id) {
    return getDb().prepare('DELETE FROM snapshots WHERE id = ?').run(id);
  },

  // --- Инциденты ---
  recordIncident(guildId, eventType, userId, userTag, details = {}, actionTaken = 'alert') {
    return getDb().prepare(`
      INSERT INTO incidents (guild_id, event_type, user_id, user_tag, details, action_taken)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(guildId, eventType, userId, userTag, JSON.stringify(details), actionTaken);
  },

  getIncidents(guildId = null, limit = 20, offset = 0) {
    if (guildId) {
      const total = getDb().prepare('SELECT COUNT(*) as c FROM incidents WHERE guild_id = ?').get(guildId).c;
      const items = getDb().prepare(`
        SELECT * FROM incidents WHERE guild_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).all(guildId, limit, offset);
      return { total, items };
    }
    const total = getDb().prepare('SELECT COUNT(*) as c FROM incidents').get().c;
    const items = getDb().prepare(`
      SELECT * FROM incidents ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
    return { total, items };
  },

  resolveIncident(id) {
    return getDb().prepare('UPDATE incidents SET resolved = 1 WHERE id = ?').run(id);
  }
};

module.exports = antinukeRepo;
