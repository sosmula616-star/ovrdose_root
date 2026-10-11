/**
 * Модуль логирования (Discord Embed каналы + таблица logs в SQLite)
 */

const { EmbedBuilder } = require('discord.js');
const { system: systemRepo, settings: settingsRepo } = require('@root-core/db');

class LoggingModule {
  constructor(client, logger) {
    this.client = client;
    this.logger = logger;
  }

  /**
   * Получить привязанный канал для типа логов
   */
  getLogChannel(guildId, logType) {
    const channelId = settingsRepo.get(guildId, 'root', `log_channel_${logType}`);
    if (!channelId) return null;
    const guild = this.client.guilds.cache.get(guildId);
    return guild ? guild.channels.cache.get(channelId) : null;
  }

  /**
   * Запись лога и отправка в соответствующий Discord-канал
   * @param {string} bot - Имя бота ('root', 'guard', etc.)
   * @param {string} guildId - ID сервера
   * @param {string} type - Тип ('security', 'economy', 'sync', 'bots', 'general')
   * @param {string} level - 'info', 'warn', 'error'
   * @param {string} message - Текст события
   * @param {object} [metadata] - Дополнительные данные
   * @param {string} [userId] - Связанный пользователь
   */
  async log(bot, guildId, type, level, message, metadata = {}, userId = null) {
    // 1. Запись в SQLite
    try {
      systemRepo.addLog(bot, guildId, type, level, message, metadata, userId);
    } catch (e) {
      this.logger.error(`[Logging] Ошибка записи лога в БД: ${e.message}`);
    }

    // 2. Отправка Embed в Discord канал (если настроен)
    if (guildId) {
      const channel = this.getLogChannel(guildId, type) || this.getLogChannel(guildId, 'general');
      if (channel && channel.isTextBased()) {
        try {
          const colors = {
            info:  0x5B8DB8,
            warn:  0xD19A3A,
            error: 0xC9545D,
          };

          const embed = new EmbedBuilder()
            .setColor(colors[level] || 0x5B8DB8)
            .setTitle(`[${bot.toUpperCase()}] [${type.toUpperCase()}] ${level.toUpperCase()}`)
            .setDescription(message)
            .setTimestamp();

          if (userId) {
            embed.addFields({ name: 'Пользователь ID', value: `\`${userId}\``, inline: true });
          }

          if (Object.keys(metadata).length) {
            const formattedMeta = Object.entries(metadata)
              .map(([k, v]) => `• **${k}**: \`${typeof v === 'object' ? JSON.stringify(v) : v}\``)
              .join('\n');
            embed.addFields({ name: 'Параметры', value: formattedMeta.slice(0, 1024) });
          }

          await channel.send({ embeds: [embed] }).catch(() => {});
        } catch (err) {
          this.logger.warn(`[Logging] Не удалось отправить лог в канал Discord: ${err.message}`);
        }
      }
    }
  }

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
