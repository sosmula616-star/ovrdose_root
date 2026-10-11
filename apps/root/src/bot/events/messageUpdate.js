/**
 * Обработчик редактирования текстового сообщения (messageUpdate)
 */

module.exports = {
  name: 'messageUpdate',
  once: false,
  async execute(oldMessage, newMessage, client, logger) {
    if (!newMessage.guild || newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return; // Пропуск изменений embed-превью

    try {
      if (client.modules.logging) {
        await client.modules.logging.logTextMessage({
          guildId: newMessage.guild.id,
          action: 'update',
          user: newMessage.author,
          channel: newMessage.channel,
          oldContent: oldMessage.content || '*Содержимое до изменения не кэшировано*',
          newContent: newMessage.content,
        });
      }
    } catch (err) {
      logger.error(`[Event:messageUpdate] Ошибка: ${err.message}`);
    }
  }
};
