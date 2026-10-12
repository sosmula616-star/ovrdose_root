/**
 * Модуль модерации: управление наказаниями, таймерными варнами,
 * ролями мута (текст/войс/оба), изоляцией (доступ только в #апелляции) и гендерками.
 */

const { PermissionFlagsBits, ChannelType, Colors } = require('discord.js');
const { moderation: modRepo, settings: settingsRepo, system: systemRepo } = require('@root-core/db');

class ModerationModule {
  constructor(client, logger, loggingModule) {
    this.client = client;
    this.logger = logger;
    this.loggingModule = loggingModule;
    this.intervalId = null;
  }

  /**
   * Инициализация модуля и запуск фоновой проверки истекших предупреждений
   */
  init() {
    this.logger.info('[Moderation] Инициализация модуля модерации...');
    // Проверка каждые 60 секунд
    this.intervalId = setInterval(() => {
      this.checkExpiredTimedWarns().catch(err => {
        this.logger.error(`[Moderation] Ошибка в checkExpiredTimedWarns: ${err.message}`);
      });
    }, 60 * 1000);

    // Первичный запуск при старте
    setTimeout(() => {
      this.checkExpiredTimedWarns().catch(() => {});
    }, 5000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Поиск или создание необходимых ролей и канала апелляции
   */
  async ensureModerationSetup(guild) {
    if (!guild) return null;

    const setup = {
      quarantineRoleId: settingsRepo.get(guild.id, 'root', 'quarantine_role_id'),
      muteTextRoleId:   settingsRepo.get(guild.id, 'root', 'mute_text_role_id'),
      muteVoiceRoleId:  settingsRepo.get(guild.id, 'root', 'mute_voice_role_id'),
      warn1hRoleId:     settingsRepo.get(guild.id, 'root', 'warn_1h_role_id'),
      warn3hRoleId:     settingsRepo.get(guild.id, 'root', 'warn_3h_role_id'),
      warn6hRoleId:     settingsRepo.get(guild.id, 'root', 'warn_6h_role_id'),
      genderMaleRoleId:   settingsRepo.get(guild.id, 'root', 'gender_male_role_id'),
      genderFemaleRoleId: settingsRepo.get(guild.id, 'root', 'gender_female_role_id'),
      appealChannelId:  settingsRepo.get(guild.id, 'root', 'appeal_channel_id'),
    };

    // 1. Проверяем или создаем канал апелляции
    let appealChannel = setup.appealChannelId ? guild.channels.cache.get(setup.appealChannelId) : null;
    if (!appealChannel) {
      appealChannel = guild.channels.cache.find(c => c.name === 'апелляции' || c.name === 'appeals' || c.name === 'канал-апелляций');
    }

    // 2. Роль изоляции / карантина (доступ ТОЛЬКО к каналу апелляции)
    let quarantineRole = setup.quarantineRoleId ? guild.roles.cache.get(setup.quarantineRoleId) : null;
    if (!quarantineRole) {
      quarantineRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('изоляция') || r.name.toLowerCase().includes('quarantine'));
      if (!quarantineRole && guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        try {
          quarantineRole = await guild.roles.create({
            name: '⛔ Изоляция',
            color: '#36393F',
            reason: 'Автоматическое создание роли изоляции для модерации и антикраша',
          });
          this.logger.info(`[Moderation] Создана роль изоляции "${quarantineRole.name}" (${quarantineRole.id})`);
        } catch (e) {
          this.logger.warn(`[Moderation] Не удалось создать роль изоляции: ${e.message}`);
        }
      }
    }
    if (quarantineRole) {
      settingsRepo.set(guild.id, 'root', 'quarantine_role_id', quarantineRole.id);
      setup.quarantineRoleId = quarantineRole.id;
    }

    // Создаем канал апелляции, если еще не найден
    if (!appealChannel && guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      try {
        const overwrites = [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
        ];
        if (quarantineRole) {
          overwrites.push({
            id: quarantineRole.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
            ],
          });
        }
        appealChannel = await guild.channels.create({
          name: 'апелляции',
          type: ChannelType.GuildText,
          permissionOverwrites: overwrites,
          reason: 'Канал апелляций для изолированных и наказанных пользователей',
        });
        this.logger.info(`[Moderation] Создан канал апелляции "${appealChannel.name}" (${appealChannel.id})`);
      } catch (e) {
        this.logger.warn(`[Moderation] Не удалось создать канал апелляций: ${e.message}`);
      }
    }
    if (appealChannel) {
      settingsRepo.set(guild.id, 'root', 'appeal_channel_id', appealChannel.id);
      setup.appealChannelId = appealChannel.id;

      // Обновляем права в канале апелляции для роли карантина
      if (quarantineRole && guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        try {
          await appealChannel.permissionOverwrites.edit(quarantineRole.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
          }).catch(() => {});
        } catch (_) {}
      }
    }

    // 3. Роль текстового мута
    let muteTextRole = setup.muteTextRoleId ? guild.roles.cache.get(setup.muteTextRoleId) : null;
    if (!muteTextRole) {
      muteTextRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('мут (текст)') || r.name.toLowerCase() === 'muted text');
      if (!muteTextRole && guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        try {
          muteTextRole = await guild.roles.create({
            name: '🔇 Мут (Текст)',
            color: '#7289DA',
            reason: 'Автоматическое создание роли текстового мута',
          });
        } catch (_) {}
      }
    }
    if (muteTextRole) {
      settingsRepo.set(guild.id, 'root', 'mute_text_role_id', muteTextRole.id);
      setup.muteTextRoleId = muteTextRole.id;
    }

    // 4. Роль голосового мута
    let muteVoiceRole = setup.muteVoiceRoleId ? guild.roles.cache.get(setup.muteVoiceRoleId) : null;
    if (!muteVoiceRole) {
      muteVoiceRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('мут (голос)') || r.name.toLowerCase() === 'muted voice');
      if (!muteVoiceRole && guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        try {
          muteVoiceRole = await guild.roles.create({
            name: '🔇 Мут (Голос)',
            color: '#99AAB5',
            reason: 'Автоматическое создание роли голосового мута',
          });
        } catch (_) {}
      }
    }
    if (muteVoiceRole) {
      settingsRepo.set(guild.id, 'root', 'mute_voice_role_id', muteVoiceRole.id);
      setup.muteVoiceRoleId = muteVoiceRole.id;
    }

    // 5. Роли предупреждений (1ч, 3ч, 6ч)
    const warnConfigs = [
      { key: 'warn_1h_role_id', name: '⚠️ Варн (1 час)', color: '#F1C40F' },
      { key: 'warn_3h_role_id', name: '⚠️ Варн (3 часа)', color: '#E67E22' },
      { key: 'warn_6h_role_id', name: '⚠️ Варн (6 часов)', color: '#E74C3C' },
    ];

    for (const w of warnConfigs) {
      let r = setup[w.key] ? guild.roles.cache.get(setup[w.key]) : null;
      if (!r) {
        r = guild.roles.cache.find(role => role.name === w.name);
        if (!r && guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          try {
            r = await guild.roles.create({
              name: w.name,
              color: w.color,
              reason: `Роль временного предупреждения (${w.name})`,
            });
          } catch (_) {}
        }
      }
      if (r) {
        settingsRepo.set(guild.id, 'root', w.key, r.id);
        if (w.key === 'warn_1h_role_id') setup.warn1hRoleId = r.id;
        if (w.key === 'warn_3h_role_id') setup.warn3hRoleId = r.id;
        if (w.key === 'warn_6h_role_id') setup.warn6hRoleId = r.id;
      }
    }

    // 6. Гендерные роли
    let maleRole = setup.genderMaleRoleId ? guild.roles.cache.get(setup.genderMaleRoleId) : null;
    if (!maleRole) {
      maleRole = guild.roles.cache.find(r => r.name === '♂️ Парень' || r.name.toLowerCase() === 'парень');
      if (!maleRole && guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        try {
          maleRole = await guild.roles.create({
            name: '♂️ Парень',
            color: '#3498DB',
            reason: 'Гендерная роль (Парень)',
          });
        } catch (_) {}
      }
    }
    if (maleRole) {
      settingsRepo.set(guild.id, 'root', 'gender_male_role_id', maleRole.id);
      setup.genderMaleRoleId = maleRole.id;
    }

    let femaleRole = setup.genderFemaleRoleId ? guild.roles.cache.get(setup.genderFemaleRoleId) : null;
    if (!femaleRole) {
      femaleRole = guild.roles.cache.find(r => r.name === '♀️ Девушка' || r.name.toLowerCase() === 'девушка');
      if (!femaleRole && guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        try {
          femaleRole = await guild.roles.create({
            name: '♀️ Девушка',
            color: '#E91E63',
            reason: 'Гендерная роль (Девушка)',
          });
        } catch (_) {}
      }
    }
    if (femaleRole) {
      settingsRepo.set(guild.id, 'root', 'gender_female_role_id', femaleRole.id);
      setup.genderFemaleRoleId = femaleRole.id;
    }

    return setup;
  }

  /**
   * Выдача мута (текстовый, голосовой или оба).
   * Кумулятивная логика: если у пользователя уже есть текстовый мут, а выдают голосовой — забираются оба доступа.
   */
  async applyMute(guild, member, moderatorUser, type = 'text', reason = 'Нарушение правил') {
    const setup = await this.ensureModerationSetup(guild);
    const textRoleId = setup?.muteTextRoleId;
    const voiceRoleId = setup?.muteVoiceRoleId;

    const hasText = textRoleId && member.roles.cache.has(textRoleId);
    const hasVoice = voiceRoleId && member.roles.cache.has(voiceRoleId);

    let rolesToAdd = [];
    let effectiveType = type;

    if (type === 'both') {
      if (textRoleId && !hasText) rolesToAdd.push(textRoleId);
      if (voiceRoleId && !hasVoice) rolesToAdd.push(voiceRoleId);
      effectiveType = 'both';
    } else if (type === 'text') {
      if (textRoleId && !hasText) rolesToAdd.push(textRoleId);
      // Если уже был голосовой — теперь у него оба!
      if (hasVoice) effectiveType = 'both';
    } else if (type === 'voice') {
      if (voiceRoleId && !hasVoice) rolesToAdd.push(voiceRoleId);
      // Если уже был текстовый — теперь у него оба!
      if (hasText) effectiveType = 'both';
    }

    if (rolesToAdd.length > 0) {
      await member.roles.add(rolesToAdd, `Мут [${effectiveType}] от ${moderatorUser.tag}: ${reason}`);
    }

    // Если выдан голосовой или оба — отключаем микрофон на сервере, если он в войсе
    if ((type === 'voice' || type === 'both' || hasVoice) && member.voice?.channel) {
      await member.voice.setMute(true, reason).catch(() => {});
    }

    // Discord native timeout как дополнительная мера ограничения для текстового мута (до 24 часов)
    if (type === 'text' || type === 'both') {
      if (member.moderatable && !member.isCommunicationDisabled()) {
        await member.timeout(24 * 60 * 60 * 1000, reason).catch(() => {});
      }
    }

    // Запись в базу данных
    const actionKey = effectiveType === 'both' ? 'mute_both' : (type === 'voice' ? 'mute_voice' : 'mute_text');
    const caseRecord = modRepo.createCase({
      guildId: guild.id,
      type: 'mute',
      targetId: member.id,
      moderatorId: moderatorUser.id,
      moderatorTag: moderatorUser.tag,
      reason: `[${actionKey.toUpperCase()}] ${reason}`,
      duration: null,
      expiresAt: null,
    });

    modRepo.addMute(guild.id, member.id, moderatorUser.id, effectiveType, reason, null, null, caseRecord.caseId);

    if (this.loggingModule) {
      this.loggingModule.log({
        guildId: guild.id,
        level: 'warn',
        category: 'moderation',
        message: `Выдан мут (${effectiveType}) участнику ${member.user.tag} (ID: ${member.id}) модератором ${moderatorUser.tag}`,
        metadata: { caseId: caseRecord.caseId, reason, type: effectiveType },
      });
    }

    return {
      success: true,
      caseNumber: caseRecord.caseNumber,
      effectiveType,
      hasText: Boolean(hasText || type === 'text' || type === 'both'),
      hasVoice: Boolean(hasVoice || type === 'voice' || type === 'both'),
    };
  }

  /**
   * Снятие мута (текстовый, голосовой или всех)
   */
  async removeMute(guild, member, moderatorUser, type = 'all', reason = 'Снятие наказания') {
    const setup = await this.ensureModerationSetup(guild);
    const rolesToRemove = [];

    if (type === 'text' || type === 'all') {
      if (setup?.muteTextRoleId && member.roles.cache.has(setup.muteTextRoleId)) {
        rolesToRemove.push(setup.muteTextRoleId);
      }
      if (member.isCommunicationDisabled()) {
        await member.timeout(null, reason).catch(() => {});
      }
    }

    if (type === 'voice' || type === 'all') {
      if (setup?.muteVoiceRoleId && member.roles.cache.has(setup.muteVoiceRoleId)) {
        rolesToRemove.push(setup.muteVoiceRoleId);
      }
      if (member.voice?.channel) {
        await member.voice.setMute(false, reason).catch(() => {});
      }
    }

    if (rolesToRemove.length > 0) {
      await member.roles.remove(rolesToRemove, `Снятие мута от ${moderatorUser.tag}: ${reason}`);
    }

    if (type === 'text') {
      modRepo.revokeActivePunishment(guild.id, member.id, 'mute_text');
    } else if (type === 'voice') {
      modRepo.revokeActivePunishment(guild.id, member.id, 'mute_voice');
    } else {
      modRepo.revokeActivePunishment(guild.id, member.id, 'mute_text');
      modRepo.revokeActivePunishment(guild.id, member.id, 'mute_voice');
      modRepo.revokeActivePunishment(guild.id, member.id, 'mute');
    }

    if (this.loggingModule) {
      this.loggingModule.log({
        guildId: guild.id,
        level: 'info',
        category: 'moderation',
        message: `Снят мут (${type}) с участника ${member.user.tag} модератором ${moderatorUser.tag}`,
        metadata: { reason },
      });
    }

    return { success: true };
  }

  /**
   * Выдача изоляции / бана: доступ ТОЛЬКО к каналу апелляции, аналогично антикрашу
   */
  async applyIsolation(guild, member, moderatorUser, reason = 'Изоляция модератором') {
    const setup = await this.ensureModerationSetup(guild);
    const quarantineRoleId = setup?.quarantineRoleId;

    if (!quarantineRoleId) {
      throw new Error('Роль изоляции не настроена на сервере.');
    }

    // Сохраняем текущие роли пользователя в settings для возможности восстановления при снятии
    const currentRoles = member.roles.cache.filter(r => r.id !== guild.id && r.id !== quarantineRoleId).map(r => r.id);
    settingsRepo.set(guild.id, 'root', `prior_roles_${member.id}`, JSON.stringify(currentRoles));

    // Назначаем только роль изоляции (полная изоляция от всех других каналов)
    await member.roles.set([quarantineRoleId], `Изоляция от ${moderatorUser.tag}: ${reason}`);

    const caseRecord = modRepo.createCase({
      guildId: guild.id,
      type: 'ban',
      targetId: member.id,
      moderatorId: moderatorUser.id,
      moderatorTag: moderatorUser.tag,
      reason: `[ИЗОЛЯЦИЯ/БАН] ${reason}`,
      duration: null,
      expiresAt: null,
    });

    if (this.loggingModule) {
      this.loggingModule.log({
        guildId: guild.id,
        level: 'warn',
        category: 'moderation',
        message: `Участник ${member.user.tag} помещен в изоляцию (доступ только к #апелляции) модератором ${moderatorUser.tag}`,
        metadata: { caseId: caseRecord.caseId, reason },
      });
    }

    return { success: true, caseNumber: caseRecord.caseNumber };
  }

  /**
   * Снятие изоляции / восстановление доступа
   */
  async removeIsolation(guild, member, moderatorUser, reason = 'Снятие изоляции') {
    const setup = await this.ensureModerationSetup(guild);
    const quarantineRoleId = setup?.quarantineRoleId;

    if (quarantineRoleId && member.roles.cache.has(quarantineRoleId)) {
      await member.roles.remove(quarantineRoleId, `Снятие изоляции от ${moderatorUser.tag}: ${reason}`).catch(() => {});
    }

    // Пробуем восстановить исходные роли, если были сохранены
    const savedRolesJson = settingsRepo.get(guild.id, 'root', `prior_roles_${member.id}`);
    if (savedRolesJson) {
      try {
        const roleIds = JSON.parse(savedRolesJson);
        const validRoles = roleIds.filter(id => guild.roles.cache.has(id));
        if (validRoles.length > 0) {
          await member.roles.add(validRoles, `Восстановление ролей после изоляции: ${reason}`).catch(() => {});
        }
        settingsRepo.delete(guild.id, 'root', `prior_roles_${member.id}`);
      } catch (_) {}
    }

    if (this.loggingModule) {
      this.loggingModule.log({
        guildId: guild.id,
        level: 'info',
        category: 'moderation',
        message: `Изоляция с участника ${member.user.tag} успешно снята модератором ${moderatorUser.tag}`,
        metadata: { reason },
      });
    }

    return { success: true };
  }

  /**
   * Выдача временного предупреждения (1ч, 3ч, 6ч)
   */
  async applyTimedWarn(guild, member, moderatorUser, hours = 1, reason = 'Предупреждение') {
    const setup = await this.ensureModerationSetup(guild);
    let roleId = null;

    if (hours === 1) roleId = setup?.warn1hRoleId;
    else if (hours === 3) roleId = setup?.warn3hRoleId;
    else if (hours === 6) roleId = setup?.warn6hRoleId;

    if (roleId && !member.roles.cache.has(roleId)) {
      await member.roles.add(roleId, `Предупреждение (${hours}ч) от ${moderatorUser.tag}: ${reason}`);
    }

    const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

    // Запись в timed_warns
    modRepo.addTimedWarn({
      guildId: guild.id,
      userId: member.id,
      moderatorId: moderatorUser.id,
      reason,
      durationHours: hours,
      roleId,
      expiresAt,
    });

    // Создание общего кейса модерации
    const caseRecord = modRepo.createCase({
      guildId: guild.id,
      type: 'warn',
      targetId: member.id,
      moderatorId: moderatorUser.id,
      moderatorTag: moderatorUser.tag,
      reason: `[ВАРН ${hours}ч] ${reason}`,
      duration: hours * 3600,
      expiresAt,
    });

    modRepo.addWarn(guild.id, member.id, moderatorUser.id, reason, caseRecord.caseId);

    // Подсчет активных варнов для уведомления об эскалации
    const activeWarns = modRepo.getActiveTimedWarns(guild.id, member.id);

    if (this.loggingModule) {
      this.loggingModule.log({
        guildId: guild.id,
        level: 'warn',
        category: 'moderation',
        message: `Выдан варн (${hours}ч) пользователю ${member.user.tag}. Всего активных варнов: ${activeWarns.length}`,
        metadata: { caseId: caseRecord.caseId, hours, expiresAt, reason },
      });
    }

    return {
      success: true,
      caseNumber: caseRecord.caseNumber,
      activeWarnsCount: activeWarns.length,
      expiresAt,
    };
  }

  /**
   * Снятие всех варнов участника
   */
  async removeWarns(guild, member, moderatorUser, reason = 'Снятие всех предупреждений') {
    const setup = await this.ensureModerationSetup(guild);
    const warnRoles = [setup?.warn1hRoleId, setup?.warn3hRoleId, setup?.warn6hRoleId].filter(Boolean);

    const rolesToRemove = warnRoles.filter(rId => member.roles.cache.has(rId));
    if (rolesToRemove.length > 0) {
      await member.roles.remove(rolesToRemove, `Снятие варнов от ${moderatorUser.tag}: ${reason}`).catch(() => {});
    }

    modRepo.deactivateAllTimedWarns(guild.id, member.id);

    if (this.loggingModule) {
      this.loggingModule.log({
        guildId: guild.id,
        level: 'info',
        category: 'moderation',
        message: `Все варны пользователя ${member.user.tag} сняты модератором ${moderatorUser.tag}`,
        metadata: { reason },
      });
    }

    return { success: true };
  }

  /**
   * Смена пола по гендерным ролям (Парень / Девушка / Снять)
   */
  async setGender(guild, member, gender = 'none', moderatorUser = null) {
    const setup = await this.ensureModerationSetup(guild);
    const maleId = setup?.genderMaleRoleId;
    const femaleId = setup?.genderFemaleRoleId;

    const toRemove = [];
    const toAdd = [];

    if (gender === 'male') {
      if (femaleId && member.roles.cache.has(femaleId)) toRemove.push(femaleId);
      if (maleId && !member.roles.cache.has(maleId)) toAdd.push(maleId);
    } else if (gender === 'female') {
      if (maleId && member.roles.cache.has(maleId)) toRemove.push(maleId);
      if (femaleId && !member.roles.cache.has(femaleId)) toAdd.push(femaleId);
    } else {
      // none
      if (maleId && member.roles.cache.has(maleId)) toRemove.push(maleId);
      if (femaleId && member.roles.cache.has(femaleId)) toRemove.push(femaleId);
    }

    const reason = `Смена гендерной роли (${gender}) ${moderatorUser ? `модератором ${moderatorUser.tag}` : 'через панель'}`;
    if (toRemove.length > 0) await member.roles.remove(toRemove, reason).catch(() => {});
    if (toAdd.length > 0) await member.roles.add(toAdd, reason).catch(() => {});

    return { success: true, gender };
  }

  /**
   * Фоновая проверка и автоматическое снятие истекших предупреждений (1ч, 3ч, 6ч)
   */
  async checkExpiredTimedWarns() {
    const expiredList = modRepo.getExpiredTimedWarns();
    if (!expiredList || expiredList.length === 0) return;

    for (const item of expiredList) {
      try {
        const guild = this.client.guilds.cache.get(item.guild_id);
        if (guild) {
          const member = await guild.members.fetch(item.user_id).catch(() => null);
          if (member && item.role_id && member.roles.cache.has(item.role_id)) {
            await member.roles.remove(item.role_id, 'Истек срок действия предупреждения').catch(() => {});
          }
        }

        modRepo.deactivateTimedWarn(item.id);
        this.logger.info(`[Moderation] Автоматически снято истекшее предупреждение #${item.id} для пользователя ${item.user_id}`);
      } catch (err) {
        this.logger.error(`[Moderation] Ошибка снятия истекшего варна #${item.id}: ${err.message}`);
      }
    }
  }
}

module.exports = ModerationModule;
