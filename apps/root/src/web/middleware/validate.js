/**
 * Валидация и санитизация входящих данных
 */

const { isSnowflake } = require('@root-core/shared').validators;

function sanitizeString(str, maxLen = 2000) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function validate(rules) {
  return (req, res, next) => {
    const body = req.body || {};
    const errors = [];

    for (const [field, validator] of Object.entries(rules)) {
      const value = body[field];
      const result = validator(value, body);
      if (result !== true) {
        errors.push({ field, message: result });
      }
    }

    if (errors.length > 0) {
      return res.status(422).json({ error: 'Ошибка валидации данных', details: errors });
    }

    next();
  };
}

const rule = {
  snowflake: (msg = 'Некорректный Discord ID') => v => isSnowflake(v) || msg,
  snowflakeOpt: () => v => (!v || isSnowflake(v)) || 'Некорректный Discord ID',
  required: (label = 'Поле') => v => (typeof v === 'string' && v.trim().length > 0) || `${label} обязательно для заполнения`,
  oneOf: (values, label = 'Поле') => v => values.includes(v) || `${label}: допустимо одно из [${values.join(', ')}]`,
  positiveInt: (label = 'Число') => v => (!isNaN(parseInt(v, 10)) && parseInt(v, 10) >= 0) || `${label} должно быть целым положительным числом`,
};

module.exports = {
  sanitizeString,
  validate,
  rule,
};
