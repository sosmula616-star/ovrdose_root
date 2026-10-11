/**
 * ROOT-CORE MANAGEMENT CONSOLE CLIENT APPLICATION
 * Built with Alpine.js, SSE real-time events, strict validation and security.
 */

document.addEventListener('alpine:init', () => {
  Alpine.data('adminConsole', () => ({
    // Состояние навигации и интерфейса
    activeTab: 'dashboard',
    selectedGuild: 'both', // 'both' | 'staff' | 'main'
    theme: localStorage.getItem('root_theme') || 'dark',
    sidebarOpen: false,

    // Пользователь и безопасность
    currentUser: null,
    csrfToken: '',

    // Серверы
    guilds: {
      staff: { id: '1558608015148716062', name: 'Staff Guild' },
      main:  { id: '1558606862277017690', name: 'Main Guild' }
    },

    // Тосты
    toasts: [],

    // Модальное окно подтверждения
    confirmModal: {
      open: false,
      title: '',
      message: '',
      requireInput: null, // Строка для ввода (напр. "RESTORE" или "DELETE")
      inputValue: '',
      confirmBtnText: 'Подтвердить',
      confirmBtnClass: 'btn-danger',
      onConfirm: null,
    },

    // --- ДАННЫЕ РАЗДЕЛОВ ---

    // 1. Dashboard
    stats: { botsOnline: 0, totalBots: 0, totalMembers: 0, activePunishments: 0, incidents24h: 0 },
    recentEvents: [],
    recentAlerts: [],

    // 2. Bots & Drawer
    botsList: [],
    botDrawer: {
      open: false,
      tab: 'general', // general | modules | permissions | guard | logs
      bot: null,
      guardSettings: {},
      actionLogs: [],
    },
    newBotModal: {
      open: false,
      name: '',
      clientId: '',
      type: 'custom',
      description: '',
      pm2Name: '',
      servers: 'both',
    },

    // 3. Role Sync
    roleMaps: [],
    pendingSync: [],
    syncLogs: [],
    newRoleMapModal: {
      open: false,
      staffRoleId: '',
      mainRoleId: '',
      direction: 'staff_to_main',
      notes: '',
    },

    // 4. Permissions & Access
    accessSettings: {
      root_owner_ids: '',
      whitelist_users: [],
      whitelist_roles: [],
      newTrustedId: '',
      newTrustedRoleId: '',
    },

    // 5. Moderation
    modCases: { items: [], total: 0, page: 1 },
    modFilters: { search: '', type: '', guildId: '' },
    activePunishments: [],
    userHistoryModal: {
      open: false,
      userId: '',
      data: null,
    },
    newPunishModal: {
      open: false,
      userId: '',
      guildId: '',
      action: 'warn', // warn | mute_text | mute_voice | ban
      durationMinutes: 60,
      reason: '',
    },

    // 6. Economy
    ecoStats: { totalBalance: 0, activeWallets: 0, transactionsCount: 0 },
    ecoLeaderboard: [],
    ecoTransactions: [],
    ecoShopItems: [],
    ecoSettings: {},
    ecoSettingsModified: false,
    userWalletModal: {
      open: false,
      userId: '',
      wallet: null,
      action: 'give', // give | take | set
      amount: 100,
      reason: '',
    },

    // 7. Anticrash & Гибкие лимиты по ролям
    anticrashRules: [],
    anticrashRoleRules: [],
    anticrashModified: false,
    lockdownStatus: false,
    snapshots: [],
    incidents: [],
    roleRuleModal: {
      open: false,
      isEdit: false,
      roleId: '',
      roleName: '',
      permissions: {},
    },
    anticrashActionTypes: [
      { key: 'channel_delete', name: 'Удаление каналов', desc: 'Удаление текстовых и голосовых каналов' },
      { key: 'channel_create', name: 'Создание каналов', desc: 'Создание новых каналов и категорий' },
      { key: 'role_delete', name: 'Удаление ролей', desc: 'Удаление ролей с сервера' },
      { key: 'role_create', name: 'Создание ролей', desc: 'Создание новых ролей' },
      { key: 'ban', name: 'Блокировка (Бан)', desc: 'Блокировка участников сервера' },
      { key: 'kick', name: 'Исключение (Кик)', desc: 'Выгон участников с сервера' },
      { key: 'webhook_create', name: 'Создание вебхуков', desc: 'Создание Webhook интеграций' },
      { key: 'bot_add', name: 'Добавление ботов', desc: 'Инвайт сторонних ботов на сервер' },
      { key: 'emoji_delete', name: 'Удаление эмодзи', desc: 'Удаление эмодзи и стикеров' },
      { key: 'guild_update', name: 'Изменение сервера', desc: 'Смена названия, аватарки или настроек сервера' },
    ],

    // 8. Logs
    logsData: { items: [], total: 0, page: 1 },
    logFilters: { bot: '', type: '', level: '', guildId: '' },
    systemErrors: [],

    // 9. Log Channels
    logChannels: { general: '', security: '', economy: '', sync: '', bots: '' },

    // 10. Backups
    backupsList: [],

    // 11. Panel Admins
    panelUsersList: [],
    newAdminModal: {
      open: false,
      discordId: '',
      discordTag: '',
      role: 'admin',
    },
    auditLogs: { items: [], total: 0, page: 1 },

    // 12. Управление каналами и ролями (Channels & Roles Management)
    channelsData: {
      categories: [],
      channels: [],
      stats: { total: 0, admin: 0, transit: 0, logs: 0, enforced: 0 }
    },
    channelFilter: 'all', // 'all' | 'admin' | 'transit' | 'logs' | 'general'
    newChannelModal: {
      open: false,
      guildId: '',
      name: '',
      type: 'text',
      groupType: 'admin',
      categoryId: '',
      categoryName: '',
      isEnforced: true,
    },
    editChannelModal: {
      open: false,
      guildId: '',
      channelId: '',
      name: '',
      type: 'text',
      groupType: 'admin',
      categoryId: '',
      categoryName: '',
      position: 0,
      isEnforced: true,
    },

    // Кэш ролей и каналов из Discord для выпадающих списков
    discordRoles: { staff: [], main: [] },
    discordChannels: { staff: [], main: [] },

    // ========================================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ========================================================================
    async init() {
      // Определение текущей вкладки из URL
      const pathTab = window.location.pathname.replace(/^\//, '').split('/')[0];
      const validTabs = ['dashboard', 'bots', 'channels', 'rolesync', 'permissions', 'moderation', 'economy', 'anticrash', 'logs', 'logchannels', 'backups', 'settings'];
      if (pathTab && validTabs.includes(pathTab)) {
        this.activeTab = pathTab;
      }

      // Установка темы
      this.applyTheme(this.theme);

      // Получение CSRF токена
      await this.fetchCsrfToken();

      // Проверка авторизации
      await this.fetchCurrentUser();

      // Подключение SSE
      this.initEventSource();

      // Загрузка списков ролей и каналов для обеих гильдий
      await this.loadDiscordMetadata();

      // Первоначальная загрузка данных текущей вкладки
      await this.loadSectionData(this.activeTab);

      // Обработка клика назад/вперед в истории браузера
      window.addEventListener('popstate', (e) => {
        const tab = (e.state && e.state.tab) || window.location.pathname.replace(/^\//, '').split('/')[0] || 'dashboard';
        this.activeTab = tab;
        this.loadSectionData(this.activeTab);
      });
    },

    // Переключение тем
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      this.applyTheme(this.theme);
      localStorage.setItem('root_theme', this.theme);
    },

    applyTheme(t) {
      document.documentElement.setAttribute('data-theme', t);
    },

    // Навигация по вкладкам
    navigate(tab) {
      this.activeTab = tab;
      this.sidebarOpen = false;
      history.pushState({ tab }, '', `/${tab === 'dashboard' ? '' : tab}`);
      this.loadSectionData(tab);
    },

    // Переключение сервера в шапке
    setGuildFilter(g) {
      this.selectedGuild = g;
      this.loadSectionData(this.activeTab);
    },

    getActiveGuildId() {
      if (this.selectedGuild === 'staff') return this.guilds.staff.id;
      if (this.selectedGuild === 'main') return this.guilds.main.id;
      return null;
    },

    // ========================================================================
    // API И БЕЗОПАСНОСТЬ
    // ========================================================================
    async fetchCsrfToken() {
      try {
        const res = await fetch('/api/csrf-token');
        if (res.ok) {
          const data = await res.json();
          this.csrfToken = data.csrfToken;
        }
      } catch (e) {
        console.error('Ошибка получения CSRF токена:', e);
      }
    },

    async fetchCurrentUser() {
      try {
        const res = await fetch('/auth/me');
        if (res.ok) {
          this.currentUser = await res.json();
        } else if (res.status === 401) {
          window.location.href = '/auth/login';
        }
      } catch (e) {
        console.error('Ошибка загрузки профиля:', e);
      }
    },

    async apiFetch(url, options = {}) {
      options.headers = options.headers || {};
      options.headers['Content-Type'] = 'application/json';
      if (this.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method?.toUpperCase())) {
        options.headers['X-CSRF-Token'] = this.csrfToken;
      }

      const res = await fetch(url, options);

      if (res.status === 401) {
        window.location.href = '/auth/login';
        throw new Error('Сессия истекла');
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Ошибка сервера: ${res.status}`);
      }

      return data;
    },

    // ========================================================================
    // SSE ЖИВЫЕ СОБЫТИЯ
    // ========================================================================
    initEventSource() {
      const es = new EventSource('/api/events');

      es.addEventListener('bots:status', (e) => {
        const data = JSON.parse(e.data);
        const idx = this.botsList.findIndex(b => b.name === data.bot);
        if (idx !== -1) {
          this.botsList[idx] = { ...this.botsList[idx], ...data };
        }
      });

      es.addEventListener('alert:security', (e) => {
        const alert = JSON.parse(e.data);
        this.recentAlerts.unshift(alert);
        if (this.recentAlerts.length > 10) this.recentAlerts.pop();
        this.showToast('warning', `[Алерт] ${alert.message}`);
      });

      es.addEventListener('moderation:case', (e) => {
        const c = JSON.parse(e.data);
        if (this.activeTab === 'moderation') this.loadModerationCases();
      });

      es.addEventListener('sync:finished', (e) => {
        this.showToast('info', 'Синхронизация ролей завершена');
        if (this.activeTab === 'rolesync') this.loadRoleSyncData();
      });

      es.onerror = () => {
        console.warn('[SSE] Соединение потеряно, повторное подключение...');
      };
    },

    // ========================================================================
    // ТОСТЫ И МОДАЛКИ
    // ========================================================================
    showToast(type, message) {
      const id = Date.now() + Math.random();
      this.toasts.push({ id, type, message });
      setTimeout(() => {
        this.toasts = this.toasts.filter(t => t.id !== id);
      }, 4000);
    },

    openConfirm(opts) {
      this.confirmModal = {
        open: true,
        title: opts.title || 'Подтверждение действия',
        message: opts.message || 'Вы уверены?',
        requireInput: opts.requireInput || null,
        inputValue: '',
        confirmBtnText: opts.confirmBtnText || 'Подтвердить',
        confirmBtnClass: opts.confirmBtnClass || 'btn-danger',
        onConfirm: opts.onConfirm,
      };
    },

    executeConfirm() {
      if (this.confirmModal.requireInput && this.confirmModal.inputValue !== this.confirmModal.requireInput) {
        this.showToast('error', `Введите "${this.confirmModal.requireInput}" для подтверждения`);
        return;
      }
      if (typeof this.confirmModal.onConfirm === 'function') {
        this.confirmModal.onConfirm();
      }
      this.confirmModal.open = false;
    },

    // ========================================================================
    // ЗАГРУЗКА МЕТАДАННЫХ DISCORD
    // ========================================================================
    async loadDiscordMetadata() {
      try {
        const [staffRoles, mainRoles, staffChans, mainChans] = await Promise.all([
          this.apiFetch(`/api/discord/roles?guildId=${this.guilds.staff.id}`).catch(() => []),
          this.apiFetch(`/api/discord/roles?guildId=${this.guilds.main.id}`).catch(() => []),
          this.apiFetch(`/api/discord/channels?guildId=${this.guilds.staff.id}`).catch(() => []),
          this.apiFetch(`/api/discord/channels?guildId=${this.guilds.main.id}`).catch(() => []),
        ]);
        this.discordRoles.staff = staffRoles;
        this.discordRoles.main = mainRoles;
        this.discordChannels.staff = staffChans;
        this.discordChannels.main = mainChans;
      } catch (e) {
        console.error('Ошибка загрузки ролей и каналов Discord:', e);
      }
    },

    // ========================================================================
    // ЗАГРУЗКА РАЗДЕЛОВ
    // ========================================================================
    async loadSectionData(tab) {
      try {
        switch (tab) {
          case 'dashboard':
            await this.loadDashboard();
            break;
          case 'bots':
            await this.loadBots();
            break;
          case 'channels':
            await this.loadChannels();
            break;
          case 'rolesync':
            await this.loadRoleSyncData();
            break;
          case 'permissions':
            await this.loadPermissions();
            break;
          case 'moderation':
            await this.loadModerationCases();
            await this.loadActivePunishments();
            break;
          case 'economy':
            await this.loadEconomyData();
            break;
          case 'anticrash':
            await this.loadAnticrashData();
            break;
          case 'logs':
            await this.loadLogs();
            await this.loadErrors();
            break;
          case 'logchannels':
            await this.loadLogChannels();
            break;
          case 'backups':
            await this.loadBackups();
            break;
          case 'settings':
            await this.loadPanelUsers();
            await this.loadAuditLogs();
            break;
        }
      } catch (err) {
        this.showToast('error', err.message);
      }
    },

    // 1. Dashboard
    async loadDashboard() {
      const gid = this.getActiveGuildId();
      const query = gid ? `?guildId=${gid}` : '';
      const data = await this.apiFetch(`/api/dashboard${query}`);
      this.stats = data.stats || this.stats;
      this.botsList = data.bots || [];
      this.recentEvents = data.recentEvents || [];
      this.recentAlerts = data.alerts || [];
    },

    // 2. Bots & Management
    async loadBots() {
      const gid = this.getActiveGuildId();
      const query = gid ? `?guildId=${gid}` : '';
      this.botsList = await this.apiFetch(`/api/bots${query}`);
    },

    async openBotDrawer(bot) {
      this.botDrawer.bot = bot;
      this.botDrawer.tab = 'general';
      this.botDrawer.open = true;

      // Загрузка логов действий
      this.botDrawer.actionLogs = await this.apiFetch(`/api/bots/${bot.name}/actions`).catch(() => []);

      // Если это Guard, загружаем настройки модерации
      if (bot.name === 'guard' || bot.bot_type === 'guard') {
        const gid = this.getActiveGuildId() || this.guilds.main.id;
        this.botDrawer.guardSettings = await this.apiFetch(`/api/bots/guard/settings?guildId=${gid}`).catch(() => ({}));
      }
    },

    async restartBot(botName) {
      this.openConfirm({
        title: `Перезапуск бота ${botName}`,
        message: `Вы действительно хотите перезапустить процесс бота ${botName}?`,
        confirmBtnText: 'Перезапустить',
        onConfirm: async () => {
          try {
            await this.apiFetch(`/api/bots/${botName}/restart`, { method: 'POST' });
            this.showToast('success', `Команда перезапуска отправлена для ${botName}`);
            await this.loadBots();
          } catch (e) {
            this.showToast('error', e.message);
          }
        }
      });
    },

    async toggleModule(botName, moduleName, currentState) {
      const newState = !currentState;
      try {
        await this.apiFetch(`/api/bots/${botName}/modules/${moduleName}`, {
          method: 'POST',
          body: JSON.stringify({ enabled: newState }),
        });
        this.showToast('success', `Модуль ${moduleName} ${newState ? 'включен' : 'отключен'}`);
        await this.loadBots();
        if (this.botDrawer.bot && this.botDrawer.bot.name === botName) {
          const updated = this.botsList.find(b => b.name === botName);
          if (updated) this.botDrawer.bot = updated;
        }
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async saveGuardSettings() {
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      try {
        await this.apiFetch(`/api/bots/guard/settings?guildId=${gid}`, {
          method: 'POST',
          body: JSON.stringify(this.botDrawer.guardSettings),
        });
        this.showToast('success', 'Настройки Guard успешно сохранены');
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async createBot() {
      try {
        await this.apiFetch('/api/bots', {
          method: 'POST',
          body: JSON.stringify(this.newBotModal),
        });
        this.showToast('success', 'Бот успешно добавлен');
        this.newBotModal.open = false;
        await this.loadBots();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    // 3. Role Sync
    async loadRoleSyncData() {
      this.roleMaps = await this.apiFetch('/api/rolesync/mappings');
      this.pendingSync = await this.apiFetch('/api/rolesync/pending');
      const logsResult = await this.apiFetch('/api/rolesync/logs?limit=30');
      this.syncLogs = logsResult.items || [];
    },

    async triggerFullResync() {
      try {
        await this.apiFetch('/api/rolesync/full-resync', { method: 'POST' });
        this.showToast('success', 'Запущен полный ресинк ролей');
        await this.loadRoleSyncData();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async createRoleMap() {
      try {
        await this.apiFetch('/api/rolesync/mappings', {
          method: 'POST',
          body: JSON.stringify(this.newRoleMapModal),
        });
        this.showToast('success', 'Связка ролей добавлена');
        this.newRoleMapModal.open = false;
        await this.loadRoleSyncData();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async toggleRoleMap(id, enabled) {
      try {
        await this.apiFetch(`/api/rolesync/mappings/${id}/toggle`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !enabled }),
        });
        await this.loadRoleSyncData();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async deleteRoleMap(id) {
      this.openConfirm({
        title: 'Удаление связки ролей',
        message: 'Вы уверены, что хотите удалить эту связь?',
        onConfirm: async () => {
          try {
            await this.apiFetch(`/api/rolesync/mappings/${id}`, { method: 'DELETE' });
            this.showToast('success', 'Связка удалена');
            await this.loadRoleSyncData();
          } catch (e) {
            this.showToast('error', e.message);
          }
        }
      });
    },

    // 4. Permissions & Access
    async loadPermissions() {
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      const data = await this.apiFetch(`/api/permissions?guildId=${gid}`);
      this.accessSettings = {
        root_owner_ids: (data.owner_ids || []).join(', ') || '',
        whitelist_users: data.whitelist_users || data.trustedUsers || [],
        whitelist_roles: data.whitelist_roles || data.trustedRoles || [],
        newTrustedId: '',
        newTrustedRoleId: '',
      };
    },

    async addTrustedUser() {
      const userId = (this.accessSettings.newTrustedId || '').trim();
      if (!userId) {
        this.showToast('error', 'Введите Discord ID пользователя');
        return;
      }
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      try {
        await this.apiFetch(`/api/permissions/whitelist/users?guildId=${gid}`, {
          method: 'POST',
          body: JSON.stringify({ userId }),
        });
        this.accessSettings.newTrustedId = '';
        this.showToast('success', `Пользователь ${userId} добавлен в Whitelist`);
        await this.loadPermissions();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async removeTrustedUser(userId) {
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      try {
        await this.apiFetch(`/api/permissions/whitelist/users?guildId=${gid}`, {
          method: 'DELETE',
          body: JSON.stringify({ userId }),
        });
        this.showToast('success', `Пользователь ${userId} удален из Whitelist`);
        await this.loadPermissions();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async addTrustedRole() {
      const roleId = (this.accessSettings.newTrustedRoleId || '').trim();
      if (!roleId) {
        this.showToast('error', 'Выберите роль или введите ID роли');
        return;
      }
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      const roleObj = this.getRoleById(roleId);
      const roleName = roleObj?.name || roleId;
      try {
        await this.apiFetch(`/api/permissions/whitelist/roles?guildId=${gid}`, {
          method: 'POST',
          body: JSON.stringify({ roleId }),
        });
        this.accessSettings.newTrustedRoleId = '';
        this.showToast('success', `Роль "${roleName}" добавлена в Whitelist`);
        await this.loadPermissions();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async removeTrustedRole(roleId) {
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      const roleObj = this.getRoleById(roleId);
      const roleName = roleObj?.name || roleId;
      try {
        await this.apiFetch(`/api/permissions/whitelist/roles?guildId=${gid}`, {
          method: 'DELETE',
          body: JSON.stringify({ roleId }),
        });
        this.showToast('success', `Роль "${roleName}" удалена из Whitelist`);
        await this.loadPermissions();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    // 5. Moderation
    async loadModerationCases() {
      const params = new URLSearchParams({
        page: this.modCases.page,
        limit: 20,
        search: this.modFilters.search,
        type: this.modFilters.type,
      });
      const gid = this.getActiveGuildId();
      if (gid) params.append('guildId', gid);

      this.modCases = await this.apiFetch(`/api/moderation/cases?${params.toString()}`);
    },

    async loadActivePunishments() {
      const gid = this.getActiveGuildId();
      const query = gid ? `?guildId=${gid}` : '';
      this.activePunishments = await this.apiFetch(`/api/moderation/active${query}`);
    },

    async viewUserHistory(userId) {
      this.userHistoryModal.userId = userId;
      this.userHistoryModal.open = true;
      this.userHistoryModal.data = await this.apiFetch(`/api/moderation/users/${userId}/history`);
    },

    async issuePunishment() {
      const gid = this.newPunishModal.guildId || this.getActiveGuildId() || this.guilds.main.id;
      try {
        await this.apiFetch('/api/moderation/punish', {
          method: 'POST',
          body: JSON.stringify({
            userId: this.newPunishModal.userId,
            guildId: gid,
            action: this.newPunishModal.action,
            durationMinutes: this.newPunishModal.durationMinutes,
            reason: this.newPunishModal.reason,
          }),
        });
        this.showToast('success', 'Наказание успешно применено');
        this.newPunishModal.open = false;
        await this.loadModerationCases();
        await this.loadActivePunishments();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async revokePunishment(caseId, type) {
      this.openConfirm({
        title: 'Снятие наказания',
        message: `Вы действительно хотите досрочно снять наказание #${caseId}?`,
        onConfirm: async () => {
          try {
            await this.apiFetch(`/api/moderation/cases/${caseId}/revoke`, { method: 'POST' });
            this.showToast('success', 'Наказание снято');
            await this.loadModerationCases();
            await this.loadActivePunishments();
          } catch (e) {
            this.showToast('error', e.message);
          }
        }
      });
    },

    // 6. Economy
    async loadEconomyData() {
      const [stats, leaderboard, txs, shop, settings] = await Promise.all([
        this.apiFetch('/api/economy/stats'),
        this.apiFetch('/api/economy/leaderboard?limit=10'),
        this.apiFetch('/api/economy/transactions?limit=20'),
        this.apiFetch('/api/economy/shop'),
        this.apiFetch('/api/economy/settings'),
      ]);
      this.ecoStats = stats;
      this.ecoLeaderboard = leaderboard;
      this.ecoTransactions = txs.items || [];
      this.ecoShopItems = shop;
      this.ecoSettings = settings;
      this.ecoSettingsModified = false;
    },

    async openWalletModal(userId) {
      this.userWalletModal.userId = userId;
      this.userWalletModal.wallet = await this.apiFetch(`/api/economy/wallets/${userId}`);
      this.userWalletModal.open = true;
    },

    async executeWalletAction() {
      if (!this.userWalletModal.reason) {
        this.showToast('error', 'Причина операции обязательна');
        return;
      }
      try {
        await this.apiFetch(`/api/economy/wallets/${this.userWalletModal.userId}/${this.userWalletModal.action}`, {
          method: 'POST',
          body: JSON.stringify({
            amount: Number(this.userWalletModal.amount),
            reason: this.userWalletModal.reason,
          }),
        });
        this.showToast('success', 'Баланс успешно обновлен');
        this.userWalletModal.open = false;
        await this.loadEconomyData();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async saveEconomySettings() {
      try {
        await this.apiFetch('/api/economy/settings', {
          method: 'POST',
          body: JSON.stringify(this.ecoSettings),
        });
        this.showToast('success', 'Настройки экономики сохранены');
        this.ecoSettingsModified = false;
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    // 7. Anticrash
    async loadAnticrashData() {
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      const [rules, lockdown, snapshots, incidents, roleRules] = await Promise.all([
        this.apiFetch(`/api/anticrash/rules?guildId=${gid}`).catch(() => []),
        this.apiFetch(`/api/anticrash/lockdown?guildId=${gid}`).catch(() => ({ active: false })),
        this.apiFetch(`/api/anticrash/snapshots?guildId=${gid}`).catch(() => []),
        this.apiFetch(`/api/anticrash/incidents?guildId=${gid}`).catch(() => []),
        this.apiFetch(`/api/anticrash/role-rules?guildId=${gid}`).catch(() => []),
      ]);
      this.anticrashRules = rules;
      this.lockdownStatus = Boolean(lockdown.active || lockdown.enabled);
      this.snapshots = snapshots;
      this.incidents = incidents;
      this.anticrashRoleRules = roleRules;
      this.anticrashModified = false;
    },

    openAddRoleRuleModal() {
      const defaultPerms = {};
      for (const act of this.anticrashActionTypes) {
        defaultPerms[act.key] = {
          allowed: true,
          limit: 3,
          window: 60,
          action: 'quarantine',
        };
      }
      this.roleRuleModal = {
        open: true,
        isEdit: false,
        roleId: '',
        roleName: '',
        permissions: defaultPerms,
      };
    },

    openEditRoleRuleModal(rule) {
      const perms = {};
      for (const act of this.anticrashActionTypes) {
        perms[act.key] = rule.permissions?.[act.key] ? { ...rule.permissions[act.key] } : {
          allowed: true,
          limit: 3,
          window: 60,
          action: 'quarantine',
        };
      }
      this.roleRuleModal = {
        open: true,
        isEdit: true,
        roleId: rule.role_id,
        roleName: rule.role_name || rule.role_id,
        permissions: perms,
      };
    },

    async saveRoleRule() {
      if (!this.roleRuleModal.roleId) {
        this.showToast('error', 'Выберите роль');
        return;
      }
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      const roleObj = this.getRoleById(this.roleRuleModal.roleId);
      const roleName = roleObj?.name || this.roleRuleModal.roleName || this.roleRuleModal.roleId;

      try {
        await this.apiFetch('/api/anticrash/role-rules', {
          method: 'POST',
          body: JSON.stringify({
            guildId: gid,
            roleId: this.roleRuleModal.roleId,
            roleName,
            permissions: this.roleRuleModal.permissions,
          }),
        });
        this.showToast('success', `Лимиты антикраша для роли "${roleName}" успешно сохранены`);
        this.roleRuleModal.open = false;
        await this.loadAnticrashData();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async deleteRoleRule(roleId, roleName) {
      this.openConfirm({
        title: `Сброс правил для роли ${roleName || roleId}`,
        message: `Вы действительно хотите удалить персональные правила антикраша для роли "${roleName || roleId}"?`,
        confirmBtnText: 'Удалить правила',
        confirmBtnClass: 'btn-danger',
        onConfirm: async () => {
          try {
            const gid = this.getActiveGuildId() || this.guilds.main.id;
            await this.apiFetch(`/api/anticrash/role-rules/${roleId}?guildId=${gid}`, { method: 'DELETE' });
            this.showToast('success', 'Правила для роли сброшены');
            await this.loadAnticrashData();
          } catch (e) {
            this.showToast('error', e.message);
          }
        }
      });
    },

    async toggleLockdown() {
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      const newState = !this.lockdownStatus;
      this.openConfirm({
        title: `${newState ? 'Активация' : 'Отключение'} Lockdown`,
        message: newState
          ? 'ВНИМАНИЕ: Бот закроет права на отправку сообщений для @everyone на всех каналах!'
          : 'Снять режим блокировки серверов?',
        confirmBtnClass: newState ? 'btn-danger' : 'btn-primary',
        onConfirm: async () => {
          try {
            await this.apiFetch(`/api/anticrash/lockdown?guildId=${gid}`, {
              method: 'POST',
              body: JSON.stringify({ enabled: newState }),
            });
            this.lockdownStatus = newState;
            this.showToast(newState ? 'error' : 'success', `Lockdown ${newState ? 'включен' : 'снят'}`);
          } catch (e) {
            this.showToast('error', e.message);
          }
        }
      });
    },

    async saveAnticrashRules() {
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      try {
        await this.apiFetch(`/api/anticrash/rules?guildId=${gid}`, {
          method: 'POST',
          body: JSON.stringify({ rules: this.anticrashRules }),
        });
        this.showToast('success', 'Правила антикраша успешно обновлены');
        this.anticrashModified = false;
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async createSnapshot() {
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      try {
        await this.apiFetch(`/api/anticrash/snapshots?guildId=${gid}`, { method: 'POST' });
        this.showToast('success', 'Снапшот структуры успешно создан');
        await this.loadAnticrashData();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async restoreSnapshot(id) {
      this.openConfirm({
        title: 'Восстановление структуры из снапшота',
        message: 'Для подтверждения восстановления структуры каналов и ролей введите "RESTORE":',
        requireInput: 'RESTORE',
        onConfirm: async () => {
          try {
            await this.apiFetch(`/api/anticrash/snapshots/${id}/restore`, {
              method: 'POST',
              body: JSON.stringify({ confirmation: 'RESTORE' }),
            });
            this.showToast('success', 'Восстановление структуры успешно завершено');
          } catch (e) {
            this.showToast('error', e.message);
          }
        }
      });
    },

    // 8. Logs
    async loadLogs() {
      const params = new URLSearchParams({
        page: this.logsData.page,
        limit: 30,
        bot: this.logFilters.bot,
        type: this.logFilters.type,
        level: this.logFilters.level,
      });
      const gid = this.getActiveGuildId();
      if (gid) params.append('guildId', gid);

      this.logsData = await this.apiFetch(`/api/logs?${params.toString()}`);
    },

    async loadErrors() {
      this.systemErrors = await this.apiFetch('/api/logs/errors');
    },

    async resolveError(id) {
      try {
        await this.apiFetch(`/api/logs/errors/${id}/resolve`, { method: 'PATCH' });
        this.showToast('success', 'Ошибка помечена как решенная');
        await this.loadErrors();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    // 9. Log Channels
    async loadLogChannels() {
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      const res = await this.apiFetch(`/api/logchannels?guildId=${gid}`);
      this.logChannels = res.channels || {};
    },

    async saveLogChannels() {
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      try {
        await this.apiFetch('/api/logchannels', {
          method: 'POST',
          body: JSON.stringify({ guildId: gid, channels: this.logChannels }),
        });
        this.showToast('success', 'Каналы логирования обновлены');
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    // 10. Backups
    async loadBackups() {
      this.backupsList = await this.apiFetch('/api/backups');
    },

    async createBackup() {
      try {
        await this.apiFetch('/api/backups', {
          method: 'POST',
          body: JSON.stringify({ notes: 'Создан через консоль управления' }),
        });
        this.showToast('success', 'Резервная копия успешно создана');
        await this.loadBackups();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async restoreBackup(filename) {
      this.openConfirm({
        title: 'Восстановление базы данных',
        message: `ВНИМАНИЕ: Текущая база данных будет заменена на ${filename}. Для подтверждения введите "RESTORE":`,
        requireInput: 'RESTORE',
        onConfirm: async () => {
          try {
            await this.apiFetch(`/api/backups/${filename}/restore`, {
              method: 'POST',
              body: JSON.stringify({ confirmation: 'RESTORE' }),
            });
            this.showToast('success', 'База данных успешно восстановлена');
            setTimeout(() => window.location.reload(), 1500);
          } catch (e) {
            this.showToast('error', e.message);
          }
        }
      });
    },

    async deleteBackup(filename) {
      this.openConfirm({
        title: 'Удаление бэкапа',
        message: `Удалить файл ${filename}?`,
        onConfirm: async () => {
          try {
            await this.apiFetch(`/api/backups/${filename}`, { method: 'DELETE' });
            this.showToast('success', 'Бэкап удален');
            await this.loadBackups();
          } catch (e) {
            this.showToast('error', e.message);
          }
        }
      });
    },

    // 11. Panel Admins
    async loadPanelUsers() {
      this.panelUsersList = await this.apiFetch('/api/settings/admins');
    },

    async loadAuditLogs() {
      this.auditLogs = await this.apiFetch(`/api/settings/audit?page=${this.auditLogs.page}&limit=25`);
    },

    async addPanelAdmin() {
      try {
        await this.apiFetch('/api/settings/admins', {
          method: 'POST',
          body: JSON.stringify(this.newAdminModal),
        });
        this.showToast('success', 'Администратор добавлен');
        this.newAdminModal.open = false;
        await this.loadPanelUsers();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async updateAdminRole(discordId, role) {
      try {
        await this.apiFetch(`/api/settings/admins/${discordId}`, {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        });
        this.showToast('success', 'Роль обновлена');
        await this.loadPanelUsers();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async deletePanelAdmin(discordId) {
      this.openConfirm({
        title: 'Удаление доступа к панели',
        message: `Отозвать доступ для пользователя ${discordId}?`,
        onConfirm: async () => {
          try {
            await this.apiFetch(`/api/settings/admins/${discordId}`, { method: 'DELETE' });
            this.showToast('success', 'Доступ отозван');
            await this.loadPanelUsers();
          } catch (e) {
            this.showToast('error', e.message);
          }
        }
      });
    },

    // ========================================================================
    // КАНАЛЫ И РОЛИ (Channels & Roles Management)
    // ========================================================================
    async loadChannels() {
      const gid = this.getActiveGuildId() || this.guilds.main.id;
      try {
        const data = await this.apiFetch(`/api/channels?guildId=${gid}`);
        this.channelsData = data;
      } catch (e) {
        this.showToast('error', `Ошибка загрузки каналов: ${e.message}`);
      }
    },

    get filteredChannels() {
      if (!this.channelsData?.channels) return [];
      if (this.channelFilter === 'all') return this.channelsData.channels;
      if (this.channelFilter === 'admin') return this.channelsData.channels.filter(c => c.groupType === 'admin');
      if (this.channelFilter === 'transit') return this.channelsData.channels.filter(c => c.groupType === 'transit');
      if (this.channelFilter === 'logs') return this.channelsData.channels.filter(c => c.groupType && c.groupType.startsWith('log_'));
      if (this.channelFilter === 'general') return this.channelsData.channels.filter(c => c.groupType === 'general');
      return this.channelsData.channels;
    },

    openNewChannelModal() {
      this.newChannelModal = {
        open: true,
        guildId: this.getActiveGuildId() || this.guilds.main.id,
        name: '',
        type: 'text',
        groupType: 'admin',
        categoryId: '',
        categoryName: '',
        isEnforced: true,
      };
    },

    async createChannel() {
      if (!this.newChannelModal.name.trim()) {
        this.showToast('error', 'Введите название канала');
        return;
      }

      try {
        await this.apiFetch('/api/channels/create', {
          method: 'POST',
          body: JSON.stringify(this.newChannelModal),
        });
        this.showToast('success', `Канал #${this.newChannelModal.name} успешно создан через веб-панель`);
        this.newChannelModal.open = false;
        await this.loadChannels();
        await this.loadDiscordMetadata();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    openEditChannelModal(c) {
      this.editChannelModal = {
        open: true,
        guildId: this.getActiveGuildId() || this.guilds.main.id,
        channelId: c.id,
        name: c.name,
        type: c.type,
        groupType: c.groupType,
        categoryId: c.categoryId || '',
        categoryName: c.categoryName || '',
        position: c.position || 0,
        isEnforced: Boolean(c.isEnforced),
      };
    },

    async saveEditChannel() {
      try {
        await this.apiFetch(`/api/channels/${this.editChannelModal.channelId}`, {
          method: 'PATCH',
          body: JSON.stringify(this.editChannelModal),
        });
        this.showToast('success', 'Канал успешно обновлен на сервере');
        this.editChannelModal.open = false;
        await this.loadChannels();
        await this.loadDiscordMetadata();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async deleteChannel(channelId, channelName) {
      this.openConfirm({
        title: `Удаление канала #${channelName}`,
        message: `Вы действительно хотите удалить канал #${channelName}? Это действие необратимо.`,
        confirmBtnText: 'Удалить канал',
        confirmBtnClass: 'btn-danger',
        onConfirm: async () => {
          try {
            const gid = this.getActiveGuildId() || this.guilds.main.id;
            await this.apiFetch(`/api/channels/${channelId}?guildId=${gid}`, { method: 'DELETE' });
            this.showToast('success', `Канал #${channelName} удален`);
            await this.loadChannels();
            await this.loadDiscordMetadata();
          } catch (e) {
            this.showToast('error', e.message);
          }
        }
      });
    },

    async enforceChannels() {
      try {
        const gid = this.getActiveGuildId();
        const res = await this.apiFetch('/api/channels/enforce', {
          method: 'POST',
          body: JSON.stringify({ guildId: gid }),
        });
        const details = res.result;
        const restored = (details.restored ?? ((details.staff?.restored || 0) + (details.main?.restored || 0))) || 0;
        const repositioned = (details.repositioned ?? ((details.staff?.repositioned || 0) + (details.main?.repositioned || 0))) || 0;
        this.showToast('success', `Сверка завершена. Восстановлено каналов: ${restored}, возвращено в категории: ${repositioned}`);
        await this.loadChannels();
      } catch (e) {
        this.showToast('error', e.message);
      }
    },

    async setupDefaultChannels() {
      this.openConfirm({
        title: 'Развертывание базовой структуры',
        message: 'Будут созданы категории "⚡ АДМИНИСТРАЦИЯ", "🚪 ПРОХОДНЫЕ КАНАЛЫ", "📋 ЖУРНАЛ АУДИТА" со всеми необходимыми каналами и защитой. Продолжить?',
        confirmBtnText: 'Развернуть',
        confirmBtnClass: 'btn-primary',
        onConfirm: async () => {
          try {
            const gid = this.getActiveGuildId() || this.guilds.main.id;
            await this.apiFetch('/api/channels/setup-defaults', {
              method: 'POST',
              body: JSON.stringify({ guildId: gid }),
            });
            this.showToast('success', 'Базовая структура успешно развернута на сервере');
            await this.loadChannels();
            await this.loadDiscordMetadata();
          } catch (e) {
            this.showToast('error', e.message);
          }
        }
      });
    },

    // Форматирование вспомогательных данных
    formatDate(isoStr) {
      if (!isoStr) return '—';
      const d = new Date(isoStr);
      return d.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    },

    formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
    },

    formatUptime(sec) {
      if (!sec) return '0с';
      const d = Math.floor(sec / 86400);
      const h = Math.floor((sec % 86400) / 3600);
      const m = Math.floor((sec % 3600) / 60);
      return `${d ? d + 'д ' : ''}${h ? h + 'ч ' : ''}${m}м`;
    },

    getRoleById(roleId) {
      const all = [...this.discordRoles.staff, ...this.discordRoles.main];
      return all.find(r => r.id === roleId) || { name: roleId, color: '#8B93A1' };
    },

    getChannelById(chanId) {
      const all = [...this.discordChannels.staff, ...this.discordChannels.main];
      return all.find(c => c.id === chanId) || { name: chanId };
    }
  }));
});
