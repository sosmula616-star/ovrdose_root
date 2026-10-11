-- ==============================================================================
-- МИГРАЦИЯ 001: ИНИЦИАЛИЗАЦИЯ СХЕМЫ БАЗЫ ДАННЫХ ROOT-CORE
-- SQLite (better-sqlite3) в режиме WAL
-- ==============================================================================

-- 1. Таблица версий примененных миграций
CREATE TABLE IF NOT EXISTS _migrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 2. Настройки системы и ботов (hot-reload через settings:changed)
CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT    NOT NULL,
  bot         TEXT    NOT NULL DEFAULT 'global', -- 'root', 'guard', 'global'
  key         TEXT    NOT NULL,
  value       TEXT,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(guild_id, bot, key)
);
CREATE INDEX IF NOT EXISTS idx_settings_lookup ON settings(guild_id, bot, key);

-- 3. Маппинг синхронизации ролей между серверами (Staff <-> Main)
CREATE TABLE IF NOT EXISTS role_map (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_role_id TEXT    NOT NULL,
  main_role_id  TEXT    NOT NULL,
  direction     TEXT    NOT NULL DEFAULT 'staff_to_main', -- 'staff_to_main', 'both'
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(staff_role_id, main_role_id)
);

-- 4. Очередь отложенной синхронизации ролей (для пользователей, отсутствующих на 2-м сервере)
CREATE TABLE IF NOT EXISTS pending_sync (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT    NOT NULL,
  target_guild  TEXT    NOT NULL,
  role_id       TEXT    NOT NULL,
  action        TEXT    NOT NULL, -- 'add', 'remove'
  reason        TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, target_guild, role_id, action)
);

-- 5. Журнал синхронизации ролей
CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    NOT NULL,
  action      TEXT    NOT NULL, -- 'add', 'remove', 'error'
  role_id     TEXT    NOT NULL,
  guild_id    TEXT    NOT NULL,
  reason      TEXT,
  success     INTEGER NOT NULL DEFAULT 1,
  error       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sync_log_created ON sync_log(created_at DESC);

-- 6. Реестр внешних и внутренних ботов
CREATE TABLE IF NOT EXISTS bots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE, -- 'root', 'guard', etc.
  client_id     TEXT,
  type          TEXT    NOT NULL DEFAULT 'external', -- 'internal', 'external'
  description   TEXT,
  pm2_name      TEXT,
  health_url    TEXT,
  status        TEXT    NOT NULL DEFAULT 'offline', -- 'online', 'offline', 'error', 'restarting'
  version       TEXT,
  max_roles_pos INTEGER DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 7. Серверы, на которых разрешено присутствие ботов (bot_servers)
CREATE TABLE IF NOT EXISTS bot_servers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_name    TEXT    NOT NULL REFERENCES bots(name) ON DELETE CASCADE,
  guild_id    TEXT    NOT NULL,
  allowed     INTEGER NOT NULL DEFAULT 1,
  added_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bot_name, guild_id)
);

-- 8. Сигналы Heartbeat от ботов (раз в 15 секунд)
CREATE TABLE IF NOT EXISTS heartbeats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot         TEXT    NOT NULL,
  ping_ms     INTEGER,
  ram_mb      REAL,
  uptime_sec  INTEGER,
  guild_count INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_bot ON heartbeats(bot, created_at DESC);

-- 9. Журнал действий ботов (сверка с Audit Log Discord)
CREATE TABLE IF NOT EXISTS bot_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id      TEXT    NOT NULL,
  bot_name    TEXT,
  guild_id    TEXT    NOT NULL,
  action_type TEXT    NOT NULL,
  target_id   TEXT,
  details     TEXT    DEFAULT '{}',
  flagged     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bot_actions_lookup ON bot_actions(bot_id, created_at DESC);

-- 10. Кейсы модерации
CREATE TABLE IF NOT EXISTS cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number   INTEGER NOT NULL,
  guild_id      TEXT    NOT NULL,
  type          TEXT    NOT NULL, -- 'warn', 'mute', 'kick', 'ban', 'unban', 'unmute', 'note'
  target_id     TEXT    NOT NULL,
  target_tag    TEXT,
  moderator_id  TEXT    NOT NULL,
  moderator_tag TEXT,
  reason        TEXT,
  duration      INTEGER,
  expires_at    TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  metadata      TEXT    DEFAULT '{}',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cases_target ON cases(guild_id, target_id);
CREATE INDEX IF NOT EXISTS idx_cases_type ON cases(guild_id, type);

-- 11. Предупреждения (Warns)
CREATE TABLE IF NOT EXISTS warns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  moderator_id  TEXT    NOT NULL,
  reason        TEXT    NOT NULL,
  case_id       INTEGER REFERENCES cases(id),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_warns_user ON warns(guild_id, user_id, active);

-- 12. Муты (Mutes - voice / text)
CREATE TABLE IF NOT EXISTS mutes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  moderator_id  TEXT    NOT NULL,
  type          TEXT    NOT NULL DEFAULT 'text', -- 'text', 'voice', 'both'
  reason        TEXT,
  duration      INTEGER,
  expires_at    TEXT,
  case_id       INTEGER REFERENCES cases(id),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mutes_user ON mutes(guild_id, user_id, active);

-- 13. Заметки модераторов
CREATE TABLE IF NOT EXISTS notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  moderator_id  TEXT    NOT NULL,
  note          TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 14. Экономика: Кошельки пользователей (общие по user_id)
CREATE TABLE IF NOT EXISTS wallets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL UNIQUE,
  balance      INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  bank         INTEGER NOT NULL DEFAULT 0 CHECK (bank >= 0),
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_spent  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wallets_balance ON wallets(balance DESC);

-- 15. Транзакции экономики (полный аудит операций)
CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT    NOT NULL,
  type          TEXT    NOT NULL, -- 'daily', 'work', 'pay_send', 'pay_receive', 'admin_give', 'admin_take', 'admin_set', 'shop_buy'
  amount        INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  target_id     TEXT,
  description   TEXT,
  metadata      TEXT    DEFAULT '{}',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);

-- 16. Магазин товаров
CREATE TABLE IF NOT EXISTS shop_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  description   TEXT,
  price         INTEGER NOT NULL CHECK (price >= 0),
  role_id       TEXT,   -- Выдаваемая роль в случае роли-награды
  stock         INTEGER, -- NULL = безлимит
  enabled       INTEGER NOT NULL DEFAULT 1,
  metadata      TEXT    DEFAULT '{}',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 17. Инвентарь пользователей
CREATE TABLE IF NOT EXISTS inventory (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    NOT NULL,
  item_id     INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  acquired_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, item_id)
);

-- 18. Кулдауны команд (daily, work и др.)
CREATE TABLE IF NOT EXISTS cooldowns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    NOT NULL,
  command     TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  UNIQUE(user_id, command)
);
CREATE INDEX IF NOT EXISTS idx_cooldowns_lookup ON cooldowns(user_id, command);

-- 19. Системные логи
CREATE TABLE IF NOT EXISTS logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot         TEXT    NOT NULL DEFAULT 'root',
  guild_id    TEXT,
  type        TEXT    NOT NULL, -- 'security', 'economy', 'sync', 'bots', 'general'
  level       TEXT    NOT NULL DEFAULT 'info', -- 'info', 'warn', 'error'
  message     TEXT    NOT NULL,
  metadata    TEXT    DEFAULT '{}',
  user_id     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_filter ON logs(bot, type, created_at DESC);

-- 20. Логи ошибок системы и ботов
CREATE TABLE IF NOT EXISTS errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot         TEXT    NOT NULL DEFAULT 'root',
  guild_id    TEXT,
  error_type  TEXT,
  message     TEXT    NOT NULL,
  stack       TEXT,
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 21. Снапшоты серверов
CREATE TABLE IF NOT EXISTS snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  data        TEXT    NOT NULL, -- JSON полная структура каналов и ролей
  size_bytes  INTEGER,
  created_by  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 22. Инциденты антикраша и безопасности
CREATE TABLE IF NOT EXISTS incidents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT    NOT NULL,
  event_type   TEXT    NOT NULL,
  user_id      TEXT,
  user_tag     TEXT,
  details      TEXT    DEFAULT '{}',
  action_taken TEXT,
  resolved     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at DESC);

-- 23. Пользователи веб-панели (RBAC: owner, admin, viewer)
CREATE TABLE IF NOT EXISTS panel_users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT    NOT NULL UNIQUE,
  discord_tag TEXT    NOT NULL,
  avatar      TEXT,
  role        TEXT    NOT NULL DEFAULT 'viewer', -- 'owner', 'admin', 'viewer'
  added_by    TEXT,
  last_login  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 24. Журнал аудита действий в панели
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    TEXT    NOT NULL,
  admin_tag   TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  section     TEXT,
  target_id   TEXT,
  old_value   TEXT,
  new_value   TEXT,
  ip_address  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit(created_at DESC);

-- 25. Резервные копии базы данных
CREATE TABLE IF NOT EXISTS backups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT    NOT NULL UNIQUE,
  size_bytes  INTEGER,
  created_by  TEXT    NOT NULL,
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
