/**
 * Команда /bots - Управление ботами и их модулями
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkPermission } = require('./index');
const { bots: botsRepo } = require('@root-core/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bots')
    .setDescription('Управление ботами Root-Core')
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Список всех зарегистрированных ботов и их статусы')
    )
    .addSubcommand(sub =>
      sub.setName('restart')
        .setDescription('Перезапустить бота')
        .addStringOption(opt => opt.setName('name').setDescription('Имя бота').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('stop')
        .setDescription('Остановить процесс бота')
        .addStringOption(opt => opt.setName('name').setDescription('Имя бота').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Запустить процесс бота')
        .addStringOption(opt => opt.setName('name').setDescription('Имя бота').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('module')
        .setDescription('Включить или выключить модуль бота')
        .addStringOption(opt => opt.setName('bot').setDescription('Имя бота').setRequired(true))
        .addStringOption(opt => opt.setName('module').setDescription('Имя модуля').setRequired(true))
        .addBooleanOption(opt => opt.setName('enabled').setDescription('Включен ли модуль').setRequired(true))
    ),

  async execute(interaction, client) {
    if (!checkPermission(interaction, 'admin')) {
      return interaction.reply({ content: 'У вас недостаточно прав для управления ботами.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const botManager = client.modules.botmanager;

    if (sub === 'list') {
      const bots = botsRepo.getAllBots();
      const embed = new EmbedBuilder()
        .setTitle('Реестр ботов Root-Core')
        .setColor(0xC8A96A);

      for (const b of bots) {
        const hb = botsRepo.getLatestHeartbeat(b.name);
        const ping = hb ? `${hb.ping_ms} ms` : '—';
        const ram = hb ? `${hb.ram_mb} MB` : '—';
        embed.addFields({
          name: `${b.name.toUpperCase()} [${b.status.toUpperCase()}]`,
          value: `Тип: \`${b.type}\` | PM2: \`${b.pm2_name || '—'}\`\nPing: \`${ping}\` | RAM: \`${ram}\``,
        });
      }

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const botName = interaction.options.getString('name') || interaction.options.getString('bot');

    await interaction.deferReply({ ephemeral: true });

    try {
      if (sub === 'restart') {
        const res = await botManager.restartBot(botName);
        await interaction.editReply({ content: `✅ ${res.message}` });
      } else if (sub === 'stop') {
        const res = await botManager.stopBot(botName);
        await interaction.editReply({ content: `🛑 ${res.message}` });
      } else if (sub === 'start') {
        const res = await botManager.startBot(botName);
        await interaction.editReply({ content: `🚀 ${res.message}` });
      } else if (sub === 'module') {
        const moduleName = interaction.options.getString('module');
        const enabled = interaction.options.getBoolean('enabled');
        await botManager.toggleModule(botName, moduleName, enabled, interaction.guildId);
        await interaction.editReply({ content: `Модуль \`${botName}.${moduleName}\` переключен на: **${enabled ? 'ВКЛ' : 'ВЫКЛ'}**` });
      }
    } catch (err) {
      await interaction.editReply({ content: `Ошибка: ${err.message}` });
    }
  }
};
