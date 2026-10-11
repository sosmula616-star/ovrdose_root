/**
 * Команды антикраша: /lockdown, /restore (с подтверждением кнопкой)
 */

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { checkPermission } = require('./index');
const { antinuke: antinukeRepo } = require('@root-core/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('defense')
    .setDescription('Управление защитой и антикрашем сервера')
    .addSubcommand(sub =>
      sub.setName('lockdown')
        .setDescription('Включить или отключить режим экстренной блокировки сервера')
        .addBooleanOption(opt => opt.setName('active').setDescription('Состояние блокировки').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('restore')
        .setDescription('Восстановить структуру каналов и ролей из последнего снапшота')
        .addIntegerOption(opt => opt.setName('snapshot_id').setDescription('ID снапшота (по умолчанию последний)'))
    ),

  async execute(interaction, client) {
    if (!checkPermission(interaction, 'admin')) {
      return interaction.reply({ content: 'У вас недостаточно прав для управления защитой сервера.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const antinuke = client.modules.antinuke;

    if (sub === 'lockdown') {
      const active = interaction.options.getBoolean('active');
      await interaction.deferReply({ ephemeral: true });

      await antinuke.setLockdown(interaction.guildId, active, `Команда /defense lockdown от ${interaction.user.tag}`);
      return interaction.editReply({
        content: `Режим Lockdown на сервере: **${active ? 'АКТИВИРОВАН' : 'ДЕАКТИВИРОВАН'}**.`
      });
    }

    if (sub === 'restore') {
      let snapId = interaction.options.getInteger('snapshot_id');
      if (!snapId) {
        const snaps = antinukeRepo.getSnapshots(interaction.guildId);
        if (!snaps.length) {
          return interaction.reply({ content: 'Снапшотов для данного сервера не обнаружено.', ephemeral: true });
        }
        snapId = snaps[0].id;
      }

      const snapshot = antinukeRepo.getSnapshotById(snapId);
      if (!snapshot) {
        return interaction.reply({ content: `Снапшот #${snapId} не найден.`, ephemeral: true });
      }

      // Опасная деструктивная операция — требуем подтверждения кнопкой!
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_restore_${snapId}`)
          .setLabel('Подтвердить восстановление')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel_restore')
          .setLabel('Отмена')
          .setStyle(ButtonStyle.Secondary)
      );

      const response = await interaction.reply({
        content: `⚠️ **ВНИМАНИЕ!** Вы собираетесь восстановить структуру сервера по снапшоту **"${snapshot.name}"** от ${snapshot.created_at}.\nКаналы и роли будут созданы заново при их отсутствии. Подтвердите действие:`,
        components: [row],
        ephemeral: true
      });

      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 30000,
        filter: i => i.user.id === interaction.user.id
      });

      collector.on('collect', async i => {
        if (i.customId === `confirm_restore_${snapId}`) {
          await i.update({ content: '⏳ Восстановление структуры сервера запущено...', components: [] });
          try {
            const res = await antinuke.restoreSnapshot(interaction.guildId, snapId);
            await i.editReply({
              content: `✅ Восстановление завершено! Восстановлено каналов: ${res.restoredChannels}, ролей: ${res.restoredRoles}.`
            });
          } catch (err) {
            await i.editReply({ content: `Ошибка восстановления: ${err.message}` });
          }
        } else {
          await i.update({ content: 'Действие отменено.', components: [] });
        }
      });
    }
  }
};
