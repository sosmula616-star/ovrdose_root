/**
 * Загрузчик и регистратор Slash-команд бота Root
 */

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

/**
 * Загрузка всех команд из текущей папки
 */
function loadCommands(client, logger) {
  const commandsPath = __dirname;
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js') && f !== 'index.js');

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command && command.data) {
      client.commands.set(command.data.name, command);
      logger.info(`[Commands] Загружена команда /${command.data.name}`);
    }
  }
}

/**
 * Регистрация команд через Discord REST API для серверов Staff и Main
 */
async function registerCommands(client, logger) {
  const token = process.env.DISCORD_TOKEN_ROOT;
  const clientId = process.env.DISCORD_CLIENT_ID_ROOT;

  if (!token || !clientId) {
    logger.warn('[Commands] Пропуск регистрации слэш-команд: нет DISCORD_TOKEN_ROOT или DISCORD_CLIENT_ID_ROOT');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const commandsBody = client.commands.map(cmd => cmd.data.toJSON());

  const guilds = [
    process.env.STAFF_GUILD_ID || '1558608015148716062',
    process.env.MAIN_GUILD_ID  || '1558606862277017690',
  ].filter(Boolean);

  for (const guildId of guilds) {
    try {
      logger.info(`[Commands] Регистрация ${commandsBody.length} слэш-команд на сервере ${guildId}...`);
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commandsBody }
      );
      logger.info(`[Commands] Успешно зарегистрированы команды для сервера ${guildId}`);
    } catch (err) {
      logger.error(`[Commands] Ошибка регистрации команд на сервере ${guildId}: ${err.message}`);
    }
  }
}

/**
 * Проверка прав пользователя на выполнение команды
 */
function checkPermission(interaction, requiredLevel = 'staff') {
  const ownerIds = (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const userId = interaction.user.id;

  if (ownerIds.includes(userId)) return true; // Владелец может всё

  if (requiredLevel === 'owner') return false;

  const member = interaction.member;
  if (!member) return false;

  if (requiredLevel === 'admin') {
    return member.permissions.has('Administrator');
  }

  if (requiredLevel === 'staff') {
    return member.permissions.has('ManageGuild') || member.permissions.has('ModerateMembers') || member.permissions.has('Administrator');
  }

  return true; // level === 'user'
}

module.exports = {
  loadCommands,
  registerCommands,
  checkPermission,
};
