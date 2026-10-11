/**
 * Общие валидаторы настроек и входных данных для панели и ботов
 */

const { ECONOMY_DEFAULTS } = require('./constants');

/**
 * Проверка Discord Snowflake ID (17-20 цифр)
 */
function isSnowflake(val) {
  return typeof val === 'string' && /^\d{17,20}$/.test(val.trim());
}

/**
 * Безопасное приведение к числу с диапазоном и дефолтом
 */
function clampInt(val, min, max, defaultVal) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return defaultVal;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Безопасное приведение к Boolean
 */
function toBoolean(val, defaultVal = false) {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * Валидация настроек экономики с гарантированными дефолтами
 */
function parseEconomySettings(rawSettings = {}) {
  return {
    currencyName:          String(rawSettings['eco_currency_name'] || ECONOMY_DEFAULTS.CURRENCY_NAME).slice(0, 32),
    currencySymbol:        String(rawSettings['eco_currency_symbol'] || ECONOMY_DEFAULTS.CURRENCY_SYMBOL).slice(0, 8),
    dailyMin:              clampInt(rawSettings['eco_daily_min'], 1, 1000000, ECONOMY_DEFAULTS.DAILY_MIN),
    dailyMax:              clampInt(rawSettings['eco_daily_max'], 1, 1000000, ECONOMY_DEFAULTS.DAILY_MAX),
    dailyCooldown:         clampInt(rawSettings['eco_daily_cooldown'], 60, 604800, ECONOMY_DEFAULTS.DAILY_COOLDOWN),
    workMin:               clampInt(rawSettings['eco_work_min'], 1, 1000000, ECONOMY_DEFAULTS.WORK_MIN),
    workMax:               clampInt(rawSettings['eco_work_max'], 1, 1000000, ECONOMY_DEFAULTS.WORK_MAX),
    workCooldown:          clampInt(rawSettings['eco_work_cooldown'], 60, 86400, ECONOMY_DEFAULTS.WORK_COOLDOWN),
    transferTaxPercent:    clampInt(rawSettings['eco_transfer_tax_percent'], 0, 50, ECONOMY_DEFAULTS.TRANSFER_TAX_PERCENT),
    transferLimitDay:      clampInt(rawSettings['eco_transfer_limit_day'], 0, 100000000, ECONOMY_DEFAULTS.TRANSFER_LIMIT_DAY),
    transferMinAgeDays:    clampInt(rawSettings['eco_transfer_min_age_days'], 0, 365, ECONOMY_DEFAULTS.TRANSFER_MIN_AGE_DAYS),
    startBalance:          clampInt(rawSettings['eco_start_balance'], 0, 1000000, ECONOMY_DEFAULTS.START_BALANCE),
    roleCreatePrice:       clampInt(rawSettings['eco_role_create_price'], 0, 10000000, ECONOMY_DEFAULTS.ROLE_CREATE_PRICE),
    roleRenamePrice:       clampInt(rawSettings['eco_role_rename_price'], 0, 1000000, ECONOMY_DEFAULTS.ROLE_RENAME_PRICE),
    roleColorPrice:        clampInt(rawSettings['eco_role_color_price'], 0, 1000000, ECONOMY_DEFAULTS.ROLE_COLOR_PRICE),
    roleIconPrice:         clampInt(rawSettings['eco_role_icon_price'], 0, 10000000, ECONOMY_DEFAULTS.ROLE_ICON_PRICE),
    roleGradientPrice:     clampInt(rawSettings['eco_role_gradient_price'], 0, 10000000, ECONOMY_DEFAULTS.ROLE_GRADIENT_PRICE),
    maxCustomRolesPerUser: clampInt(rawSettings['eco_max_roles_per_user'], 1, 10, ECONOMY_DEFAULTS.MAX_CUSTOM_ROLES_PER_USER),
    marketplaceTaxPercent: clampInt(rawSettings['eco_market_tax_percent'], 0, 100, ECONOMY_DEFAULTS.MARKETPLACE_TAX_PERCENT),
    voiceRewardPerMin:     clampInt(rawSettings['eco_voice_reward'], 0, 1000, ECONOMY_DEFAULTS.VOICE_REWARD_PER_MIN),
    messageReward:         clampInt(rawSettings['eco_chat_reward'], 0, 1000, ECONOMY_DEFAULTS.MESSAGE_REWARD),
    messageCooldown:       clampInt(rawSettings['eco_chat_cooldown'], 5, 3600, ECONOMY_DEFAULTS.MESSAGE_COOLDOWN),
  };
}

/**
 * Валидация правил антикраша
 */
function parseAntinukeRule(rule = {}) {
  const allowedActions = ['remove_roles', 'quarantine', 'kick', 'ban', 'restore', 'alert'];
  return {
    limit:   clampInt(rule.limit, 1, 100, 5),
    window:  clampInt(rule.window, 1, 300, 10),
    action:  allowedActions.includes(rule.action) ? rule.action : 'quarantine',
    enabled: toBoolean(rule.enabled, true),
  };
}

module.exports = {
  isSnowflake,
  clampInt,
  toBoolean,
  parseEconomySettings,
  parseAntinukeRule,
};
