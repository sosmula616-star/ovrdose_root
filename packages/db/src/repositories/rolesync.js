/**
 * Репозиторий синхронизации ролей (role_map, pending_sync, sync_log)
 */

const { getDb } = require('../index');

const rolesyncRepo = {
  // --- role_map ---
  getMappings(onlyEnabled = false) {
    const sql = onlyEnabled
      ? 'SELECT * FROM role_map WHERE enabled = 1 ORDER BY id ASC'
      : 'SELECT * FROM role_map ORDER BY id DESC';
    return getDb().prepare(sql).all();
  },

  getMappingById(id) {
    return getDb().prepare('SELECT * FROM role_map WHERE id = ?').get(id);
  },

  addMapping(staffRoleId, mainRoleId, direction = 'staff_to_main', createdBy = null) {
    return getDb().prepare(`
      INSERT INTO role_map (staff_role_id, main_role_id, direction, enabled, created_by)
      VALUES (?, ?, ?, 1, ?)
    `).run(staffRoleId, mainRoleId, direction, createdBy);
  },

  updateMapping(id, { enabled, direction }) {
    const old = this.getMappingById(id);
    if (!old) return null;
    const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : old.enabled;
    const newDir = direction || old.direction;
    return getDb().prepare(`
      UPDATE role_map SET enabled = ?, direction = ?, updated_at = datetime('now') WHERE id = ?
    `).run(newEnabled, newDir, id);
  },

  deleteMapping(id) {
    return getDb().prepare('DELETE FROM role_map WHERE id = ?').run(id);
  },

  // --- pending_sync ---
  addPending(userId, targetGuild, roleId, action, reason) {
    return getDb().prepare(`
      INSERT OR REPLACE INTO pending_sync (user_id, target_guild, role_id, action, reason, attempts)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(userId, targetGuild, roleId, action, reason);
  },

  getPending(targetGuild = null) {
    if (targetGuild) {
      return getDb().prepare('SELECT * FROM pending_sync WHERE target_guild = ? ORDER BY created_at ASC').all(targetGuild);
    }
    return getDb().prepare('SELECT * FROM pending_sync ORDER BY created_at ASC').all();
  },

  removePending(id) {
    return getDb().prepare('DELETE FROM pending_sync WHERE id = ?').run(id);
  },

  incrementPendingAttempt(id) {
    return getDb().prepare('UPDATE pending_sync SET attempts = attempts + 1 WHERE id = ?').run(id);
  },

  // --- sync_log ---
  logSync(userId, action, roleId, guildId, reason, success = 1, error = null) {
    return getDb().prepare(`
      INSERT INTO sync_log (user_id, action, role_id, guild_id, reason, success, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, action, roleId, guildId, reason, success ? 1 : 0, error);
  },

  getRecentLogs(limit = 50) {
    return getDb().prepare('SELECT * FROM sync_log ORDER BY created_at DESC LIMIT ?').all(limit);
  }
};

module.exports = rolesyncRepo;
