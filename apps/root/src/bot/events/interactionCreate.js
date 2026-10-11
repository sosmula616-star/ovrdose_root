/**
 * Обработчик взаимодействий (Slash-команды, активные кнопки магазина и выбор периодов)
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { system: systemRepo, economy: ecoRepo } = require('@root-core/db');

module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction, client, logger) {
    try {
      // 1. Slash-команды
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
          await command.execute(interaction, client, logger);
        } catch (err) {
          logger.error(`[Commands] Ошибка выполнения команды /${interaction.commandName}: ${err.message}`, { stack: err.stack });
          systemRepo.addError('root', interaction.guildId, 'command_error', `/${interaction.commandName}: ${err.message}`, err.stack);
          const errorMsg = 'Произошла непредвиденная ошибка при выполнении команды.';
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: errorMsg }).catch(() => {});
          } else {
            await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
          }
        }
        return;
      }

      // 2. Селект-меню или быстрая кнопка выбора роли в магазине за монеты
      const isShopRolePick = (interaction.isStringSelectMenu() && interaction.customId === 'select_shop_role') ||
                             (interaction.isButton() && interaction.customId.startsWith('shop_pick_'));

      if (isShopRolePick) {
        const roleId = interaction.isStringSelectMenu()
          ? interaction.values[0]
          : interaction.customId.replace('shop_pick_', '');

        const eco = client.modules.economy;
        const config = eco.getSettings(interaction.guildId);

        // Ищем в кастомных ролях или в товарах магазина
        const customRole = ecoRepo.getCustomRoleByRoleId(roleId);
        const shopItem = !customRole ? ecoRepo.getShopItems().find(it => String(it.role_id) === String(roleId) || String(it.id) === String(roleId)) : null;

        if (!customRole && !shopItem) {
          return interaction.reply({ content: '❌ Роль не найдена или более недоступна.', ephemeral: true });
        }

        const roleName = customRole ? customRole.name : shopItem.name;
        const basePrice = customRole ? customRole.price : shopItem.price;

        // Рассчитываем цены по периодам в монетах
        const p1m = ecoRepo.calculatePeriodPrice(basePrice, '1_month');
        const p3m = ecoRepo.calculatePeriodPrice(basePrice, '3_months');
        const p6m = ecoRepo.calculatePeriodPrice(basePrice, '6_months');
        const p1y = ecoRepo.calculatePeriodPrice(basePrice, '1_year');
        const pFor = ecoRepo.calculatePeriodPrice(basePrice, 'forever');

        const embed = new EmbedBuilder()
          .setTitle(`🛍️ Покупка роли за монеты: ${roleName}`)
          .setColor(0xC8A96A)
          .setDescription(
            `Выберите период действия роли **${roleName}**.\n` +
            `Оплата производится с вашего баланса монет (**${config.currencySymbol}**):\n\n` +
            `• 🗓️ **1 месяц (30 дней):** \`${p1m} ${config.currencySymbol}\`\n` +
            `• 🗓️ **3 месяца (90 дней):** \`${p3m} ${config.currencySymbol}\` *(выгода 17%)*\n` +
            `• 🗓️ **6 месяцев (180 дней):** \`${p6m} ${config.currencySymbol}\` *(выгода 25%)*\n` +
            `• 🗓️ **1 год (365 дней):** \`${p1y} ${config.currencySymbol}\` *(выгода 33%)*\n` +
            `• ♾️ **Навсегда (бессрочно):** \`${pFor} ${config.currencySymbol}\``
          )
          .setFooter({ text: 'Нажмите кнопку с нужным сроком для покупки роли за монеты' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`buy_period_${roleId}_1_month`).setLabel(`1 мес (${p1m} 🪙)`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`buy_period_${roleId}_3_months`).setLabel(`3 мес (${p3m} 🪙)`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`buy_period_${roleId}_6_months`).setLabel(`6 мес (${p6m} 🪙)`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`buy_period_${roleId}_1_year`).setLabel(`1 год (${p1y} 🪙)`).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`buy_period_${roleId}_forever`).setLabel(`Навсегда (${pFor} 🪙)`).setStyle(ButtonStyle.Danger)
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      // Информационная кнопка о создании роли
      if (interaction.isButton() && interaction.customId === 'quick_create_role_info') {
        const eco = client.modules.economy;
        const config = eco.getSettings(interaction.guildId);
        return interaction.reply({
          content: `🎨 **Создание кастомной роли за монеты:**\nИспользуйте команду в чате: \`!createrole <Название_роли> [#HEX_цвет]\`\nСтоимость создания: **${config.roleCreatePrice || 5000} ${config.currencySymbol}**\nЛимит: не более **${config.maxCustomRolesPerUser || 2}** ролей на одного пользователя.`,
          ephemeral: true
        });
      }

      // 3. Обработка нажатий на кнопки покупки по периодам
      if (interaction.isButton() && interaction.customId.startsWith('buy_period_')) {
        const parts = interaction.customId.split('_'); // ['buy', 'period', roleId, periodKey...]
        const roleId = parts[2];
        const period = parts.slice(3).join('_'); // '1_month', '3_months', '6_months', '1_year', 'forever'

        const eco = client.modules.economy;
        const config = eco.getSettings(interaction.guildId);

        const customRole = ecoRepo.getCustomRoleByRoleId(roleId);
        const shopItem = !customRole ? ecoRepo.getShopItems().find(it => String(it.role_id) === String(roleId) || String(it.id) === String(roleId)) : null;

        if (!customRole && !shopItem) {
          return interaction.reply({ content: '❌ Роль не найдена.', ephemeral: true });
        }

        const basePrice = customRole ? customRole.price : shopItem.price;
        const sellerId = customRole ? customRole.owner_id : null;
        const actualRoleId = customRole ? customRole.role_id : (shopItem.role_id || customRole?.role_id);

        try {
          const res = await eco.buyRoleWithPeriod(interaction.guild, interaction.user.id, actualRoleId, period, basePrice, sellerId);

          const periodNames = {
            '1_month': '1 месяц (30 дней)',
            '3_months': '3 месяца (90 дней)',
            '6_months': '6 месяцев (180 дней)',
            '1_year': '1 год (365 дней)',
            'forever': 'Навсегда',
          };

          const expireStr = res.expiresAt ? `<t:${Math.floor(new Date(res.expiresAt).getTime() / 1000)}:R>` : 'Бессрочно';

          const embed = new EmbedBuilder()
            .setTitle('🎉 Роль успешно приобретена!')
            .setColor(0x4EAC6D)
            .setDescription(`Вы успешно оформили роль <@&${actualRoleId}> на период **${periodNames[period] || period}**!`)
            .addFields(
              { name: 'Списано', value: `\`${res.price} ${res.currency}\``, inline: true },
              { name: 'Срок действия', value: expireStr, inline: true }
            );

          return interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (err) {
          return interaction.reply({ content: `❌ Ошибка покупки: ${err.message}`, ephemeral: true });
        }
      }

      // 4. Открытие меню кастомных ролей из магазина
      if (interaction.isButton() && interaction.customId === 'open_my_role_menu') {
        const userRoles = ecoRepo.getCustomRolesByUser(interaction.user.id);
        const eco = client.modules.economy;
        const config = eco.getSettings(interaction.guildId);
        const maxLimit = config.maxCustomRolesPerUser || 2;

        if (!userRoles || userRoles.length === 0) {
          const embed = new EmbedBuilder()
            .setTitle('🎨 Управление кастомными ролями')
            .setColor(0xC8A96A)
            .setDescription(
              `У вас пока нет созданных кастомных ролей.\n\n` +
              `• Создать персональную декоративную роль:\n` +
              `\`!createrole <Название_роли> [#HEX_цвет]\`\n\n` +
              `• Лимит на создание: **не более ${maxLimit}-х ролей на участника**.\n` +
              `• Стоимость создания: **${config.roleCreatePrice || 5000} ${config.currencySymbol}**`
            );
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const r = userRoles[0];
        const embed = new EmbedBuilder()
          .setTitle(`🎨 Настройки роли: ${r.name}`)
          .setColor(r.color ? parseInt(r.color.replace('#', ''), 16) || 0xC8A96A : 0xC8A96A)
          .setDescription(
            `Роль на сервере: <@&${r.role_id}>\n` +
            `Статус продажи: ${r.is_for_sale ? `🏷️ Выставлена за **${r.price} ${config.currencySymbol}**` : '🔒 Личная (не выставлена)'}\n\n` +
            `**Параметры оформления:**\n` +
            `• **Цвет:** \`${r.color || '#C8A96A'}\` (Смена: \`${config.roleColorPrice || 300} ${config.currencySymbol}\`)\n` +
            `• **Название:** **${r.name}** (Смена: \`${config.roleRenamePrice || 500} ${config.currencySymbol}\`)\n` +
            `• **Эмодзи/иконка буста:** ${r.icon ? `\`${r.icon}\`` : '*Не установлена*'} (Установка: \`${config.roleIconPrice || 1500} ${config.currencySymbol}\`)\n` +
            `• **Градиентное оформление:** ${r.is_gradient ? '🌈 **Активировано**' : `*Отключено* (Покупка: \`${config.roleGradientPrice || 2500} ${config.currencySymbol}\`)`}\n` +
            `• **Купили другие игроки:** \`${r.buyers_count || 0}\` шт.`
          )
          .setFooter({ text: `ID: ${r.role_id} • Ваши роли: ${userRoles.length}/${maxLimit}` });

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`role_act_rename_${r.role_id}`).setLabel(`✏️ Имя (${config.roleRenamePrice || 500})`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`role_act_color_${r.role_id}`).setLabel(`🎨 Цвет (${config.roleColorPrice || 300})`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`role_act_icon_${r.role_id}`).setLabel(`✨ Эмодзи (${config.roleIconPrice || 1500})`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`role_act_gradient_${r.role_id}`).setLabel(`🌈 Градиент (${config.roleGradientPrice || 2500})`).setStyle(r.is_gradient ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(Boolean(r.is_gradient))
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`role_act_sell_${r.role_id}`).setLabel('🏷️ Выставить / цена').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`role_act_del_${r.role_id}`).setLabel('🗑️ Удалить').setStyle(ButtonStyle.Danger)
        );

        return interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
      }

      // 5. Кнопки управления ролью в меню
      if (interaction.isButton() && interaction.customId.startsWith('role_act_')) {
        const [, , action, roleId] = interaction.customId.split('_');
        const eco = client.modules.economy;
        const config = eco.getSettings(interaction.guildId);

        if (action === 'rename') {
          return interaction.reply({
            content: `✏️ **Смена названия роли:**\nИспользуйте команду: \`!role-rename ${roleId} <Новое_название>\`\nСтоимость: **${config.roleRenamePrice || 500} ${config.currencySymbol}**`,
            ephemeral: true
          });
        }
        if (action === 'color') {
          return interaction.reply({
            content: `🎨 **Смена цвета роли:**\nИспользуйте команду: \`!role-color ${roleId} <#HEX-цвет>\`\nПример: \`!role-color ${roleId} #FF5733\`\nСтоимость: **${config.roleColorPrice || 300} ${config.currencySymbol}**`,
            ephemeral: true
          });
        }
        if (action === 'icon') {
          return interaction.reply({
            content: `✨ **Установка эмодзи/иконки буста:**\nИспользуйте команду: \`!role-icon ${roleId} <эмодзи_или_URL>\`\nСтоимость: **${config.roleIconPrice || 1500} ${config.currencySymbol}**`,
            ephemeral: true
          });
        }
        if (action === 'gradient') {
          try {
            await eco.setCustomRoleGradient(interaction.guild, interaction.user.id, roleId);
            return interaction.reply({
              content: `🌈 Градиентное оформление успешно приобретено и активировано для роли <@&${roleId}>!`,
              ephemeral: true
            });
          } catch (err) {
            return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
          }
        }
        if (action === 'sell') {
          return interaction.reply({
            content: `🏷️ **Выставление на Маркетплейс:**\nИспользуйте команду: \`!sellrole ${roleId} <цена_в_монетах>\`\nПример: \`!sellrole ${roleId} 1200\``,
            ephemeral: true
          });
        }
        if (action === 'del') {
          try {
            await eco.deleteCustomRole(interaction.guild, roleId, interaction.user.id);
            return interaction.reply({
              content: `🗑️ Ваша кастомная роль успешно удалена с сервера и из базы данных.`,
              ephemeral: true
            });
          } catch (err) {
            return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
          }
        }
      }

    } catch (err) {
      logger.error(`[Interaction] Ошибка обработки: ${err.message}`);
    }
  }
};
