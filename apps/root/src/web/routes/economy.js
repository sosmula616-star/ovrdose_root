/**
 * API маршруты экономики (вызывает методы модуля Root economy напрямую)
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { economy: ecoRepo, settings: settingsRepo } = require('@root-core/db');

// Сводная статистика
router.get('/stats', canView, async (req, res) => {
  const eco = req.app.locals.client?.modules?.economy;
  const top10 = eco ? await eco.getLeaderboard(10) : [];
  const items = eco ? await eco.getShop(false) : [];
  const config = eco ? eco.getSettings(req.query.guildId) : {};

  res.json({
    totalBalance: top10.reduce((acc, u) => acc + (u.balance || 0), 0),
    activeWallets: top10.length,
    transactionsCount: 0,
    top10,
    items,
    config,
  });
});

// Таблица лидеров
router.get('/leaderboard', canView, async (req, res) => {
  const limit = parseInt(req.query.limit || '10', 10);
  const eco = req.app.locals.client?.modules?.economy;
  const top = eco ? await eco.getLeaderboard(limit) : [];
  res.json(top);
});

// Магазин
router.get('/shop', canView, async (req, res) => {
  const eco = req.app.locals.client?.modules?.economy;
  const items = eco ? await eco.getShop(false) : [];
  res.json(items);
});

// Настройки экономики
router.get('/settings', canView, (req, res) => {
  const gid = req.query.guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';
  const eco = req.app.locals.client?.modules?.economy;
  res.json(eco ? eco.getSettings(gid) : {});
});

const handleSaveSettings = (req, res) => {
  const { guildId, settings } = req.body;
  const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  for (const [k, v] of Object.entries(settings || req.body || {})) {
    if (k !== 'guildId') {
      settingsRepo.set(gid, 'root', k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  }

  recordAudit(req, 'Обновлены настройки экономики', 'economy', { newValue: req.body });
  res.json({ ok: true, message: 'Настройки экономики сохранены' });
};

router.post('/settings', canEdit, handleSaveSettings);
router.put('/settings', canEdit, handleSaveSettings);

// Баланс и кошелек пользователя
const handleGetWallet = async (req, res) => {
  const { userId } = req.params;
  const eco = req.app.locals.client?.modules?.economy;
  if (!eco) return res.status(503).json({ error: 'Модуль экономики недоступен' });

  const wallet = await eco.getBalance(userId);
  const inventory = await eco.getInventory(userId);
  const tx = ecoRepo.getTransactions(userId, 20);

  res.json({ wallet, inventory, transactions: tx.items });
};

router.get('/wallets/:userId', canView, handleGetWallet);
router.get('/user/:userId', canView, handleGetWallet);

// Изменение баланса пользователя
router.post('/wallets/:userId/:action', canEdit, async (req, res) => {
  const { userId, action } = req.params;
  const { amount, reason } = req.body;
  const eco = req.app.locals.client?.modules?.economy;
  const adminTag = req.session?.user?.discord_tag || 'Admin';

  if (!eco) return res.status(503).json({ error: 'Модуль экономики недоступен' });
  const numAmount = parseInt(amount, 10);

  try {
    let result = null;
    if (action === 'give') {
      result = await eco.give(userId, numAmount, reason || 'Выдача из веб-панели', adminTag);
    } else if (action === 'take') {
      result = await eco.take(userId, numAmount, reason || 'Списание из веб-панели', adminTag);
    } else if (action === 'set') {
      result = await eco.set(userId, numAmount, reason || 'Установка баланса из веб-панели', adminTag);
    } else if (action === 'reset') {
      result = await eco.reset(userId, reason || 'Сброс баланса из веб-панели', adminTag);
    } else {
      return res.status(400).json({ error: 'Неизвестное действие над кошельком' });
    }

    recordAudit(req, `Экономика: ${action} ${amount} для ${userId}`, 'economy', { newValue: req.body });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/balance', canEdit, async (req, res) => {
  const { userId, action, amount, reason } = req.body;
  const eco = req.app.locals.client?.modules?.economy;
  const adminTag = req.session?.user?.discord_tag || 'Admin';

  if (!userId || !reason || amount === undefined) {
    return res.status(400).json({ error: 'Параметры userId, amount и обязательная причина требуются' });
  }

  const numAmount = parseInt(amount, 10);
  try {
    let result = null;
    if (action === 'give') {
      result = await eco.give(userId, numAmount, reason, adminTag);
    } else if (action === 'take') {
      result = await eco.take(userId, numAmount, reason, adminTag);
    } else if (action === 'set') {
      result = await eco.set(userId, numAmount, reason, adminTag);
    } else if (action === 'reset') {
      result = await eco.reset(userId, reason, adminTag);
    } else {
      return res.status(400).json({ error: 'Неизвестное действие над балансом' });
    }

    recordAudit(req, `Экономика: ${action} ${amount} для ${userId}`, 'economy', { newValue: req.body });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Транзакции
router.get('/transactions', canView, (req, res) => {
  const { userId, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const result = ecoRepo.getTransactions(userId || null, Number(limit), offset);
  res.json({ ...result, page: Number(page) });
});

// Магазин: добавление, изменение, удаление товаров
router.post('/shop', canEdit, (req, res) => {
  const { name, price, description, roleId, stock } = req.body;
  const parsedPrice = parseInt(price, 10);
  const parsedStock = stock ? parseInt(stock, 10) : null;

  try {
    const result = ecoRepo.addShopItem(name, parsedPrice, description || '', roleId || null, parsedStock);
    recordAudit(req, `Добавлен товар в магазин: ${name}`, 'economy', { newValue: req.body });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/shop/:id', canEdit, (req, res) => {
  ecoRepo.updateShopItem(req.params.id, req.body);
  recordAudit(req, `Изменен товар магазина #${req.params.id}`, 'economy', { newValue: req.body });
  res.json({ ok: true });
});

router.delete('/shop/:id', canEdit, (req, res) => {
  ecoRepo.deleteShopItem(req.params.id);
  recordAudit(req, `Удален товар магазина #${req.params.id}`, 'economy');
  res.json({ ok: true });
});

module.exports = router;
