/**
 * Команды экономики: /balance, /daily, /work, /pay, /leaderboard, /shop, /buy, /inventory, /eco
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkPermission } = require('./index');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eco')
    .setDescription('Система экономики серверов')
    // Пользовательские команды
    .addSubcommand(sub =>
      sub.setName('balance')
        .setDescription('Посмотреть свой баланс или баланс участника')
        .addUserOption(opt => opt.setName('user').setDescription('Пользователь'))
    )
    .addSubcommand(sub =>
      sub.setName('daily')
        .setDescription('Получить ежедневную награду')
    )
    .addSubcommand(sub =>
      sub.setName('work')
        .setDescription('Поработать и заработать монет')
    )
    .addSubcommand(sub =>
      sub.setName('pay')
        .setDescription('Перевести средства другому пользователю')
        .addUserOption(opt => opt.setName('target').setDescription('Получатель').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Сумма перевода').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('leaderboard')
        .setDescription('Таблица лидеров по балансу')
    )
    .addSubcommand(sub =>
      sub.setName('shop')
        .setDescription('Открыть магазин товаров и ролей')
    )
    .addSubcommand(sub =>
      sub.setName('buy')
        .setDescription('Купить товар в магазине')
        .addIntegerOption(opt => opt.setName('item_id').setDescription('ID товара в магазине').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('inventory')
        .setDescription('Посмотреть купленные предметы')
    )
    // Административные команды
    .addSubcommand(sub =>
      sub.setName('give')
        .setDescription('[Admin] Выдать монеты пользователю')
        .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Сумма').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Причина выдачи').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('take')
        .setDescription('[Admin] Списать монеты у пользователя')
        .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Сумма').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Причина списания').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('[Admin] Установить точный баланс')
        .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Новый баланс').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Причина').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('reset')
        .setDescription('[Admin] Обнулить баланс пользователя')
        .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Причина обнуления').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const eco = client.modules.economy;

    // --- /eco balance ---
    if (sub === 'balance') {
      const target = interaction.options.getUser('user') || interaction.user;
      const wallet = await eco.getBalance(target.id);
      const config = eco.getSettings(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle(`Баланс — ${target.tag}`)
        .setColor(0xC8A96A)
        .addFields(
          { name: 'На руках', value: `${wallet.balance.toLocaleString('ru-RU')} ${config.currencySymbol}`, inline: true },
          { name: 'В банке', value: `${wallet.bank.toLocaleString('ru-RU')} ${config.currencySymbol}`, inline: true },
          { name: 'Всего заработано', value: `${wallet.total_earned.toLocaleString('ru-RU')} ${config.currencySymbol}`, inline: true }
        )
        .setThumbnail(target.displayAvatarURL());

      return interaction.reply({ embeds: [embed] });
    }

    // --- /eco daily ---
    if (sub === 'daily') {
      const res = await eco.daily(interaction.user.id);
      if (!res.ok) {
        return interaction.reply({ content: res.message, ephemeral: true });
      }
      return interaction.reply({
        content: `Вы получили ежедневную награду: **+${res.reward} ${res.currency}**! Ваш новый баланс: **${res.newBalance} ${res.currency}**.`
      });
    }

    // --- /eco work ---
    if (sub === 'work') {
      const res = await eco.work(interaction.user.id);
      if (!res.ok) {
        return interaction.reply({ content: res.message, ephemeral: true });
      }
      return interaction.reply({
        content: `Вы успешно поработали и заработали: **+${res.earnings} ${res.currency}**! Новый баланс: **${res.newBalance} ${res.currency}**.`
      });
    }

    // --- /eco pay ---
    if (sub === 'pay') {
      const targetUser = interaction.options.getUser('target');
      const amount = interaction.options.getInteger('amount');

      if (targetUser.bot) {
        return interaction.reply({ content: 'Нельзя переводить средства ботам.', ephemeral: true });
      }

      const res = await eco.pay(interaction.user, targetUser.id, amount, interaction.guildId);
      if (!res.ok) {
        return interaction.reply({ content: `Ошибка: ${res.message}`, ephemeral: true });
      }

      return interaction.reply({
        content: `Вы успешно перевели **${res.sent} ${res.currency}** участнику <@${targetUser.id}> (Комиссия: ${res.tax} ${res.currency}, получено: ${res.received} ${res.currency}).`
      });
    }

    // --- /eco leaderboard ---
    if (sub === 'leaderboard') {
      const top = await eco.getLeaderboard(10);
      const config = eco.getSettings(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle('Таблица лидеров по богатству')
        .setColor(0xC8A96A);

      let desc = '';
      for (let i = 0; i < top.length; i++) {
        const row = top[i];
        desc += `**${i + 1}.** <@${row.user_id}> — **${row.total.toLocaleString('ru-RU')}** ${config.currencySymbol}\n`;
      }
      embed.setDescription(desc || 'Пока нет данных');

      return interaction.reply({ embeds: [embed] });
    }

    // --- /eco shop ---
    if (sub === 'shop') {
      const items = await eco.getShop(true);
      const config = eco.getSettings(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle('Магазин товаров и ролей')
        .setColor(0xC8A96A);

      if (!items.length) {
        embed.setDescription('В данный момент магазин пуст.');
      } else {
        for (const item of items) {
          const stockStr = item.stock !== null ? `Остаток: ${item.stock} шт.` : 'Неограниченно';
          const roleStr = item.role_id ? `Роль: <@&${item.role_id}>` : '';
          embed.addFields({
            name: `[#${item.id}] ${item.name} — ${item.price.toLocaleString('ru-RU')} ${config.currencySymbol}`,
            value: `${item.description || 'Без описания'}\n${roleStr ? roleStr + ' | ' : ''}${stockStr}`
          });
        }
      }

      return interaction.reply({ embeds: [embed] });
    }

    // --- /eco buy ---
    if (sub === 'buy') {
      const itemId = interaction.options.getInteger('item_id');
      const res = await eco.buy(interaction.user.id, itemId, interaction.guild);

      if (!res.ok) {
        return interaction.reply({ content: `Ошибка покупки: ${res.message}`, ephemeral: true });
      }

      return interaction.reply({ content: `Поздравляем! Вы приобрели товар: **${res.item.name}**!` });
    }

    // --- /eco inventory ---
    if (sub === 'inventory') {
      const inv = await eco.getInventory(interaction.user.id);
      const embed = new EmbedBuilder()
        .setTitle(`Инвентарь — ${interaction.user.tag}`)
        .setColor(0xC8A96A);

      if (!inv.length) {
        embed.setDescription('Ваш инвентарь пуст. Загляните в `/eco shop`!');
      } else {
        for (const item of inv) {
          embed.addFields({
            name: `${item.name} (x${item.quantity})`,
            value: item.description || 'Без описания',
            inline: true
          });
        }
      }

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // --- АДМИНИСТРАТИВНЫЕ КОМАНДЫ ---
    if (!checkPermission(interaction, 'admin')) {
      return interaction.reply({ content: 'У вас недостаточно прав для администрирования экономики.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    try {
      if (sub === 'give') {
        const amount = interaction.options.getInteger('amount');
        const res = await eco.give(targetUser.id, amount, reason, interaction.user.tag);
        return interaction.reply({ content: `Выдано **${amount}** монет пользователю <@${targetUser.id}>. Новый баланс: **${res.newBalance}**.` });
      } else if (sub === 'take') {
        const amount = interaction.options.getInteger('amount');
        const res = await eco.take(targetUser.id, amount, reason, interaction.user.tag);
        return interaction.reply({ content: `Списано **${amount}** монет у пользователя <@${targetUser.id}>. Новый баланс: **${res.newBalance}**.` });
      } else if (sub === 'set') {
        const amount = interaction.options.getInteger('amount');
        await eco.set(targetUser.id, amount, reason, interaction.user.tag);
        return interaction.reply({ content: `Баланс пользователя <@${targetUser.id}> установлен на: **${amount}**.` });
      } else if (sub === 'reset') {
        await eco.reset(targetUser.id, reason, interaction.user.tag);
        return interaction.reply({ content: `Баланс пользователя <@${targetUser.id}> сброшен на ноль.` });
      }
    } catch (err) {
      return interaction.reply({ content: `Ошибка: ${err.message}`, ephemeral: true });
    }
  }
};
