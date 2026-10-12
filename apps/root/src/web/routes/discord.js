/**
 * API проксирования данных Discord (роли, каналы, участники) через Discord-клиент Root
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { settings: settingsRepo, rolesync: rolesyncRepo } = require('@root-core/db');

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

// Получение ролей сервера с hex-цветом и флагами
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

  const whitelistRolesRaw = settingsRepo.get(guildId, 'root', 'whitelist_roles') || '[]';
  let whitelistRoles = [];
  try {
    whitelistRoles = JSON.parse(whitelistRolesRaw);
  } catch (_) {}

  const mappings = rolesyncRepo.getMappings() || [];
  const syncedRoleIds = new Set();
  for (const m of mappings) {
    if (m.staff_role_id) syncedRoleIds.add(m.staff_role_id);
    if (m.main_role_id) syncedRoleIds.add(m.main_role_id);
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
      hoist: Boolean(r.hoist),
      mentionable: Boolean(r.mentionable),
      membersCount: r.members.size,
      isAdmin: r.permissions.has(PermissionFlagsBits.Administrator),
      isWhitelist: whitelistRoles.includes(r.id),
      isSync: syncedRoleIds.has(r.id),
    }));

  res.json(roles);
});

// Создание роли через панель
router.post('/roles/create', canEdit, async (req, res, next) => {
  try {
    const { guildId, name, color, hoist = false, mentionable = false, isWhitelist = false } = req.body;
    const client = req.app.locals.client;

    if (!guildId || !name || !name.trim()) {
      return res.status(400).json({ error: 'Параметры guildId и name обязательны' });
    }

    const guild = client?.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Сервер не найден' });
    }

    const newRole = await guild.roles.create({
      name: name.trim(),
      color: color || '#8B93A1',
      hoist: Boolean(hoist),
      mentionable: Boolean(mentionable),
      reason: 'Создано через веб-панель Root',
    });

    if (isWhitelist) {
      const raw = settingsRepo.get(guildId, 'root', 'whitelist_roles') || '[]';
      let list = [];
      try { list = JSON.parse(raw); } catch (_) {}
      if (!list.includes(newRole.id)) {
        list.push(newRole.id);
        settingsRepo.set(guildId, 'root', 'whitelist_roles', JSON.stringify(list));
      }
    }

    recordAudit(req, `Создана роль @${name.trim()} на сервере`, 'roles', {
      targetId: newRole.id,
      newValue: req.body,
    });

    res.json({
      ok: true,
      role: {
        id: newRole.id,
        name: newRole.name,
        color: newRole.hexColor,
        position: newRole.position,
        hoist: newRole.hoist,
        mentionable: newRole.mentionable,
        membersCount: 0,
        isAdmin: false,
        isWhitelist: Boolean(isWhitelist),
        isSync: false,
      }
    });
  } catch (err) {
    next(err);
  }
});

// Редактирование роли через панель
router.patch('/roles/:id', canEdit, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { guildId, name, color, hoist, mentionable, position, isWhitelist } = req.body;
    const client = req.app.locals.client;

    if (!guildId) {
      return res.status(400).json({ error: 'Параметр guildId обязателен' });
    }

    const guild = client?.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Сервер не найден' });
    }

    const role = guild.roles.cache.get(id);
    if (!role) {
      return res.status(404).json({ error: 'Роль не найдена' });
    }

    if (name && name !== role.name) await role.setName(name);
    if (color && color !== role.hexColor) await role.setColor(color);
    if (hoist !== undefined && hoist !== role.hoist) await role.setHoist(Boolean(hoist));
    if (mentionable !== undefined && mentionable !== role.mentionable) await role.setMentionable(Boolean(mentionable));
    if (position !== undefined && position !== role.position) await role.setPosition(Number(position));

    if (isWhitelist !== undefined) {
      const raw = settingsRepo.get(guildId, 'root', 'whitelist_roles') || '[]';
      let list = [];
      try { list = JSON.parse(raw); } catch (_) {}
      if (isWhitelist && !list.includes(role.id)) {
        list.push(role.id);
      } else if (!isWhitelist && list.includes(role.id)) {
        list = list.filter(r => r !== role.id);
      }
      settingsRepo.set(guildId, 'root', 'whitelist_roles', JSON.stringify(list));
    }

    recordAudit(req, `Обновлена роль @${role.name}`, 'roles', {
      targetId: role.id,
      newValue: req.body,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Быстрое переключение флага роли (whitelist, hoist, mentionable)
router.post('/roles/:id/toggle-flag', canEdit, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { guildId, flag } = req.body;
    const client = req.app.locals.client;

    if (!guildId) {
      return res.status(400).json({ error: 'Параметр guildId обязателен' });
    }

    const guild = client?.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Сервер не найден' });
    }

    const role = guild.roles.cache.get(id);
    if (!role) {
      return res.status(404).json({ error: 'Роль не найдена' });
    }

    let resultState;
    if (flag === 'whitelist') {
      const raw = settingsRepo.get(guildId, 'root', 'whitelist_roles') || '[]';
      let list = [];
      try { list = JSON.parse(raw); } catch (_) {}
      if (list.includes(role.id)) {
        list = list.filter(r => r !== role.id);
        resultState = false;
      } else {
        list.push(role.id);
        resultState = true;
      }
      settingsRepo.set(guildId, 'root', 'whitelist_roles', JSON.stringify(list));
    } else if (flag === 'hoist') {
      resultState = !role.hoist;
      await role.setHoist(resultState);
    } else if (flag === 'mentionable') {
      resultState = !role.mentionable;
      await role.setMentionable(resultState);
    } else {
      return res.status(400).json({ error: 'Неизвестный флаг' });
    }

    recordAudit(req, `Переключен флаг ${flag} для роли @${role.name} → ${resultState}`, 'roles', {
      targetId: role.id,
      flag,
      resultState,
    });

    res.json({ ok: true, flag, state: resultState });
  } catch (err) {
    next(err);
  }
});

// Удаление роли через панель
router.delete('/roles/:id', canEdit, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { guildId } = req.query;
    const client = req.app.locals.client;

    if (!guildId) {
      return res.status(400).json({ error: 'Параметр guildId обязателен' });
    }

    const guild = client?.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Сервер не найден' });
    }

    const role = guild.roles.cache.get(id);
    if (!role) {
      return res.status(404).json({ error: 'Роль не найдена' });
    }

    const roleName = role.name;
    await role.delete('Удалено через веб-панель Root');

    recordAudit(req, `Удалена роль @${roleName} (${id})`, 'roles', {
      targetId: id,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
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
