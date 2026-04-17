# Legacy backtest hard-delete — 7-day follow-up procedure

**Do not run until the soft-delete from Commit 3 has been in place for ≥ 7 days
without a rollback request.**

## Context

Commit 3 (`8c41ad5 — feat(provenance): engine_version tagging + soft-delete purge scaffolding`)
added `deleted_at` columns and a `data_purges` audit table. The purge script
marks legacy (pre-engine-version) rows as soft-deleted by stamping `deleted_at`.

This follow-up hard-deletes those rows permanently once the 7-day rollback
window has elapsed with no incidents.

## Pre-flight checklist

- [ ] At least 7 calendar days since the soft-delete audit row was written
- [ ] `SELECT * FROM data_purges WHERE purge_kind = 'legacy_backtests'
       ORDER BY created_at DESC LIMIT 1;` shows phase='soft_delete'
- [ ] No rollback request in the past 7 days (check with operator/owner)
- [ ] Full pg_dump backup (from `scripts/backup-pre-purge.mjs`) is still on disk
      and/or uploaded to S3 with matching SHA-256
- [ ] Promotion engine has been running on fresh engine_version-tagged rows
      for the full 7-day window
- [ ] At least one strategy has cleared backtest→paper promotion under the
      current engine version (evidence the new pipeline is producing
      trustworthy rows)

## Execute

Write a script `apps/api/scripts/hard-delete-legacy-backtests.mjs` that:

1. Requires `PURGE_LEGACY_BACKTESTS=true` **and** `HARD_DELETE_CONFIRMED=true`
   env flags (double-gate — soft-delete had one).
2. DRY-RUN by default; requires `--execute` flag.
3. For each of the four target tables, runs:

   ```sql
   DELETE FROM <table>
   WHERE deleted_at IS NOT NULL
     AND deleted_at < NOW() - INTERVAL '7 days'
     AND engine_version IS NULL;
   ```

4. Writes an audit row to `data_purges` with:
   - `purge_kind = 'legacy_backtests'`
   - `phase = 'hard_delete'`
   - `rows_affected` = DELETE's rowCount
   - `engine_version` = current git SHA
   - `operator` = env USER or 'system'
   - `backup_path` = path to the pg_dump made pre-soft-delete (retained from
     original backup step)
   - `reason` = e.g. `'7day_rollback_window_elapsed_no_incidents'`

5. Runs `VACUUM ANALYZE` on each affected table after delete so reclaimed
   space is returned and planner stats refresh.

## Why this is a separate script, not an auto-cron

Destructive operations on production data must be intentional. A scheduled
cron job that auto-hard-deletes 7 days after soft-delete creates a silent
deadline: if someone notices a problem on day 6 and doesn't escalate in
time, the data is gone. Keeping hard-delete as a manual script with audit
trail forces a human decision to close the window.

## After hard-delete

- Update the plan file (`see-last-20-prs-scalable-lemur.md`) to mark
  Commit 7 as completed.
- Write a short post-mortem summary to `bsuite_session_YYYYMMDD` memory
  key if any anomalies surfaced during the 7-day soft-delete window.
- Consider shrinking the affected tables if disk usage is a concern:
  `CLUSTER backtest_results USING <best_index>` after vacuum.

## Rollback (if still within 7-day window)

If we decide to undo the soft-delete before hard-delete runs:

```sql
BEGIN;
UPDATE backtest_results          SET deleted_at = NULL WHERE engine_version IS NULL;
UPDATE strategy_performance      SET deleted_at = NULL WHERE engine_version IS NULL;
UPDATE autonomous_trades         SET deleted_at = NULL WHERE engine_version IS NULL;
UPDATE paper_trading_sessions    SET deleted_at = NULL WHERE engine_version IS NULL;
INSERT INTO data_purges
  (purge_kind, target_table, rows_affected, phase, engine_version, reason, operator)
  VALUES ('legacy_backtests_rollback', 'ALL', 0, 'rollback',
          '<current git sha>', 'manual_rollback_<reason>', '<operator>');
COMMIT;
```

After rollback, the soft-delete script can be re-run cleanly (it's
idempotent — rows without `deleted_at` that also have `engine_version IS NULL`
will be re-flagged).
