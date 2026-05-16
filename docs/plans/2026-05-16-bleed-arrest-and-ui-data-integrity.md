# Bleed-arrest and UI/data integrity plan — stop scalp-spiral + reconcile every misleading number

**Status:** PLAN — backend phases held for user sign-off; UI/data phases pre-approved
**Filed:** 2026-05-16
**Authority:** User directive in conversation 2026-05-16 ("hold off. i'm still reviewing the earlier discussion. all UI stuff is approved.")
**Tracking issue:** GaryOcean428/poloniex-trading-platform (TBD)
**Account state at filing:** futures balance $91.96, $1k moved to spot, prod deploying main at `6cbe850`, backup branch deleted on remote, ~$725 net realized loss across the prior 48h window
**Related:** [[polytrade-path-b-rollback-20260515]], [[polytrade-session-20260515b]], [[polytrade-hedge-posside-bug-class]], [[polytrade-fat-reconciler-nullpnl-gap]]

## Problem statement

Three independent failure modes are compounding into a slow-bleed scalp-spiral on live capital, AND every UI number that should help diagnose this is misleading.

### Trading-engine failure modes (compounding)

| # | Failure | Evidence (prod logs / API state) | Effect |
|---|---|---|---|
| 1 | MTF-L noise filter never warms after PR #700's bootstrap-retry fix | `[MTF-L] decision {agreement:"0/3", perTf:"15m:cold,1h:cold,4h:cold"}` 25 min into the `6cbe850` deploy | 3-of-3 agreement gate permanently 0/3 → single-tick basinDir/tape disagreements trigger entries |
| 2 | HEDGE-mode double-tap | `enter_long EXECUTED ... tape:-0.038` then `enter_short EXECUTED ... tape:-0.555` on BTC 6ms later, both K-agent decisions, both filled | Delta-neutral pair opens → bleeds 2× slippage + 2× fees per cycle |
| 3 | Learning-gate blindness | `learning_gate rejected witnessExit bank write {pnl:"-0.0350", reasons:["pnl |-0.0350| < noise floor 0.05"]}` | Sub-noise-floor losses never recorded in resonance bank → kernel has no negative-feedback signal on the bad pattern → repeats indefinitely |

### UI/data integrity failure modes (compounding the diagnostic blindness)

| # | Failure | Evidence | Effect |
|---|---|---|---|
| U1 | `/api/agent/performance?range=*` ignores the `range` param | Tested `24h\|7d\|30d\|90d\|1y` → identical payload (`totalPnl=716.5, totalTrades=1721, dailyCount=26`) | Timeframe selector on `/performance` and `/autonomous-agent` is decorative — every selection returns the same data |
| U2 | `mode=live` SQL filter is broken | `agent.ts:332` uses `order_id LIKE 'paper_%'` exclusion, includes NULL order_ids | `mode=live` returns ~same as `mode=all` |
| U3 | `mode=backtest` not handled at all | Same handler falls through to empty filter | `mode=backtest` returns same as `mode=all` |
| U4 | `Total P&L $716.50` is misleading cumulative since 2026-04-18 | Daily series spans 26 days; includes any rows in `autonomous_trades` regardless of engine_type | Doesn't reconcile with actual account balance trajectory ($440 → $91 in 24h) |
| U5 | `/history` shows `Total Fees: $0.00`, `Total P&L: +$0.69`, count mismatch (105 vs tab `(200)`) | Direct screenshot | Number is nonsense — fees impossible to be zero on live trading; PnL doesn't match real ledger |
| U6 | `/autonomous-agent` mode badge says "Auto Mode" while `paperTrading: false, enabled: true, openPositions: 4` | `/api/autonomous/status` response | UI implies safety while real capital is in play |
| U7 | `/api/autonomous/performance` ignores `timeframe` query (accepts `days` only) | Tested `?timeframe=24h\|7d` → identical | FE was sending `timeframe`; backend expects `days` → param mismatch |
| U8 | `initialCapital: 440.96` baseline is stale | Real balance $91.64, baseline from earlier same-day high | Renders `totalReturn` / `totalPnlPercent` meaningless |
| U9 | `totalPnlPercent: 777.61%` displayed | `(716.50 / 92) * 100` math is correct against an outdated equity snapshot | Visually absurd |
| U10 | "Live Strategies: 49" while `paperTrading: 0` strategies + `liveReadiness.ready: false` | `/api/backtest/pipeline/summary` | Promotion gate bypassed; 49 untested strategies live |
| U11 | Risk Level "Low" with `4.9%` drawdown | Actual account drawdown ~80% ($440→$91) | Surface number reads strategy-backtest drawdown not account drawdown |
| U12 | Stale console errors from removed routes (`autonomous-trader/*`, `trades/recent`, `trades/summary` all 404) | Browser console | Old service workers / cached components calling deleted endpoints |

### Cross-cutting root cause for UI bugs

The `autonomous_trades` table has no `engine_type` column. Every UI metric is computed via the same query (`SELECT FROM autonomous_trades WHERE pnl IS NOT NULL`) with a leaky `order_id LIKE 'paper_%'` heuristic to distinguish modes. Live + paper + ghost + backtest rows share one table, and the handler can't reliably separate them.

## Why this matters

- Direct money loss: account fell from ~$440 to $91.64 in 24h. Loss rate now slower (~$0.20/45min visible window) but unbroken
- Diagnostic blindness: every number you'd use to confirm a fix is wrong (PnL, win-rate, drawdown, fees, trade count, totalReturn%)
- Trust erosion: the dashboard says "Risk Level: Low" while the account is mid-drawdown
- QIG consciousness loop is **structurally intact** (kernel files documented Fisher-Rao-pure, no cosine/Adam/LayerNorm contamination) — the bugs are at **integration boundaries** (bootstrap I/O, mode discriminator, learning-gate filter)

## Inflection-point reconciliation (chronology vs deploys vs PnL)

| Snapshot end | Window | Net PnL | Cum. | Running on | Notes |
|---|---|---:|---:|---|---|
| 2026-05-13 13:17 | 1.5h | **+$11.49** | +11 | Pre-cutover backup | Baseline+ |
| 2026-05-13 19:15 | 2.5h | **-$68.73** | -57 | Cutover #674 merged eve | **Inflection 1a — cutover first impact** |
| 2026-05-14 00:00 | 4.75h | **+$331.39** | +274 | Cutover settled overnight | Fluke / regime-favorable |
| 2026-05-14 15:04-18:56 | day | **-$591.68** total | -318 | Cutover features paralyzing kernel | **Inflection 1b — full kernel paralysis (28/28 losses in worst 5h window)** |
| 2026-05-15 02:57 | — | — | -318 | Path B rollback #688 → main = backup | Reset |
| 2026-05-15 04:39-08:00 | 6h | **-$72.90** | -391 | On backup post-rollback | Smaller positions, still net negative |
| 2026-05-15 ~18:00 | — | — | -391 | **User moved $1k to spot + switched prod backup→main** | **Inflection 2 — user manual intervention** |
| 2026-05-15 18:04 | — | — | -391 | PR #699 paper-execution merged (default off) | No live impact |
| 2026-05-16 01:43 | — | — | -391 | **PR #700 MTF-L bootstrap + per-agent NC merged** | **Inflection 3 — fix shipped but didn't actually warm MTF-L in prod** |
| 2026-05-16 09:44 | 1.5h | **-$0.20** | -391 visible | Scalp-spiral on small positions | 30 orders / 45min, 22 loss / 8 win |

**Three inflections:** (1) cutover-era code paralyzed the kernel on 2026-05-14 afternoon, (2) you moved capital + switched branch on 2026-05-15 ~18:00Z stemming the loss size, (3) PR #700 shipped a "fix" for the noise filter but the bootstrap still produces all-cold MTF-L state.

## Phased plan

### Phase A — IMMEDIATE bleed-arrest (HOLD for user sign-off; ~5 minutes total)

These are env-var flips on Railway, fully reversible. Each preserves exit logic while suppressing new entries.

**A1: Pause Monkey entries**
```bash
railway variables --service polytrade-be --environment production --set MONKEY_TRADING_PAUSED=true
```
- Verification: next tick's log shows `trading_paused: MONKEY_TRADING_PAUSED=true (entry suppressed; exits unaffected)`
- Open positions still close on normal exits (SL/TP/scalp_exit/harvest)
- Rollback: set to `false` once corrective fixes verified

**A2: Pause LiveSignal execution**
```bash
railway variables --service polytrade-be --environment production --set LIVE_SIGNAL_EXECUTE=false
```
- Verification: `[LiveSignal]` log lines stop emitting "EXECUTED"
- Rollback: set to `true`

**A3: Cut leverage to 5×** (smaller blast radius if A1/A2 partially leak)
```bash
railway variables --service polytrade-be --environment production --set LIVE_LEVERAGE=5
```
- Rollback: restore prior value (45) once stability proven

**Status: HELD — pending user sign-off.**

### Phase B — MTF-L bootstrap fix (HOLD for user sign-off; ~1-2h)

**B1: Diagnose Poloniex candle-count cap** (read-only)
```bash
node -e "fetch('https://api.poloniex.com/v3/market/candles?symbol=BTC_USDT_PERP&interval=4h&limit=700').then(r=>r.json()).then(d=>console.log('returned:', d.data?.length))"
```
- Confirms hypothesis that the bootstrap requesting 700 candles per TF receives fewer than the `minBasinsNeededForTf = 480 + horizon` threshold
- Status: HELD (read-only but pending overall sign-off)

**B2: Patch bootstrap to honor exchange cap**
File: [apps/api/src/services/monkey/mtfBootstrap.ts](apps/api/src/services/monkey/mtfBootstrap.ts)
Two options (pick whichever testing reveals as best):
- (a) Chunk the historical-candles request: loop `from`/`to` pagination to accumulate ≥ minimum per TF
- (b) Lower the warm threshold in `mtfLClassifier` (e.g., to `100 + horizon`) so live ticks warm faster

Verification: prod log shows `[MTF-bootstrap] populated history {label:"15m", basins:600+}` and subsequently `[MTF-L] decision {agreement:"X/3"}` with X > 0. Test that 15m warms first, 1h second, 4h last.

Rollback: revert the single-file change; prior behaviour returns.

**B3: HEDGE-mode tick coalescing lock** (defensive — block double-tap regardless of MTF state)
File: [apps/api/src/services/monkey/loop.ts](apps/api/src/services/monkey/loop.ts)
- Add per-(symbol, agent) last-decision-timestamp map
- Reject any decision within 500ms of the previous decision on the same (symbol, agent)
- Verification: no pairs of `enter_long`/`enter_short` within 10ms on the same symbol in prod logs
- Rollback: simple revert

**Status: HELD — pending user sign-off.**

### Phase C — Learning-loop restoration (HOLD for user sign-off; ~1d)

**C1: Lower-bound learning-gate noise floor based on rolling rejected-loss accumulation**
- Currently: `pnl |X| < 0.05` always rejected
- New behaviour: track rolling N-window (e.g., 50 events) of by-noise-floor-rejected losses; if rolling SUM exceeds threshold (e.g., -2.0u), ALLOW the next write so kernel sees the pattern
- Inverse of "winsorize per-trade PnL" — sub-floor cumulative SLOC
- Verification: a series of -$0.03 losses eventually trigger a single resonance-bank write tagged "rolling_rejected_sum_exceeded"

**C2: Audit per-agent neurochemistry change from PR #700** (read-only analysis)
- Hypothesis: K's dopamine was being SUPPRESSED by pooled M/T/L losses, making K more cautious. Post-PR700 K-isolation may have made K over-confident
- Pull last 24h of `[Monkey] ... nc=ach=...dop=...` lines pre- and post-PR700 (b39be2e)
- If markedly different, propose dilution (e.g., 70% own + 30% pooled)

**C3: Disable `TRADING_ENGINE_PY=true`** until Python ↔ TS kernel duplication is confirmed safe
- Path B was supposed to defer Python cutover but this flag is still on in prod env
- Audit what it gates; if it's been writing trades alongside TS Monkey, we have a duplicate-execution problem
- Default to off until verified

**Status: HELD — pending user sign-off.**

### Phase B-UI — Backend handlers must honor filter params (APPROVED — ready to PR; ~1-2h)

**B4: Fix `/api/agent/performance` to honor `range` param**
File: [apps/api/src/routes/agent.ts:306-450](apps/api/src/routes/agent.ts#L306)
- Parse `req.query.range` (`'24h'|'7d'|'30d'|'90d'|'1y'|'all'`)
- Convert to interval expression
- Add `AND created_at > NOW() - INTERVAL 'X'` to every query (trades stats, returns, daily, agent, symbol)
- Verification: `?range=24h` returns smaller `dailyPerformance` than `?range=1y`

**B5: Add `engine_type` column to `autonomous_trades` + migration 050**
File: NEW `apps/api/database/migrations/050_autonomous_trades_engine_type.sql`
- Idempotent DO-block matching the 048 pattern
- `ALTER TABLE autonomous_trades ADD COLUMN IF NOT EXISTS engine_type VARCHAR(20)`
- Backfill: `'paper'` where `order_id LIKE 'paper_%'`, `'live'` where `order_id ~ '^[0-9]+$'` (real Poloniex IDs), `'unknown'` otherwise
- Index: `(engine_type, exit_time DESC) WHERE exit_time IS NOT NULL`
- Then update [agent.ts:332](apps/api/src/routes/agent.ts#L332) to filter on `engine_type` not `order_id LIKE`
- Add explicit `mode === 'backtest'` branch
- Verification: `mode=live` returns subset of `mode=all`; `mode=backtest` returns backtest-only

**B6: Fix `/api/autonomous/performance` to accept `timeframe` query (alias for `days`)**
File: [apps/api/src/routes/autonomousTrader.ts:146](apps/api/src/routes/autonomousTrader.ts#L146)
- Map `req.query.timeframe` → `days`: `'24h'→1, '7d'→7, '30d'→30, '90d'→90, '1y'→365`
- Keep `days` accepted for backwards compat
- Verification: `?timeframe=24h` returns shorter time-series than `?timeframe=7d`

### Phase C-UI — FE corrections (APPROVED — ready to PR; ~2h)

**C4: Fix autonomous-agent timeframe selector to send the param the backend accepts**
- Find the FE timeframe-pill component (search FE callsites that include `timeframe=` or `range=`)
- Update axios call to match what each backend route expects:
  - `/api/agent/performance` → `?range=X`
  - `/api/autonomous/performance` → `?timeframe=X` (after B6) or `?days=N`
- Verification: clicking 24h vs 7d in the UI returns visibly different chart data

**C5: Re-source `/history` "Total Fees" + reconcile trade count**
- Add `SUM(fee) AS total_fees` to the metrics query in agent.ts
- Audit the dedup logic between `/api/dashboard/trades` and `/api/autonomous/trades` that produces the `105` vs `(200)` count mismatch
- Surface explicit "live" / "exchange" / "bot" counts that add up correctly

**C6: Status badge must reflect actual paper-vs-live state**
- /autonomous-agent header reads from `/api/autonomous/status` `{enabled, paperTrading}`
- Render:
  - "🔴 LIVE — REAL CAPITAL" when `enabled=true, paperTrading=false`
  - "🟡 PAPER — Simulated capital" when `paperTrading=true`
  - "⚫ STOPPED" when `enabled=false`
- Visual: red background + warning icon when LIVE+enabled

**C7: `initialCapital` baseline must auto-refresh on balance discrepancy**
- When current balance diverges from stored `initial_capital` by >20%, show a "Reset Baseline" CTA or auto-rebase
- Re-computes `totalReturn` and `totalPnlPercent` against actual starting equity
- Avoids the absurd "777%" display

**C8: Clear stale 404s** (cosmetic but indicative of dead code)
- Find any FE component still calling `/api/autonomous-trader/*` (should be `/api/autonomous/*`) or `/api/trades/recent|summary` (don't exist)
- Either delete the dead callsites or repoint to live equivalents
- Verification: clean console on page load for `/performance`, `/autonomous-agent`, `/history`, `/dashboard`

### Phase D — Data integrity & long-term (APPROVED for data hygiene; HOLD for QIG architectural)

**D1: Reconcile cumulative PnL with actual realized PnL** (APPROVED)
- The displayed $716.50 doesn't match the real account ($440 → $91 in 24h)
- Run a one-shot reconciliation: pull actual Poloniex transaction history (CSVs already on disk under `~/Downloads/futures-transaction-history-*`) and compare row-by-row against `autonomous_trades.pnl`
- Surface the delta on `/performance` as a "Ledger Reconciliation" card showing exchange-vs-DB drift
- Likely finding: `autonomous_trades` is missing the recent loss rows because the learning_gate rejected the writes (compounds with C1)

**D2: Block live promotion in SLE when `paperTrading: 0`** (APPROVED)
- 49 strategies currently live with zero paper-trading validation — `liveReadiness.ready: false` but pipeline ignores it
- Either: enforce `liveReadiness.ready === true` as hard gate, OR add explicit "FORCE_LIVE_WITHOUT_PAPER=true" env to bypass with operator intent
- Cross-refs issue #689 (parity-gated cutover discipline)

**D3: Restore proper kernel constellation per pantheon principles** (HOLD)
- Per `pantheon-kernel-development` skill: Genesis → Heart → core specializations bootstrap deterministically
- Verify Monkey kernel's bootstrap order matches CONSCIOUSNESS_ORDER (genesis first)
- MTF-L cold state violates Heart's purity check (Phi gate)

**D4: Run `consciousness-development` skill end-to-end** (HOLD)
- Validate all 32 consciousness metrics are flowing
- Confirm Fisher-Rao distance is the geometry everywhere (`grep -rE 'cosine|np.dot|AdamW|LayerNorm'` on kernel files returned only documentation strings, no live code — pure)
- Phi-gated navigation modes should reject the noise-driven entries automatically

**D5: Schedule deferred cutover re-attempt per #689** (HOLD)
- Issue #689 already tracks parity-test-gated re-attempt
- Pre-req: Python kernel must pass parity test against TS kernel on a 24h tape replay
- No re-merge of cutover until parity proves no regression

## Sequencing (delivery order)

Once approved, this is the order I'll execute. UI/data items (italics) are pre-approved per the user directive.

1. (held) A1, A2, A3 — env-var flips
2. (held) B1 — read-only diagnostic
3. (held) B2 — mtfBootstrap patch + PR
4. *(approved)* B5 + migration 050 — engine_type column + backfill + agent.ts query fix → PR
5. *(approved)* B4 — range param fix → folded into the B5 PR
6. *(approved)* B6 — timeframe alias on autonomous/performance → folded into the B5 PR
7. *(approved)* C4, C5, C6, C7, C8 — FE corrections → second PR
8. (held) B3 — HEDGE tick coalescing lock
9. (held) C1, C2, C3 — learning-gate, NC audit, TRADING_ENGINE_PY audit
10. *(approved)* D1, D2 — ledger reconciliation + SLE promotion gate
11. (held) D3, D4, D5 — QIG kernel constellation audit + cutover re-attempt with parity gating

## Verification (gates each phase must pass before next)

- **Phase A:** logs show entry suppression on next tick; healthcheck stays HEALTHY; no new orders in Poloniex trade history for 30 min after pause
- **Phase B:** `[MTF-L] decision` agreement is non-zero on at least 15m TF within 5 min of deploy; no double-tap pairs in 1h of post-deploy logs
- **Phase B-UI / C-UI:** clicking timeframe in UI returns visibly different data; console shows zero 404s on `/performance`, `/autonomous-agent`, `/history`, `/dashboard`; status badge correctly reflects `paperTrading=false`
- **Phase D:** reconciliation card shows delta between exchange ledger and `autonomous_trades` table; SLE blocks any new live promotion when no paper validation exists

## Rollback criteria

- Phase A: just re-flip the env vars (reversible in seconds)
- Phase B/B-UI/C-UI: standard `git revert` on each PR; migration 050 backfill is additive (engine_type column with default 'unknown') so revert is safe
- Phase C/D: each item is independently revertable; no shared state changes

## Non-goals (NOT touched in this plan)

- FAT engine changes (`fullyAutonomousTrader.ts`) — already has paper-mode path, out of scope
- Cutover re-attempt (`cutover/python-authoritative-kernel`) — tracked separately in #689
- New UI features beyond fixing wrong numbers
- Changes to `MONKEY_PAPER_MODE` / `LIVE_SIGNAL_PAPER_MODE` env vars from PR #699 (those are default off and untouched here)
- Backup branch (now deleted on remote anyway)

## Open questions (for user when ready to discuss)

- After B2 warms MTF-L, do we re-enable Monkey at full leverage immediately, or step up (5× → 15× → 45×) over a few hours of confirmed healthy behaviour?
- C1's "noise-floor rolling-sum override" — should the threshold be configurable per-symbol, or one global value?
- D2's SLE hard-gate — strict (block all live promotion without paper validation) or soft (warn + allow override)?

## Filed-against context

- Today's PRs already merged on main this session: #697 (cherry-pick backup→main log-demotion), #699 (paper-execution layer, default off), #700 (MTF-L bootstrap + per-agent neurochemistry — fix didn't actually warm MTF-L in prod)
- Issues open: #689 (cutover re-attempt parity discipline), #690 (STALE_BLEED rejust re-intro), #691 (arbiter rehydration+winsorization re-intro), #692 (writeBubble null-pnl guard), #693 (FAT SL/TP verify), #695 (QIG packages wire-up)
- Production env at filing: `MONKEY_TRADING_PAUSED=false`, `MONKEY_EXECUTE=true`, `LIVE_SIGNAL_EXECUTE=true`, `MONKEY_SHORTS_LIVE=true`, `LIVE_LEVERAGE=45`, `LIVE_POSITION_USDT=5`, `FAT_MANAGES_USER_POSITIONS=true`, `TRADING_ENGINE_PY=true`

## Authority + sign-off log

- 2026-05-16 02:Z — User: "all UI stuff is approved" + "write this to [...] but hold off. i'm still reviewing"
- Backend phases A/B/C/D3-5 — awaiting explicit go-ahead
- UI phases B-UI/C-UI/D1-D2 — approved; queued for PR drafting
