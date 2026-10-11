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

  const ownerIds = (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const users = JSON.parse(trustedUsersRaw);
  const roles = JSON.parse(trustedRolesRaw);

  res.json({
    owner_ids: ownerIds,
    whitelist_users: users,
    whitelist_roles: roles,
    trustedUsers: users,
    trustedRoles: roles,
    commandPermissions: JSON.parse(cmdPermsRaw),
  });
});

// Whitelist пользователей
router.post('/whitelist/users', canEdit, (req, res) => {
  const gid = req.query.guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  // Поддержка передачи массива { users: [...] }
  if (Array.isArray(req.body.users)) {
    const list = req.body.users.map(u => String(u).trim()).filter(Boolean);
    settingsRepo.set(gid, 'root', 'whitelist_users', JSON.stringify(list));
    recordAudit(req, `Обновлен Whitelist пользователей (${list.length} записей)`, 'permissions', { newValue: list });
    return res.json({ ok: true, list, whitelist_users: list });
  }

  const targetId = req.body.userId || req.body.targetId;
  if (!targetId) return res.status(400).json({ error: 'Параметр userId обязателен' });

  const raw = settingsRepo.get(gid, 'root', 'whitelist_users') || '[]';
  const list = JSON.parse(raw);
  const strId = String(targetId).trim();
  if (!list.includes(strId)) {
    list.push(strId);
    settingsRepo.set(gid, 'root', 'whitelist_users', JSON.stringify(list));
    recordAudit(req, `Добавлен в Whitelist (пользователь): ${strId}`, 'permissions');
  }
  res.json({ ok: true, list, whitelist_users: list });
});

router.delete('/whitelist/users', canEdit, (req, res) => {
  const gid = req.query.guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const targetId = req.body.userId || req.body.targetId || req.query.userId || req.query.targetId;
  if (!targetId) return res.status(400).json({ error: 'Параметр userId обязателен' });

  const raw = settingsRepo.get(gid, 'root', 'whitelist_users') || '[]';
  let list = JSON.parse(raw);
  const strId = String(targetId).trim();
  list = list.filter(id => id !== strId);
  settingsRepo.set(gid, 'root', 'whitelist_users', JSON.stringify(list));
  recordAudit(req, `Удален из Whitelist (пользователь): ${strId}`, 'permissions');
  res.json({ ok: true, list, whitelist_users: list });
});

// Whitelist ролей
router.post('/whitelist/roles', canEdit, (req, res) => {
  const gid = req.query.guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  // Поддержка передачи массива { roles: [...] }
  if (Array.isArray(req.body.roles)) {
    const list = req.body.roles.map(r => String(r).trim()).filter(Boolean);
    settingsRepo.set(gid, 'root', 'whitelist_roles', JSON.stringify(list));
    recordAudit(req, `Обновлен Whitelist ролей (${list.length} записей)`, 'permissions', { newValue: list });
    return res.json({ ok: true, list, whitelist_roles: list });
  }

  const targetId = req.body.roleId || req.body.targetId;
  if (!targetId) return res.status(400).json({ error: 'Параметр roleId обязателен' });

  const raw = settingsRepo.get(gid, 'root', 'whitelist_roles') || '[]';
  const list = JSON.parse(raw);
  const strId = String(targetId).trim();
  if (!list.includes(strId)) {
    list.push(strId);
    settingsRepo.set(gid, 'root', 'whitelist_roles', JSON.stringify(list));
    recordAudit(req, `Добавлен в Whitelist (роль): ${strId}`, 'permissions');
  }
  res.json({ ok: true, list, whitelist_roles: list });
});

router.delete('/whitelist/roles', canEdit, (req, res) => {
  const gid = req.query.guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const targetId = req.body.roleId || req.body.targetId || req.query.roleId || req.query.targetId;
  if (!targetId) return res.status(400).json({ error: 'Параметр roleId обязателен' });

  const raw = settingsRepo.get(gid, 'root', 'whitelist_roles') || '[]';
  let list = JSON.parse(raw);
  const strId = String(targetId).trim();
  list = list.filter(id => id !== strId);
  settingsRepo.set(gid, 'root', 'whitelist_roles', JSON.stringify(list));
  recordAudit(req, `Удален из Whitelist (роль): ${strId}`, 'permissions');
  res.json({ ok: true, list, whitelist_roles: list });
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
