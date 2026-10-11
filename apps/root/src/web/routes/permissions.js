/**
 * API маршруты прав команд и белых списков
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { settings: settingsRepo } = require('@root-core/db');

router.get('/', canView, (req, res) => {
  const { guildId } = req.query;
  const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  const trustedUsersRaw = settingsRepo.get(gid, 'root', 'whitelist_users') || '[]';
  const trustedRolesRaw = settingsRepo.get(gid, 'root', 'whitelist_roles') || '[]';
  const cmdPermsRaw     = settingsRepo.get(gid, 'root', 'command_permissions') || '{}';

  res.json({
    trustedUsers: JSON.parse(trustedUsersRaw),
    trustedRoles: JSON.parse(trustedRolesRaw),
    commandPermissions: JSON.parse(cmdPermsRaw),
  });
});

// Whitelist пользователей
router.post('/whitelist/users', canEdit, (req, res) => {
  const gid = req.query.guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const targetId = req.body.userId || req.body.targetId;
  if (!targetId) return res.status(400).json({ error: 'userId обязателен' });

  const raw = settingsRepo.get(gid, 'root', 'whitelist_users') || '[]';
  const list = JSON.parse(raw);
  if (!list.includes(targetId)) {
    list.push(targetId);
    settingsRepo.set(gid, 'root', 'whitelist_users', JSON.stringify(list));
    recordAudit(req, `Добавлен в Whitelist (пользователь): ${targetId}`, 'permissions');
  }
  res.json({ ok: true, list });
});

router.delete('/whitelist/users', canEdit, (req, res) => {
  const gid = req.query.guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const targetId = req.body.userId || req.body.targetId;
  if (!targetId) return res.status(400).json({ error: 'userId обязателен' });

  const raw = settingsRepo.get(gid, 'root', 'whitelist_users') || '[]';
  let list = JSON.parse(raw);
  list = list.filter(id => id !== targetId);
  settingsRepo.set(gid, 'root', 'whitelist_users', JSON.stringify(list));
  recordAudit(req, `Удален из Whitelist (пользователь): ${targetId}`, 'permissions');
  res.json({ ok: true, list });
});

// Whitelist ролей
router.post('/whitelist/roles', canEdit, (req, res) => {
  const gid = req.query.guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const targetId = req.body.roleId || req.body.targetId;
  if (!targetId) return res.status(400).json({ error: 'roleId обязателен' });

  const raw = settingsRepo.get(gid, 'root', 'whitelist_roles') || '[]';
  const list = JSON.parse(raw);
  if (!list.includes(targetId)) {
    list.push(targetId);
    settingsRepo.set(gid, 'root', 'whitelist_roles', JSON.stringify(list));
    recordAudit(req, `Добавлен в Whitelist (роль): ${targetId}`, 'permissions');
  }
  res.json({ ok: true, list });
});

router.delete('/whitelist/roles', canEdit, (req, res) => {
  const gid = req.query.guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const targetId = req.body.roleId || req.body.targetId;
  if (!targetId) return res.status(400).json({ error: 'roleId обязателен' });

  const raw = settingsRepo.get(gid, 'root', 'whitelist_roles') || '[]';
  let list = JSON.parse(raw);
  list = list.filter(id => id !== targetId);
  settingsRepo.set(gid, 'root', 'whitelist_roles', JSON.stringify(list));
  recordAudit(req, `Удален из Whitelist (роль): ${targetId}`, 'permissions');
  res.json({ ok: true, list });
});

// Универсальные эндпоинты
router.post('/whitelist', canEdit, (req, res) => {
  const { guildId, type, targetId } = req.body;
  const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const key = type === 'role' ? 'whitelist_roles' : 'whitelist_users';

  const raw = settingsRepo.get(gid, 'root', key) || '[]';
  const list = JSON.parse(raw);
  if (!list.includes(targetId)) {
    list.push(targetId);
    settingsRepo.set(gid, 'root', key, JSON.stringify(list));
    recordAudit(req, `Добавлен в Whitelist (${type}): ${targetId}`, 'permissions');
  }
  res.json({ ok: true, list });
});

router.delete('/whitelist', canEdit, (req, res) => {
  const { guildId, type, targetId } = req.body;
  const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const key = type === 'role' ? 'whitelist_roles' : 'whitelist_users';

  const raw = settingsRepo.get(gid, 'root', key) || '[]';
  let list = JSON.parse(raw);
  list = list.filter(id => id !== targetId);
  settingsRepo.set(gid, 'root', key, JSON.stringify(list));
  recordAudit(req, `Удален из Whitelist (${type}): ${targetId}`, 'permissions');
  res.json({ ok: true, list });
});

router.put('/command-perms', canEdit, (req, res) => {
  const { guildId, permissions } = req.body;
  const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  settingsRepo.set(gid, 'root', 'command_permissions', JSON.stringify(permissions));
  recordAudit(req, 'Обновлены права на команды', 'permissions', { newValue: permissions });
  res.json({ ok: true });
});

module.exports = router;
