/**
 * Обработчик текстовых команд с префиксом "!" и система активности
 * Включает:
 *  - Административные команды с префиксом ! (!ban, !kick, !mute, !warn, !clear, !lockdown, !restore, !verify)
 *  - Проверку уровня доступа (Хост/Owner_IDs всегда имеет абсолютный доступ!)
 *  - Стафф-профиль (!staffprofile) — доступен только стаффу и хосту
 *  - Пользовательский красивый профиль (!profile)
 *  - Экономику и кастомные декоративные роли (!createrole, !sellrole, !market, !buyrole, !pay, !daily, !work)
 */

const {
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const { economy: ecoRepo, moderation: modRepo, antinuke: antinukeRepo, settings: settingsRepo } = require('@root-core/db');

// Проверка уровня доступа
function checkAccess(message) {
  const ownerIds = (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const userId = message.author.id;

  // 1. Хост / Владелец всегда имеет абсолютный доступ
  if (ownerIds.includes(userId)) {
    return { level: 'owner', isOwner: true, isAdmin: true, isStaff: true };
  }

  // 2. Проверка белых списков
  const gid = message.guild?.id || process.env.MAIN_GUILD_ID;
  const rawUsers = settingsRepo.get(gid, 'root', 'whitelist_users') || '[]';
  const rawRoles = settingsRepo.get(gid, 'root', 'whitelist_roles') || '[]';
  try {
    const trustedUsers = JSON.parse(rawUsers);
    if (trustedUsers.includes(userId)) {
      return { level: 'admin', isOwner: false, isAdmin: true, isStaff: true };
    }
  } catch {}

  const member = message.member;
  if (!member) return { level: 'user', isOwner: false, isAdmin: false, isStaff: false };

  // Проверка доверенных ролей
  try {
    const trustedRoles = JSON.parse(rawRoles);
    for (const rid of trustedRoles) {
      if (member.roles.cache.has(rid)) {
        return { level: 'admin', isOwner: false, isAdmin: true, isStaff: true };
      }
    }
  } catch {}

  // 3. Проверка Discord прав
  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return { level: 'admin', isOwner: false, isAdmin: true, isStaff: true };
  }

  if (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions.has(PermissionFlagsBits.KickMembers) ||
    member.permissions.has(PermissionFlagsBits.BanMembers)
  ) {
    return { level: 'staff', isOwner: false, isAdmin: false, isStaff: true };
  }

  return { level: 'user', isOwner: false, isAdmin: false, isStaff: false };
}

// Парсинг упоминания или ID пользователя
function parseUserId(arg) {
  if (!arg) return null;
  const clean = arg.replace(/[<@!>]/g, '');
  return /^\d{17,20}$/.test(clean) ? clean : null;
}

module.exports = {
  name: 'messageCreate',
  async execute(message, client, logger) {
    if (!message.guild || message.author.bot) return;

    const content = message.content.trim();
    const ecoModule = client.modules?.economy;
    const logging = client.modules?.logging;

    // --- Награда за активность в чате (если не команда) ---
    if (!content.startsWith('!') && content.length >= 3 && ecoModule) {
      try {
        const config = ecoModule.getSettings(message.guild.id);
        if (config.messageReward > 0) {
          const cdKey = `chat_${message.author.id}`;
          const cd = ecoRepo.getCooldown(message.author.id, cdKey);
          if (cd === null) {
            ecoRepo.modifyBalance(message.author.id, config.messageReward, 'chat_reward', 'Активность в чате');
            ecoRepo.setCooldown(message.author.id, cdKey, config.messageCooldown || 30);
          }
        }
      } catch {}
      return;
    }

    if (!content.startsWith('!')) return;

    // Парсим команду и аргументы
    const args = content.slice(1).trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();
    const access = checkAccess(message);
    const config = ecoModule ? ecoModule.getSettings(message.guild.id) : {};

    try {
      // ======================================================================
      // 1. АДМИНИСТРАТИВНЫЕ КОМАНДЫ НА ПРЕФИКС "!"
      // ======================================================================

      // --- !ban <@user|id> [причина] ---
      if (cmd === 'ban') {
        if (!access.isStaff) {
          return message.reply('🚫 У вас недостаточно прав для выполнения этой команды.');
        }
        const targetId = parseUserId(args[0]);
        if (!targetId) return message.reply('⚠️ Использование: `!ban <@пользователь|ID> [причина]`');
        const reason = args.slice(1).join(' ') || 'Причина не указана';

        try {
          await message.guild.members.ban(targetId, { reason: `[Модератор: ${message.author.tag}] ${reason}` });
          ecoRepo.incrementStaffStat(message.guild.id, message.author.id, message.author.tag, 'bans_count', 1);

          const embed = new EmbedBuilder()
            .setTitle('🔨 Пользователь заблокирован')
            .setColor(0xC9545D)
            .addFields(
              { name: 'Нарушитель', value: `<@${targetId}> (${targetId})`, inline: true },
              { name: 'Модератор', value: `${message.author.tag}`, inline: true },
              { name: 'Причина', value: reason }
            )
            .setTimestamp();
          return message.reply({ embeds: [embed] });
        } catch (err) {
          return message.reply(`❌ Ошибка бана: ${err.message}`);
        }
      }

      // --- !kick <@user|id> [причина] ---
      if (cmd === 'kick') {
        if (!access.isStaff) {
          return message.reply('🚫 У вас недостаточно прав для выполнения этой команды.');
        }
        const targetId = parseUserId(args[0]);
        if (!targetId) return message.reply('⚠️ Использование: `!kick <@пользователь|ID> [причина]`');
        const reason = args.slice(1).join(' ') || 'Причина не указана';

        try {
          const targetMember = await message.guild.members.fetch(targetId);
          if (!targetMember.kickable && !access.isOwner) {
            return message.reply('❌ Невозможно исключить данного участника (роль выше бота).');
          }
          await targetMember.kick(`[Модератор: ${message.author.tag}] ${reason}`);
          ecoRepo.incrementStaffStat(message.guild.id, message.author.id, message.author.tag, 'kicks_count', 1);

          const embed = new EmbedBuilder()
            .setTitle('🚪 Пользователь исключен (Kick)')
            .setColor(0xC8A96A)
            .addFields(
              { name: 'Участник', value: `<@${targetId}> (${targetId})`, inline: true },
              { name: 'Модератор', value: `${message.author.tag}`, inline: true },
              { name: 'Причина', value: reason }
            )
            .setTimestamp();
          return message.reply({ embeds: [embed] });
        } catch (err) {
          return message.reply(`❌ Ошибка кика: ${err.message}`);
        }
      }

      // --- !mute <@user|id> [минуты] [причина] ---
      if (cmd === 'mute') {
        if (!access.isStaff) {
          return message.reply('🚫 У вас недостаточно прав для выполнения этой команды.');
        }
        const targetId = parseUserId(args[0]);
        if (!targetId) return message.reply('⚠️ Использование: `!mute <@пользователь|ID> [минуты=60] [причина]`');
        const minutes = parseInt(args[1], 10) || 60;
        const reason = args.slice(2).join(' ') || 'Причина не указана';

        try {
          const targetMember = await message.guild.members.fetch(targetId);
          await targetMember.timeout(minutes * 60 * 1000, `[Модератор: ${message.author.tag}] ${reason}`);
          ecoRepo.incrementStaffStat(message.guild.id, message.author.id, message.author.tag, 'mutes_count', 1);

          const embed = new EmbedBuilder()
            .setTitle('🔇 Пользователь отправлен в таймаут (Mute)')
            .setColor(0xC8A96A)
            .addFields(
              { name: 'Участник', value: `<@${targetId}>`, inline: true },
              { name: 'Длительность', value: `${minutes} мин.`, inline: true },
              { name: 'Модератор', value: `${message.author.tag}`, inline: true },
              { name: 'Причина', value: reason }
            )
            .setTimestamp();
          return message.reply({ embeds: [embed] });
        } catch (err) {
          return message.reply(`❌ Ошибка выдачи мута: ${err.message}`);
        }
      }

      // --- !unmute <@user|id> [причина] ---
      if (cmd === 'unmute') {
        if (!access.isStaff) {
          return message.reply('🚫 У вас недостаточно прав для выполнения этой команды.');
        }
        const targetId = parseUserId(args[0]);
        if (!targetId) return message.reply('⚠️ Использование: `!unmute <@пользователь|ID> [причина]`');
        try {
          const targetMember = await message.guild.members.fetch(targetId);
          await targetMember.timeout(null, `[Снятие: ${message.author.tag}]`);
          return message.reply(`🔊 Таймаут с пользователя <@${targetId}> успешно снят.`);
        } catch (err) {
          return message.reply(`❌ Ошибка: ${err.message}`);
        }
      }

      // --- !warn <@user|id> <причина> ---
      if (cmd === 'warn') {
        if (!access.isStaff) {
          return message.reply('🚫 У вас недостаточно прав для выполнения этой команды.');
        }
        const targetId = parseUserId(args[0]);
        if (!targetId) return message.reply('⚠️ Использование: `!warn <@пользователь|ID> <причина>`');
        const reason = args.slice(1).join(' ') || 'Нарушение правил';

        try {
          modRepo.addWarn(message.guild.id, targetId, message.author.id, reason);
          ecoRepo.incrementStaffStat(message.guild.id, message.author.id, message.author.tag, 'warns_count', 1);
          const warnsCount = modRepo.getActiveWarnsCount(message.guild.id, targetId);

          const embed = new EmbedBuilder()
            .setTitle('⚠️ Выдано предупреждение (Warn)')
            .setColor(0xC8A96A)
            .addFields(
              { name: 'Нарушитель', value: `<@${targetId}>`, inline: true },
              { name: 'Предупреждений всего', value: `${warnsCount}`, inline: true },
              { name: 'Модератор', value: `${message.author.tag}`, inline: true },
              { name: 'Причина', value: reason }
            )
            .setTimestamp();
          return message.reply({ embeds: [embed] });
        } catch (err) {
          return message.reply(`❌ Ошибка выдачи варна: ${err.message}`);
        }
      }

      // --- !clear <1-100> ---
      if (cmd === 'clear' || cmd === 'purge') {
        if (!access.isStaff) {
          return message.reply('🚫 У вас недостаточно прав для выполнения этой команды.');
        }
        const count = parseInt(args[0], 10);
        if (isNaN(count) || count < 1 || count > 100) {
          return message.reply('⚠️ Укажите число сообщений для удаления (от 1 до 100). Пример: `!clear 20`');
        }

        try {
          await message.delete().catch(() => {});
          const deleted = await message.channel.bulkDelete(count, true);
          const notify = await message.channel.send(`🧹 Удалено сообщений: **${deleted.size}**`);
          setTimeout(() => notify.delete().catch(() => {}), 4000);
          return;
        } catch (err) {
          return message.reply(`❌ Ошибка очистки: ${err.message}`);
        }
      }

      // --- !verify <@user|id> ---
      if (cmd === 'verify') {
        if (!access.isStaff) {
          return message.reply('🚫 Команда верификации доступна только стаффу.');
        }
        const targetId = parseUserId(args[0]);
        if (!targetId) return message.reply('⚠️ Использование: `!verify <@пользователь|ID>`');

        try {
          const targetMember = await message.guild.members.fetch(targetId);
          // Ищем роль верификации или базовую роль участника
          const verifyRoleId = settingsRepo.get(message.guild.id, 'root', 'verify_role_id');
          if (verifyRoleId) {
            await targetMember.roles.add(verifyRoleId, `Верифицирован стаффером ${message.author.tag}`);
          }

          ecoRepo.incrementStaffStat(message.guild.id, message.author.id, message.author.tag, 'verified_count', 1);

          const embed = new EmbedBuilder()
            .setTitle('✅ Участник успешно верифицирован')
            .setColor(0x4E9A68)
            .setDescription(`Участник <@${targetId}> успешно прошел проверку и верификацию!`)
            .addFields(
              { name: 'Проверил стаффер', value: `${message.author.tag}`, inline: true },
              { name: 'Дата', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
            );
          return message.reply({ embeds: [embed] });
        } catch (err) {
          return message.reply(`❌ Ошибка верификации: ${err.message}`);
        }
      }

      // --- !lockdown [on|off] ---
      if (cmd === 'lockdown') {
        if (!access.isAdmin) {
          return message.reply('🚫 Управление режимом Lockdown доступно только администраторам.');
        }
        const state = args[0]?.toLowerCase();
        const active = state === 'on' || state === '1' || state === 'true';
        const antinuke = client.modules?.antinuke;
        if (!antinuke) return message.reply('❌ Модуль защиты недоступен');

        await antinuke.setLockdown(message.guild.id, active, `Команда !lockdown от ${message.author.tag}`);
        return message.reply(`🛡️ Режим экстренной защиты Lockdown: **${active ? 'АКТИВИРОВАН' : 'ОТКЛЮЧЕН'}**`);
      }

      // --- !restore [id] ---
      if (cmd === 'restore') {
        if (!access.isAdmin) {
          return message.reply('🚫 Откат структуры доступен только администраторам.');
        }
        const snapId = parseInt(args[0], 10);
        const antinuke = client.modules?.antinuke;
        if (!antinuke) return message.reply('❌ Модуль защиты недоступен');

        const snaps = antinukeRepo.getSnapshots(message.guild.id);
        const targetSnap = snapId ? antinukeRepo.getSnapshotById(snapId) : snaps[0];
        if (!targetSnap) return message.reply('❌ Снапшот не найден');

        await antinuke.restoreSnapshot(message.guild.id, targetSnap.id);
        return message.reply(`♻️ Восстановление структуры каналов и ролей из снапшота #${targetSnap.id} запущено.`);
      }

      // ======================================================================
      // 2. ПРОФИЛИ: ОБЫЧНЫЙ И СТАФФ-ПРОФИЛЬ
      // ======================================================================

      // --- !staffprofile [@user] --- (ТОЛЬКО ДЛЯ СТАФФА!)
      if (cmd === 'staffprofile' || cmd === 'staff') {
        if (!access.isStaff) {
          return message.reply('🚫 **Доступ запрещен.** Данная команда и профиль доступны исключительно персоналу сервера.');
        }

        const targetId = parseUserId(args[0]) || message.author.id;
        const targetUser = await client.users.fetch(targetId).catch(() => message.author);
        const stats = ecoRepo.getStaffStats(message.guild.id, targetId);

        let targetMember = null;
        try { targetMember = await message.guild.members.fetch(targetId); } catch {}

        const staffRoles = targetMember
          ? targetMember.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).slice(0, 4).join(', ') || 'Стафф'
          : 'Персонал';

        const embed = new EmbedBuilder()
          .setTitle(`🛡️ Служебный профиль стаффа — ${targetUser.tag}`)
          .setColor(0xC8A96A)
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
          .setDescription(`Служебная карточка модератора проекта **${message.guild.name}**\n**Должность / Роли:** ${staffRoles}`)
          .addFields(
            { name: '👤 Верифицировано участников', value: `\`${stats.verified_count}\``, inline: true },
            { name: '🔨 Выдано банов', value: `\`${stats.bans_count}\``, inline: true },
            { name: '🔇 Выдано мутов / таймаутов', value: `\`${stats.mutes_count}\``, inline: true },
            { name: '⚠️ Выдано предупреждений', value: `\`${stats.warns_count}\``, inline: true },
            { name: '🚪 Исключено (киков)', value: `\`${stats.kicks_count}\``, inline: true },
            { name: '📑 Рассмотрено обращений', value: `\`${stats.reports_count}\``, inline: true }
          )
          .setFooter({ text: `Root Security Console • Доступ: ${access.level.toUpperCase()}` })
          .setTimestamp();

        return message.reply({ embeds: [embed] });
      }

      // --- !profile [@user] ---
      if (cmd === 'profile') {
        const targetId = parseUserId(args[0]) || message.author.id;
        const targetUser = await client.users.fetch(targetId).catch(() => message.author);
        let targetMember = null;
        try { targetMember = await message.guild.members.fetch(targetId); } catch {}

        const wallet = await ecoModule.getBalance(targetId);
        const userRoles = ecoRepo.getUserCustomRoles(targetId);
        const top = await ecoModule.getLeaderboard(100);
        const rankIndex = top.findIndex(t => t.user_id === targetId);
        const rankText = rankIndex !== -1 ? `#${rankIndex + 1}` : 'Вне рейтинга';

        const customRolesList = userRoles.length > 0
          ? userRoles.map(r => `\`${r.name}\` (${r.color})`).join(', ')
          : 'Отсутствуют';

        const joinedAt = targetMember?.joinedTimestamp
          ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:D>`
          : 'Неизвестно';

        const createdAt = `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:D>`;

        const embed = new EmbedBuilder()
          .setTitle(`Карточка профиля — ${targetUser.tag}`)
          .setColor(0xC8A96A)
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
          .addFields(
            { name: '🪙 На руках', value: `\`${wallet.balance.toLocaleString('ru-RU')} ${config.currencySymbol}\``, inline: true },
            { name: '🏛️ В банке', value: `\`${wallet.bank.toLocaleString('ru-RU')} ${config.currencySymbol}\``, inline: true },
            { name: '💎 Суммарный капитал', value: `\`${(wallet.balance + wallet.bank).toLocaleString('ru-RU')} ${config.currencySymbol}\``, inline: true },
            { name: '🏆 Место в топе', value: `\`${rankText}\``, inline: true },
            { name: '📅 На сервере с', value: joinedAt, inline: true },
            { name: '🎂 Регистрация', value: createdAt, inline: true },
            { name: '🎨 Созданные кастомные роли', value: customRolesList, inline: false }
          )
          .setFooter({ text: `ID: ${targetUser.id} • Root Economy System` })
          .setTimestamp();

        return message.reply({ embeds: [embed] });
      }

      // ======================================================================
      // 3. ЭКОНОМИКА, КАСТОМНЫЕ РОЛИ И МАРКЕТПЛЕЙС
      // ======================================================================

      // --- !balance [@user] ---
      if (cmd === 'balance' || cmd === 'bal') {
        const targetId = parseUserId(args[0]) || message.author.id;
        const targetUser = await client.users.fetch(targetId).catch(() => message.author);
        const wallet = await ecoModule.getBalance(targetId);

        const embed = new EmbedBuilder()
          .setTitle(`Баланс — ${targetUser.tag}`)
          .setColor(0xC8A96A)
          .addFields(
            { name: 'На руках', value: `${wallet.balance.toLocaleString('ru-RU')} ${config.currencySymbol}`, inline: true },
            { name: 'В банке', value: `${wallet.bank.toLocaleString('ru-RU')} ${config.currencySymbol}`, inline: true },
            { name: 'Всего заработано', value: `${wallet.total_earned.toLocaleString('ru-RU')} ${config.currencySymbol}`, inline: true }
          )
          .setThumbnail(targetUser.displayAvatarURL());
        return message.reply({ embeds: [embed] });
      }

      // --- !daily ---
      if (cmd === 'daily') {
        const res = await ecoModule.daily(message.author.id);
        if (!res.ok) return message.reply(`⏳ ${res.message}`);
        return message.reply(`🎉 Вы получили ежедневную награду: **+${res.reward} ${res.currency}**! Баланс: **${res.newBalance} ${res.currency}**`);
      }

      // --- !work ---
      if (cmd === 'work') {
        const res = await ecoModule.work(message.author.id);
        if (!res.ok) return message.reply(`⏳ ${res.message}`);
        return message.reply(`💼 Вы поработали и заработали **+${res.earnings} ${res.currency}**! Новый баланс: **${res.newBalance} ${res.currency}**`);
      }

      // --- !pay <@user|id> <сумма> ---
      if (cmd === 'pay') {
        const targetId = parseUserId(args[0]);
        const amount = parseInt(args[1], 10);
        if (!targetId || isNaN(amount) || amount <= 0) {
          return message.reply('⚠️ Использование: `!pay <@пользователь|ID> <сумма>`');
        }

        const res = await ecoModule.pay(message.author, targetId, amount, message.guild.id);
        if (!res.ok) return message.reply(`❌ ${res.message}`);

        return message.reply(`💸 Вы успешно перевели **${res.received} ${res.currency}** пользователю <@${targetId}> (комиссия перевода: ${res.tax} ${res.currency})!`);
      }

      // --- !leaderboard / !top ---
      if (cmd === 'leaderboard' || cmd === 'top') {
        const top = await ecoModule.getLeaderboard(10);
        const lines = top.map((u, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`#${i + 1}\``;
          return `${medal} <@${u.user_id}> — **${u.total.toLocaleString('ru-RU')}** ${config.currencySymbol}`;
        });

        const embed = new EmbedBuilder()
          .setTitle(`🏆 Таблица лидеров — ${message.guild.name}`)
          .setColor(0xC8A96A)
          .setDescription(lines.join('\n') || 'Таблица лидеров пуста');
        return message.reply({ embeds: [embed] });
      }

      // --- !createrole <название> <#HEX_цвет> --- (СОЗДАНИЕ КАСТОМНОЙ РОЛИ БЕЗ ПРАВ)
      if (cmd === 'createrole') {
        if (!args[0]) {
          return message.reply(`⚠️ Использование: \`!createrole <Название_роли> [#HEX-цвет]\`\nСтоимость создания роли: **${config.roleCreatePrice || 5000} ${config.currencySymbol}**\nРоль создается без каких-либо прав (чисто для красоты и цвета).`);
        }

        // Если последний аргумент похож на HEX-код
        let hex = '#C8A96A';
        let nameParts = [...args];
        if (args.length > 1 && /^#?[0-9A-Fa-f]{6}$/.test(args[args.length - 1])) {
          hex = args[args.length - 1];
          if (!hex.startsWith('#')) hex = `#${hex}`;
          nameParts.pop();
        }
        const roleName = nameParts.join(' ');

        try {
          const res = await ecoModule.createCustomRole(message.guild, message.author.id, roleName, hex);
          const embed = new EmbedBuilder()
            .setTitle('🎨 Кастомная роль создана!')
            .setColor(res.color)
            .setDescription(`Поздравляем! Ваша персональная декоративная роль **${res.name}** успешно создана и выдана вам.`)
            .addFields(
              { name: 'Списано', value: `${res.pricePaid} ${res.currency}`, inline: true },
              { name: 'Цвет роли', value: `\`${res.color}\``, inline: true },
              { name: 'Права', value: 'Без доступа (декоративная)', inline: true },
              { name: 'Маркетплейс', value: 'Вы можете выставить ее на продажу: `!sellrole <ID_роли> <цена>`', inline: false }
            );
          return message.reply({ embeds: [embed] });
        } catch (err) {
          return message.reply(`❌ ${err.message}`);
        }
      }

      // --- !sellrole <ID_роли> <цена> ---
      if (cmd === 'sellrole') {
        const roleId = parseUserId(args[0]) || args[0];
        const price = parseInt(args[1], 10);
        if (!roleId || isNaN(price) || price <= 0) {
          return message.reply('⚠️ Использование: `!sellrole <ID_роли> <цена>`\nПример: `!sellrole 123456789012345678 1500`');
        }

        try {
          await ecoModule.sellCustomRole(message.guild.id, message.author.id, roleId, price);
          return message.reply(`🏷️ Ваша кастомная роль успешно выставлена на Маркетплейс за **${price} ${config.currencySymbol}**! Другие игроки могут купить ее: \`!buyrole ${roleId}\``);
        } catch (err) {
          return message.reply(`❌ ${err.message}`);
        }
      }

      // --- !removesell <ID_роли> ---
      if (cmd === 'removesell') {
        const roleId = parseUserId(args[0]) || args[0];
        if (!roleId) return message.reply('⚠️ Использование: `!removesell <ID_роли>`');

        try {
          await ecoModule.removeSaleCustomRole(message.author.id, roleId);
          return message.reply('🏷️ Роль успешно снята с продажи на Маркетплейсе.');
        } catch (err) {
          return message.reply(`❌ ${err.message}`);
        }
      }

      // --- !market / !shop / !roleshop ---
      if (cmd === 'market' || cmd === 'shop' || cmd === 'roleshop') {
        const wallet = await ecoModule.getBalance(message.author.id);
        const officialItems = await ecoModule.getShop(true);
        const marketRoles = await ecoModule.getMarketplaceRoles(message.guild.id);

        let desc = `💰 **Ваш баланс:** \`${wallet.balance.toLocaleString('ru-RU')} ${config.currencySymbol}\`\n\n` +
          `Все роли в магазине приобретаются за внутриигровые **монеты**! Нажмите активную кнопку с ролью ниже или выберите из меню, чтобы рассчитать периоды подписки (1 мес, 3 мес, 6 мес, 1 год, навсегда) и оплатить:\n\n`;

        desc += '**👑 Официальные роли сервера за монеты:**\n';
        if (officialItems.length === 0) {
          desc += '*В официальном магазине пока нет ролей (Администратор может добавить: `!addshoprole <@роль> <цена>`)*\n\n';
        } else {
          for (const it of officialItems) {
            const roleMention = it.role_id ? `<@&${it.role_id}>` : `**${it.name}**`;
            desc += `• ${roleMention} — от **${it.price.toLocaleString('ru-RU')} ${config.currencySymbol}** ${it.description ? `*(${it.description})*` : ''}\n`;
          }
          desc += '\n';
        }

        desc += '**🎨 Кастомные роли участников (Маркетплейс) за монеты:**\n';
        if (marketRoles.length === 0) {
          desc += '*На маркетплейсе пока нет ролей (Создайте свою: `!createrole`, выставить: `!sellrole`)*\n';
        } else {
          for (const r of marketRoles) {
            const iconBadge = r.icon ? `${r.icon} ` : '';
            const gradBadge = r.is_gradient ? ' 🌈' : '';
            desc += `• ${iconBadge}<@&${r.role_id}>${gradBadge} — базовая цена: **${r.price.toLocaleString('ru-RU')} ${config.currencySymbol}** (автор: <@${r.owner_id}>, купили: ${r.buyers_count})\n`;
          }
        }

        const embed = new EmbedBuilder()
          .setTitle(`🛒 Магазин ролей за монеты — ${message.guild.name}`)
          .setColor(0xC8A96A)
          .setDescription(desc)
          .setFooter({ text: 'Создать роль за монеты: !createrole • Меню своей роли: !rolemenu' });

        const components = [];

        // 1. Активные кнопки быстрого выбора ролей для покупки за монеты (до 8 кнопок)
        const allRolesList = [];
        for (const it of officialItems) {
          allRolesList.push({ id: String(it.role_id || it.id), name: it.name, price: it.price, isOfficial: true });
        }
        for (const r of marketRoles) {
          allRolesList.push({ id: String(r.role_id), name: r.name || `Роль ${r.role_id}`, price: r.price, isOfficial: false });
        }

        if (allRolesList.length > 0) {
          const firstChunk = allRolesList.slice(0, 4);
          const row1 = new ActionRowBuilder();
          for (const item of firstChunk) {
            const icon = item.isOfficial ? '👑' : '🎨';
            const label = `${icon} ${item.name} (${item.price} 🪙)`.slice(0, 80);
            row1.addComponents(
              new ButtonBuilder()
                .setCustomId(`shop_pick_${item.id}`)
                .setLabel(label)
                .setStyle(item.isOfficial ? ButtonStyle.Success : ButtonStyle.Primary)
            );
          }
          components.push(row1);

          if (allRolesList.length > 4) {
            const secondChunk = allRolesList.slice(4, 8);
            const row2 = new ActionRowBuilder();
            for (const item of secondChunk) {
              const icon = item.isOfficial ? '👑' : '🎨';
              const label = `${icon} ${item.name} (${item.price} 🪙)`.slice(0, 80);
              row2.addComponents(
                new ButtonBuilder()
                  .setCustomId(`shop_pick_${item.id}`)
                  .setLabel(label)
                  .setStyle(item.isOfficial ? ButtonStyle.Success : ButtonStyle.Primary)
              );
            }
            components.push(row2);
          }
        }

        // 2. Селект-меню со всеми ролями
        const selectOptions = [];
        for (const it of officialItems) {
          if (selectOptions.length >= 25) break;
          const targetVal = String(it.role_id || it.id);
          selectOptions.push({
            label: it.name.slice(0, 100),
            description: `Официальная роль • от ${it.price} ${config.currencySymbol}`.slice(0, 100),
            value: targetVal,
            emoji: '👑',
          });
        }
        for (const r of marketRoles) {
          if (selectOptions.length >= 25) break;
          selectOptions.push({
            label: (r.name || `Роль ${r.role_id}`).slice(0, 100),
            description: `Маркетплейс • от ${r.price} ${config.currencySymbol}`.slice(0, 100),
            value: String(r.role_id),
            emoji: '🎨',
          });
        }

        if (selectOptions.length > 0) {
          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_shop_role')
            .setPlaceholder('🛒 Или выберите роль из списка для покупки за монеты...')
            .addOptions(selectOptions);

          components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        // 3. Дополнительные кнопки
        const utilityRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('open_my_role_menu')
            .setLabel('🎨 Мои роли (!rolemenu)')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('quick_create_role_info')
            .setLabel(`➕ Создать роль (${config.roleCreatePrice || 5000} 🪙)`)
            .setStyle(ButtonStyle.Secondary)
        );
        components.push(utilityRow);

        return message.reply({ embeds: [embed], components });
      }

      // --- !addshoprole <@роль|ID> <цена_в_монетах> [описание] --- (ТОЛЬКО АДМИНИСТРАЦИЯ)
      if (cmd === 'addshoprole') {
        if (!access.isAdmin) {
          return message.reply('🚫 У вас недостаточно прав для добавления ролей в магазин.');
        }
        const roleArg = args[0];
        const price = parseInt(args[1], 10);
        const description = args.slice(2).join(' ') || '';

        const roleId = parseUserId(roleArg) || roleArg;
        if (!roleId || isNaN(price) || price < 0) {
          return message.reply('⚠️ Использование: `!addshoprole <@роль|ID> <цена_в_монетах> [описание]`\nПример: `!addshoprole @VIP 1000 Особая роль с цветом`');
        }

        let roleName = `Роль ${roleId}`;
        const discordRole = await message.guild.roles.fetch(roleId).catch(() => null);
        if (discordRole) {
          roleName = discordRole.name;
        }

        try {
          await ecoModule.addShopItem(roleName, price, description, roleId, null);
          return message.reply(`✅ Роль **${roleName}** успешно добавлена в официальный магазин за **${price} ${config.currencySymbol}**! Игроки могут купить её в \`!shop\`.`);
        } catch (err) {
          return message.reply(`❌ Ошибка: ${err.message}`);
        }
      }

      // --- !delshoprole <ID_товара> --- (ТОЛЬКО АДМИНИСТРАЦИЯ)
      if (cmd === 'delshoprole') {
        if (!access.isAdmin) {
          return message.reply('🚫 У вас недостаточно прав для удаления ролей из магазина.');
        }
        const itemId = parseInt(args[0], 10);
        if (isNaN(itemId)) {
          return message.reply('⚠️ Использование: `!delshoprole <ID_товара_в_магазине>`');
        }
        try {
          await ecoModule.deleteShopItem(itemId);
          return message.reply(`🗑️ Товар #${itemId} успешно удален из магазина.`);
        } catch (err) {
          return message.reply(`❌ Ошибка: ${err.message}`);
        }
      }

      // --- !rolemenu / !myrole / !myroles ---
      if (cmd === 'rolemenu' || cmd === 'myrole' || cmd === 'myroles') {
        const userRoles = ecoRepo.getCustomRolesByUser(message.author.id);
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
              `• Стоимость создания: **${config.roleCreatePrice || 5000} ${config.currencySymbol}**\n` +
              `• После создания вам будут доступны: смена названия, цвета, эмодзи/иконка буста, градиент и продажа на Маркетплейсе!`
            );
          return message.reply({ embeds: [embed] });
        }

        for (const r of userRoles) {
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

          await message.reply({ embeds: [embed], components: [row1, row2] });
        }
        return;
      }

      // --- !role-rename <ID_роли> <Новое название> ---
      if (cmd === 'role-rename') {
        const roleId = parseUserId(args[0]) || args[0];
        const newName = args.slice(1).join(' ').trim();
        if (!roleId || !newName) {
          return message.reply(`⚠️ Использование: \`!role-rename <ID_роли> <Новое название>\`\nСтоимость: **${config.roleRenamePrice || 500} ${config.currencySymbol}**`);
        }
        try {
          const res = await ecoModule.renameCustomRole(message.guild, message.author.id, roleId, newName);
          return message.reply(`✏️ Название роли успешно изменено на **${res.name}**! Списано: **${res.pricePaid} ${res.currency}**.`);
        } catch (err) {
          return message.reply(`❌ ${err.message}`);
        }
      }

      // --- !role-color <ID_роли> <#HEX> ---
      if (cmd === 'role-color') {
        const roleId = parseUserId(args[0]) || args[0];
        let hex = args[1];
        if (!roleId || !hex) {
          return message.reply(`⚠️ Использование: \`!role-color <ID_роли> <#HEX-цвет>\`\nПример: \`!role-color 123456789012345678 #FF5733\`\nСтоимость: **${config.roleColorPrice || 300} ${config.currencySymbol}**`);
        }
        if (!hex.startsWith('#')) hex = `#${hex}`;
        try {
          const res = await ecoModule.changeCustomRoleColor(message.guild, message.author.id, roleId, hex);
          return message.reply(`🎨 Цвет роли успешно изменен на \`${res.color}\`! Списано: **${res.pricePaid} ${res.currency}**.`);
        } catch (err) {
          return message.reply(`❌ ${err.message}`);
        }
      }

      // --- !role-icon <ID_роли> <эмодзи|URL> ---
      if (cmd === 'role-icon') {
        const roleId = parseUserId(args[0]) || args[0];
        const iconInput = args.slice(1).join(' ').trim();
        if (!roleId || !iconInput) {
          return message.reply(`⚠️ Использование: \`!role-icon <ID_роли> <эмодзи_или_URL>\`\nСтоимость: **${config.roleIconPrice || 1500} ${config.currencySymbol}**`);
        }
        try {
          const res = await ecoModule.setCustomRoleIcon(message.guild, message.author.id, roleId, iconInput);
          return message.reply(`✨ Иконка/эмодзи буста для роли успешно установлена (${res.icon})! Списано: **${res.pricePaid} ${res.currency}**.`);
        } catch (err) {
          return message.reply(`❌ ${err.message}`);
        }
      }

      // --- !role-gradient <ID_роли> ---
      if (cmd === 'role-gradient') {
        const roleId = parseUserId(args[0]) || args[0];
        if (!roleId) {
          return message.reply(`⚠️ Использование: \`!role-gradient <ID_роли>\`\nСтоимость: **${config.roleGradientPrice || 2500} ${config.currencySymbol}**`);
        }
        try {
          const res = await ecoModule.setCustomRoleGradient(message.guild, message.author.id, roleId);
          return message.reply(`🌈 Градиентное оформление успешно приобретено и активировано для роли <@&${roleId}>! Списано: **${res.pricePaid} ${res.currency}**.`);
        } catch (err) {
          return message.reply(`❌ ${err.message}`);
        }
      }

      // --- !delrole <ID_роли> ---
      if (cmd === 'delrole' || cmd === 'deleterole') {
        const roleId = parseUserId(args[0]) || args[0];
        if (!roleId) return message.reply('⚠️ Использование: `!delrole <ID_роли>`');
        try {
          await ecoModule.deleteCustomRole(message.guild, roleId, message.author.id);
          return message.reply('🗑️ Ваша кастомная роль успешно удалена.');
        } catch (err) {
          return message.reply(`❌ ${err.message}`);
        }
      }

      // --- !give <@user|id> <amount> [причина] --- (ТОЛЬКО АДМИНИСТРАЦИЯ)
      if (cmd === 'give') {
        if (!access.isAdmin) {
          return message.reply('🚫 У вас недостаточно прав для выдачи монет.');
        }
        const targetId = parseUserId(args[0]);
        const amount = parseInt(args[1], 10);
        const reason = args.slice(2).join(' ') || 'Выдача администратором';
        if (!targetId || isNaN(amount) || amount <= 0) {
          return message.reply('⚠️ Использование: `!give <@пользователь|ID> <кол-во> [причина]`');
        }
        try {
          const res = await ecoModule.give(targetId, amount, reason, message.author.tag);
          return message.reply(`💰 Пользователю <@${targetId}> успешно выдано **+${amount} ${config.currencySymbol}**! Новый баланс: **${res.newBalance} ${config.currencySymbol}**`);
        } catch (err) {
          return message.reply(`❌ ${err.message}`);
        }
      }

      // --- !take <@user|id> <amount> [причина] --- (ТОЛЬКО АДМИНИСТРАЦИЯ)
      if (cmd === 'take') {
        if (!access.isAdmin) {
          return message.reply('🚫 У вас недостаточно прав для списания монет.');
        }
        const targetId = parseUserId(args[0]);
        const amount = parseInt(args[1], 10);
        const reason = args.slice(2).join(' ') || 'Списание администратором';
        if (!targetId || isNaN(amount) || amount <= 0) {
          return message.reply('⚠️ Использование: `!take <@пользователь|ID> <кол-во> [причина]`');
        }
        try {
          const res = await ecoModule.take(targetId, amount, reason, message.author.tag);
          return message.reply(`💸 У пользователя <@${targetId}> списано **-${amount} ${config.currencySymbol}**! Новый баланс: **${res.newBalance} ${config.currencySymbol}**`);
        } catch (err) {
          return message.reply(`❌ ${err.message}`);
        }
      }

      // --- !setbalance <@user|id> <amount> [причина] --- (ТОЛЬКО АДМИНИСТРАЦИЯ)
      if (cmd === 'setbalance') {
        if (!access.isAdmin) {
          return message.reply('🚫 У вас недостаточно прав для изменения баланса.');
        }
        const targetId = parseUserId(args[0]);
        const amount = parseInt(args[1], 10);
        const reason = args.slice(2).join(' ') || 'Установка администратором';
        if (!targetId || isNaN(amount) || amount < 0) {
          return message.reply('⚠️ Использование: `!setbalance <@пользователь|ID> <новый_баланс> [причина]`');
        }
        try {
          const res = await ecoModule.set(targetId, amount, reason, message.author.tag);
          return message.reply(`🏛️ Баланс пользователя <@${targetId}> установлен на **${amount} ${config.currencySymbol}**.`);
        } catch (err) {
          return message.reply(`❌ ${err.message}`);
        }
      }

      // --- !buyrole <ID> ---
      if (cmd === 'buyrole' || cmd === 'buy') {
        const itemIdOrRoleId = args[0];
        if (!itemIdOrRoleId) return message.reply('⚠️ Использование: `!buyrole <ID_товара_или_роли>`\nПосмотреть каталог с активными кнопками: `!shop`');

        const numId = parseInt(itemIdOrRoleId, 10);
        let shopItem = null;
        if (!isNaN(numId) && numId < 1000000) {
          shopItem = ecoRepo.getShopItemById(numId);
        }

        if (shopItem) {
          const buyRes = await ecoModule.buy(message.author.id, shopItem.id, message.guild);
          if (!buyRes.ok) return message.reply(`❌ ${buyRes.message}`);
          return message.reply(`🎉 Вы успешно приобрели **${shopItem.name}** за **${shopItem.price} ${config.currencySymbol}**!`);
        } else {
          try {
            const buyCustom = await ecoModule.buyCustomRole(message.guild, message.author.id, itemIdOrRoleId);
            return message.reply(`🎉 Вы успешно приобрели кастомную роль **${buyCustom.roleItem.name}** за **${buyCustom.price} ${buyCustom.currency}**!`);
          } catch (err) {
            return message.reply(`❌ ${err.message}`);
          }
        }
      }

      // --- !help ---
      if (cmd === 'help') {
        let helpText = '**👤 Пользовательские команды:**\n' +
          '`!profile [@user]` — красивый профиль пользователя\n' +
          '`!balance` / `!bal` — проверить баланс\n' +
          '`!daily` — ежедневная награда\n' +
          '`!work` — заработок на работе\n' +
          '`!pay <@user> <сумма>` — перевод средств\n' +
          '`!leaderboard` / `!top` — топ богачей сервера\n' +
          '`!shop` / `!market` — интерактивный магазин с кнопками и периодами\n' +
          '`!createrole <название> [#цвет]` — создать кастомную роль (лимит: 2 роли)\n' +
          '`!rolemenu` / `!myrole` — меню настроек своей роли (кнопки)\n' +
          '`!role-rename <ID> <имя>` — сменить название роли\n' +
          '`!role-color <ID> <#HEX>` — сменить цвет роли\n' +
          '`!role-icon <ID> <эмодзи|URL>` — установить иконку/эмодзи буста\n' +
          '`!role-gradient <ID>` — купить градиентное оформление\n' +
          '`!sellrole <ID> <цена>` — выставить роль на Маркетплейс\n' +
          '`!removesell <ID>` — снять роль с продажи\n' +
          '`!delrole <ID>` — удалить свою роль\n';

        if (access.isStaff) {
          helpText += '\n**🛡️ Команды администрации и персонала:**\n' +
            '`!staffprofile [@user]` — служебный профиль модератора\n' +
            '`!verify <@user>` — верификация участника\n' +
            '`!ban <@user|ID> [причина]` — блокировка участника\n' +
            '`!kick <@user|ID> [причина]` — исключение участника\n' +
            '`!mute <@user|ID> [минуты] [причина]` — таймаут участника\n' +
            '`!unmute <@user|ID>` — снять таймаут\n' +
            '`!warn <@user|ID> <причина>` — выдать предупреждение\n' +
            '`!clear <кол-во>` — очистка сообщений в канале\n';
        }

        if (access.isAdmin) {
          helpText += '\n**⚡ Экономика и управление сервером (Admin/Host):**\n' +
            '`!addshoprole <@роль|ID> <цена> [описание]` — добавить роль в магазин за монеты\n' +
            '`!delshoprole <ID>` — удалить роль из магазина\n' +
            '`!give <@user|ID> <сумма> [причина]` — выдать монеты\n' +
            '`!take <@user|ID> <сумма> [причина]` — списать монеты\n' +
            '`!setbalance <@user|ID> <сумма>` — установить точный баланс\n' +
            '`!lockdown [on|off]` — экстренная защита сервера\n' +
            '`!restore [id]` — откат структуры каналов и ролей\n';
        }

        const embed = new EmbedBuilder()
          .setTitle(`Команды бота — ${message.guild.name}`)
          .setColor(0xC8A96A)
          .setDescription(helpText)
          .setFooter({ text: `Ваш уровень доступа: ${access.level.toUpperCase()}` });
        return message.reply({ embeds: [embed] });
      }

    } catch (err) {
      logger.error(`[MessageCommands] Ошибка при обработке команды !${cmd}: ${err.message}`);
      return message.reply(`❌ Произошла ошибка при выполнении команды: ${err.message}`);
    }
  }
};
