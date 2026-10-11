/**
 * Репозиторий системных данных (logs, errors, panel_users, audit, backups)
 */

const { getDb } = require('../index');

const systemRepo = {
  // --- Логи ---
  addLog(bot, guildId, type, level, message, metadata = {}, userId = null) {
    return getDb().prepare(`
      INSERT INTO logs (bot, guild_id, type, level, message, metadata, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(bot, guildId, type, level, message, JSON.stringify(metadata), userId);
  },

  getLogs({ bot, type, guildId, level, limit = 50, offset = 0 }) {
    const conditions = [];
    const params = [];

    if (bot)      { conditions.push('bot = ?');      params.push(bot); }
    if (type)     { conditions.push('type = ?');     params.push(type); }
    if (guildId)  { conditions.push('guild_id = ?');  params.push(guildId); }
    if (level)    { conditions.push('level = ?');    params.push(level); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = getDb().prepare(`SELECT COUNT(*) as c FROM logs ${where}`).get(...params).c;
    const items = getDb().prepare(`
      SELECT * FROM logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return { total, items };
  },

  // --- Ошибки ---
  addError(bot, guildId, errorType, message, stack) {
    return getDb().prepare(`
      INSERT INTO errors (bot, guild_id, error_type, message, stack)
      VALUES (?, ?, ?, ?, ?)
    `).run(bot, guildId, errorType, message, stack);
  },

  getUnresolvedErrors(limit = 50) {
    return getDb().prepare('SELECT * FROM errors WHERE resolved = 0 ORDER BY created_at DESC LIMIT ?').all(limit);
  },

  resolveError(id) {
    return getDb().prepare('UPDATE errors SET resolved = 1 WHERE id = ?').run(id);
  },

  // --- Пользователи панели ---
  getPanelUsers() {
    return getDb().prepare('SELECT * FROM panel_users ORDER BY role ASC, created_at DESC').all();
  },

  getPanelUser(discordId) {
    return getDb().prepare('SELECT * FROM panel_users WHERE discord_id = ?').get(discordId);
  },

  addPanelUser(discordId, discordTag, avatar, role, addedBy) {
    return getDb().prepare(`
      INSERT INTO panel_users (discord_id, discord_tag, avatar, role, added_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(discordId, discordTag, avatar, role, addedBy);
  },

  updatePanelUser(discordId, { role, lastLogin, discordTag, avatar }) {
    const user = this.getPanelUser(discordId);
    if (!user) return null;
    return getDb().prepare(`
      UPDATE panel_users
      SET role = COALESCE(?, role),
          last_login = COALESCE(?, last_login),
          discord_tag = COALESCE(?, discord_tag),
          avatar = COALESCE(?, avatar),
          updated_at = datetime('now')
      WHERE discord_id = ?
    `).run(role || null, lastLogin || null, discordTag || null, avatar || null, discordId);
  },

  deletePanelUser(discordId) {
    return getDb().prepare('DELETE FROM panel_users WHERE discord_id = ?').run(discordId);
  },

  // --- Аудит-лог ---
  addAudit(adminId, adminTag, action, section = null, targetId = null, oldValue = null, newValue = null, ipAddress = null) {
    return getDb().prepare(`
      INSERT INTO audit (admin_id, admin_tag, action, section, target_id, old_value, new_value, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      adminId, adminTag, action, section, targetId,
      oldValue != null ? JSON.stringify(oldValue) : null,
      newValue != null ? JSON.stringify(newValue) : null,
      ipAddress
    );
  },

  getAuditLogs(limit = 50, offset = 0) {
    const total = getDb().prepare('SELECT COUNT(*) as c FROM audit').get().c;
    const items = getDb().prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    return { total, items };
  },

  // --- Бэкапы ---
  addBackupRecord(filename, sizeBytes, createdBy, notes) {
    return getDb().prepare(`
      INSERT INTO backups (filename, size_bytes, created_by, notes)
      VALUES (?, ?, ?, ?)
    `).run(filename, sizeBytes, createdBy, notes);
  },

  getBackups() {
    return getDb().prepare('SELECT * FROM backups ORDER BY created_at DESC').all();
  },

  deleteBackupRecord(filename) {
    return getDb().prepare('DELETE FROM backups WHERE filename = ?').run(filename);
  }
};

module.exports = systemRepo;
