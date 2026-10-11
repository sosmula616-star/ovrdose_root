/**
 * Обработчик выхода участника с сервера (guildMemberRemove)
 */

module.exports = {
  name: 'guildMemberRemove',
  once: false,
  async execute(member, client, logger) {
    try {
      if (client.modules.logging) {
        await client.modules.logging.logAuditEvent({
          guildId: member.guild.id,
          action: 'leave',
          user: member.user,
          details: { text: `Покинул сервер. Осталось участников: **${member.guild.memberCount}**` }
        });
      }
    } catch (err) {
      logger.error(`[Event:guildMemberRemove] Ошибка: ${err.message}`);
    }
  }
};
