/**
 * Репозиторий ботов и супервизора (bots, bot_servers, heartbeats, bot_actions)
 */

const { getDb } = require('../index');

const botsRepo = {
  getAllBots() {
    return getDb().prepare('SELECT * FROM bots ORDER BY id ASC').all();
  },

  getBot(name) {
    return getDb().prepare('SELECT * FROM bots WHERE name = ?').get(name);
  },

  updateBotStatus(name, status, version = null, maxRolesPos = null) {
    return getDb().prepare(`
      UPDATE bots
      SET status = ?, version = COALESCE(?, version), max_roles_pos = COALESCE(?, max_roles_pos), updated_at = datetime('now')
      WHERE name = ?
    `).run(status, version, maxRolesPos, name);
  },

  addBot(name, clientId, type = 'external', description = '', pm2Name = null, healthUrl = null) {
    return getDb().prepare(`
      INSERT INTO bots (name, client_id, type, description, pm2_name, health_url, status)
      VALUES (?, ?, ?, ?, ?, ?, 'offline')
    `).run(name, clientId, type, description, pm2Name, healthUrl);
  },

  deleteBot(name) {
    return getDb().prepare('DELETE FROM bots WHERE name = ?').run(name);
  },

  // --- Серверы бота ---
  getAllowedServers(botName) {
    return getDb().prepare('SELECT guild_id FROM bot_servers WHERE bot_name = ? AND allowed = 1').all(botName).map(r => r.guild_id);
  },

  setAllowedServer(botName, guildId, allowed = true) {
    return getDb().prepare(`
      INSERT INTO bot_servers (bot_name, guild_id, allowed)
      VALUES (?, ?, ?)
      ON CONFLICT(bot_name, guild_id) DO UPDATE SET allowed = excluded.allowed
    `).run(botName, guildId, allowed ? 1 : 0);
  },

  removeAllowedServer(botName, guildId) {
    return getDb().prepare('DELETE FROM bot_servers WHERE bot_name = ? AND guild_id = ?').run(botName, guildId);
  },

  // --- Heartbeats ---
  recordHeartbeat(bot, pingMs, ramMb, uptimeSec, guildCount) {
    return getDb().prepare(`
      INSERT INTO heartbeats (bot, ping_ms, ram_mb, uptime_sec, guild_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(bot, pingMs, ramMb, uptimeSec, guildCount);
  },

  getLatestHeartbeat(bot) {
    return getDb().prepare('SELECT * FROM heartbeats WHERE bot = ? ORDER BY created_at DESC LIMIT 1').get(bot);
  },

  // --- Действия ботов ---
  recordAction(botId, botName, guildId, actionType, targetId = null, details = {}) {
    return getDb().prepare(`
      INSERT INTO bot_actions (bot_id, bot_name, guild_id, action_type, target_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(botId, botName, guildId, actionType, targetId, JSON.stringify(details));
  },

  getRecentActions(botId = null, limit = 50) {
    if (botId) {
      return getDb().prepare('SELECT * FROM bot_actions WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?').all(botId, limit);
    }
    return getDb().prepare('SELECT * FROM bot_actions ORDER BY created_at DESC LIMIT ?').all(limit);
  },

  countRecentActions(botId, actionType, secondsWindow = 10) {
    const since = new Date(Date.now() - secondsWindow * 1000).toISOString();
    const row = getDb().prepare(`
      SELECT COUNT(*) as c FROM bot_actions
      WHERE bot_id = ? AND action_type = ? AND created_at >= ?
    `).get(botId, actionType, since);
    return row ? row.c : 0;
  }
};

module.exports = botsRepo;
