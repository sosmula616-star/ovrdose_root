/**
 * Единый логгер системы Root-Core на базе Winston
 */

const winston = require('winston');

function createLogger(serviceName = 'root') {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] [${serviceName.toUpperCase()}] [${level.toUpperCase()}]: ${message}${metaStr}`;
      })
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `[${timestamp}] [${serviceName}] ${level}: ${message}${metaStr}`;
          })
        ),
      })
    ],
  });
}

module.exports = { createLogger };
