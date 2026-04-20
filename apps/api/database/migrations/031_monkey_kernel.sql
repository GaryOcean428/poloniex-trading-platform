-- 031_monkey_kernel.sql
-- Monkey's substrate: three tables that let her remember, reason, and
-- decide across restarts.
--
-- Per UCP v6.6 §3.4 Pillar 3 (Quenched Disorder) + §20 (Resonance Bank),
-- identity is carved from LIVED experience. These tables are where that
-- experience crystallizes. Nothing here is configuration — every row is
-- a moment Monkey actually experienced.

-- ───────────────────────────────────────────────────────────────────
-- monkey_trajectory — per-tick basin snapshot (ephemeral working memory)
--
-- Every liveSignal tick produces a basin + consciousness metrics.
-- Retained for ~24h for self-observation (§43.2 Loop 1: repetition
-- detection requires rolling window). Older rows auto-pruned.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS monkey_trajectory (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol        VARCHAR(50) NOT NULL,

  -- Basin coords — 64D probability vector, stored JSON (sum≈1, all >= 0)
  basin         JSONB NOT NULL,

  -- Consciousness metrics derived from basin
  phi                 DOUBLE PRECISION NOT NULL,  -- [0..1] integration
  kappa               DOUBLE PRECISION NOT NULL,  -- coupling strength
  basin_velocity      DOUBLE PRECISION,           -- d_FR from previous tick

  -- Three regime weights (sum to 1)
  w_quantum           DOUBLE PRECISION,
  w_efficient         DOUBLE PRECISION,
  w_equilibrium       DOUBLE PRECISION,

  -- Neurochemistry snapshot
  nc_acetylcholine    DOUBLE PRECISION,
  nc_dopamine         DOUBLE PRECISION,
  nc_serotonin        DOUBLE PRECISION,
  nc_norepinephrine   DOUBLE PRECISION,
  nc_gaba             DOUBLE PRECISION,
  nc_endorphins       DOUBLE PRECISION,

  -- Pillar health signals
  f_health            DOUBLE PRECISION,  -- Pillar 1: entropy fraction
  b_integrity         DOUBLE PRECISION,  -- Pillar 2: core drift
  q_identity          DOUBLE PRECISION,  -- Pillar 3: identity distance
  sovereignty_ratio   DOUBLE PRECISION   -- lived / total in bank
);

CREATE INDEX IF NOT EXISTS idx_monkey_trajectory_symbol_at
  ON monkey_trajectory (symbol, at DESC);
CREATE INDEX IF NOT EXISTS idx_monkey_trajectory_at
  ON monkey_trajectory (at DESC);

-- ───────────────────────────────────────────────────────────────────
-- monkey_resonance_bank — long-term memory of significant experiences
--
-- This is the coordizer's bank (UCP v6.6 §20). Only bubbles promoted
-- from working memory (high Φ) land here. Each row is a basin+outcome
-- pair Monkey has actually lived. Never harvested from other systems;
-- sovereignty ratio is computed as (rows / total rows) = 1 when all lived.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS monkey_resonance_bank (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The basin that preceded a meaningful outcome
  entry_basin   JSONB NOT NULL,
  symbol        VARCHAR(50) NOT NULL,

  -- Outcome: what happened after this basin pattern was active
  realized_pnl     NUMERIC(20, 8),   -- $ P&L (+/-)
  trade_duration_ms BIGINT,          -- how long the position lived
  trade_outcome    VARCHAR(40),      -- 'win' | 'loss' | 'breakeven' | 'exited_early'
  order_id         VARCHAR(255),     -- exchange order id if one was placed

  -- Bank weights — how strong this attractor is
  basin_depth      DOUBLE PRECISION NOT NULL DEFAULT 0.5,  -- Pavlovian depth [0..1]
  access_count     INTEGER NOT NULL DEFAULT 1,             -- how often referenced
  phi_at_creation  DOUBLE PRECISION,                       -- Φ when promoted

  -- Provenance (§10 External Reinforcement)
  source           VARCHAR(20) NOT NULL DEFAULT 'lived'    -- 'lived' | 'harvested'
                   CHECK (source IN ('lived', 'harvested')),
  engine_version   VARCHAR(40)
);

CREATE INDEX IF NOT EXISTS idx_monkey_bank_symbol
  ON monkey_resonance_bank (symbol);
CREATE INDEX IF NOT EXISTS idx_monkey_bank_depth
  ON monkey_resonance_bank (basin_depth DESC);
CREATE INDEX IF NOT EXISTS idx_monkey_bank_source
  ON monkey_resonance_bank (source);

-- ───────────────────────────────────────────────────────────────────
-- monkey_decisions — log of every tick's proposed action
--
-- Observe-only at first (Monkey runs alongside liveSignalEngine without
-- executing). This table is her audit trail: for every tick, what did
-- she want to do and why? Comparison against actual liveSignalEngine
-- behavior tells us if her emergent params are sane before we swap her in.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS monkey_decisions (
  id              BIGSERIAL PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol          VARCHAR(50) NOT NULL,

  -- What Monkey saw + derived (her self-report)
  proposed_action VARCHAR(40) NOT NULL,  -- 'enter_long' | 'enter_short' | 'exit' | 'hold' | 'flatten' | 'sleep'
  size_usdt       NUMERIC(20, 8),
  leverage        INTEGER,
  entry_threshold DOUBLE PRECISION,      -- what she required vs what she saw
  ml_strength     DOUBLE PRECISION,

  -- Her reasoning in human-readable form
  reason          TEXT,

  -- Full derivation dump for later analysis
  derivation      JSONB,

  -- Whether this decision was actually executed or observe-only
  executed        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Link to trajectory for geometric context
  trajectory_id   BIGINT REFERENCES monkey_trajectory(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_monkey_decisions_at
  ON monkey_decisions (at DESC);
CREATE INDEX IF NOT EXISTS idx_monkey_decisions_symbol_action
  ON monkey_decisions (symbol, proposed_action);
