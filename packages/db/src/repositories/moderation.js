/**
 * Репозиторий модерации (cases, warns, mutes, notes)
 */

const { getDb } = require('../index');

const moderationRepo = {
  createCase({ guildId, type, targetId, targetTag, moderatorId, moderatorTag, reason, duration, expiresAt, metadata = {} }) {
    const db = getDb();
    const last = db.prepare('SELECT MAX(case_number) as n FROM cases WHERE guild_id = ?').get(guildId);
    const caseNumber = (last?.n || 0) + 1;

    const res = db.prepare(`
      INSERT INTO cases (case_number, guild_id, type, target_id, target_tag, moderator_id, moderator_tag, reason, duration, expires_at, active, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      caseNumber, guildId, type, targetId, targetTag,
      moderatorId, moderatorTag, reason, duration, expiresAt,
      JSON.stringify(metadata)
    );

    return { caseId: res.lastInsertRowid, caseNumber };
  },

  getCases({ guildId, type, targetId, moderatorId, limit = 20, offset = 0 }) {
    const conditions = [];
    const params = [];

    if (guildId)     { conditions.push('guild_id = ?');     params.push(guildId); }
    if (type)        { conditions.push('type = ?');         params.push(type); }
    if (targetId)    { conditions.push('target_id = ?');    params.push(targetId); }
    if (moderatorId) { conditions.push('moderator_id = ?'); params.push(moderatorId); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = getDb().prepare(`SELECT COUNT(*) as c FROM cases ${where}`).get(...params).c;
    const items = getDb().prepare(`
      SELECT * FROM cases ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return { total, items };
  },

  getCaseById(id) {
    return getDb().prepare('SELECT * FROM cases WHERE id = ?').get(id);
  },

  // --- Предупреждения ---
  addWarn(guildId, userId, moderatorId, reason, caseId = null) {
    return getDb().prepare(`
      INSERT INTO warns (guild_id, user_id, moderator_id, reason, case_id, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(guildId, userId, moderatorId, reason, caseId);
  },

  getActiveWarnsCount(guildId, userId) {
    const row = getDb().prepare('SELECT COUNT(*) as c FROM warns WHERE guild_id = ? AND user_id = ? AND active = 1').get(guildId, userId);
    return row ? row.c : 0;
  },

  deactivateWarn(id) {
    return getDb().prepare('UPDATE warns SET active = 0 WHERE id = ?').run(id);
  },

  // --- Муты ---
  addMute(guildId, userId, moderatorId, type = 'text', reason = '', duration = null, expiresAt = null, caseId = null) {
    return getDb().prepare(`
      INSERT INTO mutes (guild_id, user_id, moderator_id, type, reason, duration, expires_at, case_id, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(guildId, userId, moderatorId, type, reason, duration, expiresAt, caseId);
  },

  getActiveMutes(guildId = null) {
    if (guildId) {
      return getDb().prepare('SELECT * FROM mutes WHERE guild_id = ? AND active = 1 ORDER BY created_at DESC').all(guildId);
    }
    return getDb().prepare('SELECT * FROM mutes WHERE active = 1 ORDER BY created_at DESC').all();
  },

  deactivateMute(id) {
    return getDb().prepare('UPDATE mutes SET active = 0 WHERE id = ?').run(id);
  },

  // --- Заметки ---
  addNote(guildId, userId, moderatorId, note) {
    return getDb().prepare(`
      INSERT INTO notes (guild_id, user_id, moderator_id, note)
      VALUES (?, ?, ?, ?)
    `).run(guildId, userId, moderatorId, note);
  },

  getNotes(guildId, userId) {
    return getDb().prepare('SELECT * FROM notes WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC').all(guildId, userId);
  },

  deleteNote(id) {
    return getDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
  }
};

module.exports = moderationRepo;
