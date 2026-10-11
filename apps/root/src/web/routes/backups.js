/**
 * API управления резервными копиями (Backups)
 */

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { canView, canEdit, ownerOnly } = require('../middleware/auth');
const { auditAction } = require('../middleware/audit');
const { system: systemRepo } = require('@root-core/db');

router.get('/', canView, (req, res) => {
  const backups = systemRepo.getBackups();
  res.json(backups);
});

router.post('/', canEdit, auditAction('create_backup', 'backups'), async (req, res, next) => {
  try {
    const { notes } = req.body;
    const backupModule = req.app.locals.client?.modules?.backup;
    if (!backupModule) {
      return res.status(503).json({ error: 'Модуль резервного копирования недоступен' });
    }

    const result = await backupModule.createBackup(notes || 'Ручной бэкап из веб-панели', req.user.discord_tag);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:filename/download', canEdit, (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const backupDir = path.resolve('./data/backups');
  const filePath = path.join(backupDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Файл бэкапа не найден' });
  }

  res.download(filePath, safeFilename);
});

router.post('/:filename/restore', ownerOnly, auditAction('restore_backup', 'backups'), async (req, res, next) => {
  try {
    const { confirmation } = req.body;
    if (confirmation !== 'RESTORE') {
      return res.status(400).json({ error: 'Для подтверждения введите RESTORE' });
    }

    const backupModule = req.app.locals.client?.modules?.backup;
    if (!backupModule) {
      return res.status(503).json({ error: 'Модуль резервного копирования недоступен' });
    }

    const result = await backupModule.restore(req.params.filename, req.user.discord_tag);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:filename', canEdit, auditAction('delete_backup', 'backups'), (req, res, next) => {
  try {
    const backupModule = req.app.locals.client?.modules?.backup;
    if (!backupModule) {
      return res.status(503).json({ error: 'Модуль резервного копирования недоступен' });
    }

    backupModule.deleteBackup(req.params.filename);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
