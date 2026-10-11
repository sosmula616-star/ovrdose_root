/**
 * Событие ready - готовность бота Root
 */

const { ActivityType } = require('discord.js');
const { registerCommands } = require('../commands/index');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client, logger) {
    logger.info(`[Bot] Root успешно авторизован как ${client.user.tag} (ID: ${client.user.id})`);

    client.user.setPresence({
      activities: [{ name: 'Staff & Main | /help', type: ActivityType.Watching }],
      status: 'online',
    });

    // Регистрация слэш-команд на серверах
    await registerCommands(client, logger);
  }
};
