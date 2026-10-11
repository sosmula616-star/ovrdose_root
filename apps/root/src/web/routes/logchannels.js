/**
 * API управления каналами логов
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { settings: settingsRepo, system: systemRepo } = require('@root-core/db');
const { auditAction } = require('../middleware/audit');
const { publishEvent } = require('./events');

const LOG_TYPES = ['general', 'security', 'economy', 'sync', 'bots'];

router.get('/', canView, (req, res) => {
  const { guildId } = req.query;
  if (!guildId) {
    return res.status(400).json({ error: 'Параметр guildId обязателен' });
  }

  const channels = {};
  for (const type of LOG_TYPES) {
    channels[type] = settingsRepo.get(guildId, 'root', `log_channel_${type}`) || null;
  }

  res.json({ guildId, channels });
});

router.post('/', canEdit, auditAction('update', 'logchannels'), (req, res) => {
  const { guildId, channels } = req.body;
  if (!guildId || !channels || typeof channels !== 'object') {
    return res.status(400).json({ error: 'Некорректные параметры' });
  }

  const oldChannels = {};
  for (const type of LOG_TYPES) {
    oldChannels[type] = settingsRepo.get(guildId, 'root', `log_channel_${type}`) || null;
    if (channels[type] !== undefined) {
      if (channels[type]) {
        settingsRepo.set(guildId, 'root', `log_channel_${type}`, channels[type]);
      } else {
        settingsRepo.delete(guildId, 'root', `log_channel_${type}`);
      }
    }
  }

  publishEvent('settings:changed', { bot: 'root', guildId, key: 'log_channels' });

  systemRepo.addAudit(
    req.user.discord_id,
    req.user.discord_tag,
    'update_log_channels',
    'logchannels',
    guildId,
    oldChannels,
    channels,
    req.ip
  );

  res.json({ ok: true });
});

module.exports = router;
