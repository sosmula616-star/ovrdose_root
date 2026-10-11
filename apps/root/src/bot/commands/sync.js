/**
 * Команда /resync - Полная синхронизация ролей Staff <-> Main
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkPermission } = require('./index');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resync')
    .setDescription('Запустить полную синхронизацию ролей между серверами Staff и Main'),

  async execute(interaction, client) {
    if (!checkPermission(interaction, 'staff')) {
      return interaction.reply({ content: 'У вас недостаточно прав для этой команды.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const syncModule = client.modules.sync;
      if (!syncModule) {
        return interaction.editReply({ content: 'Модуль синхронизации не инициализирован.' });
      }

      const result = await syncModule.fullResync();

      const embed = new EmbedBuilder()
        .setTitle('Синхронизация ролей завершена')
        .setColor(result.errors > 0 ? 0xD19A3A : 0x3FA37A)
        .addFields(
          { name: 'Обновлено участников', value: String(result.updated), inline: true },
          { name: 'Ошибок', value: String(result.errors), inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: `Ошибка выполнения ресинка: ${err.message}` });
    }
  }
};
