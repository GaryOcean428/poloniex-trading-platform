-- Migration 040: Arbiter N-agent generalization (proposal #6)
--
-- Drop the K|M CHECK constraint introduced by migration 039 so the
-- arbiter can support arbitrary agent labels (e.g., 'K2' for K
-- variants in A/B testing). The replacement constraint enforces an
-- alphanumeric label that begins with a letter — same pattern the
-- TS-side ``Arbiter.recordSettled`` validates.
--
-- Rationale: a hard CHECK on a 2-letter set blocks future
-- experiments (K-prime variants, M-replacement candidates,
-- shadow-mode siblings). The looser pattern still rejects empty
-- strings and free-form text while preserving the option to add
-- new variants without another migration.
--
-- Companion arbiter_allocation table did not have an explicit
-- agent column (it stored k_share / m_share as fixed columns).
-- We leave that table alone for back-compat; new N-agent telemetry
-- will land in a separate ``arbiter_allocation_v2`` table when
-- enough N>2 history is needed for analysis. Until then,
-- ``snapshotMany`` callers can persist their own row shapes.

BEGIN;

ALTER TABLE autonomous_trades
  DROP CONSTRAINT IF EXISTS autonomous_trades_agent_check;

ALTER TABLE autonomous_trades
  ADD CONSTRAINT autonomous_trades_agent_check
    CHECK (agent ~ '^[A-Z][A-Z0-9_]*$');

COMMIT;
