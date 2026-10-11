/**
 * API маршруты антикраша, Lockdown и снапшотов серверов
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { antinuke: antinukeRepo, settings: settingsRepo } = require('@root-core/db');
const { ANTINUKE_DEFAULTS } = require('@root-core/shared').constants;

// Получение правил антикраша
router.get('/rules', canView, (req, res) => {
  const gid = req.query.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const antinuke = req.app.locals.client?.modules?.antinuke;

  const rules = [];
  for (const eventType of Object.keys(ANTINUKE_DEFAULTS)) {
    const rule = antinuke ? antinuke.getRule(gid, eventType) : ANTINUKE_DEFAULTS[eventType];
    rules.push({
      eventType,
      ...rule,
    });
  }

  res.json(rules);
});

// Сохранение правил антикраша
const handleSaveRules = (req, res) => {
  const gid = req.query.guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const rules = req.body.rules || req.body;

  if (Array.isArray(rules)) {
    for (const r of rules) {
      if (r.eventType) {
        if (r.limit !== undefined)   settingsRepo.set(gid, 'root', `antinuke_${r.eventType}_limit`, r.limit);
        if (r.window !== undefined)  settingsRepo.set(gid, 'root', `antinuke_${r.eventType}_window`, r.window);
        if (r.action !== undefined)  settingsRepo.set(gid, 'root', `antinuke_${r.eventType}_action`, r.action);
        if (r.enabled !== undefined) settingsRepo.set(gid, 'root', `antinuke_${r.eventType}_enabled`, r.enabled ? '1' : '0');
      }
    }
  } else if (typeof rules === 'object') {
    for (const [eventType, rule] of Object.entries(rules)) {
      if (rule.limit !== undefined)   settingsRepo.set(gid, 'root', `antinuke_${eventType}_limit`, rule.limit);
      if (rule.window !== undefined)  settingsRepo.set(gid, 'root', `antinuke_${eventType}_window`, rule.window);
      if (rule.action !== undefined)  settingsRepo.set(gid, 'root', `antinuke_${eventType}_action`, rule.action);
      if (rule.enabled !== undefined) settingsRepo.set(gid, 'root', `antinuke_${eventType}_enabled`, rule.enabled ? '1' : '0');
    }
  }

  recordAudit(req, 'Обновлены правила антикраша', 'anticrash', { newValue: rules });
  res.json({ ok: true, message: 'Правила защиты сохранены' });
};

router.post('/rules', canEdit, handleSaveRules);
router.put('/rules', canEdit, handleSaveRules);

// --- Персональные лимиты и разрешения по ролям ---
router.get('/role-rules', canView, (req, res) => {
  const gid = req.query.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const list = antinukeRepo.getRoleRules(gid);
  res.json(list || []);
});

router.post('/role-rules', canEdit, (req, res) => {
  const { guildId, roleId, roleName, permissions } = req.body;
  const gid = guildId || req.query.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  if (!roleId) {
    return res.status(400).json({ error: 'Параметр roleId обязателен' });
  }

  antinukeRepo.setRoleRule(gid, roleId, roleName || roleId, permissions || {});
  recordAudit(req, `Обновлены персональные правила антикраша для роли ${roleName || roleId}`, 'anticrash', { newValue: req.body });
  res.json({ ok: true, message: 'Правила для роли сохранены' });
});

router.delete('/role-rules/:roleId', canEdit, (req, res) => {
  const { roleId } = req.params;
  const gid = req.query.guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  antinukeRepo.deleteRoleRule(gid, roleId);
  recordAudit(req, `Удалены правила антикраша для роли ${roleId}`, 'anticrash', { targetId: roleId });
  res.json({ ok: true });
});

// Статус Lockdown
router.get('/lockdown', canView, (req, res) => {
  const gid = req.query.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const active = settingsRepo.get(gid, 'root', 'lockdown_active') === '1';
  res.json({ active });
});

router.post('/lockdown', canEdit, async (req, res) => {
  const { guildId, active } = req.body;
  const gid = guildId || req.query.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const antinuke = req.app.locals.client?.modules?.antinuke;

  if (antinuke) {
    const adminTag = req.session?.user?.discord_tag || 'Admin';
    await antinuke.setLockdown(gid, active, `Панель управления (${adminTag})`);
  }

  recordAudit(req, `Режим Lockdown: ${active ? 'ВКЛЮЧЕН' : 'ОТКЛЮЧЕН'}`, 'anticrash');
  res.json({ ok: true, active });
});

// Снапшоты
router.get('/snapshots', canView, (req, res) => {
  const gid = req.query.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const list = antinukeRepo.getSnapshots(gid);
  res.json(list || []);
});

router.post('/snapshots', canEdit, async (req, res) => {
  const { guildId, name } = req.body;
  const gid = guildId || req.query.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const antinuke = req.app.locals.client?.modules?.antinuke;

  if (!antinuke) return res.status(503).json({ error: 'Модуль антикраша недоступен' });

  try {
    const adminTag = req.session?.user?.discord_tag || 'Admin';
    const result = await antinuke.createSnapshot(gid, name || 'Снапшот структуры', adminTag);
    recordAudit(req, `Создан снапшот структуры: ${result.name}`, 'anticrash');
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/snapshots/:id/restore', canEdit, async (req, res) => {
  const { guildId } = req.body;
  const gid = guildId || req.query.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const antinuke = req.app.locals.client?.modules?.antinuke;

  if (!antinuke) return res.status(503).json({ error: 'Модуль антикраша недоступен' });

  try {
    const result = await antinuke.restoreSnapshot(gid, req.params.id);
    recordAudit(req, `Восстановление структуры из снапшота #${req.params.id}`, 'anticrash', { newValue: result });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Инциденты безопасности
router.get('/incidents', canView, (req, res) => {
  const gid = req.query.guildId || null;
  const incidents = antinukeRepo.getIncidents(gid, 25).items;
  res.json(incidents || []);
});

// Полная конфигурация для совместимости
router.get('/config', canView, (req, res) => {
  const gid = req.query.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const antinuke = req.app.locals.client?.modules?.antinuke;

  const rules = {};
  for (const eventType of Object.keys(ANTINUKE_DEFAULTS)) {
    rules[eventType] = antinuke ? antinuke.getRule(gid, eventType) : ANTINUKE_DEFAULTS[eventType];
  }

  const lockdownActive = settingsRepo.get(gid, 'root', 'lockdown_active') === '1';
  const snapshots = antinukeRepo.getSnapshots(gid);
  const incidents = antinukeRepo.getIncidents(gid, 20).items;

  res.json({ rules, lockdownActive, snapshots, incidents });
});

module.exports = router;
