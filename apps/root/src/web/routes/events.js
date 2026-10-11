/**
 * Маршруты Server-Sent Events (SSE) для живых обновлений панели и внешних ботов
 */

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { internalAuth } = require('../middleware/internalAuth');

const panelClients = new Set();
const botClients = new Set();

/**
 * Рассылка события в браузерные вкладки панели
 */
function broadcastPanelEvent(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of panelClients) {
    try { client.write(payload); } catch (e) { panelClients.delete(client); }
  }
}

/**
 * Рассылка события внешним ботам (settings:changed)
 */
function broadcastBotEvent(eventType, data = {}) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of botClients) {
    try { client.write(payload); } catch (e) { botClients.delete(client); }
  }
}

// Алиас для обратной совместимости
const publishEvent = broadcastPanelEvent;

// SSE для веб-панели
router.get('/', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  panelClients.add(res);

  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    panelClients.delete(res);
  });
});

// SSE для внешних ботов (@root-core/bot-client)
router.get('/internal', internalAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  botClients.add(res);

  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    botClients.delete(res);
  });
});

// Экспортируем роутер как функцию-обработчик и прикрепляем утилиты
router.router = router;
router.broadcastPanelEvent = broadcastPanelEvent;
router.broadcastBotEvent = broadcastBotEvent;
router.publishEvent = publishEvent;

module.exports = router;
