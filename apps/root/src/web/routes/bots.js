/**
 * API маршруты управления реестром ботов и Guard
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { bots: botsRepo, settings: settingsRepo } = require('@root-core/db');
const { broadcastBotEvent } = require('./events');

/**
 * Список всех ботов
 */
router.get('/', canView, (req, res) => {
  const bots = botsRepo.getAllBots();
  res.json(bots);
});

/**
 * Детальная информация о боте (серверы, действия, настройки)
 */
router.get('/:name', canView, (req, res) => {
  const { name } = req.params;
  const bot = botsRepo.getBot(name);
  if (!bot) return res.status(404).json({ error: 'Бот не найден' });

  const servers = botsRepo.getAllowedServers(name);
  const hb = botsRepo.getLatestHeartbeat(name);
  const actions = botsRepo.getRecentActions(bot.client_id, 25);

  // Настройки бота для основного сервера
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

/**
 * Действия с процессом бота (restart, stop, start)
 */
router.post('/:name/action', canEdit, async (req, res) => {
  const { name } = req.params;
  const { action } = req.body;
  const botManager = req.app.locals.client.modules.botmanager;

  try {
    let result = null;
    if (action === 'restart') {
      result = await botManager.restartBot(name);
    } else if (action === 'stop') {
      result = await botManager.stopBot(name);
    } else if (action === 'start') {
      result = await botManager.startBot(name);
    } else {
      return res.status(400).json({ error: 'Неизвестное действие' });
    }

    recordAudit(req, `Действие над ботом ${name}: ${action}`, 'bots');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Переключение модуля
 */
router.post('/:name/module', canEdit, async (req, res) => {
  const { name } = req.params;
  const { module: mod, enabled, guildId } = req.body;
  const botManager = req.app.locals.client.modules.botmanager;
  const targetGuild = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  try {
    const result = await botManager.toggleModule(name, mod, enabled, targetGuild);
    broadcastBotEvent('settings:changed', { bot: name, guildId: targetGuild });
    recordAudit(req, `Модуль ${name}.${mod} → ${enabled ? 'ВКЛ' : 'ВЫКЛ'}`, 'bots');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Сохранение настроек бота (включая Guard: автомодерация, mute роли, mute канал, эскалация)
 */
router.put('/:name/settings', canEdit, (req, res) => {
  const { name } = req.params;
  const { guildId, settings } = req.body;
  const targetGuild = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Объект settings обязателен' });
  }

  for (const [key, value] of Object.entries(settings)) {
    settingsRepo.set(targetGuild, name, key, value);
  }

  // Оповещаем бота через hot reload
  broadcastBotEvent('settings:changed', { bot: name, guildId: targetGuild });

  recordAudit(req, `Обновлены настройки бота ${name}`, 'bots', { newValue: settings });
  res.json({ ok: true, message: 'Настройки успешно сохранены и применены' });
});

module.exports = router;
