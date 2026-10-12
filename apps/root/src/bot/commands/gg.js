/**
 * Команда /gg - Интерактивная панель модератора
 * Управление наказаниями, историей, никами, аватаром в 4K и гендерками
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { checkPermission } = require('./index');
const { moderation: modRepo, settings: settingsRepo } = require('@root-core/db');

/**
 * Построение Embed и компонентов панели модератора для пользователя
 */
async function buildModeratorPanel(guild, member) {
  const user = member.user;
  const guildId = guild.id;

  // Настройки ролей
  const quarantineRoleId = settingsRepo.get(guildId, 'root', 'quarantine_role_id');
  const muteTextRoleId   = settingsRepo.get(guildId, 'root', 'mute_text_role_id');
  const muteVoiceRoleId  = settingsRepo.get(guildId, 'root', 'mute_voice_role_id');
  const maleRoleId       = settingsRepo.get(guildId, 'root', 'gender_male_role_id');
  const femaleRoleId     = settingsRepo.get(guildId, 'root', 'gender_female_role_id');

  // Определение текущих состояний
  const hasTextMute = Boolean(muteTextRoleId && member.roles.cache.has(muteTextRoleId)) || member.isCommunicationDisabled();
  const hasVoiceMute = Boolean(muteVoiceRoleId && member.roles.cache.has(muteVoiceRoleId));
  const isIsolated = Boolean(quarantineRoleId && member.roles.cache.has(quarantineRoleId));

  let muteStatusStr = '🟢 Чисто';
  if (hasTextMute && hasVoiceMute) {
    muteStatusStr = '🔴 **Полный мут** (Текст + Войс)';
  } else if (hasTextMute) {
    muteStatusStr = '🟡 **Текстовый мут**';
  } else if (hasVoiceMute) {
    muteStatusStr = '🟡 **Голосовой мут**';
  }

  const isoStatusStr = isIsolated
    ? '🔴 **Активна** (доступ только в `#апелляции`)'
    : '🟢 Нет';

  // Активные таймерные предупреждения
  const activeTimedWarns = modRepo.getActiveTimedWarns(guildId, user.id);
  let warnsStr = '🟢 Нет активных';
  if (activeTimedWarns && activeTimedWarns.length > 0) {
    warnsStr = activeTimedWarns.map(w => {
      const expUnix = Math.floor(new Date(w.expires_at).getTime() / 1000);
      return `• ⚠️ **${w.duration_hours}ч**: до <t:${expUnix}:R> (${w.reason || 'Без причины'})`;
    }).join('\n');
  }

  // Гендерный статус
  let genderStr = '⚪ Не указан';
  if (maleRoleId && member.roles.cache.has(maleRoleId)) {
    genderStr = '♂️ **Парень**';
  } else if (femaleRoleId && member.roles.cache.has(femaleRoleId)) {
    genderStr = '♀️ **Девушка**';
  }

  // Список ролей (до 10 основных)
  const userRoles = member.roles.cache
    .filter(r => r.id !== guild.id)
    .map(r => `<@&${r.id}>`)
    .slice(0, 15)
    .join(', ') || 'Нет ролей';

  const avatarUrl = user.displayAvatarURL({ dynamic: true, size: 256 });

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ Панель модератора [/gg] • ${user.tag}`)
    .setThumbnail(avatarUrl)
    .setColor(isIsolated ? 0xE74C3C : (hasTextMute || hasVoiceMute ? 0xE67E22 : 0xC8A96A))
    .addFields(
      {
        name: '👤 Участник',
        value: `<@${user.id}> | \`${user.tag}\`\nID: \`${user.id}\``,
        inline: true,
      },
      {
        name: '📅 Даты',
        value: `Создан: <t:${Math.floor(user.createdTimestamp / 1000)}:R>\nЗашел: <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
        inline: true,
      },
      {
        name: '🚻 Гендер',
        value: genderStr,
        inline: true,
      },
      {
        name: '🔇 Статус Мута',
        value: muteStatusStr,
        inline: true,
      },
      {
        name: '⛔ Изоляция / Бан',
        value: isoStatusStr,
        inline: true,
      },
      {
        name: `⚠️ Активные предупреждения (${activeTimedWarns.length})`,
        value: warnsStr,
        inline: false,
      },
      {
        name: '🎭 Роли участника',
        value: userRoles,
        inline: false,
      }
    )
    .setFooter({ text: 'Используйте кнопки ниже для мгновенных действий модератора' })
    .setTimestamp();

  // Кнопки управления (5 рядов)
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gg_mute_text_${user.id}`).setLabel('Текст-мут').setEmoji('💬').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`gg_mute_voice_${user.id}`).setLabel('Войс-мут').setEmoji('🎙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`gg_mute_both_${user.id}`).setLabel('Полный мут').setEmoji('🔇').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`gg_iso_${user.id}`).setLabel('Изоляция').setEmoji('⛔').setStyle(ButtonStyle.Danger),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gg_warn_1_${user.id}`).setLabel('Варн (1 час)').setEmoji('⚠️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`gg_warn_3_${user.id}`).setLabel('Варн (3 часа)').setEmoji('⚠️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`gg_warn_6_${user.id}`).setLabel('Варн (6 часов)').setEmoji('⚠️').setStyle(ButtonStyle.Primary),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gg_unmute_${user.id}`).setLabel('Снять муты').setEmoji('🔊').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`gg_unwarn_${user.id}`).setLabel('Снять варны').setEmoji('🛡️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`gg_uniso_${user.id}`).setLabel('Снять изоляцию').setEmoji('🔓').setStyle(ButtonStyle.Success),
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gg_gender_m_${user.id}`).setLabel('Парень').setEmoji('♂️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`gg_gender_f_${user.id}`).setLabel('Девушка').setEmoji('♀️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`gg_gender_none_${user.id}`).setLabel('Снять пол').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  );

  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gg_hist_punish_${user.id}`).setLabel('История наказаний').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`gg_hist_nicks_${user.id}`).setLabel('История ников').setEmoji('🏷️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`gg_avatar_${user.id}`).setLabel('Аватар в 4K').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [row1, row2, row3, row4, row5],
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gg')
    .setDescription('Интерактивная панель модератора: наказания, варны, история, ники, аватар, гендер')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Пользователь для управления наказаниями и профилем')
        .setRequired(true)
    ),

  async execute(interaction, client) {
    if (!checkPermission(interaction, 'staff')) {
      return interaction.reply({
        content: '❌ У вас недостаточно прав для открытия панели модератора.',
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user');
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      return interaction.reply({
        content: `❌ Пользователь <@${targetUser.id}> не найден на данном сервере.`,
        ephemeral: true,
      });
    }

    // Инициализация / проверка ролей модерации на сервере
    if (client.modules?.moderation) {
      await client.modules.moderation.ensureModerationSetup(interaction.guild).catch(() => {});
    }

    const panelPayload = await buildModeratorPanel(interaction.guild, member);
    await interaction.reply({
      ...panelPayload,
      ephemeral: true,
    });
  },

  buildModeratorPanel,
};
