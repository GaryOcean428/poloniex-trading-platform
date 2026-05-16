-- 052_kernel_parity_log_bigint.sql
--
-- PR #705 shipped kernel_parity_log with ts_decision_ms / py_decision_ms
-- typed INTEGER, but the Python /monkey/k-shadow/tick endpoint returns
-- `decided_at_ms` as an absolute Unix-ms timestamp (~1.78e12), not a
-- duration. INTEGER tops out at 2.147e9, so every insert is failing
-- with "value out of range for type integer" and the parity log stays
-- empty in production.
--
-- Fix: widen both columns to BIGINT. Captures either interpretation
-- (duration or absolute timestamp). Idempotent — only alters when
-- current type is integer.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'kernel_parity_log'
      AND column_name = 'ts_decision_ms'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE kernel_parity_log ALTER COLUMN ts_decision_ms TYPE BIGINT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'kernel_parity_log'
      AND column_name = 'py_decision_ms'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE kernel_parity_log ALTER COLUMN py_decision_ms TYPE BIGINT;
  END IF;

  -- ts_R / py_R also store ordinals that may exceed INTEGER if someone
  -- later extends the regime enum; leave as INTEGER (current cap fits
  -- comfortably) but document the intent.
END $$;
