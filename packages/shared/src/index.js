/**
 * @root-core/shared - Общие модули
 */

const constants  = require('./constants');
const validators = require('./validators');
const { createLogger } = require('./logger');

module.exports = {
  constants,
  validators,
  createLogger,
};
