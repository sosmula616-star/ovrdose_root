/**
 * Загрузчик событий discord.js
 */

const fs = require('fs');
const path = require('path');

function loadEvents(client, logger) {
  const eventsPath = __dirname;
  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js') && f !== 'index.js');

  for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (event && event.name) {
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client, logger));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client, logger));
      }
      logger.info(`[Events] Зарегистрировано событие: ${event.name}`);
    }
  }
}

module.exports = { loadEvents };
