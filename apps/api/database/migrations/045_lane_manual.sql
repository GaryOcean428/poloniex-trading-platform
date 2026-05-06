-- 045_lane_manual.sql
--
-- Add 'manual' to the autonomous_trades.lane CHECK constraint so the
-- reconciler can INSERT user-originated positions (PR #641 manual user
-- action recognition). The constraint previously enforced
-- lane ∈ {scalp, swing, trend} which silently rejected the
-- reconciler's lane='manual' inserts inside its try/catch — the orphan
-- "Exchange has positions not tracked in DB" warning persisted every
-- 60s on prod 2026-05-06 07:51 onward despite the new code being live.
--
-- 'manual' is reserved for the agent='USER' rows the reconciler emits
-- when it detects an exchange position with no matching DB row (user
-- opened on Poloniex UI). The kernel's own lane logic (scalp/swing/
-- trend chooseLane + budgetFrac envelope) only operates on the three
-- canonical lanes; manual rows are visible for accounting and audit
-- but the kernel ignores them via reason LIKE 'monkey|kernel=%'.
--
-- Live fix already applied 2026-05-06 to prod via railway run. This
-- migration codifies the change for fresh deploys.
--
-- Idempotent — drops and re-adds the constraint with the wider check.

BEGIN;

ALTER TABLE autonomous_trades DROP CONSTRAINT IF EXISTS autonomous_trades_lane_check;
ALTER TABLE autonomous_trades ADD CONSTRAINT autonomous_trades_lane_check
  CHECK (lane = ANY (ARRAY['scalp'::text, 'swing'::text, 'trend'::text, 'manual'::text]));

COMMIT;
