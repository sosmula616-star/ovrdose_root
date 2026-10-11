/**
 * Обработчик удаления текстового сообщения (messageDelete)
 */

module.exports = {
  name: 'messageDelete',
  once: false,
  async execute(message, client, logger) {
    if (!message.guild || message.author?.bot) return;

    try {
      if (client.modules.logging) {
        const attachments = message.attachments?.size > 0 
          ? message.attachments.map(a => a.name || a.url).join(', ')
          : null;

        await client.modules.logging.logTextMessage({
          guildId: message.guild.id,
          action: 'delete',
          user: message.author,
          channel: message.channel,
          oldContent: message.content || (attachments ? `[Вложения: ${attachments}]` : '*Содержимое не кэшировано*'),
          extra: { attachments },
        });
      }
    } catch (err) {
      logger.error(`[Event:messageDelete] Ошибка: ${err.message}`);
    }
  }
};
