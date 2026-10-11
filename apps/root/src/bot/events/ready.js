/**
 * Событие ready - готовность бота Root
 */

const { ActivityType } = require('discord.js');
const { registerCommands } = require('../commands/index');

module.exports = {
  name: 'ready',
  once: true,
  async execute(readyClient, client, logger) {
    // В discord.js v14 событие ready передает (readyClient) первым аргументом
    const log = (logger && typeof logger.info === 'function')
      ? logger
      : (client && typeof client.info === 'function')
        ? client
        : console;

    const botClient = readyClient?.user ? readyClient : (client?.user ? client : readyClient);

    log.info(`[Bot] Root успешно авторизован как ${botClient.user.tag} (ID: ${botClient.user.id})`);

    botClient.user.setPresence({
      activities: [{ name: 'Staff & Main | /help', type: ActivityType.Watching }],
      status: 'online',
    });

    // Регистрация слэш-команд на серверах Staff и Main
    await registerCommands(botClient, log);
  }
};
