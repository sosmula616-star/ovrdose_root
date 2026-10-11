-- ==============================================================================
-- МИГРАЦИЯ 004: КАСТОМНЫЕ РОЛИ, МАРКЕТПЛЕЙС И СТАТИСТИКА СТАФФА
-- ==============================================================================

-- 1. Кастомные декоративные роли, создаваемые участниками за монеты
CREATE TABLE IF NOT EXISTS custom_roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  owner_id      TEXT NOT NULL,            -- Discord ID создателя роли
  role_id       TEXT NOT NULL UNIQUE,     -- Discord ID созданной роли
  name          TEXT NOT NULL,            -- Название роли
  color         TEXT NOT NULL DEFAULT '#C8A96A', -- HEX цвет
  icon          TEXT,                            -- Эмодзи или URL иконки роли для буста
  is_gradient   INTEGER NOT NULL DEFAULT 0,      -- 1 = куплено градиентное оформление
  for_sale      INTEGER NOT NULL DEFAULT 0, -- 1 = выставлена на маркетплейс
  price         INTEGER NOT NULL DEFAULT 0, -- Цена на маркетплейсе
  buyers_count  INTEGER NOT NULL DEFAULT 0, -- Количество купивших пользователей
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_custom_roles_guild ON custom_roles(guild_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_custom_roles_market ON custom_roles(guild_id, for_sale);

-- 2. Статистика персонала и модерации
CREATE TABLE IF NOT EXISTS staff_stats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  user_tag        TEXT,
  verified_count  INTEGER NOT NULL DEFAULT 0, -- Количество верификаций (!verify)
  bans_count      INTEGER NOT NULL DEFAULT 0, -- Баны
  mutes_count     INTEGER NOT NULL DEFAULT 0, -- Муты / Таймауты
  kicks_count     INTEGER NOT NULL DEFAULT 0, -- Кики
  warns_count     INTEGER NOT NULL DEFAULT 0, -- Варны
  reports_count   INTEGER NOT NULL DEFAULT 0, -- Рассмотренные репорты
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_stats_lookup ON staff_stats(guild_id, user_id);
