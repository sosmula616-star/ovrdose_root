/**
 * API маршруты логов и ошибок ботов
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { system: systemRepo } = require('@root-core/db');

router.get('/', canView, (req, res) => {
  const { bot, type, guildId, level, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const result = systemRepo.getLogs({ bot, type, guildId, level, limit: Number(limit), offset });
  res.json({ ...result, page: Number(page) });
});

router.get('/export/csv', canView, (req, res) => {
  const { bot, type, guildId, level } = req.query;
  const result = systemRepo.getLogs({ bot, type, guildId, level, limit: 5000, offset: 0 });

  let csv = 'ID,Bot,GuildID,Type,Level,Message,UserID,CreatedAt\r\n';
  for (const item of result.items) {
    const msg = `"${(item.message || '').replace(/"/g, '""')}"`;
    csv += `${item.id},${item.bot},${item.guild_id || ''},${item.type},${item.level},${msg},${item.user_id || ''},${item.created_at}\r\n`;
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="logs_${Date.now()}.csv"`);
  res.send('\uFEFF' + csv);
});

router.get('/errors', canView, (req, res) => {
  const errors = systemRepo.getUnresolvedErrors(50);
  res.json(errors);
});

router.patch('/errors/:id/resolve', canEdit, (req, res) => {
  systemRepo.resolveError(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
