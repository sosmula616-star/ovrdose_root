/**
 * Модуль управления каналами и ролями серверов (Root Channels Module)
 * Поддерживает:
 * 1. Считывание структуры каналов и категорий
 * 2. Авто-пересоздание удаленных каналов (администрация, проходные, логи)
 * 3. Авто-возврат перемещенных каналов в исходную категорию
 * 4. Запуск проверки по кнопке или раз в 24 часа
 * 5. Контроль создания каналов (только через веб-панель)
 * 6. Развертывание базовой структуры серверов
 */

const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { channels: channelsRepo, settings: settingsRepo, system: systemRepo } = require('@root-core/db');

class ChannelsModule {
  constructor(client, logger, loggingModule) {
    this.client = client;
    this.logger = logger;
    this.loggingModule = loggingModule;
    this.panelCreatedChannels = new Set();
    this.checkInterval = null;
    this.isEnforcing = false;
  }

  init() {
    this.logger.info('[Channels] Инициализация модуля управления каналами...');

    // Запуск автоматической проверки каждые 24 часа
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    this.checkInterval = setInterval(() => {
      this.logger.info('[Channels] Плановая 24-часовая проверка структуры каналов...');
      this.enforceAll().catch(err => {
        this.logger.error(`[Channels] Ошибка 24-часовой проверки: ${err.message}`);
      });
    }, TWENTY_FOUR_HOURS);

    // Первоначальная сверка после старта бота
    if (this.client.isReady()) {
      this.enforceAll().catch(() => {});
    } else {
      this.client.once('ready', () => {
        setTimeout(() => this.enforceAll().catch(() => {}), 5000);
      });
    }

    // Регистрация обработчиков событий Discord
    this.registerEventHandlers();
  }

  registerEventHandlers() {
    // 1. При удалении канала
    this.client.on('channelDelete', async (channel) => {
      if (!channel.guild) return;
      try {
        const managed = channelsRepo.getByChannelId(channel.guild.id, channel.id);
        if (managed && managed.is_enforced) {
          this.logger.warn(`[Channels] Защищенный канал "${channel.name}" был удален! Запуск авто-восстановления...`);
          
          if (this.loggingModule) {
            await this.loggingModule.criticalSecurity(channel.guild.id, `Защищенный канал **${channel.name}** [${managed.group_type}] был удален. Выполняется автоматическое пересоздание...`);
          }

          // Задержка 1.5 секунды во избежание гонок с Discord API
          setTimeout(async () => {
            await this.recreateManagedChannel(channel.guild.id, managed);
          }, 1500);
        }
      } catch (err) {
        this.logger.error(`[Channels] Ошибка обработки удаления канала: ${err.message}`);
      }
    });

    // 2. При перемещении или редактировании канала
    this.client.on('channelUpdate', async (oldChannel, newChannel) => {
      if (!newChannel.guild) return;
      try {
        const managed = channelsRepo.getByChannelId(newChannel.guild.id, newChannel.id);
        if (!managed || !managed.is_enforced) return;

        // Если канал был перемещен из своей категории
        if (managed.category_id && newChannel.parentId !== managed.category_id) {
          this.logger.warn(`[Channels] Канал "${newChannel.name}" был перемещен из категории. Возврат на место...`);
          
          await newChannel.setParent(managed.category_id, { lockPermissions: false }).catch(e => {
            this.logger.error(`[Channels] Не удалось вернуть канал в категорию: ${e.message}`);
          });

          if (this.loggingModule) {
            await this.loggingModule.security(newChannel.guild.id, `Канал **${newChannel.name}** был самовольно перемещен. Root вернул его в исходную категорию.`);
          }
        }
      } catch (err) {
        this.logger.error(`[Channels] Ошибка обработки обновления канала: ${err.message}`);
      }
    });

    // 3. Контроль создания каналов ("Создание каналов через сайт рута только")
    this.client.on('channelCreate', async (channel) => {
      if (!channel.guild) return;

      // Если канал был создан через панель управления - пропускаем
      if (this.panelCreatedChannels.has(channel.id)) {
        this.panelCreatedChannels.delete(channel.id);
        return;
      }

      try {
        // Проверяем Audit Log, кто создал канал
        let executorTag = 'Неизвестно';
        let executorId = null;
        try {
          const audit = await channel.guild.fetchAuditLogs({ type: 10, limit: 1 }); // 10 = CHANNEL_CREATE
          const entry = audit.entries.first();
          if (entry && (Date.now() - entry.createdTimestamp) < 10000) {
            executorTag = entry.executor?.tag || entry.executor?.id || 'Неизвестно';
            executorId = entry.executor?.id;
          }
        } catch (_) {}

        // Если создал бот Root - пропускаем
        if (executorId === this.client.user?.id) return;

        this.logger.warn(`[Channels] Обнаружено создание канала "${channel.name}" на сервере ${channel.guild.name} пользователем ${executorTag} в обход веб-панели!`);

        if (this.loggingModule) {
          await this.loggingModule.security(channel.guild.id, `Обнаружено создание канала **#${channel.name}** пользователем **${executorTag}** в обход веб-панели. Политика: "Создание каналов только через сайт".`, {
            channelId: channel.id,
            executorId,
            executorTag,
          });
        }
      } catch (err) {
        this.logger.error(`[Channels] Ошибка в channelCreate: ${err.message}`);
      }
    });
  }

  /**
   * Считывание всех каналов и категорий сервера
   */
  async scanGuildChannels(guildId) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error(`Сервер ${guildId} не найден или бот не подключен`);
    }

    const discordChannels = await guild.channels.fetch();
    const managedRecords = channelsRepo.getAll(guildId);
    const managedMap = new Map();
    for (const m of managedRecords) {
      if (m.channel_id) managedMap.set(m.channel_id, m);
    }

    const categories = [];
    const channels = [];

    for (const [id, c] of discordChannels) {
      if (!c) continue;

      if (c.type === ChannelType.GuildCategory) {
        const channelsInCategory = Array.from(discordChannels.values()).filter(ch => ch && ch.parentId === c.id);
        categories.push({
          id: c.id,
          name: c.name,
          position: c.position,
          channelsCount: channelsInCategory.length,
        });
      } else {
        const managed = managedMap.get(c.id);
        const parent = c.parentId ? discordChannels.get(c.parentId) : null;

        let channelTypeStr = 'text';
        if (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) channelTypeStr = 'voice';
        if (c.type === ChannelType.GuildAnnouncement) channelTypeStr = 'announcement';

        channels.push({
          id: c.id,
          name: c.name,
          type: channelTypeStr,
          rawType: c.type,
          categoryId: c.parentId || null,
          categoryName: parent?.name || 'Без категории',
          position: c.position,
          groupType: managed ? managed.group_type : 'general',
          isEnforced: managed ? Boolean(managed.is_enforced) : false,
          managedId: managed ? managed.id : null,
          nsfw: Boolean(c.nsfw),
          rateLimitPerUser: c.rateLimitPerUser || 0,
          topic: c.topic || '',
        });
      }
    }

    // Сортировка по категориям и позициям
    categories.sort((a, b) => a.position - b.position);
    channels.sort((a, b) => a.position - b.position);

    return {
      guild: { id: guild.id, name: guild.name, memberCount: guild.memberCount },
      categories,
      channels,
      stats: {
        total: channels.length,
        admin: channels.filter(c => c.groupType === 'admin').length,
        transit: channels.filter(c => c.groupType === 'transit').length,
        logs: channels.filter(c => c.groupType.startsWith('log_')).length,
        enforced: channels.filter(c => c.isEnforced).length,
      }
    };
  }

  /**
   * Создание канала ТОЛЬКО через веб-панель
   */
  async createChannelViaPanel(guildId, { name, type = 'text', groupType = 'general', categoryId = null, categoryName = null, isEnforced = 1, nsfw = false, rateLimitPerUser = 0, topic = '' }) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Сервер не найден');

    // Определение Discord типа канала
    let discordType = ChannelType.GuildText;
    if (type === 'voice') discordType = ChannelType.GuildVoice;
    if (type === 'category') discordType = ChannelType.GuildCategory;
    if (type === 'announcement') discordType = ChannelType.GuildAnnouncement;
    if (type === 'stage') discordType = ChannelType.GuildStageVoice;

    // Подготовка прав доступа в зависимости от группы канала
    const permissionOverwrites = [];

    if (groupType === 'admin') {
      // Закрытый канал администрации: всем запрещено, админам разрешено
      permissionOverwrites.push({
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect],
      });
      if (this.client.user) {
        permissionOverwrites.push({
          id: this.client.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
        });
      }
    } else if (groupType === 'transit') {
      // Проходной канал: правила, верификация, добро пожаловать
      permissionOverwrites.push({
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendTTSMessages],
      });
    } else if (groupType.startsWith('log_')) {
      // Каналы логов: только чтение для стаффа, для всех скрыто, бот пишет
      permissionOverwrites.push({
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      });
      if (this.client.user) {
        permissionOverwrites.push({
          id: this.client.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles],
        });
      }
    }

    // Если указана категория по имени и нет ID, ищем или создаем категорию (только если мы не создаем саму категорию!)
    let finalParentId = categoryId;
    if (discordType === ChannelType.GuildCategory) {
      finalParentId = null; // Категории не могут иметь родителя
    } else if (!finalParentId && categoryName) {
      const existingCat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase());
      if (existingCat) {
        finalParentId = existingCat.id;
      } else {
        const newCat = await guild.channels.create({
          name: categoryName,
          type: ChannelType.GuildCategory,
        });
        finalParentId = newCat.id;
        this.panelCreatedChannels.add(newCat.id);
      }
    }

    // Параметры создания канала
    const createOptions = {
      name,
      type: discordType,
      reason: `Создано через веб-панель Root [${groupType}]`,
    };

    if (discordType !== ChannelType.GuildCategory && finalParentId) {
      createOptions.parent = finalParentId;
    }
    if (discordType !== ChannelType.GuildCategory && permissionOverwrites.length > 0) {
      createOptions.permissionOverwrites = permissionOverwrites;
    }
    if (discordType === ChannelType.GuildText || discordType === ChannelType.GuildAnnouncement) {
      if (nsfw) createOptions.nsfw = Boolean(nsfw);
      if (rateLimitPerUser) createOptions.rateLimitPerUser = Number(rateLimitPerUser);
      if (topic) createOptions.topic = String(topic);
    }

    // Создаем канал в Discord
    const createdChannel = await guild.channels.create(createOptions);

    // Регистрируем в списке разрешенных каналов панели
    this.panelCreatedChannels.add(createdChannel.id);

    // Получаем реальное имя родительской категории
    const parentChannel = finalParentId ? guild.channels.cache.get(finalParentId) : null;
    const resolvedCategoryName = parentChannel ? parentChannel.name : categoryName;

    // Сохраняем в базу данных managed_channels (для обычных каналов)
    let managedId = null;
    if (discordType !== ChannelType.GuildCategory) {
      const dbResult = channelsRepo.addManagedChannel({
        guildId,
        channelId: createdChannel.id,
        name,
        type,
        groupType,
        categoryName: resolvedCategoryName,
        categoryId: finalParentId,
        position: createdChannel.position,
        isEnforced: isEnforced ? 1 : 0,
      });
      managedId = dbResult.lastInsertRowid;
    }

    // Если это лог-канал, автоматически привязываем в settings
    if (groupType.startsWith('log_')) {
      settingsRepo.set(guildId, 'root', `log_channel_${groupType}`, createdChannel.id);
      if (groupType === 'log_audit') {
        settingsRepo.set(guildId, 'root', 'log_channel_security', createdChannel.id);
      }
    }

    this.logger.info(`[Channels] Создан канал/категория "${name}" (${createdChannel.id}) [${groupType}] на сервере ${guild.name}`);
    return {
      id: createdChannel.id,
      name: createdChannel.name,
      type,
      groupType,
      categoryId: finalParentId,
      categoryName: resolvedCategoryName,
      managedId,
      nsfw: Boolean(createdChannel.nsfw),
      rateLimitPerUser: createdChannel.rateLimitPerUser || 0,
    };
  }

  /**
   * Создание категории напрямую
   */
  async createCategoryViaPanel(guildId, { name, position = null }) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Сервер не найден');

    const createOptions = {
      name: name.trim(),
      type: ChannelType.GuildCategory,
      reason: 'Создание категории через веб-панель Root',
    };
    if (position !== null && position !== undefined) {
      createOptions.position = Number(position);
    }

    const createdCat = await guild.channels.create(createOptions);
    this.panelCreatedChannels.add(createdCat.id);
    this.logger.info(`[Channels] Создана категория "${createdCat.name}" (${createdCat.id}) на сервере ${guild.name}`);
    return {
      id: createdCat.id,
      name: createdCat.name,
      position: createdCat.position,
    };
  }

  /**
   * Редактирование названия, категории, флагов и позиции через хостинг
   */
  async editChannelViaPanel(guildId, channelId, { name, categoryId, categoryName, position, groupType, isEnforced, nsfw, rateLimitPerUser, topic }) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Сервер не найден');

    const channel = guild.channels.cache.get(channelId);
    if (!channel) throw new Error('Канал в Discord не найден');

    const updates = {};
    if (name && name !== channel.name) {
      await channel.setName(name);
      updates.name = name;
    }

    if (categoryId !== undefined && categoryId !== channel.parentId && channel.type !== ChannelType.GuildCategory) {
      await channel.setParent(categoryId || null, { lockPermissions: false });
      updates.categoryId = categoryId;
      const parent = categoryId ? guild.channels.cache.get(categoryId) : null;
      updates.categoryName = parent ? parent.name : null;
    }

    if (position !== undefined && position !== channel.position) {
      await channel.setPosition(Number(position));
      updates.position = Number(position);
    }

    if (nsfw !== undefined && channel.setNSFW && channel.nsfw !== Boolean(nsfw)) {
      await channel.setNSFW(Boolean(nsfw), 'Обновление флага NSFW через веб-панель Root');
      updates.nsfw = Boolean(nsfw);
    }

    if (rateLimitPerUser !== undefined && channel.setRateLimitPerUser && channel.rateLimitPerUser !== Number(rateLimitPerUser)) {
      await channel.setRateLimitPerUser(Number(rateLimitPerUser), 'Обновление Slowmode через веб-панель Root');
      updates.rateLimitPerUser = Number(rateLimitPerUser);
    }

    if (topic !== undefined && channel.setTopic && channel.topic !== topic) {
      await channel.setTopic(String(topic), 'Обновление описания через веб-панель Root');
      updates.topic = String(topic);
    }

    if (groupType !== undefined) updates.groupType = groupType;
    if (isEnforced !== undefined) updates.isEnforced = isEnforced ? 1 : 0;

    // Обновляем запись в БД если это не категория
    if (channel.type !== ChannelType.GuildCategory) {
      const managed = channelsRepo.getByChannelId(guildId, channelId);
      if (managed) {
        channelsRepo.updateManagedChannel(managed.id, updates);
      } else {
        channelsRepo.addManagedChannel({
          guildId,
          channelId,
          name: updates.name || channel.name,
          type: channel.isVoiceBased() ? 'voice' : 'text',
          groupType: updates.groupType || 'general',
          categoryName: updates.categoryName,
          categoryId: updates.categoryId || channel.parentId,
          position: updates.position !== undefined ? updates.position : channel.position,
          isEnforced: updates.isEnforced !== undefined ? updates.isEnforced : 1,
        });
      }
    }

    this.logger.info(`[Channels] Канал #${channel.name} успешно обновлен через веб-панель`);
    return { ok: true, updates };
  }

  /**
   * Быстрое переключение флага канала (isEnforced, nsfw, etc.)
   */
  async toggleChannelFlag(guildId, channelId, flag) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Сервер не найден');

    const channel = guild.channels.cache.get(channelId);
    if (!channel) throw new Error('Канал не найден');

    let resultState;
    if (flag === 'isEnforced') {
      const managed = channelsRepo.getByChannelId(guildId, channelId);
      if (managed) {
        resultState = managed.is_enforced ? 0 : 1;
        channelsRepo.updateManagedChannel(managed.id, { isEnforced: resultState });
      } else {
        resultState = 1;
        channelsRepo.addManagedChannel({
          guildId,
          channelId,
          name: channel.name,
          type: channel.isVoiceBased() ? 'voice' : 'text',
          groupType: 'general',
          categoryName: channel.parent?.name || null,
          categoryId: channel.parentId || null,
          position: channel.position,
          isEnforced: 1,
        });
      }
    } else if (flag === 'nsfw') {
      if (channel.setNSFW) {
        resultState = !channel.nsfw;
        await channel.setNSFW(resultState, 'Переключение NSFW через веб-панель Root');
      } else {
        throw new Error('Данный тип канала не поддерживает флаг NSFW');
      }
    } else {
      throw new Error(`Неизвестный флаг канала: ${flag}`);
    }

    return { flag, state: resultState };
  }

  /**
   * Удаление канала через панель
   */
  async deleteChannelViaPanel(guildId, channelId) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Сервер не найден');

    channelsRepo.deleteByChannelId(guildId, channelId);

    const channel = guild.channels.cache.get(channelId);
    if (channel) {
      await channel.delete('Удалено через веб-панель Root');
    }

    return { ok: true };
  }

  /**
   * Восстановление удаленного защищенного канала
   */
  async recreateManagedChannel(guildId, managedRecord) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;

    try {
      this.logger.info(`[Channels] Восстановление канала "${managedRecord.name}" [${managedRecord.group_type}]...`);

      // Проверяем существование родительской категории
      let parentId = managedRecord.category_id;
      if (parentId && !guild.channels.cache.has(parentId)) {
        // Категория тоже была удалена, ищем по имени или создаем
        const cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === (managedRecord.category_name || '').toLowerCase());
        if (cat) {
          parentId = cat.id;
        } else if (managedRecord.category_name) {
          const newCat = await guild.channels.create({
            name: managedRecord.category_name,
            type: ChannelType.GuildCategory,
          });
          parentId = newCat.id;
          this.panelCreatedChannels.add(newCat.id);
        }
      }

      const res = await this.createChannelViaPanel(guildId, {
        name: managedRecord.name,
        type: managedRecord.type,
        groupType: managedRecord.group_type,
        categoryId: parentId,
        categoryName: managedRecord.category_name,
        isEnforced: managedRecord.is_enforced,
      });

      // Обновляем старую запись в БД новым channel_id
      if (res && res.id) {
        channelsRepo.updateChannelId(managedRecord.id, res.id);
      }

      if (this.loggingModule) {
        await this.loggingModule.criticalSecurity(guildId, `✅ Канал **${managedRecord.name}** [${managedRecord.group_type}] успешно восстановлен Root-ботом с исходными правами доступа.`);
      }

      return res;
    } catch (err) {
      this.logger.error(`[Channels] Ошибка авто-пересоздания канала ${managedRecord.name}: ${err.message}`);
      return null;
    }
  }

  /**
   * Сверка и принудительное восстановление структуры (по кнопке или раз в 24 часа)
   */
  async checkAndEnforce(guildId) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error(`Сервер ${guildId} не найден`);

    await guild.channels.fetch();
    const enforced = channelsRepo.getEnforced(guildId);

    let restored = 0;
    let repositioned = 0;

    for (const record of enforced) {
      let channel = record.channel_id ? guild.channels.cache.get(record.channel_id) : null;

      // Если по ID не найден, пробуем найти по имени и типу
      if (!channel) {
        channel = guild.channels.cache.find(c => c.name.toLowerCase() === record.name.toLowerCase());
      }

      // Канал отсутствует -> Пересоздаем!
      if (!channel) {
        await this.recreateManagedChannel(guildId, record);
        restored++;
        continue;
      }

      // Канал существует, проверяем его ID в базе
      if (channel.id !== record.channel_id) {
        channelsRepo.updateChannelId(record.id, channel.id);
      }

      // Проверяем привязку к категории
      if (record.category_id && channel.parentId !== record.category_id) {
        const targetCategory = guild.channels.cache.get(record.category_id);
        if (targetCategory) {
          await channel.setParent(record.category_id, { lockPermissions: false }).catch(() => {});
          repositioned++;
        }
      }
    }

    return {
      guildId,
      totalEnforced: enforced.length,
      restored,
      repositioned,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Проверка всех серверов (Staff и Main)
   */
  async enforceAll() {
    if (this.isEnforcing) return;
    this.isEnforcing = true;

    try {
      const staffId = process.env.STAFF_GUILD_ID || '1558608015148716062';
      const mainId  = process.env.MAIN_GUILD_ID  || '1558606862277017690';

      const results = {};
      if (this.client.guilds.cache.has(staffId)) {
        results.staff = await this.checkAndEnforce(staffId);
      }
      if (this.client.guilds.cache.has(mainId)) {
        results.main = await this.checkAndEnforce(mainId);
      }

      this.logger.info(`[Channels] Проверка целостности завершена: Staff (восстановлено: ${results.staff?.restored || 0}, возвращено: ${results.staff?.repositioned || 0}), Main (восстановлено: ${results.main?.restored || 0}, возвращено: ${results.main?.repositioned || 0})`);
      return results;
    } finally {
      this.isEnforcing = false;
    }
  }

  /**
   * Развертывание базовой эталонной структуры серверов
   * Создает каналы администрации, проходные каналы и каналы с логами
   */
  async setupDefaultStructure(guildId) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Сервер не найден');

    this.logger.info(`[Channels] Развертывание базовой структуры каналов на ${guild.name}...`);

    const blueprint = [
      // 1. КАТЕГОРИЯ: АДМИНИСТРАЦИЯ
      { category: '⚡ АДМИНИСТРАЦИЯ', name: 'staff-chat', type: 'text', groupType: 'admin' },
      { category: '⚡ АДМИНИСТРАЦИЯ', name: 'staff-reports', type: 'text', groupType: 'admin' },
      { category: '⚡ АДМИНИСТРАЦИЯ', name: 'Staff Voice', type: 'voice', groupType: 'admin' },

      // 2. КАТЕГОРИЯ: ПРОХОДНЫЕ КАНАЛЫ
      { category: '🚪 ПРОХОДНЫЕ КАНАЛЫ', name: 'добро-пожаловать', type: 'text', groupType: 'transit' },
      { category: '🚪 ПРОХОДНЫЕ КАНАЛЫ', name: 'правила', type: 'text', groupType: 'transit' },
      { category: '🚪 ПРОХОДНЫЕ КАНАЛЫ', name: 'верификация', type: 'text', groupType: 'transit' },
      { category: '🚪 ПРОХОДНЫЕ КАНАЛЫ', name: 'объявления', type: 'announcement', groupType: 'transit' },

      // 3. КАТЕГОРИЯ: ЖУРНАЛ АУДИТА (ЛОГИ)
      { category: '📋 ЖУРНАЛ АУДИТА', name: 'лог-сообщений', type: 'text', groupType: 'log_text' },
      { category: '📋 ЖУРНАЛ АУДИТА', name: 'лог-голоса', type: 'text', groupType: 'log_voice' },
      { category: '📋 ЖУРНАЛ АУДИТА', name: 'лог-ролей', type: 'text', groupType: 'log_roles' },
      { category: '📋 ЖУРНАЛ АУДИТА', name: 'лог-сервера', type: 'text', groupType: 'log_audit' },
    ];

    const created = [];
    for (const item of blueprint) {
      try {
        const c = await this.createChannelViaPanel(guildId, {
          name: item.name,
          type: item.type,
          groupType: item.groupType,
          categoryName: item.category,
          isEnforced: 1,
        });
        created.push(c);
      } catch (err) {
        this.logger.warn(`[Channels] Ошибка создания базового канала ${item.name}: ${err.message}`);
      }
    }

    return { ok: true, createdCount: created.length, items: created };
  }
}

module.exports = ChannelsModule;
