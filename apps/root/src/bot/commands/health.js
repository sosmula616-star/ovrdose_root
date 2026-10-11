/**
 * Команда /health - Диагностика состояния бота, базы данных и веб-панели
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('@root-core/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Проверка состояния бота Root, базы данных и веб-панели'),

  async execute(interaction, client) {
    let dbStatus = 'OK';
    let walMode = 'unknown';

    try {
      const db = getDb();
      const walRow = db.pragma('journal_mode');
      walMode = walRow[0]?.journal_mode || 'unknown';
    } catch (e) {
      dbStatus = `Error: ${e.message}`;
    }

    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    const uptimeStr = `${hours}ч ${minutes}м ${seconds}с`;

    const ramMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);

    const embed = new EmbedBuilder()
      .setTitle('Состояние системы Root-Core')
      .setColor(0xC8A96A) // Приглушенное золото
      .addFields(
        { name: 'Root Bot Ping', value: `${client.ws.ping} ms`, inline: true },
        { name: 'RAM (RSS)', value: `${ramMb} MB`, inline: true },
        { name: 'Uptime', value: uptimeStr, inline: true },
        { name: 'База данных', value: `${dbStatus} (WAL: ${walMode})`, inline: true },
        { name: 'Веб-панель', value: `${process.env.PANEL_BASE_URL || 'http://127.0.0.1:3000'}`, inline: true },
        { name: 'Серверы', value: `${client.guilds.cache.size}`, inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
