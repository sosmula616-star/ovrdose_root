/**
 * Модуль синхронизации ролей между серверами Staff и Main
 * Использует таблицу role_map, pending_sync, sync_log.
 * Имеет защиту от эха (10 сек кэш действий), проверку иерархии и отложенную синхронизацию.
 */

const { rolesync: rolesyncRepo, settings: settingsRepo, system: systemRepo } = require('@root-core/db');
const { GUILDS } = require('@root-core/shared').constants;

class RoleSyncModule {
  constructor(client, logger) {
    this.client = client;
    this.logger = logger;
    this.STAFF_GUILD_ID = process.env.STAFF_GUILD_ID || GUILDS.STAFF;
    this.MAIN_GUILD_ID  = process.env.MAIN_GUILD_ID  || GUILDS.MAIN;

    // Кэш защиты от эхо-эффекта: key = `${guildId}:${userId}:${roleId}:${action}`, value = timestamp
    this.echoCache = new Map();
    this.intervalTimer = null;
  }

  init() {
    this.logger.info('[RoleSync] Модуль синхронизации ролей инициализирован');
    // Запуск регулярного полного ресинка каждые 10 минут
    this.intervalTimer = setInterval(() => {
      this.fullResync().catch(err => {
        this.logger.error(`[RoleSync] Ошибка автоматического ресинка: ${err.message}`);
      });
    }, 600000);
  }

  destroy() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /**
   * Ключ для защиты от эха
   */
  getEchoKey(guildId, userId, roleId, action) {
    return `${guildId}:${userId}:${roleId}:${action}`;
  }

  isEcho(guildId, userId, roleId, action) {
    const key = this.getEchoKey(guildId, userId, roleId, action);
    const time = this.echoCache.get(key);
    if (time && (Date.now() - time) < 10000) {
      return true; // Действие совершено самим ботом менее 10 сек назад
    }
    return false;
  }

  markEcho(guildId, userId, roleId, action) {
    const key = this.getEchoKey(guildId, userId, roleId, action);
    this.echoCache.set(key, Date.now());
    setTimeout(() => this.echoCache.delete(key), 12000);
  }

  /**
   * Проверка прав и иерархии ролей бота
   */
  canManageRole(guild, role) {
    const botMember = guild.members.me;
    if (!botMember) return { allowed: false, error: 'Бот не найден на сервере' };
    if (!botMember.permissions.has('ManageRoles')) {
      return { allowed: false, error: 'У бота отсутствует право Управлять ролями (ManageRoles)' };
    }
    if (role.position >= botMember.roles.highest.position) {
      return { allowed: false, error: `Роль "${role.name}" находится выше или наравне с высшей ролью бота` };
    }
    return { allowed: true };
  }

  /**
   * Обработчик изменения ролей участника (guildMemberUpdate)
   */
  async handleMemberUpdate(oldMember, newMember) {
    const guildId = newMember.guild.id;
    if (guildId !== this.STAFF_GUILD_ID && guildId !== this.MAIN_GUILD_ID) return;

    const oldRoles = new Set(oldMember.roles.cache.keys());
    const newRoles = new Set(newMember.roles.cache.keys());

    const addedRoles   = [...newRoles].filter(r => !oldRoles.has(r));
    const removedRoles = [...oldRoles].filter(r => !newRoles.has(r));

    if (addedRoles.length === 0 && removedRoles.length === 0) return;

    const mappings = rolesyncRepo.getMappings(true);
    if (!mappings.length) return;

    for (const roleId of addedRoles) {
      await this.processRoleChange(newMember, roleId, 'add', mappings);
    }
    for (const roleId of removedRoles) {
      await this.processRoleChange(newMember, roleId, 'remove', mappings);
    }
  }

  /**
   * Обработка добавления/снятия конкретной роли
   */
  async processRoleChange(member, roleId, action, mappings) {
    const currentGuildId = member.guild.id;
    const userId = member.id;

    for (const map of mappings) {
      let targetGuildId = null;
      let targetRoleId = null;

      if (currentGuildId === this.STAFF_GUILD_ID && map.staff_role_id === roleId) {
        // Staff -> Main
        targetGuildId = this.MAIN_GUILD_ID;
        targetRoleId  = map.main_role_id;
      } else if (currentGuildId === this.MAIN_GUILD_ID && map.main_role_id === roleId && map.direction === 'both') {
        // Main -> Staff (только если direction === 'both')
        targetGuildId = this.STAFF_GUILD_ID;
        targetRoleId  = map.staff_role_id;
      }

      if (!targetGuildId || !targetRoleId) continue;

      // Проверка на эхо
      if (this.isEcho(targetGuildId, userId, targetRoleId, action)) {
        continue;
      }

      await this.applyRoleSync(userId, targetGuildId, targetRoleId, action, `Синхронизация из ${member.guild.name}`);
    }
  }

  /**
   * Применение изменения роли на целевом сервере
   */
  async applyRoleSync(userId, targetGuildId, targetRoleId, action, reason) {
    const targetGuild = this.client.guilds.cache.get(targetGuildId);
    if (!targetGuild) {
      rolesyncRepo.logSync(userId, action, targetRoleId, targetGuildId, reason, 0, 'Целевой сервер недоступен боту');
      return;
    }

    // Проверяем наличие роли
    const role = targetGuild.roles.cache.get(targetRoleId);
    if (!role) {
      rolesyncRepo.logSync(userId, action, targetRoleId, targetGuildId, reason, 0, `Целевая роль ID ${targetRoleId} не найдена`);
      return;
    }

    // Проверяем иерархию бота
    const hierarchy = this.canManageRole(targetGuild, role);
    if (!hierarchy.allowed) {
      rolesyncRepo.logSync(userId, action, targetRoleId, targetGuildId, reason, 0, hierarchy.error);
      this.logger.warn(`[RoleSync] Иерархия: ${hierarchy.error} на сервере ${targetGuild.name}`);
      return;
    }

    // Получаем участника
    let targetMember = null;
    try {
      targetMember = await targetGuild.members.fetch(userId);
    } catch (e) {
      // Участника нет на целевом сервере -> ставим в pending_sync
      rolesyncRepo.addPending(userId, targetGuildId, targetRoleId, action, reason);
      rolesyncRepo.logSync(userId, action, targetRoleId, targetGuildId, 'Участника нет на сервере. Добавлен в очередь pending_sync', 1);
      return;
    }

    // Применяем роль
    try {
      this.markEcho(targetGuildId, userId, targetRoleId, action);

      if (action === 'add') {
        if (!targetMember.roles.cache.has(targetRoleId)) {
          await targetMember.roles.add(targetRoleId, reason);
        }
      } else if (action === 'remove') {
        if (targetMember.roles.cache.has(targetRoleId)) {
          await targetMember.roles.remove(targetRoleId, reason);
        }
      }

      rolesyncRepo.logSync(userId, action, targetRoleId, targetGuildId, reason, 1, null);
    } catch (err) {
      rolesyncRepo.logSync(userId, action, targetRoleId, targetGuildId, reason, 0, err.message);
      this.logger.error(`[RoleSync] Ошибка применения роли: ${err.message}`);
    }
  }

  /**
   * Обработчик входа участника на сервер (guildMemberAdd)
   * Проверяет очередь pending_sync и выдает отложенные роли
   */
  async handleMemberAdd(member) {
    const guildId = member.guild.id;
    const pendingList = rolesyncRepo.getPending(guildId);

    const userPending = pendingList.filter(p => p.user_id === member.id);
    if (!userPending.length) return;

    this.logger.info(`[RoleSync] Обнаружено ${userPending.length} отложенных действий для нового участника ${member.user.tag}`);

    for (const item of userPending) {
      await this.applyRoleSync(item.user_id, item.target_guild, item.role_id, item.action, `Отложенная синхронизация: ${item.reason}`);
      rolesyncRepo.removePending(item.id);
    }
  }

  /**
   * Полная синхронизация всех участников по активным маппингам
   */
  async fullResync() {
    this.logger.info('[RoleSync] Запущен полный ресинк ролей...');
    const mappings = rolesyncRepo.getMappings(true);
    if (!mappings.length) {
      return { total: 0, updated: 0, errors: 0, message: 'Нет активных маппингов' };
    }

    const staffGuild = this.client.guilds.cache.get(this.STAFF_GUILD_ID);
    const mainGuild  = this.client.guilds.cache.get(this.MAIN_GUILD_ID);

    if (!staffGuild || !mainGuild) {
      throw new Error('Один из серверов (Staff или Main) недоступен боту');
    }

    // Предзагрузка участников обоих серверов
    await Promise.all([
      staffGuild.members.fetch(),
      mainGuild.members.fetch(),
    ]);

    let updatedCount = 0;
    let errorCount   = 0;

    for (const map of mappings) {
      const staffRole = staffGuild.roles.cache.get(map.staff_role_id);
      const mainRole  = mainGuild.roles.cache.get(map.main_role_id);

      if (!staffRole || !mainRole) {
        errorCount++;
        continue;
      }

      // 1. Staff -> Main: все у кого есть staffRole на Staff сервере должны получить mainRole на Main
      for (const [userId, staffMember] of staffGuild.members.cache) {
        const hasStaff = staffMember.roles.cache.has(staffRole.id);
        const mainMember = mainGuild.members.cache.get(userId);

        if (mainMember) {
          const hasMain = mainMember.roles.cache.has(mainRole.id);

          if (hasStaff && !hasMain) {
            try {
              this.markEcho(mainGuild.id, userId, mainRole.id, 'add');
              await mainMember.roles.add(mainRole.id, 'Полный ресинк ролей Staff -> Main');
              rolesyncRepo.logSync(userId, 'add', mainRole.id, mainGuild.id, 'Полный ресинк', 1);
              updatedCount++;
            } catch (e) {
              errorCount++;
            }
          } else if (!hasStaff && hasMain && map.direction !== 'both') {
            // Если снята на staff, снимаем на main (при staff_to_main)
            try {
              this.markEcho(mainGuild.id, userId, mainRole.id, 'remove');
              await mainMember.roles.remove(mainRole.id, 'Полный ресинк ролей (снятие)');
              rolesyncRepo.logSync(userId, 'remove', mainRole.id, mainGuild.id, 'Полный ресинк', 1);
              updatedCount++;
            } catch (e) {
              errorCount++;
            }
          }
        } else if (hasStaff) {
          rolesyncRepo.addPending(userId, mainGuild.id, mainRole.id, 'add', 'Полный ресинк: участника нет на Main');
        }
      }

      // 2. Двусторонняя синхронизация (both): если роль на Main, проверяем Staff
      if (map.direction === 'both') {
        for (const [userId, mainMember] of mainGuild.members.cache) {
          const hasMain = mainMember.roles.cache.has(mainRole.id);
          const staffMember = staffGuild.members.cache.get(userId);

          if (staffMember) {
            const hasStaff = staffMember.roles.cache.has(staffRole.id);
            if (hasMain && !hasStaff) {
              try {
                this.markEcho(staffGuild.id, userId, staffRole.id, 'add');
                await staffMember.roles.add(staffRole.id, 'Полный ресинк ролей Main -> Staff');
                rolesyncRepo.logSync(userId, 'add', staffRole.id, staffGuild.id, 'Полный ресинк (обратный)', 1);
                updatedCount++;
              } catch (e) {
                errorCount++;
              }
            }
          }
        }
      }
    }

    this.logger.info(`[RoleSync] Полный ресинк завершен. Обновлено: ${updatedCount}, ошибок: ${errorCount}`);
    return { updated: updatedCount, errors: errorCount };
  }
}

module.exports = RoleSyncModule;
