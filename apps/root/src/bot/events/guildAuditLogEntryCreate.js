/**
 * Обработчик записей Discord Audit Log (v14) для антикраша и супервизора
 */

module.exports = {
  name: 'guildAuditLogEntryCreate',
  once: false,
  async execute(auditLogEntry, guild, client, logger) {
    try {
      if (client.modules.antinuke) {
        await client.modules.antinuke.handleAuditLogEntry(auditLogEntry, guild);
      }
      if (client.modules.supervisor) {
        await client.modules.supervisor.handleAuditLogEntry(auditLogEntry, guild);
      }
    } catch (err) {
      logger.error(`[Event:guildAuditLogEntryCreate] Ошибка: ${err.message}`, { stack: err.stack });
    }
  }
};
