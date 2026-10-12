/**
 * Обработчик обновления участника (роли, ники, таймауты)
 */

module.exports = {
  name: 'guildMemberUpdate',
  once: false,
  async execute(oldMember, newMember, client, logger) {
    try {
      // 1. Синхронизация ролей
      if (client.modules.sync) {
        await client.modules.sync.handleMemberUpdate(oldMember, newMember);
      }

      // 2. Антикраш
      if (client.modules.antinuke) {
        await client.modules.antinuke.handleMemberUpdate(oldMember, newMember);
      }

      // 3. Логирование изменений ролей
      if (client.modules.logging) {
        const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
        const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

        for (const [_, role] of addedRoles) {
          await client.modules.logging.logRoleAction({
            guildId: newMember.guild.id,
            action: 'add',
            targetMember: newMember,
            role,
          });
        }

        for (const [_, role] of removedRoles) {
          await client.modules.logging.logRoleAction({
            guildId: newMember.guild.id,
            action: 'remove',
            targetMember: newMember,
            role,
          });
        }

        // Логирование и сохранение смены ника
        if (oldMember.nickname !== newMember.nickname) {
          const { moderation: modRepo } = require('@root-core/db');
          modRepo.addNicknameHistory(
            newMember.guild.id,
            newMember.id,
            oldMember.nickname || oldMember.user.username,
            newMember.nickname || newMember.user.username
          );

          await client.modules.logging.logAuditEvent({
            guildId: newMember.guild.id,
            action: 'nick',
            user: newMember.user,
            details: { text: `Никнейм изменен: \`${oldMember.nickname || oldMember.user.username}\` ➔ \`${newMember.nickname || newMember.user.username}\`` },
          });
        }

        // Логирование таймаута
        if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
          const isTimeout = newMember.communicationDisabledUntilTimestamp && newMember.communicationDisabledUntilTimestamp > Date.now();
          await client.modules.logging.logAuditEvent({
            guildId: newMember.guild.id,
            action: 'timeout',
            user: newMember.user,
            details: { text: isTimeout ? `Таймаут до <t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:f>` : 'Таймаут досрочно снят' },
          });
        }
      }
    } catch (err) {
      logger.error(`[Event:guildMemberUpdate] Ошибка: ${err.message}`, { stack: err.stack });
    }
  }
};
