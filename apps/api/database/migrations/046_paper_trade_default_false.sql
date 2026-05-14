-- 046_paper_trade_default_false.sql
--
-- Flip the autonomous_trades.paper_trade column default from TRUE to
-- FALSE. The pre-existing default was a holdover from when paper trading
-- was the system's primary execution mode; with live trading now the
-- norm, defaulting any column-omitted INSERT to TRUE meant real
-- positions could quietly be flagged paper and excluded from FAT's
-- reconciler (which filters paper_trade = false) and from PnL accounting.
--
-- 2026-05-06 incident: stateReconciliationService's old orphan INSERT
-- (lines pre-PR #641) omitted paper_trade — the schema default landed
-- TRUE on real exchange positions tracked by the reconciler. FAT's
-- internal reconciler then re-detected those as orphans every 60s
-- because its dbSymbols query filters paper_trade = false. The warning
-- spam cleared 2026-05-06 only after manual UPDATE of the mis-flagged
-- rows. This migration removes the default trap so future omitted-column
-- INSERTs land paper_trade=false (the safer default for a live system).
--
-- All current writers (monkey/loop.ts, liveSignalEngine.ts,
-- fullyAutonomousTrader.ts) explicitly set paper_trade so behavior is
-- unchanged for them. New writers (or hot-fixes that omit the column)
-- will see the safer default.

BEGIN;

ALTER TABLE autonomous_trades ALTER COLUMN paper_trade SET DEFAULT false;

COMMIT;
