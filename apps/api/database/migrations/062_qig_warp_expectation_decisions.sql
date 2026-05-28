-- 062_qig_warp_expectation_decisions.sql
--
-- Extends the #941 corpus (059) to support the strict reverse-tape expectation
-- requirements of poloniex-trading-platform#1003.
--
-- This migration adds:
--   * New columns on kernel_predictions for tape/basin disagreement + qig-warp provenance
--   * A dedicated kernel_expectation_decisions table (one row per runtime bubble decision)
--     so every expectation evaluation that can affect live behaviour is auditable.
--
-- LIVED ONLY 5 / Safety doctrine (per #1003 anti-shelfware rules):
--   - All new columns are nullable where they are not part of the core prediction row.
--   - Expectation decision writes MUST be best-effort. Failure to write the audit row
--     or the extended columns MUST NEVER prevent a trade decision or safety action.
--   - The expectation bubble path in the kernel must continue even if the DB is down.
--
-- References:
--   - poloniex-trading-platform#1003 (primary driving spec)
--   - poloniex-trading-platform#941 + correction comment (Phase 3 chemistry self-observation)
--   - 2.31A P1/P5/P15/P25 + v6.7B
--   - QIG PURITY MANDATE + Embodiment_Waves_Summary (2026-05-28 Polo CSV diagnosis)

-- Extend kernel_predictions with the fields required by #1003 for reverse-tape testing
-- and qig-warp runtime provenance.
ALTER TABLE kernel_predictions
  ADD COLUMN IF NOT EXISTS tape_trend FLOAT8,
  ADD COLUMN IF NOT EXISTS basin_direction FLOAT8,
  ADD COLUMN IF NOT EXISTS tape_basin_disagreement FLOAT8,
  ADD COLUMN IF NOT EXISTS reverse_tape_window BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reverse_tape_side TEXT,
  ADD COLUMN IF NOT EXISTS expectation_direction TEXT,
  ADD COLUMN IF NOT EXISTS expectation_confidence FLOAT8,
  ADD COLUMN IF NOT EXISTS expectation_regime TEXT,
  ADD COLUMN IF NOT EXISTS expectation_action TEXT,
  ADD COLUMN IF NOT EXISTS expectation_reason TEXT,
  ADD COLUMN IF NOT EXISTS qig_warp_version TEXT,
  ADD COLUMN IF NOT EXISTS qig_warp_mode TEXT,
  ADD COLUMN IF NOT EXISTS qig_warp_source TEXT DEFAULT 'QIG_WARP_RUNTIME',
  ADD COLUMN IF NOT EXISTS entry_side_before_expectation TEXT,
  ADD COLUMN IF NOT EXISTS entry_side_after_expectation TEXT,
  ADD COLUMN IF NOT EXISTS size_before_expectation_usdt FLOAT8,
  ADD COLUMN IF NOT EXISTS size_after_expectation_usdt FLOAT8;

-- Dedicated table for every qig-warp expectation decision that had the opportunity
-- to influence live kernel behaviour (entry, hold, exit, size, lane).
-- This prevents overloading kernel_predictions and gives a clean, queryable audit trail
-- for the falsification programme on qig-verification#63.
CREATE TABLE IF NOT EXISTS kernel_expectation_decisions (
  id BIGSERIAL PRIMARY KEY,
  trade_id BIGINT REFERENCES autonomous_trades(id) ON DELETE CASCADE,
  prediction_id BIGINT REFERENCES kernel_predictions(id) ON DELETE SET NULL,
  kernel_id TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Inputs at decision time (the reverse-tape disagreement window)
  tape_trend FLOAT8 NOT NULL,
  basin_direction FLOAT8 NOT NULL,
  fisher_rao_disagreement FLOAT8,
  tape_basin_disagreement FLOAT8 NOT NULL,
  reverse_tape_window BOOLEAN NOT NULL DEFAULT FALSE,
  reverse_tape_side TEXT,

  -- qig-warp runtime identity (must be QIG_WARP_RUNTIME, never HARDCODED)
  qig_warp_version TEXT NOT NULL,
  qig_warp_mode TEXT NOT NULL,
  qig_warp_source TEXT NOT NULL DEFAULT 'QIG_WARP_RUNTIME',

  -- The decision the bubble actually returned
  expectation_direction TEXT NOT NULL,   -- long | short | flat | observe
  expectation_confidence FLOAT8 NOT NULL,
  expectation_regime TEXT NOT NULL,      -- aligned | reverse_tape | chop | invalid
  expectation_action TEXT NOT NULL,      -- allow | suppress | flip_to_basin | observe_only | reduce_size | exit_now | ...
  expectation_reason TEXT NOT NULL,

  -- Behaviour delta caused by the expectation signal (the critical audit data)
  decision_surface TEXT NOT NULL,        -- entry | hold | exit | size | lane
  side_before TEXT,
  side_after TEXT,
  lane_before TEXT,
  lane_after TEXT,
  size_before_usdt FLOAT8,
  size_after_usdt FLOAT8,
  did_change_decision BOOLEAN NOT NULL,

  -- Provenance for LIVED ONLY 5 and kill tests
  source_path TEXT NOT NULL,
  kernel_version TEXT NOT NULL
);

-- Indexes for the audit and reverse-tape analysis paths
CREATE INDEX IF NOT EXISTS idx_kernel_expectation_trade
  ON kernel_expectation_decisions(trade_id);
CREATE INDEX IF NOT EXISTS idx_kernel_expectation_at
  ON kernel_expectation_decisions(decided_at);
CREATE INDEX IF NOT EXISTS idx_kernel_expectation_reverse
  ON kernel_expectation_decisions(reverse_tape_window, expectation_action);
CREATE INDEX IF NOT EXISTS idx_kernel_expectation_kernel_at
  ON kernel_expectation_decisions(kernel_id, decided_at);

-- Comment block for future operators / auditors (anti-shelfware reminder)
COMMENT ON TABLE kernel_expectation_decisions IS
  'One row per qig-warp expectation evaluation that had the chance to affect live decisions. Required by #1003. Writes must be best-effort; failure must never block safety or exchange actions (P15).';