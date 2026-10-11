/**
 * Модуль Антикраша, Антинюка и защиты структуры серверов
 */

const { AuditLogEvent, PermissionFlagsBits, ChannelType } = require('discord.js');
const { antinuke: antinukeRepo, settings: settingsRepo, bots: botsRepo } = require('@root-core/db');
const { parseAntinukeRule } = require('@root-core/shared').validators;
const { ANTINUKE_DEFAULTS } = require('@root-core/shared').constants;

class AntinukeModule {
  constructor(client, logger, loggingModule) {
    this.client = client;
    this.logger = logger;
    this.loggingModule = loggingModule;

    // Скользящие окна: Map<`${guildId}:${userId}:${eventType}`, Array<timestamp>>
    this.actionWindows = new Map();
    // Окно рейдов (вход участников): Map<guildId, Array<timestamp>>
    this.joinWindows = new Map();
  }

  /**
   * Проверка доверия (Whitelist)
   */
  isTrusted(guildId, memberOrUser) {
    const ownerIds = (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const userId = memberOrUser.id;

    // Владельцы и сам бот Root всегда в белом списке
    if (ownerIds.includes(userId) || userId === this.client.user.id) {
      return true;
    }

    // Проверка настроек вайтлиста в БД
    const whitelistRaw = settingsRepo.get(guildId, 'root', 'whitelist_users') || '[]';
    try {
      const trustedUsers = JSON.parse(whitelistRaw);
      if (trustedUsers.includes(userId)) return true;
    } catch {}

    // Проверка доверенных ролей
    if (memberOrUser.roles?.cache) {
      const trustedRolesRaw = settingsRepo.get(guildId, 'root', 'whitelist_roles') || '[]';
      try {
        const trustedRoles = JSON.parse(trustedRolesRaw);
        for (const roleId of trustedRoles) {
          if (memberOrUser.roles.cache.has(roleId)) return true;
        }
      } catch {}
    }

    return false;
  }

  /**
   * Получить конфигурацию лимита для типа события
   */
  getRule(guildId, eventType) {
    const defaultRule = ANTINUKE_DEFAULTS[eventType] || { limit: 5, window: 10, action: 'quarantine' };
    const rawLimit  = settingsRepo.get(guildId, 'root', `antinuke_${eventType}_limit`);
    const rawWindow = settingsRepo.get(guildId, 'root', `antinuke_${eventType}_window`);
    const rawAction = settingsRepo.get(guildId, 'root', `antinuke_${eventType}_action`);
    const rawEnabled = settingsRepo.get(guildId, 'root', `antinuke_${eventType}_enabled`);

    return parseAntinukeRule({
      limit:   rawLimit !== null ? rawLimit : defaultRule.limit,
      window:  rawWindow !== null ? rawWindow : defaultRule.window,
      action:  rawAction || defaultRule.action,
      enabled: rawEnabled !== null ? rawEnabled : true,
    });
  }

  /**
   * Получить эффективное правило для конкретного участника с учетом его ролей
   */
  getMemberEffectiveRule(guildId, member, eventType) {
    if (!member || !member.roles?.cache) {
      return this.getRule(guildId, eventType);
    }

    const roleRules = antinukeRepo.getRoleRules(guildId);
    if (!roleRules || roleRules.length === 0) {
      return this.getRule(guildId, eventType);
    }

    // Ищем правила для ролей участника
    const matchingRoleRules = [];
    for (const rr of roleRules) {
      if (member.roles.cache.has(rr.role_id)) {
        matchingRoleRules.push(rr);
      }
    }

    if (matchingRoleRules.length === 0) {
      return this.getRule(guildId, eventType);
    }

    // Находим наиболее подходящее правило
    let effective = null;

    for (const rr of matchingRoleRules) {
      const actRule = rr.permissions?.[eventType];
      if (actRule) {
        if (actRule.allowed !== false) {
          const lim = parseInt(actRule.limit ?? 5, 10);
          if (!effective || (effective.allowed && lim > effective.limit)) {
            effective = {
              allowed: true,
              limit: lim,
              window: parseInt(actRule.window ?? 10, 10),
              action: actRule.action || 'quarantine',
              enabled: true,
              roleName: rr.role_name,
            };
          }
        } else {
          // Если явно запрещено для роли
          if (!effective) {
            effective = {
              allowed: false,
              limit: 0,
              window: parseInt(actRule.window ?? 10, 10),
              action: actRule.action || 'remove_roles',
              enabled: true,
              roleName: rr.role_name,
            };
          }
        }
      }
    }

    return effective || this.getRule(guildId, eventType);
  }

  /**
   * Проверка скользящего окна лимитов действий
   * @returns {boolean} true если лимит превышен
   */
  trackAction(guildId, userId, eventType) {
    const rule = this.getRule(guildId, eventType);
    return this.trackActionWithRule(guildId, userId, eventType, rule);
  }

  trackActionWithRule(guildId, userId, eventType, rule) {
    if (!rule.enabled) return false;
    if (rule.allowed === false || rule.limit <= 0) return true;

    const key = `${guildId}:${userId}:${eventType}`;
    const now = Date.now();
    const windowMs = (rule.window || 10) * 1000;

    let timestamps = this.actionWindows.get(key) || [];
    timestamps = timestamps.filter(t => (now - t) < windowMs);
    timestamps.push(now);
    this.actionWindows.set(key, timestamps);

    return timestamps.length > rule.limit;
  }

  /**
   * Применение наказания к нарушителю
   */
  async punish(guild, memberOrUser, action, reason) {
    const userId = memberOrUser.id;
    let member = memberOrUser;

    if (!member.roles) {
      try { member = await guild.members.fetch(userId); } catch {}
    }

    try {
      switch (action) {
        case 'remove_roles':
          if (member?.roles) {
            const botHighest = guild.members.me.roles.highest.position;
            const rolesToRemove = member.roles.cache.filter(r => r.id !== guild.id && r.position < botHighest);
            await member.roles.remove(rolesToRemove, reason);
          }
          break;

        case 'quarantine':
          // Выдача роли карантина или тайм-аут
          if (member?.roles) {
            const quarantineRoleId = settingsRepo.get(guild.id, 'root', 'quarantine_role_id');
            if (quarantineRoleId && guild.roles.cache.has(quarantineRoleId)) {
              await member.roles.set([quarantineRoleId], reason);
            } else {
              // Изоляция через timeout 28 дней
              await member.timeout(28 * 24 * 60 * 60 * 1000, reason);
            }
          }
          break;

        case 'kick':
          if (member?.kickable) {
            await member.kick(reason);
          }
          break;

        case 'ban':
          await guild.members.ban(userId, { reason });
          break;

        case 'restore':
          // Запуск отката последнего снапшота
          const snapshots = antinukeRepo.getSnapshots(guild.id);
          if (snapshots.length) {
            await this.restoreSnapshot(guild.id, snapshots[0].id);
          }
          break;

        case 'alert':
        default:
          break;
      }
    } catch (err) {
      this.logger.error(`[Antinuke] Ошибка наказания (${action}): ${err.message}`);
    }
  }

  /**
   * Обработка записей Audit Log Discord
   */
  async handleAuditLogEntry(entry, guild) {
    const { action, executorId, targetId, extra } = entry;
    if (!executorId) return;

    // Игнорируем действия самого бота Root
    if (executorId === this.client.user.id) return;

    let executor = null;
    try { executor = await guild.members.fetch(executorId); } catch {}

    // Доверенные пользователи не проверяются
    if (executor && this.isTrusted(guild.id, executor)) return;

    let eventType = null;

    switch (action) {
      case AuditLogEvent.ChannelDelete: eventType = 'channel_delete'; break;
      case AuditLogEvent.ChannelCreate: eventType = 'channel_create'; break;
      case AuditLogEvent.RoleDelete:    eventType = 'role_delete'; break;
      case AuditLogEvent.RoleCreate:    eventType = 'role_create'; break;
      case AuditLogEvent.MemberBanAdd:  eventType = 'ban'; break;
      case AuditLogEvent.MemberKick:    eventType = 'kick'; break;
      case AuditLogEvent.WebhookCreate: eventType = 'webhook_create'; break;
      case AuditLogEvent.BotAdd:        eventType = 'bot_add'; break;
      case AuditLogEvent.EmojiDelete:   eventType = 'emoji_delete'; break;
      case AuditLogEvent.GuildUpdate:   eventType = 'guild_update'; break;
    }

    if (!eventType) return;

    // Защита ботов (Root и Guard): никого нельзя кикать/банить кроме овнера
    if ((eventType === 'ban' || eventType === 'kick') && targetId) {
      const isBotTarget = targetId === this.client.user.id || botsRepo.getBot(targetId) !== undefined;
      if (isBotTarget) {
        // Немедленное наказание нарушителя
        const rule = this.getRule(guild.id, eventType);
        await this.punish(guild, executor, 'ban', `Попытка кика/бана защищенного бота ID ${targetId}`);
        antinukeRepo.recordIncident(guild.id, 'bot_attack', executorId, executor?.user?.tag || executorId, { targetId }, 'ban');
        await this.loggingModule.criticalSecurity(guild.id, `🚨 Попытка атаки на бота ID ${targetId} участником ${executor?.user?.tag || executorId}! Нарушитель забанен.`);
        return;
      }
    }

    // Проверка эффективных лимитов роли нарушителя
    const effectiveRule = this.getMemberEffectiveRule(guild.id, executor, eventType);

    // Если действие запрещено для роли (allowed: false или limit: 0)
    if (effectiveRule.allowed === false) {
      const reason = `[Антикраш] Действие "${eventType}" запрещено для роли ${effectiveRule.roleName || 'пользователя'}`;
      await this.punish(guild, executor, effectiveRule.action, reason);
      antinukeRepo.recordIncident(guild.id, eventType, executorId, executor?.user?.tag || executorId, { rule: effectiveRule, forbidden: true }, effectiveRule.action);
      await this.loggingModule.criticalSecurity(guild.id, `🚨 НАРУШЕНИЕ ПРАВ РОЛИ: ${executor?.user?.tag || executorId} попытался выполнить запрещенное действие **${eventType}** (роль: ${effectiveRule.roleName || '—'})! Наказание: ${effectiveRule.action}`);
      return;
    }

    // Проверка превышения скользящего окна
    const exceeded = this.trackActionWithRule(guild.id, executorId, eventType, effectiveRule);
    if (exceeded) {
      const reason = `[Антикраш] Превышен лимит ${effectiveRule.limit} действий (${eventType}) за ${effectiveRule.window}с для роли ${effectiveRule.roleName || 'пользователя'}`;

      await this.punish(guild, executor, effectiveRule.action, reason);
      antinukeRepo.recordIncident(guild.id, eventType, executorId, executor?.user?.tag || executorId, { rule: effectiveRule }, effectiveRule.action);

      await this.loggingModule.criticalSecurity(guild.id, `🚨 АНТИКРАШ СРАБОТАЛ: ${executor?.user?.tag || executorId} превысил лимит ${eventType} (${effectiveRule.limit} за ${effectiveRule.window}с, роль: ${effectiveRule.roleName || '—'})! Наказание: ${effectiveRule.action}`);
    }
  }

  /**
   * Обработка обновления ролей (защита от выдачи Admin прав и изменение ролей ботов)
   */
  async handleMemberUpdate(oldMember, newMember) {
    const guild = newMember.guild;

    // 1. Защита ролей самого Root и других ботов реестра
    if (newMember.id === this.client.user.id) {
      const oldHighest = oldMember.roles.highest.position;
      const newHighest = newMember.roles.highest.position;
      if (newHighest < oldHighest) {
        // Попытка понизить роль Root -> восстанавливаем
        try {
          await newMember.roles.set(oldMember.roles.cache.map(r => r.id), 'Защита роли бота Root (откат)');
        } catch (e) {}
      }
    }

    // 2. Проверка выдачи Администратора неизвестным лицам
    const hadAdmin = oldMember.permissions.has(PermissionFlagsBits.Administrator);
    const hasAdmin = newMember.permissions.has(PermissionFlagsBits.Administrator);

    if (!hadAdmin && hasAdmin && !this.isTrusted(guild.id, newMember)) {
      const rule = this.getRule(guild.id, 'admin_grant');
      if (rule.enabled) {
        // Снимаем роли с админ-правами
        const adminRoles = newMember.roles.cache.filter(r => r.permissions.has(PermissionFlagsBits.Administrator));
        await newMember.roles.remove(adminRoles, '[Antinuke] Несанкционированная выдача прав Администратора');
        antinukeRepo.recordIncident(guild.id, 'admin_grant', newMember.id, newMember.user.tag, {}, 'remove_admin_roles');
        await this.loggingModule.criticalSecurity(guild.id, `⚠️ Участнику ${newMember.user.tag} были выданы права Администратора. Роли автоматически сняты.`);
      }
    }
  }

  /**
   * Защита от рейдов (массовый вход участников)
   */
  async handleMemberAdd(member) {
    const guild = member.guild;

    // Проверка добавления бота
    if (member.user.bot) {
      const isRegistered = botsRepo.getAllBots().some(b => b.client_id === member.id || b.name === member.user.username.toLowerCase());
      if (!isRegistered && !this.isTrusted(guild.id, member)) {
        try {
          await member.kick('Неавторизованный бот не внесен в реестр Root');
          antinukeRepo.recordIncident(guild.id, 'unauthorized_bot', member.id, member.user.tag, {}, 'kick');
          await this.loggingModule.criticalSecurity(guild.id, `🤖 Неавторизованный бот ${member.user.tag} был автоматически кикнут.`);
        } catch (e) {}
        return;
      }
    }

    // Отслеживание окна входов
    const now = Date.now();
    let joins = this.joinWindows.get(guild.id) || [];
    joins = joins.filter(t => (now - t) < 30000); // 30 сек окно
    joins.push(now);
    this.joinWindows.set(guild.id, joins);

    const raidThreshold = parseInt(settingsRepo.get(guild.id, 'root', 'raid_threshold') || '15', 10);
    if (joins.length >= raidThreshold) {
      // Авто-активация Lockdown при рейде
      const lockdownActive = settingsRepo.get(guild.id, 'root', 'lockdown_active') === '1';
      if (!lockdownActive) {
        await this.setLockdown(guild.id, true, `Автоматическая активация при рейде (${joins.length} входов за 30с)`);
        antinukeRepo.recordIncident(guild.id, 'raid_detected', member.id, member.user.tag, { joins: joins.length }, 'lockdown_enabled');
        await this.loggingModule.criticalSecurity(guild.id, `🚨 ОБНАРУЖЕН РЕЙД! Сервер переведен в режим LOCKDOWN автоматически.`);
      }
    }
  }

  /**
   * Переключение режима Lockdown
   */
  async setLockdown(guildId, active, reason = '') {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;

    settingsRepo.set(guildId, 'root', 'lockdown_active', active ? '1' : '0');

    // Блокировка отправки сообщений для роли @everyone
    try {
      const everyoneRole = guild.roles.everyone;
      await everyoneRole.setPermissions(
        active
          ? everyoneRole.permissions.remove(PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.Connect)
          : everyoneRole.permissions.add(PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.Connect),
        `[Lockdown] ${reason}`
      );
    } catch (err) {
      this.logger.error(`[Lockdown] Ошибка изменения прав @everyone: ${err.message}`);
    }

    await this.loggingModule.security(guildId, `🛡️ Режим Lockdown ${active ? 'ВКЛЮЧЕН' : 'ОТКЛЮЧЕН'}. ${reason}`);
    return active;
  }

  /**
   * Создание снапшота структуры сервера (каналы, роли, права)
   */
  async createSnapshot(guildId, name = null, createdBy = 'system') {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Сервер недоступен');

    const snap = {
      guild: {
        id: guild.id,
        name: guild.name,
        verificationLevel: guild.verificationLevel,
      },
      roles: guild.roles.cache.map(r => ({
        id: r.id,
        name: r.name,
        color: r.color,
        hoist: r.hoist,
        position: r.position,
        permissions: r.permissions.bitfield.toString(),
        mentionable: r.mentionable,
      })),
      channels: guild.channels.cache.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        parentId: c.parentId,
        position: c.position,
        permissionOverwrites: c.permissionOverwrites.cache.map(o => ({
          id: o.id,
          type: o.type,
          allow: o.allow.bitfield.toString(),
          deny: o.deny.bitfield.toString(),
        })),
      })),
      createdAt: new Date().toISOString(),
    };

    const jsonStr = JSON.stringify(snap);
    const sizeBytes = Buffer.byteLength(jsonStr, 'utf8');
    const snapName = name || `Снапшот ${new Date().toLocaleDateString('ru-RU')} ${new Date().toLocaleTimeString('ru-RU')}`;

    const res = antinukeRepo.createSnapshot(guildId, snapName, jsonStr, sizeBytes, createdBy);
    this.logger.info(`[Antinuke] Создан снапшот #${res.lastInsertRowid} (${snapName})`);

    return { id: res.lastInsertRowid, name: snapName, sizeBytes };
  }

  /**
   * Восстановление структуры сервера из снапшота
   */
  async restoreSnapshot(guildId, snapshotId) {
    const snapRecord = antinukeRepo.getSnapshotById(snapshotId);
    if (!snapRecord) throw new Error('Снапшот не найден в базе данных');

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Сервер недоступен');

    const data = JSON.parse(snapRecord.data);
    this.logger.warn(`[Antinuke] Начат процесс восстановления сервера ${guild.name} из снапшота "${snapRecord.name}"`);

    let restoredChannels = 0;
    let restoredRoles = 0;

    // 1. Восстановление ролей
    for (const r of data.roles) {
      if (r.id === guild.id) continue; // @everyone
      let existingRole = guild.roles.cache.get(r.id);
      if (!existingRole) {
        try {
          await guild.roles.create({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            permissions: BigInt(r.permissions),
            mentionable: r.mentionable,
            reason: `Восстановление из снапшота "${snapRecord.name}"`,
          });
          restoredRoles++;
        } catch (e) {}
      }
    }

    // 2. Восстановление каналов
    for (const c of data.channels) {
      let existingChannel = guild.channels.cache.get(c.id);
      if (!existingChannel) {
        try {
          await guild.channels.create({
            name: c.name,
            type: c.type,
            parent: c.parentId,
            reason: `Восстановление из снапшота "${snapRecord.name}"`,
          });
          restoredChannels++;
        } catch (e) {}
      }
    }

    await this.loggingModule.criticalSecurity(guildId, `✅ Восстановление сервера по снапшоту "${snapRecord.name}" завершено! Восстановлено каналов: ${restoredChannels}, ролей: ${restoredRoles}.`);

    return { restoredChannels, restoredRoles };
  }
}

module.exports = AntinukeModule;
