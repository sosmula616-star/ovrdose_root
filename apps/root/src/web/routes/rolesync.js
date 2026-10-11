/**
 * API маршруты синхронизации ролей (role_map, pending_sync, sync_log)
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { rolesync: rolesyncRepo } = require('@root-core/db');

router.get('/map', canView, (req, res) => {
  res.json(rolesyncRepo.getMappings());
});

router.post('/map', canEdit, (req, res) => {
  const { staffRoleId, mainRoleId, direction = 'staff_to_main' } = req.body;
  if (!staffRoleId || !mainRoleId) {
    return res.status(400).json({ error: 'staffRoleId и mainRoleId обязательны' });
  }

  try {
    const result = rolesyncRepo.addMapping(staffRoleId, mainRoleId, direction, req.session.user.discord_tag);
    recordAudit(req, 'Добавлен маппинг ролей', 'rolesync', { newValue: req.body });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'Такой маппинг уже существует' });
  }
});

router.patch('/map/:id', canEdit, (req, res) => {
  const { id } = req.params;
  const { enabled, direction } = req.body;

  const old = rolesyncRepo.getMappingById(id);
  rolesyncRepo.updateMapping(id, { enabled, direction });

  recordAudit(req, 'Изменен маппинг ролей', 'rolesync', { targetId: id, oldValue: old, newValue: req.body });
  res.json({ ok: true });
});

router.delete('/map/:id', canEdit, (req, res) => {
  const { id } = req.params;
  const old = rolesyncRepo.getMappingById(id);
  rolesyncRepo.deleteMapping(id);

  recordAudit(req, 'Удален маппинг ролей', 'rolesync', { targetId: id, oldValue: old });
  res.json({ ok: true });
});

router.post('/resync', canEdit, async (req, res) => {
  const syncModule = req.app.locals.client.modules.sync;
  if (!syncModule) return res.status(500).json({ error: 'Модуль синхронизации недоступен' });

  try {
    const result = await syncModule.fullResync();
    recordAudit(req, 'Запущен полный ресинк ролей', 'rolesync', { newValue: result });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/check', canView, (req, res) => {
  const logs = rolesyncRepo.getRecentLogs(50);
  const pending = rolesyncRepo.getPending();
  res.json({ logs, pending });
});

module.exports = router;
