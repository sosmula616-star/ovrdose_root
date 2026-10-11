/**
 * API маршруты Dashboard
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { bots: botsRepo, antinuke: antinukeRepo, moderation: modRepo, system: systemRepo } = require('@root-core/db');
const { recordAudit } = require('../middleware/audit');

router.get('/stats', canView, async (req, res) => {
  const client = req.app.locals.client;
  const staffGuild = client.guilds.cache.get(process.env.STAFF_GUILD_ID || '1558608015148716062');
  const mainGuild  = client.guilds.cache.get(process.env.MAIN_GUILD_ID  || '1558606862277017690');

  // Статусы ботов
  const allBots = botsRepo.getAllBots();
  const botsData = allBots.map(b => {
    if (b.name === 'root') {
      const ram = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
      return {
        name: 'root',
        type: 'internal',
        status: 'online',
        ping: client.ws.ping >= 0 ? client.ws.ping : 0,
        ram: parseFloat(ram),
        uptime: Math.floor(process.uptime()),
        version: b.version || '1.0.0',
      };
    }
    const hb = botsRepo.getLatestHeartbeat(b.name);
    const isOnline = hb && (Date.now() - new Date(hb.created_at).getTime()) < 60000;
    return {
      name: b.name,
      type: b.type,
      status: isOnline ? 'online' : (b.status === 'restarting' ? 'restarting' : 'offline'),
      ping: hb?.ping_ms ?? 0,
      ram: hb?.ram_mb ?? 0,
      uptime: hb?.uptime_sec ?? 0,
      version: b.version || '1.0.0',
    };
  });

  // Число участников
  const members = {
    staff: staffGuild?.memberCount || 0,
    main:  mainGuild?.memberCount  || 0,
  };

  // Активные наказания и инциденты
  const activeMutes = modRepo.getActiveMutes().length;
  const incidents = antinukeRepo.getIncidents(null, 5).items;
  const recentLogs = systemRepo.getLogs({ limit: 10 }).items;

  res.json({
    bots: botsData,
    members,
    activeMutes,
    incidents,
    recentLogs,
  });
});

module.exports = router;
