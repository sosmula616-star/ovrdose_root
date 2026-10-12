-- 006_moderation_enhancements.sql
-- История ников и поддержка расширенных наказаний / варнов с таймерами

CREATE TABLE IF NOT EXISTS nickname_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  old_nickname  TEXT,
  new_nickname  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nickname_history_user ON nickname_history(guild_id, user_id, created_at DESC);

-- Таблица для активных ролевых предупреждений с таймером (1 час, 3 часа, 6 часов)
CREATE TABLE IF NOT EXISTS timed_warns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT    NOT NULL,
  user_id        TEXT    NOT NULL,
  moderator_id   TEXT    NOT NULL,
  reason         TEXT    NOT NULL,
  duration_hours INTEGER NOT NULL, -- 1, 3, 6
  role_id        TEXT,
  expires_at     TEXT    NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_timed_warns_lookup ON timed_warns(guild_id, user_id, active);
