/**
 * @root-core/bot-client - Клиентская библиотека для внешних ботов (Guard, Music, Tickets)
 * Обеспечивает отправку Heartbeat, чтение настроек, hot reload и логирование действий.
 */

const fetch = globalThis.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)));
const EventEmitter = require('events');

class ExternalBotClient extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.botName - Уникальное имя бота ('guard', etc.)
   * @param {string} options.apiBaseUrl - Базовый URL панели Root (дефолт: http://127.0.0.1:3000)
   * @param {string} options.internalToken - Секретный INTERNAL_API_TOKEN
   * @param {object} [options.discordClient] - Экземпляр discord.js Client для автоматического сбора метрик
   */
  constructor({ botName, apiBaseUrl = 'http://127.0.0.1:3000', internalToken, discordClient = null }) {
    super();
    this.botName = botName;
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
    this.internalToken = internalToken;
    this.discordClient = discordClient;

    this.settingsCache = new Map();
    this.heartbeatTimer = null;
    this.pollTimer = null;
    this.sseConnection = null;
    this.lastSettingsHash = '';
  }

  /**
   * Заголовки авторизации
   */
  get headers() {
    return {
      'Authorization': `Bearer ${this.internalToken}`,
      'Content-Type':  'application/json',
      'X-Bot-Name':    this.botName,
    };
  }

  /**
   * Запуск отправки Heartbeat раз в 15 секунд
   */
  startHeartbeat(intervalMs = 15000) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    const send = async () => {
      try {
        const ping = this.discordClient?.ws?.ping ?? 0;
        const ram = process.memoryUsage().rss / (1024 * 1024);
        const uptime = Math.floor(process.uptime());
        const guildCount = this.discordClient?.guilds?.cache?.size ?? 0;

        await fetch(`${this.apiBaseUrl}/api/internal/heartbeat`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({
            bot:        this.botName,
            pingMs:     ping >= 0 ? ping : 0,
            ramMb:      parseFloat(ram.toFixed(1)),
            uptimeSec:  uptime,
            guildCount: guildCount,
          }),
        });
      } catch (err) {
        // Ошибки соединения не ломают бота
      }
    };

    send();
    this.heartbeatTimer = setInterval(send, intervalMs);
  }

  /**
   * Остановка Heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Получить настройки для сервера
   */
  async getSettings(guildId) {
    try {
      const res = await fetch(`${this.apiBaseUrl}/api/internal/settings?guildId=${guildId}&bot=${this.botName}`, {
        headers: this.headers,
      });
      if (res.ok) {
        const data = await res.json();
        this.settingsCache.set(guildId, data);
        return data;
      }
    } catch (err) {}

    return this.settingsCache.get(guildId) || {};
  }

  /**
   * Запуск слушателя hot reload (SSE с фолбеком на опрос раз в 5 сек)
   */
  startHotReload(fallbackPollIntervalMs = 5000) {
    this.connectSse();

    // Запасной опрос раз в 5 сек на случай сбоя SSE
    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${this.apiBaseUrl}/api/internal/settings/version?bot=${this.botName}`, {
          headers: this.headers,
        });
        if (res.ok) {
          const { hash } = await res.json();
          if (hash && hash !== this.lastSettingsHash) {
            this.lastSettingsHash = hash;
            this.emit('settings:changed');
          }
        }
      } catch (e) {}
    }, fallbackPollIntervalMs);
  }

  /**
   * Подключение к Server-Sent Events
   */
  connectSse() {
    // Внутренний механизм SSE через поток
    // При получении 'settings:changed' сбрасываем кэш и эмиттим событие
    const url = `${this.apiBaseUrl}/api/internal/events?bot=${this.botName}&token=${encodeURIComponent(this.internalToken)}`;
    
    fetch(url).then(res => {
      if (!res.ok) return;
      res.body.on('data', chunk => {
        const text = chunk.toString();
        if (text.includes('settings:changed')) {
          this.settingsCache.clear();
          this.emit('settings:changed');
        }
      });
      res.body.on('error', () => setTimeout(() => this.connectSse(), 5000));
      res.body.on('end', () => setTimeout(() => this.connectSse(), 5000));
    }).catch(() => {
      setTimeout(() => this.connectSse(), 5000);
    });
  }

  /**
   * Запись действия бота для супервизора
   */
  async recordAction(guildId, actionType, targetId = null, details = {}) {
    try {
      await fetch(`${this.apiBaseUrl}/api/internal/action`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          botId:      this.discordClient?.user?.id || this.botName,
          botName:    this.botName,
          guildId:    guildId,
          actionType: actionType,
          targetId:   targetId,
          details:    details,
        }),
      });
    } catch (e) {}
  }

  /**
   * Очистка ресурсов
   */
  destroy() {
    this.stopHeartbeat();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.removeAllListeners();
  }
}

module.exports = { ExternalBotClient };
