/**
 * API маршруты управления каналами и структурой серверов (Root Channels API)
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { channels: channelsRepo } = require('@root-core/db');

/**
 * Получение списка каналов, категорий и управляемых структур
 */
router.get('/', canView, async (req, res, next) => {
  try {
    const { guildId } = req.query;
    const targetGuildId = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
    const channelsModule = req.app.locals.client?.modules?.channels;

    if (!channelsModule) {
      return res.status(503).json({ error: 'Модуль каналов недоступен' });
    }

    const data = await channelsModule.scanGuildChannels(targetGuildId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * Создание канала (ТОЛЬКО через веб-панель)
 */
router.post('/create', canEdit, async (req, res, next) => {
  try {
    const { guildId, name, type = 'text', groupType = 'general', categoryId = null, categoryName = null, isEnforced = 1 } = req.body;
    const targetGuildId = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
    const channelsModule = req.app.locals.client?.modules?.channels;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Название канала обязательно' });
    }

    if (!channelsModule) {
      return res.status(503).json({ error: 'Модуль каналов недоступен' });
    }

    const result = await channelsModule.createChannelViaPanel(targetGuildId, {
      name: name.trim(),
      type,
      groupType,
      categoryId,
      categoryName,
      isEnforced: isEnforced ? 1 : 0,
    });

    recordAudit(req, `Создан канал #${name} [${groupType}] на сервере`, 'channels', {
      targetId: result.id,
      newValue: req.body,
    });

    res.json({ ok: true, channel: result });
  } catch (err) {
    next(err);
  }
});

/**
 * Редактирование названия, категории или параметров канала
 */
router.patch('/:id', canEdit, async (req, res, next) => {
  try {
    const { id } = req.params; // discord channel id
    const { guildId, name, categoryId, categoryName, position, groupType, isEnforced } = req.body;
    const targetGuildId = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
    const channelsModule = req.app.locals.client?.modules?.channels;

    if (!channelsModule) {
      return res.status(503).json({ error: 'Модуль каналов недоступен' });
    }

    const result = await channelsModule.editChannelViaPanel(targetGuildId, id, {
      name,
      categoryId,
      categoryName,
      position,
      groupType,
      isEnforced,
    });

    recordAudit(req, `Обновлен канал #${name || id}`, 'channels', {
      targetId: id,
      newValue: req.body,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Удаление канала через панель
 */
router.delete('/:id', canEdit, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { guildId } = req.query;
    const targetGuildId = guildId || req.body.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
    const channelsModule = req.app.locals.client?.modules?.channels;

    if (!channelsModule) {
      return res.status(503).json({ error: 'Модуль каналов недоступен' });
    }

    await channelsModule.deleteChannelViaPanel(targetGuildId, id);

    recordAudit(req, `Удален канал ID: ${id}`, 'channels', { targetId: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Принудительная проверка целостности и восстановление каналов (по кнопке)
 */
router.post('/enforce', canEdit, async (req, res, next) => {
  try {
    const { guildId } = req.body;
    const channelsModule = req.app.locals.client?.modules?.channels;

    if (!channelsModule) {
      return res.status(503).json({ error: 'Модуль каналов недоступен' });
    }

    let result;
    if (guildId) {
      result = await channelsModule.checkAndEnforce(guildId);
    } else {
      result = await channelsModule.enforceAll();
    }

    recordAudit(req, 'Запущена ручная сверка и восстановление структуры каналов', 'channels', { newValue: result });
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

/**
 * Развертывание базовой эталонной структуры серверов (администрация, проходные, логи)
 */
router.post('/setup-defaults', canEdit, async (req, res, next) => {
  try {
    const { guildId } = req.body;
    const targetGuildId = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
    const channelsModule = req.app.locals.client?.modules?.channels;

    if (!channelsModule) {
      return res.status(503).json({ error: 'Модуль каналов недоступен' });
    }

    const result = await channelsModule.setupDefaultStructure(targetGuildId);
    recordAudit(req, 'Развернута эталонная структура каналов (Администрация, Проходные, Логи)', 'channels');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
