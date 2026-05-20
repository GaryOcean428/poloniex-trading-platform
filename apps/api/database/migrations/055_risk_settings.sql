-- Migration 055: risk_settings table — the operator's risk profile.
--
-- The RiskSettings UI (apps/web/src/components/risk/RiskSettings.tsx)
-- PUTs to /api/risk/settings, whose handler upserts `risk_settings`
-- with ON CONFLICT (user_id). No migration ever created the table, so
-- every write silently failed (the route swallows the error in a
-- try/catch) and the panel was a dead control surface.
--
-- This creates the table so the profile actually persists AND can be
-- read by the Monkey kernel — see services/monkey/risk_settings.ts,
-- which applies three honest hard ceilings: a leverage clamp, a
-- max-concurrent-positions gate, and a daily-loss halt.
--
-- Columns and defaults mirror the INSERT in routes/risk.ts exactly.

CREATE TABLE IF NOT EXISTS risk_settings (
  user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_drawdown             NUMERIC(6,2) NOT NULL DEFAULT 15,
  max_position_size        NUMERIC(6,2) NOT NULL DEFAULT 5,
  max_concurrent_positions INTEGER      NOT NULL DEFAULT 3,
  stop_loss                NUMERIC(6,2) NOT NULL DEFAULT 2,
  take_profit              NUMERIC(6,2) NOT NULL DEFAULT 4,
  daily_loss_limit         NUMERIC(6,2) NOT NULL DEFAULT 5,
  max_leverage             INTEGER      NOT NULL DEFAULT 10,
  risk_level               TEXT         NOT NULL DEFAULT 'moderate',
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
