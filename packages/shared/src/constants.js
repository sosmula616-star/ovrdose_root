/**
 * Константы проекта root-core
 */

module.exports = {
  // ID серверов по умолчанию
  GUILDS: {
    STAFF: process.env.STAFF_GUILD_ID || '1558608015148716062',
    MAIN:  process.env.MAIN_GUILD_ID  || '1558606862277017690',
  },

  // Уровни доступа к командам
  PERM_LEVELS: {
    OWNER: 'owner',
    ADMIN: 'admin',
    STAFF: 'staff',
    USER:  'user',
  },

  // Роли в веб-панели
  PANEL_ROLES: {
    OWNER:  'owner',
    ADMIN:  'admin',
    VIEWER: 'viewer',
  },

  // Дефолтные настройки экономики
  ECONOMY_DEFAULTS: {
    CURRENCY_NAME: 'монет',
    CURRENCY_SYMBOL: '🪙',
    DAILY_MIN: 100,
    DAILY_MAX: 300,
    DAILY_COOLDOWN: 86400, // 24ч
    WORK_MIN: 50,
    WORK_MAX: 150,
    WORK_COOLDOWN: 3600, // 1ч
    TRANSFER_TAX_PERCENT: 5,
    TRANSFER_LIMIT_DAY: 50000,
    TRANSFER_MIN_AGE_DAYS: 3,
    START_BALANCE: 0,
    ROLE_CREATE_PRICE: 5000,         // Стоимость создания декоративной роли
    MARKETPLACE_TAX_PERCENT: 10,     // Комиссия маркета при продаже роли другому игроку (%)
    VOICE_REWARD_PER_MIN: 5,         // Награда за 1 минуту в голосовом канале
    MESSAGE_REWARD: 2,               // Награда за сообщения в чате
    MESSAGE_COOLDOWN: 30,            // Кулдаун награды за сообщения (сек)
  },

  // Типы событий антикраша и лимиты по умолчанию
  ANTINUKE_EVENTS: {
    CHANNEL_CREATE: 'channel_create',
    CHANNEL_DELETE: 'channel_delete',
    ROLE_CREATE:    'role_create',
    ROLE_DELETE:    'role_delete',
    BAN:            'ban',
    KICK:           'kick',
    WEBHOOK_CREATE: 'webhook_create',
    BOT_ADD:        'bot_add',
    EMOJI_DELETE:   'emoji_delete',
    MASS_MENTION:   'mass_mention',
    RAID_JOIN:      'raid_join',
    INVITE_SPAM:    'invite_spam',
    ADMIN_GRANT:    'admin_grant',
    EVERYONE_PERM:  'everyone_perm',
    GUILD_UPDATE:   'guild_update',
  },

  // Действия реагирования на краш/нюк
  ANTINUKE_ACTIONS: {
    REMOVE_ROLES: 'remove_roles',
    QUARANTINE:   'quarantine',
    KICK:         'kick',
    BAN:          'ban',
    RESTORE:      'restore',
    ALERT:        'alert',
  },

  // Дефолтные лимиты антикраша
  ANTINUKE_DEFAULTS: {
    channel_delete: { limit: 3, window: 10, action: 'quarantine' },
    role_delete:    { limit: 3, window: 10, action: 'quarantine' },
    ban:            { limit: 5, window: 10, action: 'remove_roles' },
    kick:           { limit: 5, window: 10, action: 'remove_roles' },
    webhook_create: { limit: 3, window: 10, action: 'ban' },
    bot_add:        { limit: 1, window: 30, action: 'kick' },
    mass_mention:   { limit: 5, window: 5,  action: 'quarantine' },
    raid_join:      { limit: 15, window: 20, action: 'quarantine' },
  },

  // Интервалы супервизора (в миллисекундах)
  SUPERVISOR: {
    HEARTBEAT_INTERVAL_MS: 15000, // 15 сек
    HEARTBEAT_TIMEOUT_MS:  60000, // 60 сек
    ROLE_SYNC_INTERVAL_MS: 600000, // 10 мин
  }
};
