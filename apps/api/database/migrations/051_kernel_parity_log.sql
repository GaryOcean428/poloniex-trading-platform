-- 051_kernel_parity_log.sql
--
-- Issue #689 — Python K shadow under translation-only discipline.
--
-- Mirror of /governance/regime-parity's in-memory ring (#695) but
-- persisted: every K-block tick in apps/api/src/services/monkey/loop.ts
-- fans out the same inputs to the ml-worker /monkey/k-shadow/tick
-- endpoint AFTER TS K computes its decision and BEFORE execution. The
-- TS decision is unchanged; the Python would-be decision is captured
-- next to it so the cutover PR (Py K authoritative) ships only after
-- the operator has a representative parity window.
--
-- Schema notes:
--   * tick_id is a per-tick correlation UUID (TS-generated) so rows
--     can be joined back to monkey_decisions / agent_events if needed.
--   * ts_* columns are NOT NULL (TS K always produces a decision); py_*
--     columns are nullable (Python shadow may be down or timeout).
--   * py_error captures the failure mode when py_* is null — e.g.
--     "timeout", "HTTP 500", "fetch error: ECONNREFUSED" — surfaced
--     in /governance/k-parity so operators can confirm the shadow is
--     actually reaching ml-worker.
--   * agree_action / agree_side / delta_phi / delta_kappa are
--     GENERATED ALWAYS AS ... STORED so the disagreement query path
--     (idx_kparity_disagreements) doesn't need a runtime expression.
--   * IS NOT DISTINCT FROM handles NULL == NULL as TRUE for agree_side
--     so a hold-on-both side (both null) registers as agreement.
--
-- Idempotent: CREATE TABLE / CREATE INDEX use IF NOT EXISTS; GENERATED
-- columns are wrapped in a DO-block guard so re-apply on a partially-
-- migrated DB doesn't error.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'kernel_parity_log'
  ) THEN
    CREATE TABLE kernel_parity_log (
      id BIGSERIAL PRIMARY KEY,
      tick_id UUID NOT NULL,
      symbol VARCHAR(50) NOT NULL,
      symbol_timestamp TIMESTAMP NOT NULL,
      ts_action VARCHAR(20) NOT NULL,
      ts_side VARCHAR(10),
      ts_phi NUMERIC,
      ts_kappa NUMERIC,
      ts_M NUMERIC,
      ts_Gamma NUMERIC,
      ts_R INTEGER,
      ts_regime VARCHAR(30),
      ts_decision_ms INTEGER,
      py_action VARCHAR(20),
      py_side VARCHAR(10),
      py_phi NUMERIC,
      py_kappa NUMERIC,
      py_M NUMERIC,
      py_Gamma NUMERIC,
      py_R INTEGER,
      py_regime VARCHAR(30),
      py_decision_ms INTEGER,
      py_error VARCHAR(255),
      agree_action BOOLEAN
        GENERATED ALWAYS AS (ts_action = py_action) STORED,
      agree_side BOOLEAN
        GENERATED ALWAYS AS (ts_side IS NOT DISTINCT FROM py_side) STORED,
      delta_phi NUMERIC
        GENERATED ALWAYS AS (ABS(ts_phi - py_phi)) STORED,
      delta_kappa NUMERIC
        GENERATED ALWAYS AS (ABS(ts_kappa - py_kappa)) STORED,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;
END $$;

-- Hot read path for /governance/k-parity (symbol + recency).
CREATE INDEX IF NOT EXISTS idx_kparity_symbol_time
  ON kernel_parity_log(symbol, symbol_timestamp DESC);

-- Partial index — only the rows where TS and Py disagree on action.
-- Used by ops queries that surface "where is the shadow diverging?"
-- WHERE NOT agree_action excludes both matches AND py-null rows
-- (NULL fails the NOT condition); a separate query path filters
-- py_error IS NOT NULL when we want to see shadow outages.
CREATE INDEX IF NOT EXISTS idx_kparity_disagreements
  ON kernel_parity_log(created_at DESC)
  WHERE NOT agree_action;
