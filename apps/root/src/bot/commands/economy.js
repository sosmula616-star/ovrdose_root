/**
 * Команды экономики: /eco balance, /eco profile, /eco staffprofile, /eco daily, /eco work, /eco pay, /eco leaderboard, /eco market, /eco buy
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkPermission } = require('./index');
const { economy: ecoRepo } = require('@root-core/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eco')
    .setDescription('Система экономики, ролей и профилей')
    // Профиль участника
    .addSubcommand(sub =>
      sub.setName('profile')
        .setDescription('Посмотреть красивую карточку профиля')
        .addUserOption(opt => opt.setName('user').setDescription('Пользователь'))
    )
    // Служебный профиль стаффа
    .addSubcommand(sub =>
      sub.setName('staffprofile')
        .setDescription('Служебная карточка модератора (только для персонала)')
        .addUserOption(opt => opt.setName('user').setDescription('Модератор'))
    )
    // Баланс
    .addSubcommand(sub =>
      sub.setName('balance')
        .setDescription('Посмотреть баланс монет')
        .addUserOption(opt => opt.setName('user').setDescription('Пользователь'))
    )
    // Ежедневная награда
    .addSubcommand(sub =>
      sub.setName('daily')
        .setDescription('Получить ежедневную награду монет')
    )
    // Заработок
    .addSubcommand(sub =>
      sub.setName('work')
        .setDescription('Поработать и заработать монет')
    )
    // Перевод
    .addSubcommand(sub =>
      sub.setName('pay')
        .setDescription('Перевести средства другому пользователю')
        .addUserOption(opt => opt.setName('target').setDescription('Получатель').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Сумма перевода').setRequired(true))
    )
    // Таблица лидеров
    .addSubcommand(sub =>
      sub.setName('leaderboard')
        .setDescription('Таблица лидеров по балансу')
    )
    // Магазин ролей и маркетплейс
    .addSubcommand(sub =>
      sub.setName('market')
        .setDescription('Открыть магазин товаров и маркетплейс кастомных ролей')
    )
    // Покупка
    .addSubcommand(sub =>
      sub.setName('buy')
        .setDescription('Купить роль в магазине или на маркетплейсе')
        .addStringOption(opt => opt.setName('id').setDescription('ID товара или роли').setRequired(true))
    )
    // Инвентарь
    .addSubcommand(sub =>
      sub.setName('inventory')
        .setDescription('Посмотреть купленные предметы')
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const eco = client.modules.economy;
    const config = eco.getSettings(interaction.guildId);

    // --- /eco profile ---
    if (sub === 'profile') {
      const target = interaction.options.getUser('user') || interaction.user;
      let member = null;
      try { member = await interaction.guild.members.fetch(target.id); } catch {}

      const wallet = await eco.getBalance(target.id);
      const userRoles = ecoRepo.getUserCustomRoles(target.id);
      const top = await eco.getLeaderboard(100);
      const rankIndex = top.findIndex(t => t.user_id === target.id);
      const rankText = rankIndex !== -1 ? `#${rankIndex + 1}` : 'Вне рейтинга';

      const customRolesList = userRoles.length > 0
        ? userRoles.map(r => `\`${r.name}\` (${r.color})`).join(', ')
        : 'Отсутствуют';

      const joinedAt = member?.joinedTimestamp
        ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`
        : 'Неизвестно';

      const embed = new EmbedBuilder()
        .setTitle(`Карточка профиля — ${target.tag}`)
        .setColor(0xC8A96A)
        .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: '🪙 На руках', value: `\`${wallet.balance.toLocaleString('ru-RU')} ${config.currencySymbol}\``, inline: true },
          { name: '🏛️ В банке', value: `\`${wallet.bank.toLocaleString('ru-RU')} ${config.currencySymbol}\``, inline: true },
          { name: '💎 Суммарный капитал', value: `\`${(wallet.balance + wallet.bank).toLocaleString('ru-RU')} ${config.currencySymbol}\``, inline: true },
          { name: '🏆 Место в топе', value: `\`${rankText}\``, inline: true },
          { name: '📅 На сервере с', value: joinedAt, inline: true },
          { name: '🎂 Регистрация', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`, inline: true },
          { name: '🎨 Кастомные роли', value: customRolesList, inline: false }
        )
        .setFooter({ text: `ID: ${target.id} • Root Economy System` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // --- /eco staffprofile --- (ТОЛЬКО ДЛЯ СТАФФА!)
    if (sub === 'staffprofile') {
      if (!checkPermission(interaction, 'staff')) {
        return interaction.reply({ content: '🚫 **Доступ запрещен.** Данный профиль доступен только персоналу сервера.', ephemeral: true });
      }

      const target = interaction.options.getUser('user') || interaction.user;
      let member = null;
      try { member = await interaction.guild.members.fetch(target.id); } catch {}

      const stats = ecoRepo.getStaffStats(interaction.guildId, target.id);
      const staffRoles = member
        ? member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).slice(0, 4).join(', ') || 'Стафф'
        : 'Персонал';

      const embed = new EmbedBuilder()
        .setTitle(`🛡️ Служебный профиль стаффа — ${target.tag}`)
        .setColor(0xC8A96A)
        .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
        .setDescription(`Служебная карточка модератора проекта **${interaction.guild.name}**\n**Должность / Роли:** ${staffRoles}`)
        .addFields(
          { name: '👤 Верифицировано участников', value: `\`${stats.verified_count}\``, inline: true },
          { name: '🔨 Выдано банов', value: `\`${stats.bans_count}\``, inline: true },
          { name: '🔇 Выдано мутов / таймаутов', value: `\`${stats.mutes_count}\``, inline: true },
          { name: '⚠️ Выдано предупреждений', value: `\`${stats.warns_count}\``, inline: true },
          { name: '🚪 Исключено (киков)', value: `\`${stats.kicks_count}\``, inline: true },
          { name: '📑 Рассмотрено обращений', value: `\`${stats.reports_count}\``, inline: true }
        )
        .setFooter({ text: `Root Security Console • Доступ: STAFF+` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // --- /eco balance ---
    if (sub === 'balance') {
      const target = interaction.options.getUser('user') || interaction.user;
      const wallet = await eco.getBalance(target.id);

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
        content: `🎉 Вы забрали ежедневную награду: **+${res.reward} ${res.currency}**! Ваш новый баланс: **${res.newBalance} ${res.currency}**.`
      });
    }

    // --- /eco work ---
    if (sub === 'work') {
      const res = await eco.work(interaction.user.id);
      if (!res.ok) {
        return interaction.reply({ content: res.message, ephemeral: true });
      }
      return interaction.reply({
        content: `💼 Вы отлично поработали и заработали **+${res.earnings} ${res.currency}**! Ваш новый баланс: **${res.newBalance} ${res.currency}**.`
      });
    }

    // --- /eco pay ---
    if (sub === 'pay') {
      const targetUser = interaction.options.getUser('target');
      const amount = interaction.options.getInteger('amount');

      if (amount <= 0) {
        return interaction.reply({ content: 'Сумма перевода должна быть больше нуля.', ephemeral: true });
      }

      const res = await eco.pay(interaction.user, targetUser.id, amount, interaction.guildId);
      if (!res.ok) {
        return interaction.reply({ content: `Ошибка перевода: ${res.message}`, ephemeral: true });
      }

      return interaction.reply({
        content: `💸 Вы успешно перевели **${res.received} ${res.currency}** пользователю <@${targetUser.id}> (комиссия перевода: ${res.tax} ${res.currency})!`
      });
    }

    // --- /eco leaderboard ---
    if (sub === 'leaderboard') {
      const top = await eco.getLeaderboard(10);
      const lines = top.map((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`#${i + 1}\``;
        return `${medal} <@${u.user_id}> — **${u.total.toLocaleString('ru-RU')}** ${config.currencySymbol}`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`🏆 Таблица лидеров — ${interaction.guild.name}`)
        .setColor(0xC8A96A)
        .setDescription(lines.join('\n') || 'Таблица лидеров пуста');

      return interaction.reply({ embeds: [embed] });
    }

    // --- /eco market ---
    if (sub === 'market') {
      const officialItems = await eco.getShop(true);
      const marketRoles = await eco.getMarketplaceRoles(interaction.guildId);

      let desc = 'Купить товар/роль: `/eco buy id:<ID>`\n\n';

      desc += '**🛍️ Официальные роли магазина:**\n';
      if (officialItems.length === 0) {
        desc += '*В магазине пока нет ролей*\n\n';
      } else {
        for (const it of officialItems) {
          desc += `• **[ID: ${it.id}]** ${it.name} — **${it.price} ${config.currencySymbol}** ${it.description ? `(${it.description})` : ''}\n`;
        }
        desc += '\n';
      }

      desc += '**🎨 Кастомные роли игроков (Маркетплейс):**\n';
      if (marketRoles.length === 0) {
        desc += '*На маркетплейсе пока нет ролей*\n';
      } else {
        for (const r of marketRoles) {
          desc += `• **[ID: ${r.role_id}]** <@&${r.role_id}> — **${r.price} ${config.currencySymbol}** (автор: <@${r.owner_id}>, купили: ${r.buyers_count})\n`;
        }
      }

      const embed = new EmbedBuilder()
        .setTitle(`🛒 Магазин ролей и Маркетплейс — ${interaction.guild.name}`)
        .setColor(0xC8A96A)
        .setDescription(desc)
        .setFooter({ text: 'Создать свою роль в чате: !createrole <Название> [#цвет]' });

      return interaction.reply({ embeds: [embed] });
    }

    // --- /eco buy ---
    if (sub === 'buy') {
      const id = interaction.options.getString('id');
      const numId = parseInt(id, 10);
      let shopItem = null;
      if (!isNaN(numId) && numId < 1000000) {
        shopItem = ecoRepo.getShopItemById(numId);
      }

      if (shopItem) {
        const res = await eco.buy(interaction.user.id, shopItem.id, interaction.guild);
        if (!res.ok) {
          return interaction.reply({ content: `Ошибка покупки: ${res.message}`, ephemeral: true });
        }
        return interaction.reply({ content: `Поздравляем! Вы приобрели товар: **${res.item.name}**!` });
      } else {
        try {
          const buyCustom = await eco.buyCustomRole(interaction.guild, interaction.user.id, id);
          return interaction.reply({ content: `Поздравляем! Вы приобрели кастомную роль **${buyCustom.roleItem.name}** за **${buyCustom.price} ${buyCustom.currency}**!` });
        } catch (err) {
          return interaction.reply({ content: `Ошибка покупки роли: ${err.message}`, ephemeral: true });
        }
      }
    }

    // --- /eco inventory ---
    if (sub === 'inventory') {
      const inv = await eco.getInventory(interaction.user.id);
      const embed = new EmbedBuilder()
        .setTitle(`Инвентарь — ${interaction.user.tag}`)
        .setColor(0xC8A96A);

      if (!inv.length) {
        embed.setDescription('Ваш инвентарь пуст. Загляните в `/eco market`!');
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
  }
};
