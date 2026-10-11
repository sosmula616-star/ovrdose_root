/**
 * Модуль расширенного логирования Discord и аудита серверов
 * Поддерживает специализированные каналы:
 * - log_text: Сообщения (удаление, редактирование, очистка)
 * - log_voice: Голосовые каналы (подключение, отключение, смена канала, мут/деф)
 * - log_roles: Изменения ролей участников и структуры ролей
 * - log_audit: Журнал аудита сервера (вход, выход, баны, кики, таймауты, ники)
 */

const { EmbedBuilder } = require('discord.js');
const { system: systemRepo, settings: settingsRepo, channels: channelsRepo } = require('@root-core/db');

class LoggingModule {
  constructor(client, logger) {
    this.client = client;
    this.logger = logger;
  }

  /**
   * Получить Discord-канал для указанного типа логов
   */
  getLogChannel(guildId, logType) {
    // 1. Проверяем settings (например log_channel_log_text или log_channel_text)
    let channelId = settingsRepo.get(guildId, 'root', `log_channel_${logType}`);
    
    // 2. Если нет, проверяем managed_channels
    if (!channelId) {
      const managed = channelsRepo.getAll(guildId).find(c => c.group_type === logType || c.group_type === `log_${logType}`);
      if (managed && managed.channel_id) channelId = managed.channel_id;
    }

    // 3. Fallback на general/security
    if (!channelId) {
      channelId = settingsRepo.get(guildId, 'root', 'log_channel_general') || settingsRepo.get(guildId, 'root', 'log_channel_security');
    }

    if (!channelId) return null;
    const guild = this.client.guilds.cache.get(guildId);
    return guild ? guild.channels.cache.get(channelId) : null;
  }

  /**
   * Отправка форматированного Embed в нужный канал логов
   */
  async sendEmbed(guildId, logType, embed) {
    const channel = this.getLogChannel(guildId, logType);
    if (channel && channel.isTextBased()) {
      try {
        await channel.send({ embeds: [embed] });
      } catch (err) {
        this.logger.warn(`[Logging] Не удалось отправить лог в канал ${channel.name}: ${err.message}`);
      }
    }
  }

  /**
   * Общий метод записи лога в БД и отправки Embed
   */
  async log(bot, guildId, type, level, message, metadata = {}, userId = null) {
    try {
      systemRepo.addLog(bot, guildId, type, level, message, metadata, userId);
    } catch (e) {
      this.logger.error(`[Logging] Ошибка записи лога в БД: ${e.message}`);
    }

    if (guildId) {
      const colors = {
        info:    0x5B8DB8,
        success: 0x4EAC6D,
        warn:    0xD19A3A,
        error:   0xC9545D,
      };

      const embed = new EmbedBuilder()
        .setColor(colors[level] || 0x5B8DB8)
        .setTitle(`[${bot.toUpperCase()}] [${type.toUpperCase()}] ${level.toUpperCase()}`)
        .setDescription(message)
        .setTimestamp();

      if (userId) {
        embed.addFields({ name: 'Пользователь ID', value: `\`${userId}\``, inline: true });
      }

      if (metadata && Object.keys(metadata).length > 0) {
        const formattedMeta = Object.entries(metadata)
          .map(([k, v]) => `• **${k}**: \`${typeof v === 'object' ? JSON.stringify(v) : v}\``)
          .join('\n');
        embed.addFields({ name: 'Параметры', value: formattedMeta.slice(0, 1024) });
      }

      await this.sendEmbed(guildId, type, embed);
    }
  }

  // --- СПЕЦИАЛИЗИРОВАННЫЕ КАНАЛЫ ЛОГИРОВАНИЯ ---

  /**
   * 1. Текстовые логи: удаление, редактирование, очистка
   */
  async logTextMessage({ guildId, action, user, channel, oldContent, newContent, extra = {} }) {
    const colors = {
      delete: 0xC9545D, // красный
      update: 0xD19A3A, // оранжевый
      purge:  0x8B93A1, // серый
    };

    const titles = {
      delete: '🗑️ Удалено сообщение',
      update: '✏️ Отредактировано сообщение',
      purge:  '🧹 Массовая очистка сообщений',
    };

    const embed = new EmbedBuilder()
      .setColor(colors[action] || 0x5B8DB8)
      .setTitle(titles[action] || 'Текстовое событие')
      .setTimestamp();

    if (user) {
      embed.setAuthor({ name: `${user.tag} (${user.id})`, iconURL: user.displayAvatarURL ? user.displayAvatarURL() : undefined });
    }

    if (channel) {
      embed.addFields({ name: 'Канал', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true });
    }

    if (oldContent) {
      embed.addFields({ name: action === 'update' ? 'До изменения' : 'Содержимое', value: oldContent.slice(0, 1024) || '*Пусто*' });
    }

    if (newContent) {
      embed.addFields({ name: 'После изменения', value: newContent.slice(0, 1024) || '*Пусто*' });
    }

    if (extra.attachments) {
      embed.addFields({ name: 'Вложения', value: extra.attachments.slice(0, 1024) });
    }

    await this.sendEmbed(guildId, 'log_text', embed);
    systemRepo.addLog('root', guildId, 'text_log', 'info', `[${action}] #${channel?.name}: ${user?.tag}`, { oldContent, newContent, ...extra }, user?.id);
  }

  /**
   * 2. Голосовые логи: подключение, отключение, перемещение, мут/деф
   */
  async logVoiceState({ guildId, member, action, oldChannel, newChannel, extra = {} }) {
    const colors = {
      join:       0x4EAC6D, // зеленый
      leave:      0xC9545D, // красный
      move:       0x5B8DB8, // синий
      serverMute: 0xD19A3A, // оранжевый
      serverDeaf: 0xD19A3A,
    };

    const titles = {
      join:       '🔊 Подключение к войсу',
      leave:      '🔇 Отключение от войса',
      move:       '🔀 Перемещение между войсами',
      serverMute: '🎙️ Серверный мут микрофона',
      serverDeaf: '🎧 Серверное отключение звука',
    };

    const embed = new EmbedBuilder()
      .setColor(colors[action] || 0x5B8DB8)
      .setTitle(titles[action] || 'Голосовая активность')
      .setAuthor({ name: `${member.user.tag} (${member.id})`, iconURL: member.user.displayAvatarURL() })
      .setTimestamp();

    if (action === 'join' && newChannel) {
      embed.addFields({ name: 'Подключился к каналу', value: `🔊 **${newChannel.name}** (\`${newChannel.id}\`)` });
    } else if (action === 'leave' && oldChannel) {
      embed.addFields({ name: 'Покинул канал', value: `🔇 **${oldChannel.name}** (\`${oldChannel.id}\`)` });
    } else if (action === 'move') {
      embed.addFields(
        { name: 'Из канала', value: `🔊 **${oldChannel.name}**`, inline: true },
        { name: 'В канал', value: `🔊 **${newChannel.name}**`, inline: true }
      );
    }

    if (extra.details) {
      embed.addFields({ name: 'Детали', value: String(extra.details) });
    }

    await this.sendEmbed(guildId, 'log_voice', embed);
    systemRepo.addLog('root', guildId, 'voice_log', 'info', `[${action}] ${member.user.tag}: ${oldChannel?.name || ''} -> ${newChannel?.name || ''}`, extra, member.id);
  }

  /**
   * 3. Логи ролей: выдача, снятие, создание, удаление, редактирование ролей
   */
  async logRoleAction({ guildId, action, targetMember, role, executor, changes = {} }) {
    const colors = {
      add:    0x4EAC6D, // зеленый
      remove: 0xC9545D, // красный
      create: 0x5B8DB8, // синий
      delete: 0xC9545D, // красный
      update: 0xD19A3A, // оранжевый
    };

    const titles = {
      add:    '🎭 Выдана роль участнику',
      remove: '❌ Снята роль с участника',
      create: '✨ Создана новая роль',
      delete: '🗑️ Удалена роль с сервера',
      update: '⚙️ Изменена роль сервера',
    };

    const embed = new EmbedBuilder()
      .setColor(colors[action] || 0x5B8DB8)
      .setTitle(titles[action] || 'Событие ролей')
      .setTimestamp();

    if (targetMember) {
      embed.addFields({ name: 'Участник', value: `${targetMember} (\`${targetMember.user ? targetMember.user.tag : targetMember.id}\`)`, inline: true });
    }

    if (role) {
      embed.addFields({ name: 'Роль', value: `${role.name} (\`${role.id}\`)`, inline: true });
    }

    if (executor) {
      embed.addFields({ name: 'Модератор / Исполнитель', value: `${executor.tag || executor.id}`, inline: true });
    }

    if (changes.details) {
      embed.addFields({ name: 'Детали изменений', value: String(changes.details) });
    }

    await this.sendEmbed(guildId, 'log_roles', embed);
    systemRepo.addLog('root', guildId, 'role_log', 'info', `[${action}] Роль ${role?.name || ''} (${targetMember?.user?.tag || ''})`, changes, targetMember?.id);
  }

  /**
   * 4. Журнал аудита сервера: входы, выходы, баны, кики, смена ников, таймауты
   */
  async logAuditEvent({ guildId, action, user, executor, reason, details = {} }) {
    const colors = {
      join:    0x4EAC6D, // зеленый
      leave:   0x8B93A1, // серый
      kick:    0xD19A3A, // оранжевый
      ban:     0xC9545D, // красный
      unban:   0x4EAC6D, // зеленый
      timeout: 0xD19A3A, // оранжевый
      nick:    0x5B8DB8, // синий
    };

    const titles = {
      join:    '👋 Новый участник присоединился',
      leave:   '🚪 Участник покинул сервер',
      kick:    '👢 Участник кикнут с сервера',
      ban:     '🔨 Участник заблокирован',
      unban:   '🔓 Участник разблокирован',
      timeout: '⏳ Выдан таймаут участнику',
      nick:    '✏️ Изменен никнейм участника',
    };

    const embed = new EmbedBuilder()
      .setColor(colors[action] || 0x5B8DB8)
      .setTitle(titles[action] || 'Событие аудита сервера')
      .setTimestamp();

    if (user) {
      embed.setAuthor({ name: `${user.tag || user.displayName || user.id} (${user.id})`, iconURL: user.displayAvatarURL ? user.displayAvatarURL() : undefined });
    }

    if (executor) {
      embed.addFields({ name: 'Модератор', value: `${executor.tag || executor.id}`, inline: true });
    }

    if (reason) {
      embed.addFields({ name: 'Причина', value: reason, inline: true });
    }

    if (details.text) {
      embed.addFields({ name: 'Детали', value: String(details.text) });
    }

    await this.sendEmbed(guildId, 'log_audit', embed);
    systemRepo.addLog('root', guildId, 'audit_log', 'info', `[${action}] ${user?.tag || user?.id}: ${reason || details.text || ''}`, details, user?.id);
  }

  // Хелперы для модулей
  async security(guildId, message, metadata = {}, userId = null) {
    return this.log('root', guildId, 'security', 'warn', message, metadata, userId);
  }

  async criticalSecurity(guildId, message, metadata = {}, userId = null) {
    return this.log('root', guildId, 'security', 'error', message, metadata, userId);
  }

  async economy(guildId, message, metadata = {}, userId = null) {
    return this.log('root', guildId, 'economy', 'info', message, metadata, userId);
  }

  async sync(guildId, message, metadata = {}) {
    return this.log('root', guildId, 'sync', 'info', message, metadata);
  }

  async bots(guildId, message, metadata = {}, level = 'info') {
    return this.log('root', guildId, 'bots', level, message, metadata);
  }
}

module.exports = LoggingModule;
