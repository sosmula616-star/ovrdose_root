/**
 * Внутренние API-эндпоинты для внешних ботов (@root-core/bot-client)
 */

const router = require('express').Router();
const crypto = require('crypto');
const { internalAuth } = require('../middleware/internalAuth');
const { bots: botsRepo, settings: settingsRepo } = require('@root-core/db');

router.use(internalAuth);

/**
 * Прием Heartbeat от внешнего бота
 */
router.post('/heartbeat', (req, res) => {
  const { bot, pingMs, ramMb, uptimeSec, guildCount } = req.body;
  if (!bot) return res.status(400).json({ error: 'Параметр bot обязателен' });

  botsRepo.recordHeartbeat(bot, pingMs, ramMb, uptimeSec, guildCount);
  botsRepo.updateBotStatus(bot, 'online');

  res.json({ ok: true });
});

/**
 * Чтение настроек бота
 */
router.get('/settings', (req, res) => {
  const { guildId, bot } = req.query;
  if (!guildId || !bot) return res.status(400).json({ error: 'guildId и bot обязательны' });

  const rows = settingsRepo.getAll(guildId, bot);
  const result = {};
  for (const r of rows) result[r.key] = r.value;

  res.json(result);
});

/**
 * Хэш версии настроек для резервного polling раз в 5 сек
 */
router.get('/settings/version', (req, res) => {
  const { bot } = req.query;
  const rows = settingsRepo.getAll(process.env.MAIN_GUILD_ID, bot);
  const str = JSON.stringify(rows);
  const hash = crypto.createHash('md5').update(str).digest('hex');
  res.json({ hash });
});

/**
 * Фиксация действия внешнего бота для супервизора
 */
router.post('/action', (req, res) => {
  const { botId, botName, guildId, actionType, targetId, details } = req.body;
  if (!botName || !guildId || !actionType) {
    return res.status(400).json({ error: 'Недостаточно данных' });
  }

  botsRepo.recordAction(botId || botName, botName, guildId, actionType, targetId, details || {});
  res.json({ ok: true });
});

module.exports = router;
