/**
 * Событие ready - готовность бота Root
 */

const { ActivityType } = require('discord.js');
const { registerCommands } = require('../commands/index');
const { bots: botsRepo } = require('@root-core/db');

module.exports = {
  name: 'ready',
  once: true,
  async execute(readyClient, client, logger) {
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

    // Обновляем статус бота Root в базе данных
    try {
      botsRepo.updateBotStatus('root', 'online', '1.0.0');
      // Запись первичного heartbeat
      const memRss = parseFloat((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
      botsRepo.recordHeartbeat('root', botClient.ws?.ping >= 0 ? botClient.ws.ping : 0, memRss, Math.floor(process.uptime()), botClient.guilds?.cache?.size || 2);
    } catch (e) {
      log.warn(`[Bot] Не удалось обновить статус в БД: ${e.message}`);
    }

    // Предварительный кэш участников ботов Warden / Guard
    const wardenId = process.env.GUARD_CLIENT_ID || '1558816485760303136';
    for (const guild of botClient.guilds.cache.values()) {
      guild.members.fetch(wardenId).catch(() => null);
    }

    // Регистрация слэш-команд на серверах Staff и Main
    await registerCommands(botClient, log);
  }
};
