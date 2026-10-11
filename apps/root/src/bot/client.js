/**
 * Инициализация клиента Discord.js v14 для бота Root
 */

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');

function createBotClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,         // Привилегированный: для синхронизации ролей и антирейда
      GatewayIntentBits.GuildModeration,      // Для отслеживания Audit Log (антикраш и супервизор)
      GatewayIntentBits.GuildEmojisAndStickers,
      GatewayIntentBits.GuildWebhooks,
      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,       // Привилегированный
    ],
    partials: [
      Partials.GuildMember,
      Partials.User,
      Partials.Channel,
      Partials.Message,
    ],
    allowedMentions: { parse: ['users'], repliedUser: false },
  });

  client.commands = new Collection();
  client.modules = {}; // Ссылки на активные модули (sync, economy, antinuke, etc.)

  return client;
}

module.exports = { createBotClient };
