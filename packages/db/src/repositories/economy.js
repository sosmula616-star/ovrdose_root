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
  }
};

module.exports = economyRepo;
