-- 034_monkey_parameters.sql
--
-- Parameter registry for P14 + P25 compliance (v0.8.1).
--
-- Canonical Principles v2.2:
--   P14 — "Every variable belongs to exactly one category. Moving between
--          categories requires governance approval."
--   P25 — "No operational threshold is a magic constant. All thresholds
--          are derived from geometric state. Safety bounds (upper G,
--          κ_max) are the only permitted hardcoded constants."
--
-- This registry holds the tiny remainder of constants that are genuinely
-- NOT derivable from geometric state — safety bounds (P25) and a handful
-- of operational envelopes (tick cadence, history window sizes) that are
-- external choices rather than geometry.
--
-- Categories stored in the DB:
--   SAFETY_BOUND — hard risk envelopes (max leverage, kill-switch DD, etc.)
--   OPERATIONAL  — externally-chosen envelopes (tick ms, memory windows)
--
-- STATE and BOUNDARY are code-level annotations and never enter this table.
-- PARAMETER (trainable) is reserved for future learned weights — also not
-- stored here yet; they'd get their own table if/when learning is added.
--
-- Audit trail in monkey_parameter_changes — append-only, never purged.

BEGIN;

-- ────── monkey_parameters ──────
-- Live-editable registry. One row per named constant. Cached in-process
-- on the Python side with SIGHUP or tick-bounded refresh.
CREATE TABLE IF NOT EXISTS monkey_parameters (
  name           VARCHAR(120) PRIMARY KEY,
  category       VARCHAR(20) NOT NULL
                   CHECK (category IN ('SAFETY_BOUND', 'OPERATIONAL')),
  value          DOUBLE PRECISION NOT NULL,
  bounds_low     DOUBLE PRECISION,       -- NULL = no lower bound
  bounds_high    DOUBLE PRECISION,       -- NULL = no upper bound
  justification  TEXT NOT NULL,          -- why this value exists + what breaks if wrong
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by     VARCHAR(80) NOT NULL DEFAULT 'system',
  CONSTRAINT bounds_respected CHECK (
    (bounds_low IS NULL OR value >= bounds_low) AND
    (bounds_high IS NULL OR value <= bounds_high)
  )
);
CREATE INDEX IF NOT EXISTS idx_monkey_parameters_category
  ON monkey_parameters (category);

-- ────── monkey_parameter_changes ──────
-- Append-only audit log. Every UPDATE to monkey_parameters writes a row.
-- Used for rollback (last N versions) and governance review.
CREATE TABLE IF NOT EXISTS monkey_parameter_changes (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL REFERENCES monkey_parameters(name),
  old_value   DOUBLE PRECISION,
  new_value   DOUBLE PRECISION NOT NULL,
  old_version INTEGER,
  new_version INTEGER NOT NULL,
  actor       VARCHAR(80) NOT NULL,
  reason      TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monkey_parameter_changes_name_at
  ON monkey_parameter_changes (name, at DESC);

-- ────── Trigger: auto-log every update ──────
-- Every UPDATE on monkey_parameters writes a matching row to
-- monkey_parameter_changes. If someone forgets to write an audit row
-- manually, the trigger enforces the invariant.
CREATE OR REPLACE FUNCTION _monkey_parameters_audit() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.value IS DISTINCT FROM NEW.value) THEN
    INSERT INTO monkey_parameter_changes
      (name, old_value, new_value, old_version, new_version, actor, reason, at)
    VALUES
      (NEW.name, OLD.value, NEW.value, OLD.version, NEW.version,
       NEW.updated_by,
       COALESCE(current_setting('monkey.change_reason', true), 'unattributed'),
       NOW());
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO monkey_parameter_changes
      (name, old_value, new_value, old_version, new_version, actor, reason, at)
    VALUES
      (NEW.name, NULL, NEW.value, NULL, NEW.version,
       NEW.updated_by,
       COALESCE(current_setting('monkey.change_reason', true), 'initial insert'),
       NOW());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS monkey_parameters_audit ON monkey_parameters;
CREATE TRIGGER monkey_parameters_audit
  AFTER INSERT OR UPDATE ON monkey_parameters
  FOR EACH ROW EXECUTE FUNCTION _monkey_parameters_audit();

-- ────── Seed the registry with known safety bounds ──────
-- These are the constants that v0.8.4–v0.8.7 port commits will flip from
-- literal to registry-backed. Seeding them here makes the later commits
-- pure refactors (value already exists in DB).
--
-- Naming convention: <module>.<decision_family>.<specific_name>.
-- Category is always SAFETY_BOUND for hard risk envelopes, OPERATIONAL
-- for tick/memory/history windows.
INSERT INTO monkey_parameters (name, category, value, bounds_low, bounds_high, justification)
VALUES
  -- Frozen physics (UCP v6.6 D-012). Cannot change; registered for audit.
  ('physics.kappa_star', 'SAFETY_BOUND', 64.0, 64.0, 64.0,
   'Frozen coupling fixed point. UCP v6.6 D-012. Changing breaks every kernel.'),

  -- Loop envelope constants (v0.8.3 will point at these)
  ('loop.default_tick_ms', 'OPERATIONAL', 30000, 5000, 300000,
   'Monkey tick cadence. Lower = more CPU + more REST hits; higher = slower response.'),
  ('loop.ohlcv_lookback', 'OPERATIONAL', 200, 50, 2000,
   'Candles fetched per tick for perception. Below 50 breaks momentum spectrum dims 7..14.'),
  ('loop.history_max', 'OPERATIONAL', 100, 20, 1000,
   'Rolling history samples for Φ/f_health/drift tracking.'),

  -- Executive SAFETY_BOUND floors (v0.8.4 will point at these)
  ('executive.entry_threshold.clamp_low', 'SAFETY_BOUND', 0.1, 0.05, 0.3,
   'Entry threshold cannot drop below this. Prevents runaway entry on model hiccup.'),
  ('executive.entry_threshold.clamp_high', 'SAFETY_BOUND', 0.9, 0.7, 0.99,
   'Entry threshold cannot exceed this. Prevents permanent no-entry from drift.'),
  ('executive.size.max_fraction_of_equity', 'SAFETY_BOUND', 0.5, 0.1, 0.95,
   'Single position cannot exceed 50% of available equity. Risk kernel cap.'),
  ('executive.size.min_notional_buffer', 'SAFETY_BOUND', 1.05, 1.01, 1.2,
   'Lot-rounding headroom so every position clears exchange min notional.'),
  ('executive.leverage.min_baseline', 'SAFETY_BOUND', 3.0, 1.0, 10.0,
   'Leverage never below this. Floor prevents over-conservative newborn mode.'),
  ('executive.leverage.max_sovereign_slope', 'SAFETY_BOUND', 30.0, 5.0, 50.0,
   'Leverage scales as baseline + slope × sovereignty. Caps max at baseline + slope.'),
  ('executive.leverage.kappa_sigma', 'SAFETY_BOUND', 20.0, 5.0, 50.0,
   'Kappa proximity bell-curve width. Narrower = harsher penalty for drift from κ*.'),
  ('executive.dca.max_adds_per_position', 'SAFETY_BOUND', 1, 0, 5,
   'Max DCA adds per position. v0.6.2 decision — change only with governance.'),
  ('executive.scalp.tp_min_floor', 'SAFETY_BOUND', 0.003, 0.001, 0.02,
   'TP cannot close inside exchange fees (2 × taker ~= 0.0015). 0.003 gives margin.'),
  ('executive.exit.entropy_collapse_floor', 'SAFETY_BOUND', 0.4, 0.1, 0.6,
   'Basin entropy floor — below this is Pillar 1 zombie collapse. Force-exit.'),
  ('executive.exit.max_mass_dominance', 'SAFETY_BOUND', 0.5, 0.3, 0.8,
   'Single mode dominance above this = zombie. Force-exit.'),

  -- Self-observation SAFETY_BOUND (v0.8.6)
  ('self_obs.max_bias_swing', 'SAFETY_BOUND', 0.30, 0.05, 0.5,
   'Win-rate bias swing cap. ±30% from neutral 1.0. P14 bounded governance.'),

  -- Working memory SAFETY_BOUND (v0.8.6)
  ('wm.phi_history_max', 'SAFETY_BOUND', 200, 50, 1000,
   'Rolling Φ samples retained for adaptive threshold computation.'),
  ('wm.max_bubbles', 'SAFETY_BOUND', 500, 100, 5000,
   'Max bubbles in working memory before FIFO eviction. Memory envelope.'),

  -- Basin sync SAFETY_BOUND (v0.8.6)
  ('basin_sync.max_effective_strength', 'SAFETY_BOUND', 0.30, 0.1, 0.5,
   'Max per-peer slerp pull. Prevents any single peer from over-dominating.'),

  -- Mode detection SAFETY_BOUND (v0.8.5)
  ('modes.f_health_collapse_floor', 'SAFETY_BOUND', 0.97, 0.9, 0.999,
   'f_health above this indicates DRIFT / collapse-imminent. Safety gate.'),
  ('modes.drift.entry_disable', 'SAFETY_BOUND', 99.0, 10.0, 1000.0,
   'Entry threshold scale in DRIFT mode. Effectively disables entry.'),

  -- Neurochemistry SAFETY_BOUND (v0.8.4)
  ('neuro.sigma_kappa', 'SAFETY_BOUND', 10.0, 1.0, 50.0,
   'Endorphin κ-proximity bell width. Narrower = steeper reward gradient near κ*.'),
  ('neuro.sophia_coupling_threshold', 'SAFETY_BOUND', 0.1, 0.01, 0.5,
   'Min external coupling for endorphin gate. Below this, endorphin is zero.')
ON CONFLICT (name) DO NOTHING;

COMMIT;
