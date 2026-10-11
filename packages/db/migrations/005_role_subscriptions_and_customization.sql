-- ==============================================================================
-- МИГРАЦИЯ 005: ПОДПИСКИ НА РОЛИ ПО СРОКАМ (1М, 3М, 6М, 1 ГОД, НАВСЕГДА)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS role_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role_id     TEXT NOT NULL,
  period      TEXT NOT NULL, -- '1_month', '3_months', '6_months', '1_year', 'forever'
  price_paid  INTEGER NOT NULL,
  expires_at  TEXT,          -- ISO datetime или NULL для 'forever'
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_role_subs_expires ON role_subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS idx_role_subs_user ON role_subscriptions(guild_id, user_id, role_id);
