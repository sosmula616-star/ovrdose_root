/**
 * API маршруты синхронизации ролей (role_map, pending_sync, sync_log)
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { rolesync: rolesyncRepo } = require('@root-core/db');

// Получение маппингов (поддерживает и /mappings, и /map)
router.get('/mappings', canView, (req, res) => {
  res.json(rolesyncRepo.getMappings());
});

router.get('/map', canView, (req, res) => {
  res.json(rolesyncRepo.getMappings());
});

// Получение отложенных синхронизаций
router.get('/pending', canView, (req, res) => {
  res.json(rolesyncRepo.getPending());
});

// Получение логов синхронизации
router.get('/logs', canView, (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  res.json(rolesyncRepo.getRecentLogs(limit));
});

// Добавление маппинга
const handleAddMapping = (req, res) => {
  const { staffRoleId, mainRoleId, direction = 'staff_to_main', notes = '' } = req.body;
  if (!staffRoleId || !mainRoleId) {
    return res.status(400).json({ error: 'staffRoleId и mainRoleId обязательны' });
  }

  try {
    const adminTag = req.session?.user?.discord_tag || 'Admin';
    const result = rolesyncRepo.addMapping(staffRoleId, mainRoleId, direction, adminTag);
    recordAudit(req, 'Добавлен маппинг ролей', 'rolesync', { newValue: req.body });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'Такой маппинг уже существует' });
  }
};

router.post('/mappings', canEdit, handleAddMapping);
router.post('/map', canEdit, handleAddMapping);

// Переключение состояния маппинга
router.post('/mappings/:id/toggle', canEdit, (req, res) => {
  const { id } = req.params;
  const old = rolesyncRepo.getMappingById(id);
  if (!old) return res.status(404).json({ error: 'Маппинг не найден' });

  const newEnabled = old.enabled ? 0 : 1;
  rolesyncRepo.updateMapping(id, { enabled: newEnabled });
  recordAudit(req, `Переключен маппинг ролей #${id} → ${newEnabled ? 'ВКЛ' : 'ВЫКЛ'}`, 'rolesync');
  res.json({ ok: true, enabled: newEnabled });
});

router.patch('/mappings/:id', canEdit, (req, res) => {
  const { id } = req.params;
  const { enabled, direction } = req.body;
  rolesyncRepo.updateMapping(id, { enabled, direction });
  res.json({ ok: true });
});

router.patch('/map/:id', canEdit, (req, res) => {
  const { id } = req.params;
  const { enabled, direction } = req.body;
  rolesyncRepo.updateMapping(id, { enabled, direction });
  res.json({ ok: true });
});

// Удаление маппинга
const handleDeleteMapping = (req, res) => {
  const { id } = req.params;
  const old = rolesyncRepo.getMappingById(id);
  rolesyncRepo.deleteMapping(id);
  recordAudit(req, 'Удален маппинг ролей', 'rolesync', { targetId: id, oldValue: old });
  res.json({ ok: true });
};

router.delete('/mappings/:id', canEdit, handleDeleteMapping);
router.delete('/map/:id', canEdit, handleDeleteMapping);

// Полный ресинк
const handleResync = async (req, res) => {
  const syncModule = req.app.locals.client?.modules?.sync;
  if (!syncModule) return res.status(500).json({ error: 'Модуль синхронизации недоступен' });

  try {
    const result = await syncModule.fullResync();
    recordAudit(req, 'Запущен полный ресинк ролей', 'rolesync', { newValue: result });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.post('/full-resync', canEdit, handleResync);
router.post('/resync', canEdit, handleResync);

// Сверка логов и очереди
router.get('/check', canView, (req, res) => {
  const logs = rolesyncRepo.getRecentLogs(50);
  const pending = rolesyncRepo.getPending();
  res.json({ logs, pending });
});

module.exports = router;
