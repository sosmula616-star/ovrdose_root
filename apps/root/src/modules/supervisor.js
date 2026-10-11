/**
 * Модуль супервизора (Supervisor) - Root контролирует внешних ботов (Guard и др.)
 */

const { bots: botsRepo, settings: settingsRepo, antinuke: antinukeRepo } = require('@root-core/db');
const { PermissionFlagsBits, ChannelType } = require('discord.js');

class SupervisorModule {
  constructor(client, logger, loggingModule, botManager) {
    this.client = client;
    this.logger = logger;
    this.loggingModule = loggingModule;
    this.botManager = botManager;

    this.checkInterval = null;
    this.STAFF_GUILD_ID = process.env.STAFF_GUILD_ID || '1558608015148716062';
    this.MAIN_GUILD_ID  = process.env.MAIN_GUILD_ID  || '1558606862277017690';
  }

  init() {
    this.logger.info('[Supervisor] Модуль супервизора запущен');

    // Каждые 15 секунд проверяем состояние внешних ботов
    this.checkInterval = setInterval(() => {
      this.runHealthChecks().catch(err => {
        this.logger.error(`[Supervisor] Ошибка проверки ботов: ${err.message}`);
      });
    }, 15000);
  }

  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Комплексная проверка внешних ботов
   */
  async runHealthChecks() {
    const bots = botsRepo.getAllBots().filter(b => b.name !== 'root');

    for (const bot of bots) {
      if (bot.client_id) {
        const staffGuild = this.client.guilds.cache.get(this.STAFF_GUILD_ID);
        const mainGuild = this.client.guilds.cache.get(this.MAIN_GUILD_ID);
        const member = staffGuild?.members.cache.get(bot.client_id) || mainGuild?.members.cache.get(bot.client_id);
        if (member) {
          const isOnline = member.presence?.status && member.presence.status !== 'offline';
          if (isOnline && bot.status !== 'online') {
            botsRepo.updateBotStatus(bot.name, 'online', 40);
          }
        }
      }
      await this.checkHeartbeat(bot);
      await this.checkBotServers(bot);
      await this.checkBotPermissions(bot);
    }

    // Проверка инфраструктуры Guard (роли мутов)
    await this.checkGuardInfrastructure();
  }

  /**
   * 1. Проверка Heartbeat (нет сигнала > 60 сек -> перезапуск через PM2)
   */
  async checkHeartbeat(bot) {
    const hb = botsRepo.getLatestHeartbeat(bot.name);
    const now = Date.now();

    if (!hb) return;

    const diffMs = now - new Date(hb.created_at).getTime();

    if (diffMs > 60000 && bot.status !== 'offline') {
      this.logger.warn(`[Supervisor] Бот ${bot.name} не отвечает > 60 сек! Попытка автоперезапуска через PM2...`);
      botsRepo.updateBotStatus(bot.name, 'error');

      await this.loggingModule.criticalSecurity(
        this.STAFF_GUILD_ID,
        `🚨 ВНИМАНИЕ: Бот **${bot.name}** перестал отвечать (нет heartbeat ${Math.floor(diffMs / 1000)}с). Запущен автоперезапуск через PM2.`
      );

      try {
        await this.botManager.restartBot(bot.name);
      } catch (e) {
        this.logger.error(`[Supervisor] Не удалось перезапустить ${bot.name}: ${e.message}`);
      }
    }
  }

  /**
   * 2. Проверка разрешенных серверов (bot_servers)
   */
  async checkBotServers(bot) {
    if (!bot.client_id) return;
    const allowed = new Set(botsRepo.getAllowedServers(bot.name));

    for (const [guildId, guild] of this.client.guilds.cache) {
      if (!allowed.has(guildId)) {
        // Проверяем, есть ли бот на этом сервере
        const member = guild.members.cache.get(bot.client_id);
        if (member) {
          try {
            await member.kick('Бот находится на неавторизованном сервере (контроль супервизора)');
            await this.loggingModule.criticalSecurity(
              guildId,
              `⚠️ Бот ${bot.name} был автоматически кикнут с сервера "${guild.name}", так как сервер не включен в список разрешенных.`
            );
          } catch (e) {}
        }
      }
    }
  }

  /**
   * 3. Проверка позиции роли бота (не выше заданной)
   */
  async checkBotPermissions(bot) {
    if (!bot.client_id || !bot.max_roles_pos) return;

    for (const guildId of [this.STAFF_GUILD_ID, this.MAIN_GUILD_ID]) {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) continue;

      const member = guild.members.cache.get(bot.client_id);
      if (member) {
        const highestPos = member.roles.highest.position;
        if (highestPos > bot.max_roles_pos) {
          // Роль бота поднята выше положенного -> откат
          const dangerousRoles = member.roles.cache.filter(r => r.position > bot.max_roles_pos);
          try {
            await member.roles.remove(dangerousRoles, 'Супервизор: превышение максимально допустимой позиции роли');
            await this.loggingModule.criticalSecurity(
              guildId,
              `⚠️ Обнаружено несанкционированное повышение роли бота ${bot.name}! Роли выше позиции ${bot.max_roles_pos} были сняты.`
            );
          } catch (e) {}
        }
      }
    }
  }

  /**
   * 4. Контроль инфраструктуры Guard (роли Text Muted и Voice Muted и overwrites)
   */
  async checkGuardInfrastructure() {
    for (const guildId of [this.STAFF_GUILD_ID, this.MAIN_GUILD_ID]) {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) continue;

      let textMuteRole = guild.roles.cache.find(r => r.name === 'Text Muted');
      let voiceMuteRole = guild.roles.cache.find(r => r.name === 'Voice Muted');

      // Автосоздание если удалены
      if (!textMuteRole) {
        try {
          textMuteRole = await guild.roles.create({
            name: 'Text Muted',
            color: 0x818384,
            permissions: [],
            reason: 'Супервизор: восстановление роли Text Muted для Guard',
          });
          settingsRepo.set(guildId, 'guard', 'text_mute_role', textMuteRole.id);
        } catch (e) {}
      }

      if (!voiceMuteRole) {
        try {
          voiceMuteRole = await guild.roles.create({
            name: 'Voice Muted',
            color: 0x818384,
            permissions: [],
            reason: 'Супервизор: восстановление роли Voice Muted для Guard',
          });
          settingsRepo.set(guildId, 'guard', 'voice_mute_role', voiceMuteRole.id);
        } catch (e) {}
      }

      // Проверка overwrites на каналах для роли Text Muted
      if (textMuteRole) {
        for (const [chId, channel] of guild.channels.cache) {
          if (channel.isTextBased() && channel.type !== ChannelType.GuildCategory) {
            const currentOverwrite = channel.permissionOverwrites.cache.get(textMuteRole.id);
            if (!currentOverwrite || currentOverwrite.deny.has(PermissionFlagsBits.SendMessages) === false) {
              try {
                await channel.permissionOverwrites.edit(textMuteRole, {
                  SendMessages: false,
                  AddReactions: false,
                  CreatePublicThreads: false,
                  CreatePrivateThreads: false,
                }, { reason: 'Супервизор: изоляция роли Text Muted на канале' });
              } catch (e) {}
            }
          }
        }
      }
    }
  }

  /**
   * Сверка действий ботов с Discord Audit Log
   */
  async handleAuditLogEntry(entry, guild) {
    const { executorId, action, targetId } = entry;
    if (!executorId) return;

    // Проверяем, является ли исполнитель внешним ботом
    const bot = botsRepo.getAllBots().find(b => b.client_id === executorId);
    if (!bot || bot.name === 'root') return;

    // Записываем действие бота
    botsRepo.recordAction(executorId, bot.name, guild.id, `audit_${action}`, targetId, entry.extra || {});

    // Проверка аномалий: например, массовые баны от бота (более 3 банов за 10 сек)
    if (action === 22) { // 22 = MemberBanAdd
      const recentBans = botsRepo.countRecentActions(executorId, 'audit_22', 10);
      if (recentBans >= 3) {
        // Аномальная активность бота -> снимаем права и шлем критический алерт
        const member = guild.members.cache.get(executorId);
        if (member) {
          try {
            await member.roles.set([], 'Супервизор: аномальная активность массовых банов от бота');
            await this.loggingModule.criticalSecurity(
              guild.id,
              `🚨 КРИТИЧЕСКИЙ ИНЦИДЕНТ: Бот **${bot.name}** произвел массовые баны (${recentBans} за 10с). Все роли бота немедленно сняты!`
            );
          } catch (e) {}
        }
      }
    }
  }
}

module.exports = SupervisorModule;
