/**
 * Обработчик голосовой активности (voiceStateUpdate)
 * Логирует: вход, выход, переключение каналов, серверный мут и деф
 */

module.exports = {
  name: 'voiceStateUpdate',
  once: false,
  async execute(oldState, newState, client, logger) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    try {
      if (!client.modules.logging) return;

      // 1. Подключение к голосовому каналу
      if (!oldState.channelId && newState.channelId) {
        await client.modules.logging.logVoiceState({
          guildId: guild.id,
          member,
          action: 'join',
          newChannel: newState.channel,
        });
        return;
      }

      // 2. Отключение от голосового канала
      if (oldState.channelId && !newState.channelId) {
        await client.modules.logging.logVoiceState({
          guildId: guild.id,
          member,
          action: 'leave',
          oldChannel: oldState.channel,
        });
        return;
      }

      // 3. Перемещение между голосовыми каналами
      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        await client.modules.logging.logVoiceState({
          guildId: guild.id,
          member,
          action: 'move',
          oldChannel: oldState.channel,
          newChannel: newState.channel,
        });
        return;
      }

      // 4. Серверный мут микрофона
      if (oldState.serverMute !== newState.serverMute) {
        await client.modules.logging.logVoiceState({
          guildId: guild.id,
          member,
          action: 'serverMute',
          newChannel: newState.channel,
          extra: { details: newState.serverMute ? 'Серверный микрофон отключен модератором' : 'Серверный микрофон включен' },
        });
      }

      // 5. Серверный деф звука
      if (oldState.serverDeaf !== newState.serverDeaf) {
        await client.modules.logging.logVoiceState({
          guildId: guild.id,
          member,
          action: 'serverDeaf',
          newChannel: newState.channel,
          extra: { details: newState.serverDeaf ? 'Серверный звук заглушен модератором' : 'Серверный звук включен' },
        });
      }
    } catch (err) {
      logger.error(`[Event:voiceStateUpdate] Ошибка: ${err.message}`);
    }
  }
};
