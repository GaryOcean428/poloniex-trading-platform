-- Paper promotion deadline persistence
-- Replaces in-memory setTimeout for paper→live promotion checks
-- so that Railway redeploys do not lose scheduled evaluations.

CREATE TABLE IF NOT EXISTS paper_promotion_queue (
  id            SERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL,                          -- agent session id
  strategy_id   TEXT NOT NULL,                          -- strategy being evaluated
  due_at        TIMESTAMPTZ NOT NULL,                   -- when to run checkPaperTradingResults
  processed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ppq_due ON paper_promotion_queue (due_at) WHERE NOT processed;
