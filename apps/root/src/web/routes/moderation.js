/**
 * API маршруты модерации (данные Guard и действия)
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { moderation: modRepo } = require('@root-core/db');

router.get('/cases', canView, (req, res) => {
  const { guildId, type, targetId, moderatorId, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const result = modRepo.getCases({ guildId, type, targetId, moderatorId, limit: Number(limit), offset });
  res.json({ ...result, page: Number(page) });
});

router.get('/history/:userId', canView, (req, res) => {
  const { userId } = req.params;
  const { guildId } = req.query;

  const cases = modRepo.getCases({ guildId, targetId: userId, limit: 50 }).items;
  const notes = modRepo.getNotes(guildId, userId);
  const activeWarns = modRepo.getActiveWarnsCount(guildId, userId);

  res.json({ cases, notes, activeWarns });
});

router.post('/action', canEdit, async (req, res) => {
  const { guildId, type, targetId, reason, duration, muteType = 'text' } = req.body;
  const client = req.app.locals.client;
  const guild = client.guilds.cache.get(guildId);

  if (!guildId || !targetId || !type) {
    return res.status(400).json({ error: 'Недостаточно параметров' });
  }

  const moderatorId = req.session.user.discord_id;
  const moderatorTag = req.session.user.discord_tag;
  const durationSec = duration ? parseInt(duration, 10) : null;
  const expiresAt = durationSec ? new Date(Date.now() + durationSec * 1000).toISOString() : null;

  try {
    const caseRecord = modRepo.createCase({
      guildId,
      type,
      targetId,
      moderatorId,
      moderatorTag,
      reason,
      duration: durationSec,
      expiresAt,
    });

    if (type === 'warn') {
      modRepo.addWarn(guildId, targetId, moderatorId, reason, caseRecord.caseId);
    } else if (type === 'mute') {
      modRepo.addMute(guildId, targetId, moderatorId, muteType, reason, durationSec, expiresAt, caseRecord.caseId);
      // Применяем тайм-аут через Discord API бота Root
      if (guild) {
        const member = await guild.members.fetch(targetId).catch(() => null);
        if (member) {
          await member.timeout(durationSec ? durationSec * 1000 : 28 * 24 * 3600 * 1000, reason).catch(() => {});
        }
      }
    } else if (type === 'ban') {
      if (guild) {
        await guild.members.ban(targetId, { reason }).catch(() => {});
      }
    }

    recordAudit(req, `Выдано наказание [${type}] #${caseRecord.caseNumber} для ${targetId}`, 'moderation', { newValue: req.body });
    res.json({ ok: true, caseNumber: caseRecord.caseNumber });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/notes', canEdit, (req, res) => {
  const { guildId, userId, note } = req.body;
  modRepo.addNote(guildId, userId, req.session.user.discord_id, note);
  recordAudit(req, `Добавлена заметка для ${userId}`, 'moderation');
  res.json({ ok: true });
});

router.delete('/notes/:id', canEdit, (req, res) => {
  modRepo.deleteNote(req.params.id);
  recordAudit(req, `Удалена заметка #${req.params.id}`, 'moderation');
  res.json({ ok: true });
});

module.exports = router;
