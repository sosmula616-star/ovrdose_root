/**
 * Бот модерации Guard (внешний сервис, подконтрольный Root и панели управления)
 * Использует @root-core/bot-client для heartbeat и hot reload настроек
 */

require('dotenv').config();
const path = require('path');
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { ExternalBotClient } = require('@root-core/bot-client');
const { initDatabase, moderation: modRepo, system: systemRepo } = require('@root-core/db');
const { createLogger } = require('@root-core/shared');

const logger = createLogger('Guard');

// 1. Инициализация базы данных
const dbPath = path.resolve(process.env.DB_PATH || './data/shared.db');
initDatabase(dbPath);

// 2. Discord клиент Guard
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.GuildMember, Partials.User, Partials.Channel, Partials.Message],
});

// 3. Подключение к супервизору Root
const supervisorClient = new ExternalBotClient({
  botName: 'guard',
  apiBaseUrl: process.env.PANEL_API_URL || 'http://127.0.0.1:3000',
  internalToken: process.env.INTERNAL_API_TOKEN || 'internal_secret_root_guard_token_2026_secure',
  discordClient: client,
});

// Кэш настроек Guard
let guardSettings = {
  automod_enabled: true,
  warn_mute_threshold: 3,
  warn_ban_threshold: 5,
  mute_text_role: null,
  mute_voice_role: null,
  mute_channel_id: null,
};

supervisorClient.on('settings:update', ({ guildId, settings }) => {
  logger.info(`[Guard] Получены обновленные настройки для гильдии ${guildId}`);
  guardSettings = { ...guardSettings, ...settings };
});

// 4. Определение команд модерации
const commands = [
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Выдать предупреждение участнику')
    .addUserOption(opt => opt.setName('user').setDescription('Нарушитель').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Причина').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Выдать мут участнику (текстовый или голосовой)')
    .addUserOption(opt => opt.setName('user').setDescription('Нарушитель').setRequired(true))
    .addStringOption(opt => opt.setName('type').setDescription('Тип мута').setRequired(true)
      .addChoices({ name: 'Текстовый (Text)', value: 'mute_text' }, { name: 'Голосовой (Voice)', value: 'mute_voice' }))
    .addIntegerOption(opt => opt.setName('duration').setDescription('Длительность в минутах').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Причина').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Снять мут с участника')
    .addUserOption(opt => opt.setName('user').setDescription('Участник').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Причина снятия').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Исключить участника с сервера')
    .addUserOption(opt => opt.setName('user').setDescription('Участник').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Причина').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Заблокировать участника на сервере')
    .addUserOption(opt => opt.setName('user').setDescription('Нарушитель').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Причина').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('history')
    .setDescription('Посмотреть историю наказаний участника')
    .addUserOption(opt => opt.setName('user').setDescription('Участник').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
];

// Регистрация слэш-команд
async function registerCommands() {
  const token = process.env.DISCORD_TOKEN_GUARD;
  const clientId = process.env.DISCORD_CLIENT_ID_GUARD || client.user.id;
  if (!token || !clientId) return;

  const rest = new REST({ version: '10' }).setToken(token);
  const guilds = [process.env.STAFF_GUILD_ID, process.env.MAIN_GUILD_ID].filter(Boolean);

  for (const gid of guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, gid), {
        body: commands.map(c => c.toJSON()),
      });
      logger.info(`[Guard] Слэш-команды модерации зарегистрированы на сервере ${gid}`);
    } catch (e) {
      logger.error(`[Guard] Ошибка регистрации команд на ${gid}: ${e.message}`);
    }
  }
}

// 5. Обработка событий бота
client.once('ready', async () => {
  logger.info(`[Guard] Успешно авторизован как ${client.user.tag} (ID: ${client.user.id})`);
  await registerCommands();
  supervisorClient.start();
});

// Обработка взаимодействия (слэш-команды)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, guild, user } = interaction;
  const targetUser = options.getUser('user');
  const targetMember = targetUser ? await guild.members.fetch(targetUser.id).catch(() => null) : null;
  const reason = options.getString('reason') || 'Причина не указана';

  try {
    if (commandName === 'warn') {
      const caseRecord = modRepo.addCase(guild.id, 'warn', targetUser.id, user.id, reason);
      modRepo.addWarn(caseRecord.id, guild.id, targetUser.id, user.id, reason);
      supervisorClient.reportAction('warn', targetUser.id, { caseId: caseRecord.id, reason });

      // Проверка автоэскалации
      const userWarns = modRepo.getUserWarns(guild.id, targetUser.id).filter(w => w.active === 1);
      let escalationMsg = '';

      if (userWarns.length >= (guardSettings.warn_ban_threshold || 5)) {
        if (targetMember && targetMember.bannable) {
          await targetMember.ban({ reason: `Автоэскалация: превышен лимит варнов (${userWarns.length})` });
          modRepo.addCase(guild.id, 'ban', targetUser.id, client.user.id, 'Автоэскалация по варнам');
          escalationMsg = `\n**Автобан:** превышен порог варнов (${userWarns.length}).`;
        }
      } else if (userWarns.length >= (guardSettings.warn_mute_threshold || 3)) {
        if (targetMember && targetMember.moderatable) {
          await targetMember.timeout(60 * 60 * 1000, `Автоэскалация: порог варнов (${userWarns.length})`);
          escalationMsg = `\n**Автомут (1 час):** превышен порог варнов (${userWarns.length}).`;
        }
      }

      await interaction.reply({
        content: `Предупреждение выдано пользователю <@${targetUser.id}> (Кейс #${caseRecord.case_number}). Всего активных варнов: **${userWarns.length}**${escalationMsg}`,
      });
    }

    else if (commandName === 'mute') {
      const type = options.getString('type');
      const durationMin = options.getInteger('duration');
      const untilDate = new Date(Date.now() + durationMin * 60 * 1000).toISOString();

      if (targetMember) {
        if (type === 'mute_text' && targetMember.moderatable) {
          await targetMember.timeout(durationMin * 60 * 1000, reason);
        } else if (type === 'mute_voice' && targetMember.voice?.channel) {
          await targetMember.voice.setMute(true, reason);
        }
      }

      const caseRecord = modRepo.addCase(guild.id, type, targetUser.id, user.id, reason, durationMin, untilDate);
      modRepo.addMute(caseRecord.id, guild.id, targetUser.id, user.id, type.replace('mute_', ''), durationMin, untilDate, reason);
      supervisorClient.reportAction(type, targetUser.id, { durationMin, reason });

      await interaction.reply({
        content: `Пользователь <@${targetUser.id}> получил ${type === 'mute_text' ? 'текстовый' : 'голосовой'} мут на **${durationMin} мин**. (Кейс #${caseRecord.case_number}). Причина: ${reason}`,
      });
    }

    else if (commandName === 'unmute') {
      if (targetMember && targetMember.isCommunicationDisabled()) {
        await targetMember.timeout(null, reason);
      }
      if (targetMember?.voice?.channel) {
        await targetMember.voice.setMute(false, reason);
      }

      modRepo.revokeActivePunishment(guild.id, targetUser.id, 'mute_text');
      modRepo.revokeActivePunishment(guild.id, targetUser.id, 'mute_voice');
      supervisorClient.reportAction('unmute', targetUser.id, { reason });

      await interaction.reply({ content: `Мут с пользователя <@${targetUser.id}> снят. Причина: ${reason}` });
    }

    else if (commandName === 'kick') {
      if (!targetMember || !targetMember.kickable) {
        return interaction.reply({ content: 'Невозможно исключить данного участника (недостаточно прав бота или роль выше).', ephemeral: true });
      }
      await targetMember.kick(reason);
      const caseRecord = modRepo.addCase(guild.id, 'kick', targetUser.id, user.id, reason);
      supervisorClient.reportAction('kick', targetUser.id, { reason });

      await interaction.reply({ content: `Пользователь <@${targetUser.id}> исключен с сервера. Кейс #${caseRecord.case_number}.` });
    }

    else if (commandName === 'ban') {
      if (targetMember && !targetMember.bannable) {
        return interaction.reply({ content: 'Невозможно заблокировать данного участника (роль выше роли бота).', ephemeral: true });
      }
      await guild.bans.create(targetUser.id, { reason });
      const caseRecord = modRepo.addCase(guild.id, 'ban', targetUser.id, user.id, reason);
      supervisorClient.reportAction('ban', targetUser.id, { reason });

      await interaction.reply({ content: `Пользователь <@${targetUser.id}> заблокирован. Кейс #${caseRecord.case_number}.` });
    }

    else if (commandName === 'history') {
      const history = modRepo.getUserHistory(guild.id, targetUser.id);
      const embed = new EmbedBuilder()
        .setColor(0x5B8DB8)
        .setTitle(`История наказаний: ${targetUser.tag} (${targetUser.id})`)
        .setDescription(`Всего кейсов: **${history.cases.length}** | Активных варнов: **${history.warns.filter(w => w.active).length}**`)
        .setTimestamp();

      const recentCases = history.cases.slice(0, 5).map(c => 
        `• **#${c.case_number} [${c.action.toUpperCase()}]**: ${c.reason} (<@${c.moderator_id}>)`
      ).join('\n') || 'Нарушений не зафиксировано.';

      embed.addFields({ name: 'Последние нарушения', value: recentCases });
      await interaction.reply({ embeds: [embed] });
    }
  } catch (err) {
    logger.error(`[Guard] Ошибка выполнения команды ${commandName}: ${err.message}`);
    if (!interaction.replied) {
      await interaction.reply({ content: `Ошибка выполнения: ${err.message}`, ephemeral: true });
    }
  }
});

// 6. Автомодерация сообщений
client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.guild) return;
  if (!guardSettings.automod_enabled) return;

  const content = msg.content;

  // Блокировка ссылок-инвайтов Discord
  const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[a-zA-Z0-9]+/i;
  if (inviteRegex.test(content) && !msg.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await msg.delete().catch(() => {});
    await msg.channel.send({ content: `<@${msg.author.id}>, отправка сторонних инвайтов запрещена.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    supervisorClient.reportAction('automod_invite_delete', msg.author.id, { channelId: msg.channel.id });
  }
});

// Запуск бота Guard
const token = process.env.DISCORD_TOKEN_GUARD;
if (!token) {
  logger.error('[Guard] DISCORD_TOKEN_GUARD не задан в .env');
  process.exit(1);
}

client.login(token).catch(err => {
  logger.error(`[Guard] Ошибка авторизации в Discord: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  supervisorClient.stop();
  client.destroy();
  process.exit(0);
});
