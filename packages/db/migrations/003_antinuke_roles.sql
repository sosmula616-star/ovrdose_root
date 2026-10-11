-- ==============================================================================
-- МИГРАЦИЯ 003: ГИБКИЕ ПРАВИЛА И ЛИМИТЫ АНТИКРАША ДЛЯ КАЖДОЙ РОЛИ
-- Таблица antinuke_role_rules: персональные лимиты и действия на роль
-- ==============================================================================

CREATE TABLE IF NOT EXISTS antinuke_role_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  role_id     TEXT NOT NULL,
  role_name   TEXT,
  permissions TEXT NOT NULL DEFAULT '{}', -- JSON: { channel_delete: { allowed: false, limit: 0, window: 60, action: 'ban' }, ... }
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(guild_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_antinuke_role_rules_guild ON antinuke_role_rules(guild_id, role_id);
