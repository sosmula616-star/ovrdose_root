/**
 * Обработчик входа нового участника (guildMemberAdd)
 */

module.exports = {
  name: 'guildMemberAdd',
  once: false,
  async execute(member, client, logger) {
    try {
      // 1. Проверка очереди отложенной синхронизации ролей
      if (client.modules.sync) {
        await client.modules.sync.handleMemberAdd(member);
      }
      // 2. Проверка на рейд (массовый вход)
      if (client.modules.antinuke) {
        await client.modules.antinuke.handleMemberAdd(member);
      }
    } catch (err) {
      logger.error(`[Event:guildMemberAdd] Ошибка: ${err.message}`, { stack: err.stack });
    }
  }
};
