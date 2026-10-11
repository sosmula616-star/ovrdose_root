/**
 * API маршруты антикраша, Lockdown и снапшотов серверов
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { antinuke: antinukeRepo, settings: settingsRepo } = require('@root-core/db');
const { ANTINUKE_DEFAULTS } = require('@root-core/shared').constants;

router.get('/config', canView, (req, res) => {
  const { guildId } = req.query;
  const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const antinuke = req.app.locals.client.modules.antinuke;

  const rules = {};
  for (const eventType of Object.keys(ANTINUKE_DEFAULTS)) {
    rules[eventType] = antinuke.getRule(gid, eventType);
  }

  const lockdownActive = settingsRepo.get(gid, 'root', 'lockdown_active') === '1';
  const snapshots = antinukeRepo.getSnapshots(gid);
  const incidents = antinukeRepo.getIncidents(gid, 20).items;

  res.json({
    rules,
    lockdownActive,
    snapshots,
    incidents,
  });
});

router.put('/rules', canEdit, (req, res) => {
  const { guildId, rules } = req.body;
  const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  for (const [eventType, rule] of Object.entries(rules || {})) {
    if (rule.limit !== undefined)   settingsRepo.set(gid, 'root', `antinuke_${eventType}_limit`, rule.limit);
    if (rule.window !== undefined)  settingsRepo.set(gid, 'root', `antinuke_${eventType}_window`, rule.window);
    if (rule.action !== undefined)  settingsRepo.set(gid, 'root', `antinuke_${eventType}_action`, rule.action);
    if (rule.enabled !== undefined) settingsRepo.set(gid, 'root', `antinuke_${eventType}_enabled`, rule.enabled ? '1' : '0');
  }

  recordAudit(req, 'Обновлены правила антикраша', 'anticrash', { newValue: rules });
  res.json({ ok: true, message: 'Правила защиты сохранены' });
});

router.post('/lockdown', canEdit, async (req, res) => {
  const { guildId, active } = req.body;
  const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const antinuke = req.app.locals.client.modules.antinuke;

  await antinuke.setLockdown(gid, active, `Панель управления (${req.session.user.discord_tag})`);
  recordAudit(req, `Режим Lockdown: ${active ? 'ВКЛЮЧЕН' : 'ОТКЛЮЧЕН'}`, 'anticrash');

  res.json({ ok: true, active });
});

router.post('/snapshots', canEdit, async (req, res) => {
  const { guildId, name } = req.body;
  const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const antinuke = req.app.locals.client.modules.antinuke;

  try {
    const result = await antinuke.createSnapshot(gid, name, req.session.user.discord_tag);
    recordAudit(req, `Создан снапшот структуры: ${result.name}`, 'anticrash');
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/snapshots/:id/restore', canEdit, async (req, res) => {
  const { guildId } = req.body;
  const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const antinuke = req.app.locals.client.modules.antinuke;

  try {
    const result = await antinuke.restoreSnapshot(gid, req.params.id);
    recordAudit(req, `Восстановление структуры из снапшота #${req.params.id}`, 'anticrash', { newValue: result });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
