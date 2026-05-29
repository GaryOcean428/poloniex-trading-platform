-- 065_monkey_exemplar_decisions.sql
--
-- CC→kernel exemplar-observation channel (poloniex-trading-platform#1033).
--
-- Records the CC exemplar trader's per-cycle DECISION — including deliberate
-- ABSTENTIONS (flat-by-choice in chop) — so the kernel can later OBSERVE
-- "what good looks like" and, crucially, distinguish a deliberate stand-aside
-- from mere absence. A trade-only channel can't teach restraint; a decision
-- STREAM can (operator 2026-05-29: "how does the kernel learn you're holding
-- flat and not just absent?").
--
-- STAGED ROLLOUT / safety (mirrors the 062 expectation-decision doctrine):
--   * PR1 (this migration + ingress endpoint): WRITE-ONLY. No kernel reads it
--     yet. Zero live-behaviour change.
--   * PR2 (separate, FLAG-GATED): kernel consumes these rows as a witnessed-
--     peer signal (raise entry bar where the exemplar abstained; reinforce
--     where it won). That PR alters live decisions and rolls out behind a flag.
--   * Writes are BEST-EFFORT: failure to record a decision MUST NEVER affect
--     trading or safety. All non-key columns nullable.
--
-- References: #1033 (coupled exemplar⇄kernel loop), #1032 (rotation/expectancy),
-- #1028 (authoritative reward), 062 (expectation-decision audit template).

CREATE TABLE IF NOT EXISTS monkey_exemplar_decisions (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Who produced the exemplar decision (bootstrap=Claude; future=gemma/ollama).
  source        TEXT NOT NULL DEFAULT 'cc_bootstrap',
  symbol        TEXT,
  -- enter | hold | exit | abstain  (abstain = deliberate flat — first-class)
  action        TEXT NOT NULL,
  is_abstain    BOOLEAN NOT NULL DEFAULT FALSE,
  side          TEXT,                 -- short | long | null (null on abstain)
  conviction    FLOAT8,               -- 0..1 self-rated conviction
  -- The exemplar's regime read (its own classification of the tape).
  regime        TEXT,                 -- trend_up | trend_down | chop | ...
  -- Kernel signals the exemplar OBSERVED this cycle (basinDir, tape, cell, ...).
  kernel_signals JSONB,
  price         FLOAT8,               -- mark price at decision time
  reasoning     TEXT,                 -- why this decision (the teaching label)
  -- Outcome, backfilled when the position the decision opened later closes.
  outcome_pnl   FLOAT8,
  outcome_r     FLOAT8,               -- realized R multiple (pnl / 1R risk)
  CHECK (action IN ('enter', 'hold', 'exit', 'abstain'))
);

CREATE INDEX IF NOT EXISTS idx_monkey_exemplar_decisions_symbol_time
  ON monkey_exemplar_decisions (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_monkey_exemplar_decisions_recent
  ON monkey_exemplar_decisions (created_at DESC);
