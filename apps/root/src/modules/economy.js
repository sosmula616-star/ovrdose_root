/**
 * Модуль экономики (общая база данных по user_id для обоих серверов)
 */

const { economy: economyRepo, settings: settingsRepo } = require('@root-core/db');
const { parseEconomySettings } = require('@root-core/shared').validators;

class EconomyModule {
  constructor(client, logger) {
    this.client = client;
    this.logger = logger;
  }

  /**
   * Получение актуальных настроек экономики для сервера
   */
  getSettings(guildId = null) {
    const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
    const rawList = settingsRepo.getAll(gid, 'root');
    const rawMap = {};
    for (const r of rawList) rawMap[r.key] = r.value;
    return parseEconomySettings(rawMap);
  }

  /**
   * Баланс пользователя
   */
  async getBalance(userId) {
    return economyRepo.getWallet(userId);
  }

  /**
   * Получение ежедневной награды /daily
   */
  async daily(userId) {
    const config = this.getSettings();
    const cooldown = economyRepo.getCooldown(userId, 'daily');
    if (cooldown !== null) {
      return { ok: false, cooldown, message: `Вы уже получали ежедневную награду. Доступно через ${cooldown} сек.` };
    }

    const reward = Math.floor(Math.random() * (config.dailyMax - config.dailyMin + 1)) + config.dailyMin;
    const res = economyRepo.modifyBalance(userId, reward, 'daily', 'Ежедневная награда (/daily)');
    economyRepo.setCooldown(userId, 'daily', config.dailyCooldown);

    return { ok: true, reward, newBalance: res.newBalance, currency: config.currencySymbol };
  }

  /**
   * Работа /work
   */
  async work(userId) {
    const config = this.getSettings();
    const cooldown = economyRepo.getCooldown(userId, 'work');
    if (cooldown !== null) {
      return { ok: false, cooldown, message: `Вы устали. Отдохните ещё ${cooldown} сек.` };
    }

    const earnings = Math.floor(Math.random() * (config.workMax - config.workMin + 1)) + config.workMin;
    const res = economyRepo.modifyBalance(userId, earnings, 'work', 'Заработок на работе (/work)');
    economyRepo.setCooldown(userId, 'work', config.workCooldown);

    return { ok: true, earnings, newBalance: res.newBalance, currency: config.currencySymbol };
  }

  /**
   * Перевод средств другому участнику /pay
   */
  async pay(fromUser, toUserId, amount, guildId = null) {
    const config = this.getSettings(guildId);

    // Проверка возраста аккаунта отправителя
    if (config.transferMinAgeDays > 0) {
      const createdTimestamp = fromUser.createdTimestamp;
      const ageDays = (Date.now() - createdTimestamp) / (1000 * 60 * 60 * 24);
      if (ageDays < config.transferMinAgeDays) {
        return {
          ok: false,
          message: `Ваш Discord-аккаунт слишком новый для переводов. Требуется возраст от ${config.transferMinAgeDays} дней.`
        };
      }
    }

    if (amount > config.transferLimitDay) {
      return {
        ok: false,
        message: `Превышен разовый лимит перевода (${config.transferLimitDay} ${config.currencySymbol}).`
      };
    }

    try {
      const result = economyRepo.transfer(fromUser.id, toUserId, amount, config.transferTaxPercent, 'Перевод игроку (/pay)');
      return { ok: true, ...result, currency: config.currencySymbol };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  /**
   * Топ богатых участников
   */
  async getLeaderboard(limit = 10) {
    return economyRepo.getLeaderboard(limit);
  }

  /**
   * Список товаров магазина
   */
  async getShop(onlyEnabled = true) {
    return economyRepo.getShopItems(onlyEnabled);
  }

  /**
   * Покупка товара в магазине
   */
  async buy(userId, itemId, guild = null) {
    try {
      const item = economyRepo.buyItem(userId, itemId);

      // Если к товару привязана роль-награда, пытаемся выдать её
      if (item.role_id && guild) {
        try {
          const member = await guild.members.fetch(userId);
          if (member && !member.roles.cache.has(item.role_id)) {
            await member.roles.add(item.role_id, `Покупка товара в магазине: ${item.name}`);
          }
        } catch (roleErr) {
          this.logger.warn(`[Economy] Не удалось выдать роль ${item.role_id} после покупки: ${roleErr.message}`);
        }
      }

      return { ok: true, item };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  /**
   * Инвентарь пользователя
   */
  async getInventory(userId) {
    return economyRepo.getInventory(userId);
  }

  // --- Кастомные декоративные роли (Без прав, только цвет и красота) ---

  /**
   * Создание кастомной роли за монеты без каких-либо прав (permissions: 0n)
   */
  async createCustomRole(guild, userId, roleName, hexColor = '#C8A96A') {
    if (!guild) throw new Error('Сервер Discord не указан');
    const config = this.getSettings(guild.id);
    const price = config.roleCreatePrice || 5000;

    const wallet = await this.getBalance(userId);
    if (wallet.balance < price) {
      throw new Error(`Недостаточно средств для создания роли. Требуется: ${price} ${config.currencySymbol}, у вас: ${wallet.balance}`);
    }

    // Очистка и валидация названия роли
    const cleanName = String(roleName || '').trim().slice(0, 50);
    if (!cleanName || cleanName.length < 2) {
      throw new Error('Название роли должно содержать от 2 до 50 символов');
    }

    // Валидация цвета
    let validColor = hexColor.startsWith('#') ? hexColor : `#${hexColor}`;
    if (!/^#[0-9A-Fa-f]{6}$/.test(validColor)) {
      validColor = '#C8A96A';
    }

    // 1. Создаем роль в Discord БЕЗ прав (permissions: 0n)
    let discordRole;
    try {
      discordRole = await guild.roles.create({
        name: cleanName,
        color: validColor,
        permissions: 0n, // Строго БЕЗ прав!
        mentionable: false,
        reason: `[Экономика] Создание кастомной декоративной роли участником ID ${userId}`,
      });
    } catch (err) {
      this.logger.error(`[Economy] Ошибка создания Discord роли: ${err.message}`);
      throw new Error(`Не удалось создать роль в Discord: ${err.message}`);
    }

    // 2. Списываем средства
    try {
      economyRepo.modifyBalance(userId, -price, 'custom_role_create', `Создание декоративной роли "${cleanName}"`, null, { roleId: discordRole.id, color: validColor });
    } catch (err) {
      // Откатываем роль если списание упало
      await discordRole.delete().catch(() => {});
      throw err;
    }

    // 3. Выдаем роль создателю в Discord
    try {
      const member = await guild.members.fetch(userId);
      if (member) {
        await member.roles.add(discordRole.id, `Создатель кастомной роли ${cleanName}`);
      }
    } catch (err) {
      this.logger.warn(`[Economy] Не удалось выдать созданную роль участнику: ${err.message}`);
    }

    // 4. Записываем в базу данных
    economyRepo.createCustomRole(guild.id, userId, discordRole.id, cleanName, validColor, 0, 0);

    return {
      ok: true,
      role: discordRole,
      name: cleanName,
      color: validColor,
      pricePaid: price,
      currency: config.currencySymbol,
    };
  }

  /**
   * Выставить кастомную роль на маркетплейс
   */
  async sellCustomRole(guildId, userId, roleId, price) {
    const roleItem = economyRepo.getCustomRoleByRoleId(roleId);
    if (!roleItem) throw new Error('Кастомная роль не найдена');
    if (roleItem.owner_id !== userId) throw new Error('Вы не являетесь владельцем этой роли');

    const numPrice = parseInt(price, 10);
    if (isNaN(numPrice) || numPrice < 1) throw new Error('Цена должна быть не менее 1 монеты');

    economyRepo.setCustomRoleSale(roleId, userId, 1, numPrice);
    return { ok: true, roleItem, price: numPrice };
  }

  /**
   * Снять кастомную роль с продажи на маркетплейсе
   */
  async removeSaleCustomRole(userId, roleId) {
    const roleItem = economyRepo.getCustomRoleByRoleId(roleId);
    if (!roleItem) throw new Error('Кастомная роль не найдена');
    if (roleItem.owner_id !== userId) throw new Error('Вы не являетесь владельцем этой роли');

    economyRepo.setCustomRoleSale(roleId, userId, 0, roleItem.price);
    return { ok: true };
  }

  /**
   * Покупка кастомной роли на маркетплейсе
   */
  async buyCustomRole(guild, buyerId, roleId) {
    if (!guild) throw new Error('Сервер не указан');
    const config = this.getSettings(guild.id);
    const taxPercent = config.marketplaceTaxPercent || 10;

    const result = economyRepo.buyCustomRole(buyerId, roleId, taxPercent);

    // Выдаем роль покупателю в Discord
    try {
      const member = await guild.members.fetch(buyerId);
      if (member && !member.roles.cache.has(roleId)) {
        await member.roles.add(roleId, `Покупка кастомной роли на Маркетплейсе: ${result.roleItem.name}`);
      }
    } catch (err) {
      this.logger.warn(`[Economy] Ошибка выдачи купленной роли ${roleId}: ${err.message}`);
    }

    return { ok: true, ...result, currency: config.currencySymbol };
  }

  /**
   * Список кастомных ролей для маркетплейса
   */
  async getMarketplaceRoles(guildId) {
    return economyRepo.getCustomRolesForSale(guildId);
  }

  /**
   * Все кастомные роли сервера
   */
  async getCustomRoles(guildId) {
    return economyRepo.getCustomRoles(guildId);
  }

  /**
   * Удаление кастомной роли (администратором или создателем)
   */
  async deleteCustomRole(guild, roleId) {
    const roleItem = economyRepo.getCustomRoleByRoleId(roleId);
    if (guild && roleItem) {
      try {
        const discordRole = await guild.roles.fetch(roleId).catch(() => null);
        if (discordRole) {
          await discordRole.delete('Удаление кастомной роли через панель / бота');
        }
      } catch (err) {
        this.logger.warn(`[Economy] Не удалось удалить роль из Discord: ${err.message}`);
      }
    }
    economyRepo.deleteCustomRole(roleId);
    return { ok: true };
  }

  // --- Админские функции ---

  async give(userId, amount, reason, adminTag = 'Admin') {
    if (amount <= 0) throw new Error('Сумма должна быть положительной');
    return economyRepo.modifyBalance(userId, amount, 'admin_give', `Выдано администратором (${adminTag}): ${reason}`, null, { adminTag, reason });
  }

  async take(userId, amount, reason, adminTag = 'Admin') {
    if (amount <= 0) throw new Error('Сумма должна быть положительной');
    return economyRepo.modifyBalance(userId, -amount, 'admin_take', `Списано администратором (${adminTag}): ${reason}`, null, { adminTag, reason });
  }

  async set(userId, amount, reason, adminTag = 'Admin') {
    if (amount < 0) throw new Error('Баланс не может быть отрицательным');
    return economyRepo.setBalance(userId, amount, `Установлено администратором (${adminTag}): ${reason}`, { adminTag, reason });
  }

  async reset(userId, reason, adminTag = 'Admin') {
    return economyRepo.setBalance(userId, 0, `Сброс баланса администратором (${adminTag}): ${reason}`, { adminTag, reason });
  }
}

module.exports = EconomyModule;
