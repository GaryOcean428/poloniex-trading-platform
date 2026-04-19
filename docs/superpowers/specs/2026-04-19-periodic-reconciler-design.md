# Periodic Reconciler + Time-Bounded Stacking Guard (P2)

## Context

On 2026-04-18 the autonomous trading bot submitted 6 live orders that either never filled on Poloniex (due to the `ordId` vs `orderId` bug) or filled and closed without our reconciler catching the close. Result: 6 `autonomous_trades` rows stayed `status='open'` for 12+ hours while the actual Poloniex account held zero positions.

The stacking guard added in PR #499 (designed to prevent the bot from placing a second order while an existing live-signal trade was still open) correctly read those 6 rows and correctly blocked every new signal for 12 hours — but because the DB was lying about reality, the guard silently killed all trading activity. The bug was only caught when the user asked "what is this thing doing?" and we manually queried the exchange to see the 0-position reality.

## Goals

1. **Prevent recurrence.** Any phantom DB `open` row older than N minutes that has no matching exchange position must auto-close so the stacking guard releases.
2. **Prevent the next class of this bug too.** Divergence between DB `status='open'` count and exchange-position count for any symbol should be automatically resolved on a cadence, not require human intervention.
3. **Keep the fix local.** No schema change, no migration, no change to the order-placement path. Pure defensive addition.

## Non-goals

- Retroactively reconciling paper trades (separate table `paper_trades`, different close logic).
- Fixing the root `ordId` capture bug — already done in PR #499.
- P&L math correctness (that's P3).

## Design

### Periodic reconciler service

New function in `apps/api/src/services/stateReconciliationService.ts`:

```ts
async function reconcileLiveSignalPositions(): Promise<ReconcileReport> { ... }
```

Runs every **5 minutes** via `setInterval` started in `apps/api/src/index.ts` after backend boot, gated on `NODE_ENV !== 'test'`.

Algorithm:

1. Pull all `autonomous_trades` rows where `status='open' AND reason LIKE 'live_signal|%'`, grouped by `(user_id, symbol)`.
2. For each `user_id`:
   - Load credentials via `apiCredentialsService.getCredentials(userId, 'poloniex')`.
   - Call `poloniexFuturesService.getPositions(credentials)` → `Map<symbol, netQty>`.
3. For each `(user_id, symbol)` with DB `open` rows:
   - If exchange has **zero** open qty on that symbol → **all DB rows for that symbol are phantoms.** Close them with:
     ```sql
     UPDATE autonomous_trades
     SET status = 'closed',
         exit_time = NOW(),
         exit_reason = 'reconciled_phantom_no_exchange_position',
         pnl = COALESCE(pnl, 0)
     WHERE id = ANY($1)
     ```
   - If exchange has **some** open qty on that symbol → leave DB rows alone. (We conservatively assume the position is real; the managePositions loop owns closing them.)
4. Emit a `strategy_state_events` row per reconciled symbol so audit trail exists.
5. Log summary: `[Reconciler] closed N phantom rows across M symbols in ${elapsed}ms`.

**Safety properties:**

- Fail-soft: any Poloniex error aborts the cycle without touching DB (we'd rather re-check in 5 minutes than wrongly close a real position).
- Idempotent: running it twice in a row with no state change is a no-op.
- Per-user isolation: one user's credentials failure doesn't block reconciling others.

### Time-bounded stacking guard

Second layer of defense in `liveSignalEngine.ts::processSymbol`. Currently the guard unconditionally skips when any `status='open'` row exists for the symbol. Tighten:

```ts
const OPEN_TRADE_MAX_AGE_MS = 60 * 60_000;  // 60 minutes

// Existing query, plus created_at filter:
const openCheck = await pool.query(
  `SELECT 1 FROM autonomous_trades
    WHERE symbol = $1
      AND status = 'open'
      AND reason LIKE 'live_signal|%'
      AND (entry_time > NOW() - INTERVAL '60 minutes' OR created_at > NOW() - INTERVAL '60 minutes')
    LIMIT 1`,
  [symbol],
);
```

A DB row older than 60 minutes with no exchange position is **either:**

- A phantom the reconciler hasn't caught yet (reconciler runs every 5 min, so worst case is a 5-min window where both this guard and reconciler disagree — fine, bias to conservative)
- A real position that's been open for >1 hour, in which case the stacking guard would still veto correctly if the reconciler confirms it's real (exchange position present), OR the reconciler would close it.

The 60-minute window is deliberately generous. ATR-scaled stop/take-profit targets should resolve most trades within tens of minutes; anything open > 1 hour is outside our strategy envelope and should not block new entries indefinitely.

### Wire-up in `index.ts`

```ts
import { reconcileLiveSignalPositions } from './services/stateReconciliationService.js';

// Already started:  liveSignalEngine.start(...)
// Add:
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    reconcileLiveSignalPositions().catch((err) => {
      logger.error('[Reconciler] tick failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }, 5 * 60_000).unref?.();
  logger.info('[Reconciler] periodic reconciler started', { intervalMs: 300_000 });
}
```

## Verification plan

1. Unit test: `reconcileLiveSignalPositions` with mocked `poloniexFuturesService.getPositions` returning `[]` → asserts all `status='open'` live-signal rows flip to `closed` with the reconciled reason.
2. Unit test: same, but Poloniex returns one position with qty > 0 → those rows stay open.
3. Integration smoke: insert a phantom row via SQL, wait 5 minutes (or trigger the interval manually), confirm row is closed.
4. Production: deploy, confirm `[Reconciler]` log line appears every 5 minutes. If we reach a phantom state again, count how long until auto-recovery.

## Follow-ups (still not in this PR)

- P3 P&L math audit — decimal vs percent, short sign, leverage.
- Alert/page when reconciler detects divergence above a threshold (e.g. > 3 phantom rows in one cycle).
