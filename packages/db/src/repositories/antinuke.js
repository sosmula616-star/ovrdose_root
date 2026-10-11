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
  },

  // --- Гибкие лимиты и правила по ролям ---
  getRoleRules(guildId) {
    const rows = getDb().prepare('SELECT * FROM antinuke_role_rules WHERE guild_id = ? ORDER BY id ASC').all(guildId);
    return rows.map(r => ({
      ...r,
      permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : (r.permissions || {})
    }));
  },

  getRoleRule(guildId, roleId) {
    const row = getDb().prepare('SELECT * FROM antinuke_role_rules WHERE guild_id = ? AND role_id = ?').get(guildId, roleId);
    if (!row) return null;
    return {
      ...row,
      permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : (row.permissions || {})
    };
  },

  setRoleRule(guildId, roleId, roleName, permissions) {
    const permissionsStr = typeof permissions === 'object' ? JSON.stringify(permissions) : permissions;
    return getDb().prepare(`
      INSERT INTO antinuke_role_rules (guild_id, role_id, role_name, permissions)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, role_id) DO UPDATE SET
        role_name = excluded.role_name,
        permissions = excluded.permissions,
        updated_at = datetime('now')
    `).run(guildId, roleId, roleName, permissionsStr);
  },

  deleteRoleRule(guildId, roleId) {
    return getDb().prepare('DELETE FROM antinuke_role_rules WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
  }
};

module.exports = antinukeRepo;
