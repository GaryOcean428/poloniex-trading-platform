-- 066_kernel_parity_log_cold_kappa.sql
--
-- Issue #710 (review) — parity-log tautology guard.
--
-- Adds py_kappa_cold and delta_kappa_cold to kernel_parity_log so the
-- cutover gate can compare:
--
--   delta_kappa      = |ts_kappa − py_kappa|       (warm-start: seeded from TS)
--   delta_kappa_cold = |ts_kappa − py_kappa_cold|  (cold-start: registry default)
--
-- When the caller supplied kappa: state.kappa, py_kappa is seeded and
-- delta_kappa will look small by construction.  delta_kappa_cold provides
-- an independent baseline — if it is also small, the two kernels genuinely
-- agree; if it is large while delta_kappa is small, the log exposes that the
-- seeded delta was masking divergence.
--
-- py_kappa_cold is nullable: it is only populated when the TS caller passed a
-- kappa hint (MONKEY_K_SHADOW_LIVE=true path) AND the cold-start tick
-- succeeded.  Rows inserted before this migration have NULL.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guards re-application.

ALTER TABLE kernel_parity_log
  ADD COLUMN IF NOT EXISTS py_kappa_cold NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'kernel_parity_log'
      AND column_name  = 'delta_kappa_cold'
  ) THEN
    ALTER TABLE kernel_parity_log
      ADD COLUMN delta_kappa_cold NUMERIC
        GENERATED ALWAYS AS (ABS(ts_kappa - py_kappa_cold)) STORED;
  END IF;
END $$;
