/**
 * API маршруты экономики (вызывает методы модуля Root economy напрямую)
 */

const router = require('express').Router();
const { canView, canEdit } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { economy: ecoRepo, settings: settingsRepo } = require('@root-core/db');

router.get('/stats', canView, async (req, res) => {
  const eco = req.app.locals.client.modules.economy;
  const top10 = await eco.getLeaderboard(10);
  const items = await eco.getShop(false);
  const config = eco.getSettings(req.query.guildId);

  res.json({ top10, items, config });
});

router.get('/user/:userId', canView, async (req, res) => {
  const eco = req.app.locals.client.modules.economy;
  const wallet = await eco.getBalance(req.params.userId);
  const inventory = await eco.getInventory(req.params.userId);
  const tx = ecoRepo.getTransactions(req.params.userId, 20);

  res.json({ wallet, inventory, transactions: tx.items });
});

router.post('/balance', canEdit, async (req, res) => {
  const { userId, action, amount, reason } = req.body;
  const eco = req.app.locals.client.modules.economy;
  const adminTag = req.session.user.discord_tag;

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

router.get('/transactions', canView, (req, res) => {
  const { userId, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const result = ecoRepo.getTransactions(userId || null, Number(limit), offset);
  res.json({ ...result, page: Number(page) });
});

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

router.put('/settings', canEdit, (req, res) => {
  const { guildId, settings } = req.body;
  const gid = guildId || process.env.MAIN_GUILD_ID || '1558606862277017690';

  for (const [k, v] of Object.entries(settings || {})) {
    settingsRepo.set(gid, 'root', k, v);
  }

  recordAudit(req, 'Обновлены настройки экономики', 'economy', { newValue: settings });
  res.json({ ok: true });
});

module.exports = router;
