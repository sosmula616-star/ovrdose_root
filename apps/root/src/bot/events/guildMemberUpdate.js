/**
 * Обработчик обновления участника (роли, ники)
 */

module.exports = {
  name: 'guildMemberUpdate',
  once: false,
  async execute(oldMember, newMember, client, logger) {
    try {
      if (client.modules.sync) {
        await client.modules.sync.handleMemberUpdate(oldMember, newMember);
      }
      if (client.modules.antinuke) {
        await client.modules.antinuke.handleMemberUpdate(oldMember, newMember);
      }
    } catch (err) {
      logger.error(`[Event:guildMemberUpdate] Ошибка: ${err.message}`, { stack: err.stack });
    }
  }
};
