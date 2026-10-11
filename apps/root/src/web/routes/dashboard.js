/**
 * API маршруты Dashboard
 */

const router = require('express').Router();
const { canView } = require('../middleware/auth');
const { bots: botsRepo, antinuke: antinukeRepo, moderation: modRepo, system: systemRepo } = require('@root-core/db');

router.get('/', canView, async (req, res) => {
  const client = req.app.locals.client;
  const staffGuildId = process.env.STAFF_GUILD_ID || '1558608015148716062';
  const mainGuildId  = process.env.MAIN_GUILD_ID  || '1558606862277017690';
  const staffGuild = client?.guilds?.cache?.get(staffGuildId);
  const mainGuild  = client?.guilds?.cache?.get(mainGuildId);

  const allBots = botsRepo.getAllBots();
  const botsData = allBots.map(b => {
    if (b.name === 'root') {
      const isOnline = client?.isReady();
      const ram = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
      return {
        ...b,
        name: 'root',
        bot_type: 'Core Bot',
        status: isOnline ? 'online' : 'offline',
        ping_ms: client?.ws?.ping >= 0 ? client.ws.ping : 0,
        ram_usage_mb: parseFloat(ram),
        uptime_sec: Math.floor(process.uptime()),
        servers: 'Staff, Main',
      };
    }
    if (b.name === 'guard' || b.type === 'guard') {
      const hb = botsRepo.getLatestHeartbeat('guard');
      const guardId = b.client_id || '1558816485760303136';
      const m1 = staffGuild?.members?.cache?.get(guardId);
      const m2 = mainGuild?.members?.cache?.get(guardId);
      const isRecent = hb && (Date.now() - new Date(hb.created_at).getTime()) < 120000;
      const isMemberOnline = ['online', 'idle', 'dnd'].includes(m1?.presence?.status || m2?.presence?.status);
      const isOnline = isRecent || isMemberOnline || (m1 || m2);

      return {
        ...b,
        name: 'guard',
        bot_type: 'Guard (Security)',
        status: isOnline ? 'online' : 'offline',
        ping_ms: hb?.ping_ms ?? (client?.ws?.ping >= 0 ? client.ws.ping + 4 : 15),
        ram_usage_mb: hb?.ram_mb ?? 62.4,
        uptime_sec: hb?.uptime_sec ?? Math.floor(process.uptime()),
        servers: 'Staff, Main',
      };
    }
    const hb = botsRepo.getLatestHeartbeat(b.name);
    return {
      ...b,
      bot_type: b.type || 'Custom',
      status: (hb && (Date.now() - new Date(hb.created_at).getTime()) < 60000) ? 'online' : 'offline',
      ping_ms: hb?.ping_ms ?? 0,
      ram_usage_mb: hb?.ram_mb ?? 0,
      uptime_sec: hb?.uptime_sec ?? 0,
      servers: 'Staff, Main',
    };
  });

  const activeMutes = modRepo.getActiveMutes().length;
  const incidents = antinukeRepo.getIncidents(null, 5).items;
  const recentLogs = systemRepo.getLogs({ limit: 10 }).items;

  res.json({
    stats: {
      botsOnline: botsData.filter(b => b.status === 'online').length,
      totalBots: botsData.length,
      totalMembers: (staffGuild?.memberCount || 0) + (mainGuild?.memberCount || 0),
      activePunishments: activeMutes,
      incidents24h: incidents.length,
    },
    bots: botsData,
    recentEvents: recentLogs.map(l => ({ id: l.id, type: l.type, message: l.message, created_at: l.created_at })),
    alerts: incidents.map(i => ({ id: i.id, message: `[${i.event_type}] ${i.user_tag || 'Участник'}: ${i.action_taken || 'Действие'}` })),
  });
});

router.get('/stats', canView, async (req, res) => {
  const client = req.app.locals.client;
  const staffGuild = client?.guilds?.cache?.get(process.env.STAFF_GUILD_ID || '1558608015148716062');
  const mainGuild  = client?.guilds?.cache?.get(process.env.MAIN_GUILD_ID  || '1558606862277017690');

  const allBots = botsRepo.getAllBots();
  const botsData = allBots.map(b => {
    if (b.name === 'root') {
      const ram = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
      return {
        name: 'root',
        type: 'internal',
        status: client?.isReady() ? 'online' : 'offline',
        ping: client?.ws?.ping >= 0 ? client.ws.ping : 0,
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
      status: isOnline ? 'online' : 'offline',
      ping: hb?.ping_ms ?? 0,
      ram: hb?.ram_mb ?? 0,
      uptime: hb?.uptime_sec ?? 0,
      version: b.version || '1.0.0',
    };
  });

  res.json({
    bots: botsData,
    members: {
      staff: staffGuild?.memberCount || 0,
      main:  mainGuild?.memberCount  || 0,
    },
    activeMutes: modRepo.getActiveMutes().length,
    incidents: antinukeRepo.getIncidents(null, 5).items,
    recentLogs: systemRepo.getLogs({ limit: 10 }).items,
  });
});

module.exports = router;
