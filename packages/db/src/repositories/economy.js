/**
 * Репозиторий экономики (wallets, transactions, shop_items, inventory, cooldowns)
 */

const { getDb } = require('../index');

const economyRepo = {
  // --- Кошельки ---
  getWallet(userId) {
    let wallet = getDb().prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) {
      getDb().prepare(`
        INSERT OR IGNORE INTO wallets (user_id, balance, bank, total_earned, total_spent)
        VALUES (?, 0, 0, 0, 0)
      `).run(userId);
      wallet = { user_id: userId, balance: 0, bank: 0, total_earned: 0, total_spent: 0 };
    }
    return wallet;
  },

  getLeaderboard(limit = 10) {
    return getDb().prepare(`
      SELECT user_id, balance, bank, (balance + bank) as total
      FROM wallets
      ORDER BY (balance + bank) DESC
      LIMIT ?
    `).all(limit);
  },

  modifyBalance(userId, amount, type, description = '', targetId = null, metadata = {}) {
    const db = getDb();
    const tx = db.transaction(() => {
      let wallet = this.getWallet(userId);
      const oldBalance = wallet.balance;
      const newBalance = oldBalance + amount;

      if (newBalance < 0) {
        throw new Error('Недостаточно средств на балансе');
      }

      if (amount > 0) {
        db.prepare(`
          UPDATE wallets
          SET balance = ?, total_earned = total_earned + ?, updated_at = datetime('now')
          WHERE user_id = ?
        `).run(newBalance, amount, userId);
      } else {
        db.prepare(`
          UPDATE wallets
          SET balance = ?, total_spent = total_spent + ?, updated_at = datetime('now')
          WHERE user_id = ?
        `).run(newBalance, Math.abs(amount), userId);
      }

      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, balance_after, target_id, description, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, type, amount, newBalance, targetId, description, JSON.stringify(metadata));

      return { oldBalance, newBalance, diff: amount };
    });

    return tx();
  },

  setBalance(userId, newAmount, description = '', metadata = {}) {
    if (newAmount < 0) throw new Error('Баланс не может быть отрицательным');
    const db = getDb();
    const tx = db.transaction(() => {
      const wallet = this.getWallet(userId);
      const diff = newAmount - wallet.balance;

      db.prepare(`
        UPDATE wallets SET balance = ?, updated_at = datetime('now') WHERE user_id = ?
      `).run(newAmount, userId);

      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (?, 'admin_set', ?, ?, ?, ?)
      `).run(userId, diff, newAmount, description, JSON.stringify(metadata));

      return { oldBalance: wallet.balance, newBalance: newAmount, diff };
    });
    return tx();
  },

  transfer(fromUserId, toUserId, amount, taxPercent = 0, description = '') {
    if (amount <= 0) throw new Error('Сумма перевода должна быть больше нуля');
    if (fromUserId === toUserId) throw new Error('Нельзя перевести средства самому себе');

    const db = getDb();
    const tx = db.transaction(() => {
      const fromWallet = this.getWallet(fromUserId);
      if (fromWallet.balance < amount) throw new Error('Недостаточно средств для перевода');

      const tax = Math.floor(amount * (taxPercent / 100));
      const received = amount - tax;

      // Списание у отправителя
      db.prepare(`
        UPDATE wallets
        SET balance = balance - ?, total_spent = total_spent + ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(amount, amount, fromUserId);

      // Зачисление получателю
      db.prepare(`
        UPDATE wallets
        SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(received, received, toUserId);

      const fromAfter = fromWallet.balance - amount;
      const toWallet = this.getWallet(toUserId);

      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, balance_after, target_id, description, metadata)
        VALUES (?, 'pay_send', ?, ?, ?, ?, ?)
      `).run(fromUserId, -amount, fromAfter, toUserId, description, JSON.stringify({ tax, received }));

      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, balance_after, target_id, description, metadata)
        VALUES (?, 'pay_receive', ?, ?, ?, ?, ?)
      `).run(toUserId, received, toWallet.balance, fromUserId, description, JSON.stringify({ tax, original: amount }));

      return { sent: amount, tax, received, fromAfter };
    });

    return tx();
  },

  getTransactions(userId = null, limit = 20, offset = 0) {
    if (userId) {
      const total = getDb().prepare('SELECT COUNT(*) as c FROM transactions WHERE user_id = ?').get(userId).c;
      const items = getDb().prepare(`
        SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).all(userId, limit, offset);
      return { total, items };
    }
    const total = getDb().prepare('SELECT COUNT(*) as c FROM transactions').get().c;
    const items = getDb().prepare(`
      SELECT * FROM transactions ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
    return { total, items };
  },

  // --- Магазин ---
  getShopItems(onlyEnabled = true) {
    const sql = onlyEnabled
      ? 'SELECT * FROM shop_items WHERE enabled = 1 ORDER BY id ASC'
      : 'SELECT * FROM shop_items ORDER BY id DESC';
    return getDb().prepare(sql).all();
  },

  getShopItemById(id) {
    return getDb().prepare('SELECT * FROM shop_items WHERE id = ?').get(id);
  },

  addShopItem(name, price, description = '', roleId = null, stock = null) {
    return getDb().prepare(`
      INSERT INTO shop_items (name, price, description, role_id, stock, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(name, price, description, roleId, stock);
  },

  updateShopItem(id, data) {
    const old = this.getShopItemById(id);
    if (!old) return null;
    return getDb().prepare(`
      UPDATE shop_items
      SET name = ?, price = ?, description = ?, role_id = ?, stock = ?, enabled = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      data.name !== undefined ? data.name : old.name,
      data.price !== undefined ? data.price : old.price,
      data.description !== undefined ? data.description : old.description,
      data.roleId !== undefined ? data.roleId : old.role_id,
      data.stock !== undefined ? data.stock : old.stock,
      data.enabled !== undefined ? (data.enabled ? 1 : 0) : old.enabled,
      id
    );
  },

  deleteShopItem(id) {
    return getDb().prepare('DELETE FROM shop_items WHERE id = ?').run(id);
  },

  buyItem(userId, itemId) {
    const db = getDb();
    const tx = db.transaction(() => {
      const item = this.getShopItemById(itemId);
      if (!item || !item.enabled) throw new Error('Товар не найден или недоступен для покупки');
      if (item.stock !== null && item.stock <= 0) throw new Error('Товара нет в наличии');

      const wallet = this.getWallet(userId);
      if (wallet.balance < item.price) throw new Error('Недостаточно средств для покупки товара');

      // Списание средств
      this.modifyBalance(userId, -item.price, 'shop_buy', `Покупка товара: ${item.name}`, null, { itemId });

      // Уменьшение остатка
      if (item.stock !== null) {
        db.prepare('UPDATE shop_items SET stock = stock - 1 WHERE id = ?').run(itemId);
      }

      // Добавление в инвентарь
      db.prepare(`
        INSERT INTO inventory (user_id, item_id, quantity)
        VALUES (?, ?, 1)
        ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1
      `).run(userId, itemId);

      return item;
    });

    return tx();
  },

  // --- Инвентарь ---
  getInventory(userId) {
    return getDb().prepare(`
      SELECT i.id, i.item_id, i.quantity, i.acquired_at, s.name, s.description, s.role_id, s.price
      FROM inventory i
      JOIN shop_items s ON i.item_id = s.id
      WHERE i.user_id = ?
    `).all(userId);
  },

  // --- Кулдауны ---
  getCooldown(userId, command) {
    const row = getDb().prepare(`
      SELECT expires_at FROM cooldowns WHERE user_id = ? AND command = ?
    `).get(userId, command);
    if (!row) return null;
    const expires = new Date(row.expires_at).getTime();
    const now = Date.now();
    if (now >= expires) {
      getDb().prepare('DELETE FROM cooldowns WHERE user_id = ? AND command = ?').run(userId, command);
      return null;
    }
    return Math.ceil((expires - now) / 1000);
  },

  setCooldown(userId, command, durationSeconds) {
    const expiresAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
    return getDb().prepare(`
      INSERT OR REPLACE INTO cooldowns (user_id, command, expires_at)
      VALUES (?, ?, ?)
    `).run(userId, command, expiresAt);
  },

  // --- Кастомные роли пользователей (Декоративные / Без прав) ---
  createCustomRole(guildId, ownerId, roleId, name, color = '#C8A96A', price = 0, forSale = 0) {
    return getDb().prepare(`
      INSERT INTO custom_roles (guild_id, owner_id, role_id, name, color, price, for_sale)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, ownerId, roleId, name, color, price, forSale ? 1 : 0);
  },

  getCustomRoles(guildId) {
    return getDb().prepare(`
      SELECT * FROM custom_roles WHERE guild_id = ? ORDER BY id DESC
    `).all(guildId);
  },

  getCustomRolesForSale(guildId) {
    return getDb().prepare(`
      SELECT * FROM custom_roles WHERE guild_id = ? AND for_sale = 1 ORDER BY price ASC
    `).all(guildId);
  },

  getCustomRoleByRoleId(roleId) {
    return getDb().prepare(`
      SELECT * FROM custom_roles WHERE role_id = ?
    `).get(roleId);
  },

  getUserCustomRoles(ownerId) {
    return getDb().prepare(`
      SELECT * FROM custom_roles WHERE owner_id = ? ORDER BY id DESC
    `).all(ownerId);
  },

  setCustomRoleSale(roleId, ownerId, forSale, price) {
    return getDb().prepare(`
      UPDATE custom_roles
      SET for_sale = ?, price = ?, updated_at = datetime('now')
      WHERE role_id = ? AND owner_id = ?
    `).run(forSale ? 1 : 0, Math.max(0, parseInt(price || 0, 10)), roleId, ownerId);
  },

  deleteCustomRole(roleId) {
    return getDb().prepare(`
      DELETE FROM custom_roles WHERE role_id = ?
    `).run(roleId);
  },

  buyCustomRole(buyerId, roleId, taxPercent = 10) {
    const db = getDb();
    const tx = db.transaction(() => {
      const roleItem = this.getCustomRoleByRoleId(roleId);
      if (!roleItem || !roleItem.for_sale) {
        throw new Error('Данная роль не выставлена на продажу на Маркетплейсе');
      }

      if (roleItem.owner_id === buyerId) {
        throw new Error('Вы являетесь создателем этой роли');
      }

      const price = roleItem.price;
      const buyerWallet = this.getWallet(buyerId);
      if (buyerWallet.balance < price) {
        throw new Error(`Недостаточно средств. Цена роли: ${price}, у вас: ${buyerWallet.balance}`);
      }

      // Списание с покупателя
      this.modifyBalance(buyerId, -price, 'custom_role_buy', `Покупка кастомной роли: ${roleItem.name}`, roleItem.owner_id, { roleId });

      // Начисление продавцу за вычетом комиссии маркетплейса
      const tax = Math.floor(price * (taxPercent / 100));
      const sellerReward = price - tax;
      this.modifyBalance(roleItem.owner_id, sellerReward, 'custom_role_sell', `Продажа кастомной роли: ${roleItem.name} (комиссия ${tax})`, buyerId, { roleId, tax });

      // Обновляем статистику покупок роли
      db.prepare(`
        UPDATE custom_roles
        SET buyers_count = buyers_count + 1, updated_at = datetime('now')
        WHERE role_id = ?
      `).run(roleId);

      return { roleItem, price, sellerReward, tax };
    });

    return tx();
  },

  // --- Настройка и кастомизация своей роли ---
  updateCustomRoleName(roleId, ownerId, newName) {
    return getDb().prepare(`
      UPDATE custom_roles SET name = ?, updated_at = datetime('now')
      WHERE role_id = ? AND owner_id = ?
    `).run(newName, roleId, ownerId);
  },

  updateCustomRoleColor(roleId, ownerId, newColor) {
    return getDb().prepare(`
      UPDATE custom_roles SET color = ?, updated_at = datetime('now')
      WHERE role_id = ? AND owner_id = ?
    `).run(newColor, roleId, ownerId);
  },

  updateCustomRoleIcon(roleId, ownerId, newIcon) {
    return getDb().prepare(`
      UPDATE custom_roles SET icon = ?, updated_at = datetime('now')
      WHERE role_id = ? AND owner_id = ?
    `).run(newIcon, roleId, ownerId);
  },

  updateCustomRoleGradient(roleId, ownerId, isGradient = 1) {
    return getDb().prepare(`
      UPDATE custom_roles SET is_gradient = ?, updated_at = datetime('now')
      WHERE role_id = ? AND owner_id = ?
    `).run(isGradient ? 1 : 0, roleId, ownerId);
  },

  // --- Подписки на роли по срокам (1м, 3м, 6м, 1 год, навсегда) ---
  calculatePeriodPrice(basePrice, period) {
    const p = Math.max(1, parseInt(basePrice || 0, 10));
    switch (period) {
      case '1_month':  return p;
      case '3_months': return Math.round(p * 2.5);
      case '6_months': return Math.round(p * 4.5);
      case '1_year':   return Math.round(p * 8.0);
      case 'forever':  return Math.round(p * 12.0);
      default:         return p;
    }
  },

  calculateExpiresAt(period) {
    const now = Date.now();
    switch (period) {
      case '1_month':  return new Date(now + 30 * 86400 * 1000).toISOString();
      case '3_months': return new Date(now + 90 * 86400 * 1000).toISOString();
      case '6_months': return new Date(now + 180 * 86400 * 1000).toISOString();
      case '1_year':   return new Date(now + 365 * 86400 * 1000).toISOString();
      case 'forever':  return null;
      default:         return null;
    }
  },

  buyRoleSubscription(buyerId, guildId, roleId, period, basePrice, sellerId = null, taxPercent = 10) {
    const db = getDb();
    const tx = db.transaction(() => {
      const price = this.calculatePeriodPrice(basePrice, period);
      const buyerWallet = this.getWallet(buyerId);
      if (buyerWallet.balance < price) {
        throw new Error(`Недостаточно средств. Стоимость периода: ${price}, на балансе: ${buyerWallet.balance}`);
      }

      const expiresAt = this.calculateExpiresAt(period);

      // Списание у покупателя
      this.modifyBalance(buyerId, -price, 'role_subscription_buy', `Покупка роли на период (${period})`, sellerId, { roleId, period, expiresAt });

      // Если продавец указан (маркетплейс кастомных ролей)
      let sellerReward = 0;
      let tax = 0;
      if (sellerId && sellerId !== buyerId) {
        const clampedTax = Math.min(100, Math.max(0, parseInt(taxPercent ?? 10, 10)));
        tax = Math.floor(price * (clampedTax / 100));
        sellerReward = price - tax;
        if (sellerReward > 0) {
          this.modifyBalance(sellerId, sellerReward, 'role_subscription_sell', `Продажа роли на период (${period}) с комиссией ${tax}`, buyerId, { roleId, period, tax });
        }
      }

      // Сохраняем подписку
      const res = db.prepare(`
        INSERT INTO role_subscriptions (guild_id, user_id, role_id, period, price_paid, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(guildId, buyerId, roleId, period, price, expiresAt);

      // Обновляем статистику если это кастомная роль
      db.prepare(`
        UPDATE custom_roles SET buyers_count = buyers_count + 1 WHERE role_id = ?
      `).run(roleId);

      return { subId: res.lastInsertRowid, price, expiresAt, sellerReward, tax };
    });

    return tx();
  },

  getExpiredSubscriptions() {
    return getDb().prepare(`
      SELECT * FROM role_subscriptions WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')
    `).all();
  },

  deleteSubscription(id) {
    return getDb().prepare('DELETE FROM role_subscriptions WHERE id = ?').run(id);
  },

  // --- Статистика стаффа и модераторов ---
  getStaffStats(guildId, userId) {
    let row = getDb().prepare(`
      SELECT * FROM staff_stats WHERE guild_id = ? AND user_id = ?
    `).get(guildId, userId);

    if (!row) {
      getDb().prepare(`
        INSERT OR IGNORE INTO staff_stats (guild_id, user_id, verified_count, bans_count, mutes_count, kicks_count, warns_count, reports_count)
        VALUES (?, ?, 0, 0, 0, 0, 0, 0)
      `).run(guildId, userId);
      row = { guild_id: guildId, user_id: userId, verified_count: 0, bans_count: 0, mutes_count: 0, kicks_count: 0, warns_count: 0, reports_count: 0 };
    }
    return row;
  },

  getAllStaffStats(guildId) {
    return getDb().prepare(`
      SELECT * FROM staff_stats WHERE guild_id = ? ORDER BY (verified_count + bans_count + mutes_count + warns_count) DESC
    `).all(guildId);
  },

  incrementStaffStat(guildId, userId, userTag, field, delta = 1) {
    const validFields = ['verified_count', 'bans_count', 'mutes_count', 'kicks_count', 'warns_count', 'reports_count'];
    if (!validFields.includes(field)) return;

    this.getStaffStats(guildId, userId); // guarantee row exists
    return getDb().prepare(`
      UPDATE staff_stats
      SET ${field} = ${field} + ?, user_tag = COALESCE(?, user_tag), updated_at = datetime('now')
      WHERE guild_id = ? AND user_id = ?
    `).run(delta, userTag || null, guildId, userId);
  }
};

module.exports = economyRepo;

