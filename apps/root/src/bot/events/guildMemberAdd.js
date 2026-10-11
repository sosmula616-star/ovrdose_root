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
      // 3. Журнал аудита входа
      if (client.modules.logging) {
        const createdAgo = Math.floor(member.user.createdTimestamp / 1000);
        await client.modules.logging.logAuditEvent({
          guildId: member.guild.id,
          action: 'join',
          user: member.user,
          details: { text: `Аккаунт создан: <t:${createdAgo}:R> | Всего участников: **${member.guild.memberCount}**` }
        });
      }
    } catch (err) {
      logger.error(`[Event:guildMemberAdd] Ошибка: ${err.message}`, { stack: err.stack });
    }
  }
};
