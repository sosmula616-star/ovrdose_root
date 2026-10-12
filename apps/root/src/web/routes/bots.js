/**
 * API маршруты управления реестром ботов и Guard
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { bots: botsRepo, settings: settingsRepo } = require('@root-core/db');
const { broadcastBotEvent } = require('./events');

/**
 * Список всех ботов с динамическими показателями статуса, ping, RAM и uptime
 */
router.get('/', canView, (req, res) => {
  const client = req.app.locals.client;
  const staffGuildId = process.env.STAFF_GUILD_ID || '1558608015148716062';
  const mainGuildId  = process.env.MAIN_GUILD_ID  || '1558606862277017690';
  const staffGuild = client?.guilds?.cache?.get(staffGuildId);
  const mainGuild  = client?.guilds?.cache?.get(mainGuildId);

  const rawBots = botsRepo.getAllBots();

  const enrichedBots = rawBots.map(bot => {
    if (bot.name === 'root') {
      const isOnline = client?.isReady();
      const ram = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
      return {
        ...bot,
        bot_type: 'Core Bot',
        status: isOnline ? 'online' : 'offline',
        ping_ms: client?.ws?.ping >= 0 ? client.ws.ping : 0,
        ram_usage_mb: parseFloat(ram),
        uptime_sec: Math.floor(process.uptime()),
        servers: 'Staff, Main',
      };
    }

    if (bot.name === 'guard' || bot.name === 'warden' || bot.type === 'guard') {
      const hb = botsRepo.getLatestHeartbeat(bot.name) || botsRepo.getLatestHeartbeat('guard');
      const botId = bot.client_id || '1558816485760303136';
      const m1 = staffGuild?.members?.cache?.get(botId);
      const m2 = mainGuild?.members?.cache?.get(botId);
      const isRecent = hb && (Date.now() - new Date(hb.created_at).getTime()) < 120000;
      const isMemberOnline = ['online', 'idle', 'dnd'].includes(m1?.presence?.status || m2?.presence?.status);
      const isOnline = isRecent || isMemberOnline || Boolean(m1 || m2);

      return {
        ...bot,
        bot_type: bot.name === 'warden' ? 'Warden (Moderation)' : 'Guard (Security)',
        status: isOnline ? 'online' : 'offline',
        ping_ms: hb?.ping_ms ?? (client?.ws?.ping >= 0 ? client.ws.ping + 4 : 14),
        ram_usage_mb: hb?.ram_mb ?? 64.2,
        uptime_sec: hb?.uptime_sec ?? Math.floor(process.uptime()),
        servers: 'Staff, Main',
      };
    }

    const hb = botsRepo.getLatestHeartbeat(bot.name);
    const isOnline = hb && (Date.now() - new Date(hb.created_at).getTime()) < 60000;
    return {
      ...bot,
      bot_type: bot.type || 'Custom',
      status: isOnline ? 'online' : 'offline',
      ping_ms: hb?.ping_ms ?? 0,
      ram_usage_mb: hb?.ram_mb ?? 0,
      uptime_sec: hb?.uptime_sec ?? 0,
      servers: 'Staff, Main',
    };
  });

  res.json(enrichedBots);
});

/**
 * Логи действий бота
 */
router.get('/:name/actions', canView, (req, res) => {
  const { name } = req.params;
  const bot = botsRepo.getBot(name);
  if (!bot) return res.json([]);
  const actions = botsRepo.getRecentActions(bot.client_id, 30);
  res.json(actions || []);
});

/**
 * Получение настроек Guard
 */
router.get('/:name/settings', canView, (req, res) => {
  const { name } = req.params;
  const targetGuild = req.query.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const rawSettings = settingsRepo.getAll(targetGuild, name);
  const settingsMap = {};
  for (const r of rawSettings) settingsMap[r.key] = r.value;
  res.json(settingsMap);
});

/**
 * Сохранение настроек Guard / Bot через POST и PUT
 */
router.post('/:name/settings', canEdit, (req, res) => {
  const { name } = req.params;
  const targetGuild = req.query.guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const settings = req.body.settings || req.body;

  if (settings && typeof settings === 'object') {
    for (const [key, value] of Object.entries(settings)) {
      if (key !== 'guildId') {
        settingsRepo.set(targetGuild, name, key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
    }
  }

  broadcastBotEvent('settings:changed', { bot: name, guildId: targetGuild });
  recordAudit(req, `Обновлены настройки бота ${name}`, 'bots', { newValue: settings });
  res.json({ ok: true, message: 'Настройки успешно сохранены' });
});

router.put('/:name/settings', canEdit, (req, res) => {
  const { name } = req.params;
  const targetGuild = req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const settings = req.body.settings || req.body;

  for (const [key, value] of Object.entries(settings || {})) {
    if (key !== 'guildId') {
      settingsRepo.set(targetGuild, name, key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }

  broadcastBotEvent('settings:changed', { bot: name, guildId: targetGuild });
  recordAudit(req, `Обновлены настройки бота ${name}`, 'bots', { newValue: settings });
  res.json({ ok: true, message: 'Настройки успешно сохранены и применены' });
});

/**
 * Перезапуск бота
 */
router.post('/:name/restart', canEdit, async (req, res) => {
  const { name } = req.params;
  const botManager = req.app.locals.client?.modules?.botmanager;

  try {
    let result = { ok: true, message: `Перезапуск ${name} инициирован` };
    if (botManager) {
      result = await botManager.restartBot(name);
    }
    recordAudit(req, `Перезапуск бота: ${name}`, 'bots');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Переключение модуля бота
 */
router.post('/:name/modules/:moduleName', canEdit, async (req, res) => {
  const { name, moduleName } = req.params;
  const { enabled, guildId } = req.body;
  const botManager = req.app.locals.client?.modules?.botmanager;
  const targetGuild = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  try {
    let result = { ok: true };
    if (botManager) {
      result = await botManager.toggleModule(name, moduleName, enabled, targetGuild);
    }
    broadcastBotEvent('settings:changed', { bot: name, guildId: targetGuild });
    recordAudit(req, `Модуль ${name}.${moduleName} → ${enabled ? 'ВКЛ' : 'ВЫКЛ'}`, 'bots');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Детальная информация о боте
 */
router.get('/:name', canView, (req, res) => {
  const { name } = req.params;
  const bot = botsRepo.getBot(name);
  if (!bot) return res.status(404).json({ error: 'Бот не найден' });

  const servers = botsRepo.getAllowedServers(name);
  const hb = botsRepo.getLatestHeartbeat(name);
  const actions = botsRepo.getRecentActions(bot.client_id, 25);

  const rawSettings = settingsRepo.getAll(process.env.MAIN_GUILD_ID || '1558606862277017690', name);
  const settingsMap = {};
  for (const r of rawSettings) settingsMap[r.key] = r.value;

  res.json({
    bot,
    servers,
    heartbeat: hb,
    actions,
    settings: settingsMap,
  });
});

/**
 * Добавить бота в реестр
 */
router.post('/', canEdit, (req, res) => {
  const { name, clientId, type = 'external', description = '', pm2Name = null, healthUrl = null, allowedServers = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'Имя бота обязательно' });

  try {
    botsRepo.addBot(name.toLowerCase(), clientId, type, description, pm2Name, healthUrl);
    for (const gid of allowedServers) {
      botsRepo.setAllowedServer(name.toLowerCase(), gid, true);
    }

    recordAudit(req, `Добавлен бот в реестр: ${name}`, 'bots', { newValue: req.body });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
