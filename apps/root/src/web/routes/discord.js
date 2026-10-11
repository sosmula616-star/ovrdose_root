/**
 * API проксирования данных Discord (роли, каналы, участники) через Discord-клиент Root
 */

const router = require('express').Router();
const { canView } = require('../middleware/auth');
const { ChannelType } = require('discord.js');

// Получение списка доступных серверов
router.get('/guilds', canView, (req, res) => {
  const client = req.app.locals.client;
  const staffId = process.env.STAFF_GUILD_ID;
  const mainId = process.env.MAIN_GUILD_ID;

  const result = [];
  const staffGuild = client?.guilds.cache.get(staffId);
  const mainGuild = client?.guilds.cache.get(mainId);

  if (staffGuild) {
    result.push({
      id: staffGuild.id,
      name: staffGuild.name,
      icon: staffGuild.iconURL({ size: 64 }),
      memberCount: staffGuild.memberCount,
      type: 'staff',
    });
  }

  if (mainGuild) {
    result.push({
      id: mainGuild.id,
      name: mainGuild.name,
      icon: mainGuild.iconURL({ size: 64 }),
      memberCount: mainGuild.memberCount,
      type: 'main',
    });
  }

  res.json(result);
});

// Получение ролей сервера с hex-цветом
router.get('/roles', canView, (req, res) => {
  const { guildId } = req.query;
  const client = req.app.locals.client;

  if (!guildId) {
    return res.status(400).json({ error: 'Параметр guildId обязателен' });
  }

  const guild = client?.guilds.cache.get(guildId);
  if (!guild) {
    return res.status(404).json({ error: 'Сервер не найден или бот не подключен' });
  }

  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id) // кроме @everyone
    .sort((a, b) => b.position - a.position)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.hexColor !== '#000000' ? r.hexColor : '#8B93A1',
      position: r.position,
      managed: r.managed,
    }));

  res.json(roles);
});

// Получение каналов сервера
router.get('/channels', canView, (req, res) => {
  const { guildId, type } = req.query;
  const client = req.app.locals.client;

  if (!guildId) {
    return res.status(400).json({ error: 'Параметр guildId обязателен' });
  }

  const guild = client?.guilds.cache.get(guildId);
  if (!guild) {
    return res.status(404).json({ error: 'Сервер не найден' });
  }

  let channels = guild.channels.cache;

  if (type === 'text') {
    channels = channels.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
  } else if (type === 'voice') {
    channels = channels.filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);
  }

  const result = channels
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId,
    }));

  res.json(result);
});

// Поиск участников сервера
router.get('/members', canView, async (req, res, next) => {
  try {
    const { guildId, query = '' } = req.query;
    const client = req.app.locals.client;

    if (!guildId) {
      return res.status(400).json({ error: 'Параметр guildId обязателен' });
    }

    const guild = client?.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Сервер не найден' });
    }

    if (!query) {
      // Вернуть первых 30 из кэша
      const members = Array.from(guild.members.cache.values()).slice(0, 30).map(m => ({
        id: m.id,
        tag: m.user.tag,
        displayName: m.displayName,
        avatar: m.user.displayAvatarURL({ size: 64 }),
        roles: m.roles.cache.map(r => r.id),
      }));
      return res.json(members);
    }

    // Поиск по нику или ID через Discord API
    const found = await guild.members.search({ query, limit: 25 });
    const members = found.map(m => ({
      id: m.id,
      tag: m.user.tag,
      displayName: m.displayName,
      avatar: m.user.displayAvatarURL({ size: 64 }),
      roles: m.roles.cache.map(r => r.id),
    }));

    res.json(members);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
