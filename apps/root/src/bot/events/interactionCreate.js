/**
 * Обработчик взаимодействий (команды, кнопки подтверждений)
 */

const { system: systemRepo } = require('@root-core/db');

module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction, client, logger) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction, client, logger);
      } catch (err) {
        logger.error(`[Commands] Ошибка выполнения команды /${interaction.commandName}: ${err.message}`, { stack: err.stack });

        systemRepo.addError('root', interaction.guildId, 'command_error', `/${interaction.commandName}: ${err.message}`, err.stack);

        const errorMsg = 'Произошла непредвиденная ошибка при выполнении команды.';
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: errorMsg }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
        }
      }
    }
  }
};
