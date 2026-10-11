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

  init() {
    this.subscriptionTimer = setInterval(() => {
      this.checkExpiredSubscriptions().catch(err => {
        this.logger.error(`[Economy] Ошибка проверки истекших подписок на роли: ${err.message}`);
      });
    }, 5 * 60 * 1000);
    this.checkExpiredSubscriptions().catch(() => {});
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

  /**
   * Добавить роль или товар в официальный магазин за монеты
   */
  async addShopItem(name, price, description = '', roleId = null, stock = null) {
    if (!name) throw new Error('Укажите название роли или товара');
    const numPrice = parseInt(price, 10);
    if (isNaN(numPrice) || numPrice < 0) throw new Error('Цена должна быть положительным числом монет');
    return economyRepo.addShopItem(name, numPrice, description, roleId, stock);
  }

  /**
   * Удалить товар из магазина
   */
  async deleteShopItem(id) {
    return economyRepo.deleteShopItem(id);
  }

  // --- Кастомные декоративные роли (Без прав, только цвет и красота) ---

  /**
   * Создание кастомной роли за монеты без каких-либо прав (permissions: 0n)
   */
  async createCustomRole(guild, userId, roleName, hexColor = '#C8A96A') {
    if (!guild) throw new Error('Сервер Discord не указан');
    const config = this.getSettings(guild.id);
    const price = config.roleCreatePrice || 5000;
    const maxRoles = config.maxCustomRolesPerUser || 2;

    // Проверка лимита: не более 2ух ролей на пользователя
    const existingRoles = economyRepo.getUserCustomRoles(userId);
    if (existingRoles.length >= maxRoles) {
      throw new Error(`Вы исчерпали лимит создания ролей (максимум ${maxRoles} роли на пользователя). Удалите одну из своих ролей через меню перед созданием новой.`);
    }

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
   * Смена названия своей роли
   */
  async renameCustomRole(guild, userId, roleId, newName) {
    const roleItem = economyRepo.getCustomRoleByRoleId(roleId);
    if (!roleItem) throw new Error('Кастомная роль не найдена');
    if (roleItem.owner_id !== userId) throw new Error('Вы не являетесь владельцем этой роли');

    const cleanName = String(newName || '').trim().slice(0, 50);
    if (!cleanName || cleanName.length < 2) throw new Error('Название должно быть от 2 до 50 символов');

    const config = this.getSettings(guild.id);
    const price = config.roleRenamePrice || 500;
    const wallet = await this.getBalance(userId);
    if (wallet.balance < price) {
      throw new Error(`Недостаточно средств. Стоимость смены названия: ${price} ${config.currencySymbol}, у вас: ${wallet.balance}`);
    }

    // Изменяем в Discord
    const discordRole = await guild.roles.fetch(roleId).catch(() => null);
    if (discordRole) {
      await discordRole.setName(cleanName, `Смена названия кастомной роли владельцем ${userId}`);
    }

    economyRepo.modifyBalance(userId, -price, 'role_rename', `Смена названия роли на "${cleanName}"`, null, { roleId });
    economyRepo.updateCustomRoleName(roleId, userId, cleanName);

    return { ok: true, name: cleanName, pricePaid: price, currency: config.currencySymbol };
  }

  /**
   * Смена цвета своей роли
   */
  async changeCustomRoleColor(guild, userId, roleId, newHexColor) {
    const roleItem = economyRepo.getCustomRoleByRoleId(roleId);
    if (!roleItem) throw new Error('Кастомная роль не найдена');
    if (roleItem.owner_id !== userId) throw new Error('Вы не являетесь владельцем этой роли');

    let validColor = newHexColor.startsWith('#') ? newHexColor : `#${newHexColor}`;
    if (!/^#[0-9A-Fa-f]{6}$/.test(validColor)) throw new Error('Некорректный HEX-код цвета (пример: #FF5733)');

    const config = this.getSettings(guild.id);
    const price = config.roleColorPrice || 300;
    const wallet = await this.getBalance(userId);
    if (wallet.balance < price) {
      throw new Error(`Недостаточно средств. Стоимость смены цвета: ${price} ${config.currencySymbol}, у вас: ${wallet.balance}`);
    }

    const discordRole = await guild.roles.fetch(roleId).catch(() => null);
    if (discordRole) {
      await discordRole.setColor(validColor, `Смена цвета роли владельцем ${userId}`);
    }

    economyRepo.modifyBalance(userId, -price, 'role_color', `Смена цвета роли на "${validColor}"`, null, { roleId });
    economyRepo.updateCustomRoleColor(roleId, userId, validColor);

    return { ok: true, color: validColor, pricePaid: price, currency: config.currencySymbol };
  }

  /**
   * Установка иконки / эмодзи буста для своей роли
   */
  async setCustomRoleIcon(guild, userId, roleId, iconEmojiOrUrl) {
    const roleItem = economyRepo.getCustomRoleByRoleId(roleId);
    if (!roleItem) throw new Error('Кастомная роль не найдена');
    if (roleItem.owner_id !== userId) throw new Error('Вы не являетесь владельцем этой роли');

    const cleanIcon = String(iconEmojiOrUrl || '').trim();
    if (!cleanIcon) throw new Error('Укажите эмодзи или ссылку на изображение иконки');

    const config = this.getSettings(guild.id);
    const price = config.roleIconPrice || 1500;
    const wallet = await this.getBalance(userId);
    if (wallet.balance < price) {
      throw new Error(`Недостаточно средств. Стоимость установки иконки: ${price} ${config.currencySymbol}, у вас: ${wallet.balance}`);
    }

    const discordRole = await guild.roles.fetch(roleId).catch(() => null);
    if (discordRole) {
      try {
        // Если эмодзи или URL
        if (cleanIcon.startsWith('http://') || cleanIcon.startsWith('https://')) {
          await discordRole.setIcon(cleanIcon, `Установка иконки роли владельцем ${userId}`);
        } else {
          await discordRole.setUnicodeEmoji(cleanIcon, `Установка эмодзи роли владельцем ${userId}`);
        }
      } catch (err) {
        this.logger.warn(`[Economy] Сервер не поддерживает иконки ролей (требуется 2+ уровень буста): ${err.message}`);
      }
    }

    economyRepo.modifyBalance(userId, -price, 'role_icon', `Установка иконки/эмодзи роли`, null, { roleId });
    economyRepo.updateCustomRoleIcon(roleId, userId, cleanIcon);

    return { ok: true, icon: cleanIcon, pricePaid: price, currency: config.currencySymbol };
  }

  /**
   * Покупка градиентного оформления для роли
   */
  async setCustomRoleGradient(guild, userId, roleId) {
    const roleItem = economyRepo.getCustomRoleByRoleId(roleId);
    if (!roleItem) throw new Error('Кастомная роль не найдена');
    if (roleItem.owner_id !== userId) throw new Error('Вы не являетесь владельцем этой роли');

    if (roleItem.is_gradient) throw new Error('Градиентное оформление уже активировано для этой роли');

    const config = this.getSettings(guild.id);
    const price = config.roleGradientPrice || 2500;
    const wallet = await this.getBalance(userId);
    if (wallet.balance < price) {
      throw new Error(`Недостаточно средств. Стоимость градиентного оформления: ${price} ${config.currencySymbol}, у вас: ${wallet.balance}`);
    }

    economyRepo.modifyBalance(userId, -price, 'role_gradient', `Покупка градиентного оформления роли`, null, { roleId });
    economyRepo.updateCustomRoleGradient(roleId, userId, 1);

    return { ok: true, pricePaid: price, currency: config.currencySymbol };
  }

  /**
   * Покупка роли с выбором периода (1 месяц, 3 месяца, 6 месяцев, 1 год, навсегда)
   */
  async buyRoleWithPeriod(guild, buyerId, roleId, period = '1_month', basePrice = 1000, sellerId = null) {
    if (!guild) throw new Error('Сервер не указан');
    const config = this.getSettings(guild.id);
    const taxPercent = config.marketplaceTaxPercent !== undefined ? config.marketplaceTaxPercent : 10;

    const result = economyRepo.buyRoleSubscription(buyerId, guild.id, roleId, period, basePrice, sellerId, taxPercent);

    // Выдаем роль в Discord
    try {
      const member = await guild.members.fetch(buyerId);
      if (member && !member.roles.cache.has(roleId)) {
        await member.roles.add(roleId, `Покупка подписки на роль (${period})`);
      }
    } catch (err) {
      this.logger.warn(`[Economy] Ошибка выдачи роли ${roleId}: ${err.message}`);
    }

    return { ok: true, ...result, currency: config.currencySymbol };
  }

  /**
   * Проверка и снятие истекших подписок на роли
   */
  async checkExpiredSubscriptions() {
    const expired = economyRepo.getExpiredSubscriptions();
    if (!expired || expired.length === 0) return;

    for (const sub of expired) {
      try {
        const guild = this.client.guilds.cache.get(sub.guild_id);
        if (guild) {
          const member = await guild.members.fetch(sub.user_id).catch(() => null);
          if (member && member.roles.cache.has(sub.role_id)) {
            await member.roles.remove(sub.role_id, `Истек срок подписки на роль (${sub.period})`);
          }
        }
      } catch (err) {
        this.logger.error(`[Economy] Ошибка снятия истекшей роли ${sub.role_id}: ${err.message}`);
      } finally {
        economyRepo.deleteSubscription(sub.id);
      }
    }
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
  async deleteCustomRole(guild, roleId, userId = null) {
    const roleItem = economyRepo.getCustomRoleByRoleId(roleId);
    if (userId && roleItem && roleItem.owner_id !== userId) {
      throw new Error('Вы не являетесь владельцем этой роли');
    }
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
