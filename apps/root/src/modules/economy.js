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
