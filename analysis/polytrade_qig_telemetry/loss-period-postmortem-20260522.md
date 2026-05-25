# Loss-period post-mortem — 2026-05-21/22

Read-only analysis. No production env or code was changed to produce this.
Operator (Braden) holds the env vars; this document only reports.

## 1. Summary

Over **~18:05 UTC 21 May → 01:15 UTC 22 May** the live account realised
**≈ −$61** with **zero winning trades** (ETH −$41.1, BTC −$19.6). The
earlier period (~04:00 UTC 21 May) was churny — small wins, small losses,
heavy fees, roughly break-even.

The dominant, **confirmed** cause is a **regression introduced this session**:
activating the de-shadow Python consensus peer made the consensus arbiter
return `hold`-action verdicts, and the override code applied that `hold`
to **exit** decisions — so stop-losses, take-profits and bracket exits were
**suppressed for ~14 hours**. Positions could not be closed; losers bled,
winners were never banked.

`basinDir` direction is **not** sign-inverted (code-verified). The
"doing the opposite" perception is explained by the exit suppression, not
by an inverted entry signal — see §5.

## 2. P&L evidence (CSV ground truth)

`~/Downloads/futures-transaction-history-2026-05-22 09_38_24.csv`
(timestamps local UTC+8; window 02:05–09:15 local = 18:05 UTC 21 May → 01:15 UTC 22 May):

| Symbol | Realised PnL | Notable single closes |
|---|---|---|
| ETH | −$41.1 | −19.09, −6.17, −6.07, −2.79 |
| BTC | −$19.6 | −4.64, −4.12, −2.24, −2.06 |
| **Total** | **≈ −$61** | **31 realised-PnL rows, all negative** |

`~/Downloads/futures-transaction-history-2026-05-21 12_47_00.csv` (~04:00 UTC):
3 tiny wins (+0.15, +0.18, +0.06), 5 small losses, heavy fees → ~break-even.

The big losing closes cluster at the **close timestamps**, not spread
evenly — the signature of positions held far past their intended exit and
realised in a batch.

## 3. Timeline

| UTC (21–22 May) | Event |
|---|---|
| ~10:05 | #885 (B1.1 basinDir neutral) deployed |
| ~10:35 | `CONSENSUS_PEER_FANOUT_LIVE=true` set (peer fanout on) |
| ~10:46 | #888 (proposal-bus subscriber boot) deployed → **peer proposals start reaching the TS arbiter** → regression begins |
| ~11:06 | #890 (engine_type) deployed |
| 18:05 → 01:15 | CSV window: ≈ −$61, all losses |
| ~00:50 | `CONSENSUS_PEER_FANOUT_LIVE=false` (revert 1) |
| ~00:55 | `CONSENSUS_EXECUTOR_LIVE=false` (revert 2 — consensus layer fully off) |

## 4. Root cause — exit suppression (CONFIRMED)

`apps/api/src/services/monkey/loop.ts:3984-3997`:

```ts
if (consensusOverride !== null) {
  ...
  if (consensusOverride.action === 'hold') {
    action = 'hold';            // ← overrides ANY kernel action, including exits
    size.value = 0;
  } else if (consensusOverride.action === 'enter_long' || ... ) { ... }
}
```

- `CONSENSUS_EXECUTOR_LIVE=true` (prod) builds `consensusOverride` every tick.
- Pre-de-shadow: no peer → verdict always `single-kernel` → `consensus.action
  = own.proposed_action`, which is `'exit'` for an exit → the `=== 'hold'`
  branch did **not** fire → exits passed through. The bug was dormant.
- Post-de-shadow activation: a peer proposal arrives → arbiter returns
  `no-trade-divergence` (and later `lesser-observe`) → `consensus.action =
  'hold'` → the kernel's `exit` is **overwritten to `hold`**.

**Result:** stop-losses, take-profits and synthetic-bracket exits could not
execute. Confirmed in production logs:

```
[Monkey] BTC_USDT_PERP [drift] hold
  reason:"bracket_sl: mark 77201.88 <= SL 77804.09 | consensus.no-trade-divergence"
```

The bracket stop-loss condition is met (`mark <= SL`) but the action is
`hold` — the exit was suppressed. Poloniex has no native SL/TP (synthetic
brackets only), so a suppressed bracket = a position that simply does not
close. For ~14h, **no position could take profit or cut a loss**; outcomes
were dominated by the deepest drawdowns → −$61.

Secondary mis-mapping: `loop.ts:3933` maps the kernel action to the
proposal via `action.startsWith('exit')`. Exit actions `scalp_exit` and
`flatten` do **not** start with `'exit'` → mapped to `'hold'` → they were
suppressible even under `single-kernel`. (Low impact historically, but it
means the override has been able to drop those two exits whenever
`CONSENSUS_EXECUTOR_LIVE=true`.)

## 5. "Doing the opposite" — explained, and basinDir cleared

The operator observed entries that "look like the opposite would be right."
Two findings:

**basinDir is NOT sign-inverted.** `perception.ts:basinDirection` (#885)
sign reduces algebraically to `average momentumCoord(logReturn) ≥ 0.5`,
i.e. `average momentum-horizon log-return ≥ 0`. Uptrend → positive,
downtrend → negative. The sign convention is correct.

**What `basinDir` *does* have is weak magnitude.** The momentum band is 8
of 64 basin dims (~20% of mass); the Fisher-Rao distance to the
no-momentum antipode is structurally small, so `|basinDir|` sits ~0.03–0.17.
`kernelDirection = sign(basinDir + 0.5·tapeTrend)` is therefore
**tape-dominated**. This is a pre-existing limitation (the open "B1
magnitude" workstream — see `polytrade_b1_basindir_neutral_skew`), **not a
regression from this session**.

**The "opposite" perception is the exit suppression.** An entry that was
fine at open, once it cannot be exited or reversed, gets dragged through
the next reversal and sits deep underwater. To an observer it looks like
"it entered long right where a short was about to be right" — but the
kernel *did* try to exit/flip; loop.ts:3988 overwrote that to `hold`.
Suppressed exits turn adequate entries into trades that look catastrophic.

## 6. The "both long and short closed at once" / crossover

The kernel runs multiple agents/instances on one symbol (K, T,
`monkey-position`, `monkey-swing`). Each tracks its own `autonomous_trades`
DB rows, but Poloniex aggregates all of one side into a single `posSide`
position. When one agent's bracket closes "the short," it empties the
**shared** exchange position; the other agents' rows become orphans. On
the next reconcile pass (triggered here by the revert redeploys) the
reconciler batch-closes all orphaned rows — long and short together — and
labels them `manual_close_user` (its catch-all for "position gone, no
matching kernel order"). Logs show one BTC short tracked as 3 stacked rows
(shares 23.5% / 58.8% / 17.6%) closed in a single pass. This is the
phantom/stacked-rows class (`polytrade_phantom_rows_lesson`), distinct
from the regression above.

## 7. Recommendations (reported only — not actioned)

1. **Consensus override must govern ENTRIES only.** The arbiter decides
   whether to *open* a trade; exits are risk management and must always
   execute. Fix: gate the override so it applies only when the kernel's
   own action is an entry (`enter_long/short`, `pyramid_long/short`);
   every other action (exit, `scalp_exit`, `flatten`, hold) passes through
   untouched. A TDD'd `applyConsensusOverride` helper is drafted on branch
   `fix/consensus-override-entries-only`.
2. **Do not re-enable `CONSENSUS_EXECUTOR_LIVE` / the de-shadow** until (1)
   ships and is verified.
3. **basinDir magnitude (B1)** — separate, pre-existing. The sign is
   correct; the signal is just weak. Continuing the B1 expressiveness work
   is worthwhile but is not a regression and not urgent-for-safety.
4. **Multi-agent posSide stacking / reconciler `manual_close_user`
   mislabel** — agents sharing one exchange `posSide` should either net
   their intent before sending orders, or the reconciler should attribute
   shared-posSide closes to the agent whose bracket fired rather than
   `manual_close_user`.

## 8. What is already done

- Consensus layer is **off** in production (operator-confirmed env state) —
  the exit-suppression regression cannot recur while it is off.
- The ~$61 loss is realised and unrecoverable; it is not ongoing.
