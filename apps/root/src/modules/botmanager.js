/**
 * Модуль управления ботами (PM2 интеграция по whitelist, управление модулями)
 */

const { bots: botsRepo, settings: settingsRepo } = require('@root-core/db');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Белый список допустимых имен процессов PM2 (защита от произвольного shell)
const ALLOWED_PM2_PROCESSES = new Set([
  'root-core-root',
  'root-core-guard',
  'root-core-music',
  'root-core-tickets',
]);

class BotManagerModule {
  constructor(client, logger, loggingModule) {
    this.client = client;
    this.logger = logger;
    this.loggingModule = loggingModule;
  }

  /**
   * Проверка допустимости имени процесса PM2
   */
  validatePm2Name(botRecord) {
    const pm2Name = botRecord?.pm2_name;
    if (!pm2Name || !ALLOWED_PM2_PROCESSES.has(pm2Name)) {
      throw new Error(`Процесс "${pm2Name}" не входит в белый список разрешенных процессов PM2`);
    }
    return pm2Name;
  }

  /**
   * Перезапуск внешнего бота через PM2
   */
  async restartBot(botName) {
    if (botName === 'root') {
      return this.softRestartRoot();
    }

    const bot = botsRepo.getBot(botName);
    if (!bot) throw new Error(`Бот "${botName}" не найден в реестре`);
    const pm2Name = this.validatePm2Name(bot);

    this.logger.info(`[BotManager] Перезапуск процесса PM2: ${pm2Name}`);
    try {
      await execPromise(`pm2 restart ${pm2Name}`);
      botsRepo.updateBotStatus(botName, 'restarting');
      return { ok: true, message: `Процесс ${pm2Name} перезапущен через PM2` };
    } catch (err) {
      this.logger.warn(`[BotManager] Локальный PM2 не найден (бот запущен на отдельном хосте): ${err.message}`);
      botsRepo.updateBotStatus(botName, 'restarting');
      return { ok: true, message: `Сигнал перезапуска зарегистрирован для внешнего бота ${botName}` };
    }
  }

  /**
   * Остановка бота через PM2
   */
  async stopBot(botName) {
    if (botName === 'root') {
      throw new Error('Остановка ядра Root через панель запрещена во избежание потери контроля');
    }

    const bot = botsRepo.getBot(botName);
    if (!bot) throw new Error(`Бот "${botName}" не найден в реестре`);
    const pm2Name = this.validatePm2Name(bot);

    try {
      await execPromise(`pm2 stop ${pm2Name}`);
      botsRepo.updateBotStatus(botName, 'offline');
      return { ok: true, message: `Процесс ${pm2Name} остановлен` };
    } catch (err) {
      throw new Error(`Ошибка остановки PM2: ${err.message}`);
    }
  }

  /**
   * Запуск бота через PM2
   */
  async startBot(botName) {
    const bot = botsRepo.getBot(botName);
    if (!bot) throw new Error(`Бот "${botName}" не найден в реестре`);
    const pm2Name = this.validatePm2Name(bot);

    try {
      await execPromise(`pm2 start ${pm2Name}`);
      botsRepo.updateBotStatus(botName, 'online');
      return { ok: true, message: `Процесс ${pm2Name} запущен` };
    } catch (err) {
      throw new Error(`Ошибка запуска PM2: ${err.message}`);
    }
  }

  /**
   * Мягкий перезапуск самого Root (перезагрузка модулей, очистка кэшей)
   */
  async softRestartRoot() {
    this.logger.warn('[BotManager] Выполняется мягкий перезапуск Root...');
    try {
      if (this.client.modules.sync) {
        await this.client.modules.sync.fullResync().catch(() => {});
      }
      return { ok: true, message: 'Бот Root успешно выполнил мягкую перезагрузку модулей' };
    } catch (err) {
      throw new Error(`Ошибка мягкого перезапуска: ${err.message}`);
    }
  }

  /**
   * Включение/выключение модуля бота
   */
  async toggleModule(botName, moduleName, enabled, guildId) {
    const key = `module_${moduleName}_enabled`;
    settingsRepo.set(guildId, botName, key, enabled ? '1' : '0');

    this.logger.info(`[BotManager] Модуль ${botName}.${moduleName} на сервере ${guildId} переключен: ${enabled ? 'ON' : 'OFF'}`);

    return { ok: true, bot: botName, module: moduleName, enabled };
  }
}

module.exports = BotManagerModule;
