-- ==============================================================================
-- МИГРАЦИЯ 002: УПРАВЛЕНИЕ КАНАЛАМИ И СТРУКТУРОЙ СЕРВЕРА
-- Таблица managed_channels для авто-восстановления и контроля целостности
-- ==============================================================================

CREATE TABLE IF NOT EXISTS managed_channels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  channel_id    TEXT,
  name          TEXT    NOT NULL,
  type          TEXT    NOT NULL DEFAULT 'text', -- 'text', 'voice', 'category', 'announcement', 'stage'
  group_type    TEXT    NOT NULL DEFAULT 'general', -- 'admin', 'transit', 'log_text', 'log_voice', 'log_roles', 'log_audit', 'general'
  category_name TEXT,
  category_id   TEXT,
  position      INTEGER DEFAULT 0,
  is_enforced   INTEGER NOT NULL DEFAULT 1, -- 1 = пересоздавать при удалении, возвращать при перемещении
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(guild_id, name, group_type)
);

CREATE INDEX IF NOT EXISTS idx_managed_channels_guild ON managed_channels(guild_id, group_type);
CREATE INDEX IF NOT EXISTS idx_managed_channels_lookup ON managed_channels(guild_id, channel_id);
