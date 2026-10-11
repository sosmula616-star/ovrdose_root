/**
 * API управления администраторами панели и журналами аудита
 */

const router = require('express').Router();
const { canView, ownerOnly } = require('../middleware/auth');
const { auditAction } = require('../middleware/audit');
const { system: systemRepo } = require('@root-core/db');

// --- Администраторы панели ---

router.get('/admins', canView, (req, res) => {
  const users = systemRepo.getPanelUsers();
  res.json(users);
});

router.post('/admins', ownerOnly, auditAction('add_admin', 'panel_users'), (req, res) => {
  const { discordId, discordTag, role } = req.body;
  if (!discordId || !/^\d{17,20}$/.test(discordId)) {
    return res.status(400).json({ error: 'Некорректный Discord ID' });
  }

  if (!['owner', 'admin', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Некорректная роль (owner, admin, viewer)' });
  }

  const existing = systemRepo.getPanelUser(discordId);
  if (existing) {
    return res.status(409).json({ error: 'Пользователь уже добавлен в панель' });
  }

  systemRepo.addPanelUser(discordId, discordTag || discordId, null, role, req.user.discord_tag);
  res.json({ ok: true });
});

router.patch('/admins/:discordId', ownerOnly, auditAction('update_admin', 'panel_users'), (req, res) => {
  const { discordId } = req.params;
  const { role } = req.body;

  if (!['owner', 'admin', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Некорректная роль' });
  }

  const existing = systemRepo.getPanelUser(discordId);
  if (!existing) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  if (discordId === req.user.discord_id && role !== 'owner') {
    return res.status(400).json({ error: 'Нельзя понизить собственную роль владельца' });
  }

  systemRepo.updatePanelUser(discordId, { role });
  res.json({ ok: true });
});

router.delete('/admins/:discordId', ownerOnly, auditAction('delete_admin', 'panel_users'), (req, res) => {
  const { discordId } = req.params;

  if (discordId === req.user.discord_id) {
    return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  }

  systemRepo.deletePanelUser(discordId);
  res.json({ ok: true });
});

// --- Журнал аудита панели ---

router.get('/audit', canView, (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const result = systemRepo.getAuditLogs(Number(limit), offset);
  res.json({ ...result, page: Number(page) });
});

module.exports = router;
