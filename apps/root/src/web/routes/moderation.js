/**
 * API маршруты модерации (данные Guard и действия)
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { moderation: modRepo } = require('@root-core/db');

// Список кейсов
router.get('/cases', canView, (req, res) => {
  const { guildId, type, targetId, moderatorId, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const result = modRepo.getCases({ guildId, type, targetId, moderatorId, limit: Number(limit), offset });
  res.json({ ...result, page: Number(page) });
});

// Активные наказания
router.get('/active', canView, (req, res) => {
  const { guildId } = req.query;
  const mutes = modRepo.getActiveMutes(guildId);
  res.json(mutes || []);
});

// История пользователя (поддерживает и /users/:userId/history, и /history/:userId)
const handleUserHistory = (req, res) => {
  const { userId } = req.params;
  const { guildId } = req.query;

  const cases = modRepo.getCases({ guildId, targetId: userId, limit: 50 }).items;
  const notes = modRepo.getNotes(guildId, userId);
  const activeWarns = modRepo.getActiveWarnsCount(guildId, userId);

  res.json({ cases, notes, activeWarns });
};

router.get('/users/:userId/history', canView, handleUserHistory);
router.get('/history/:userId', canView, handleUserHistory);

// Выдача наказания (поддерживает и /punish, и /action)
const handlePunish = async (req, res) => {
  const { guildId, userId, action, reason, durationMinutes, targetId, type, duration } = req.body;
  const client = req.app.locals.client;

  const finalUserId = userId || targetId;
  const rawAction = action || type || 'warn';
  const targetGuild = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const guild = client?.guilds.cache.get(targetGuild);

  if (!finalUserId) {
    return res.status(400).json({ error: 'Параметр userId обязателен' });
  }

  let modType = rawAction;
  let muteType = 'text';
  if (rawAction === 'mute_text') {
    modType = 'mute';
    muteType = 'text';
  } else if (rawAction === 'mute_voice') {
    modType = 'mute';
    muteType = 'voice';
  }

  const durationSec = durationMinutes ? durationMinutes * 60 : (duration ? parseInt(duration, 10) : null);
  const expiresAt = durationSec ? new Date(Date.now() + durationSec * 1000).toISOString() : null;
  const moderatorId = req.session?.user?.discord_id || 'system';
  const moderatorTag = req.session?.user?.discord_tag || 'System';

  try {
    const caseRecord = modRepo.createCase({
      guildId: targetGuild,
      type: modType,
      targetId: finalUserId,
      moderatorId,
      moderatorTag,
      reason: reason || 'Без указания причины',
      duration: durationSec,
      expiresAt,
    });

    if (modType === 'warn') {
      modRepo.addWarn(targetGuild, finalUserId, moderatorId, reason, caseRecord.caseId);
    } else if (modType === 'mute') {
      modRepo.addMute(targetGuild, finalUserId, moderatorId, muteType, reason, durationSec, expiresAt, caseRecord.caseId);
      if (guild) {
        const member = await guild.members.fetch(finalUserId).catch(() => null);
        if (member) {
          await member.timeout(durationSec ? durationSec * 1000 : 28 * 24 * 3600 * 1000, reason).catch(() => {});
        }
      }
    } else if (modType === 'ban') {
      if (guild) {
        await guild.members.ban(finalUserId, { reason }).catch(() => {});
      }
    }

    recordAudit(req, `Выдано наказание [${rawAction}] #${caseRecord.caseNumber} для ${finalUserId}`, 'moderation', { newValue: req.body });
    res.json({ ok: true, caseNumber: caseRecord.caseNumber });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.post('/punish', canEdit, handlePunish);
router.post('/action', canEdit, handlePunish);

// Отзыв наказания (снятие мута / анбан / аннулирование кейса)
router.post('/cases/:caseId/revoke', canEdit, async (req, res) => {
  const { caseId } = req.params;
  const client = req.app.locals.client;

  try {
    const caseItem = modRepo.getCaseById(caseId);
    if (!caseItem) return res.status(404).json({ error: 'Кейс не найден' });

    modRepo.deactivateCase(caseId);

    const guild = client?.guilds.cache.get(caseItem.guild_id);
    if (guild && caseItem.target_id) {
      if (caseItem.type === 'mute') {
        const member = await guild.members.fetch(caseItem.target_id).catch(() => null);
        if (member) await member.timeout(null, 'Снятие наказания через веб-панель').catch(() => {});
      } else if (caseItem.type === 'ban') {
        await guild.bans.remove(caseItem.target_id, 'Разбан через веб-панель').catch(() => {});
      }
    }

    recordAudit(req, `Аннулирован кейс модерации #${caseItem.case_number}`, 'moderation');
    res.json({ ok: true, message: 'Наказание успешно отозвано' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Заметки
router.post('/notes', canEdit, (req, res) => {
  const { guildId, userId, note } = req.body;
  modRepo.addNote(guildId, userId, req.session?.user?.discord_id || 'system', note);
  recordAudit(req, `Добавлена заметка для ${userId}`, 'moderation');
  res.json({ ok: true });
});

router.delete('/notes/:id', canEdit, (req, res) => {
  modRepo.deleteNote(req.params.id);
  recordAudit(req, `Удалена заметка #${req.params.id}`, 'moderation');
  res.json({ ok: true });
});

module.exports = router;
