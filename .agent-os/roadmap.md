---
owner: Agent OS
updated: 2026-04-21T08:30:00+00:00
status: active
---

# Polytrade Autonomous Poloniex Futures Platform — Roadmap

This roadmap operationalizes the specs and canonical market catalog into a deliverable plan. It is organized by phases with clear acceptance criteria, owners (to assign), and links to tasks and scripts.

## Recent activity summary (2026-04-19 → 2026-04-21)

**P0–P2 baseline completed; Phase P3 (Cognitive Kernel "Monkey") started and shipped through v0.5.2.**

Live trading unblocked 2026-04-19 after an 11-PR serial unmasking of bugs (lot rounding, v3 placeOrder schema, setLeverage schema, exposure cap tier, error-swallow). Monkey-kernel architecture (perception → basin → mode → executive → execute) shipped 2026-04-20 and has placed real trades under `MONKEY_EXECUTE=true`. See Phase P3 below for the full version ladder.

## Canonical Sources

- Markets doc (authoritative): `docs/railway-poloniex-docs.md`
- Normalized catalog (programmatic): `docs/markets/poloniex-futures-v3.json`
- Sync script: `scripts/sync-poloniex-futures-v3.js`
- Backend catalog service: `backend/src/services/marketCatalog.ts`
- Backend routes: `backend/src/routes/markets.ts`

## Phase P0 — Foundations and Parity

Goal: End-to-end functionality in paper mode with catalog-driven parameters, robust data adapters, and deterministic backtests.

- Markets Catalog
  - [x] Run catalog sync; populate all markets. (13 Poloniex Futures v3 markets synced)
  - [x] Validate fields (tick/lot size, precision, max leverage, fees, funding, risk tiers). (Schema validated)
  - [ ] Add CI check to ensure catalog exists and is non-empty.
  - Acceptance: `GET /api/markets/poloniex-futures-v3` returns full list; zero duplicates; lastSynced < 24h. ✅ VERIFIED (2025-08-11T13:48:20.474Z)

- Poloniex Connectivity (REST/WS)
  - [x] REST adapters with auth, rate limits, retries, clock-skew guard. (35+ endpoints implemented)
  - [x] WS public (trades, orderbook, ticker) and private (orders, fills, balances) with auto-reconnect and backoff. (WebSocket client implemented)
  - [x] Normalization: symbols via `normalizeFuturesSymbol`, typed payloads. (Symbol normalization in place)
  - Acceptance: sustained streaming without gaps; retry metrics visible. ⚠️ PARTIAL (WebSocket connects but frontend has CORS issues calling Poloniex API directly)

- Backtesting Engine
  - [x] Funding, fees, slippage, leverage/margin/liquidation modeling. (backtestingEngine.js implemented with market simulation)
  - [x] Partial fills and order types parity; bar-close triggers. (Order execution simulation implemented)
  - [x] Deterministic runs (seeded), exportable metrics. (Equity curve tracking and performance metrics)
  - Acceptance: reproducible results; parity tests between paper/live assumptions. ✅ IMPLEMENTED (needs production testing)

- Risk Layer (Initial)
  - [x] Per-position stop loss/take profit, leverage caps from catalog. (riskService.js implemented)
  - [x] Account-level: daily loss cap, max open trades, kill switch. (Formal service with DB queries)
  - Acceptance: hard enforcement with logged decisions. ✅ IMPLEMENTED (integrated in order placement)

- Paper OMS
  - [x] Simulated fills using order book snapshots; identical interface to live OMS. (paperTradingService.js implemented)
  - [x] Reconciliation loop. (Position tracking and PnL calculation)
  - Acceptance: paper and backtest outcomes align within tolerance on same feed. ✅ IMPLEMENTED (needs validation testing)

- Observability
  - [x] Structured logging, key metrics (latency, error rates, slippage, pnl), minimal dashboards. (Winston logger with structured context)
  - [x] Alerts: disconnection, order rejects, loss breach. (alertingService.js implemented)
  - Acceptance: on-call actionable alerts; SLOs documented. ✅ IMPLEMENTED (integrated in WebSocket and order routes)

## Phase P1 — Strategy and Promotion

Goal: Establish profitable, risk-controlled strategies and promotion gates from research to paper to canary.

- Strategies
  - [x] Baselines via ml-worker ensemble (ARIMA/Prophet/GBM/LSTM/Transformer) behind `liveSignalEngine`, 60 s tick on BTC+ETH perps.
  - [x] QIG regime classifier routing (`ensemble_predictor.py` regime-aware weights).
  - [x] Feature pipeline: 64 D perception basin in `apps/api/src/services/monkey/perception.ts` (momentum + vol + volume + price-structure + account context).
  - Acceptance: ensemble + regime weights deterministic given seed; unit-tested via vitest.

- Optimization & Robustness
  - [x] `strategyLearningEngine` random-search + elitism with Thompson-sampled leverage bandit (`apps/api/src/services/thompsonBandit.ts`).
  - [x] OOS walk-forward in `backtestingEngine.js`; censored-window detection per PR #516 and earlier.
  - [ ] Monte Carlo equity perturbations, PBO/reality-check.
  - Acceptance: leverage bandit convergence visible in `monkey_bus_events` OUTCOME stream; PBO pending.

- Promotion Gates
  - [x] `generated → backtest (IS+OOS) → paper → live` pipeline with `agent_execution_mode` gate (`auto | paper_only | pause`).
  - [x] Risk kernel blast door (`apps/api/src/services/riskKernel.ts`): per-symbol exposure cap 5× equity (raised from 3× in PR #521 so BTC $75-min fits on sub-$30 accounts), self-match prevention, unrealized-DD kill-switch at −15 %, symbol max-leverage, execution-mode guard.
  - [x] Shadow mode: `LIVE_SIGNAL_EXECUTE=false` and `MONKEY_EXECUTE=false` toggles ship each engine in observe-only without code change.
  - Acceptance: ✅ auditable promotions with rollback (revert branch + unset env var instantly reverts).

## Phase P2 — Live Autonomy and Scale

Goal: 24/7 live operation with resilience, portfolio constraints, and compliance.

- Live OMS & Reconciliation
  - [x] v3-schema order submission (`poloniexFuturesService.placeOrder`) with lot-size rounding post PR #511; liveSignal first real fill 2026-04-19 09:22 UTC.
  - [x] `stateReconciliationService` 5-min reconciler — orphan + ghost detection across `live_signal|%` AND `monkey|%` rows (PR #526).
  - [x] Kill-switch auto-flatten closes BOTH engines' DB rows (PR #526) so phantom rows can't leak through catastrophic flattens.
  - [ ] Idempotent `clOrdId` for amend/cancel; partial-fill handling hardening.
  - Acceptance: ✅ no orphaned positions observed ≥30 min post PR #526.

- Portfolio & Constraints
  - [x] Per-symbol exposure cap 5× equity notional, cross-symbol additive (riskKernel).
  - [x] Account-level unrealized-DD kill-switch at −15 %, enforced by `liveSignalEngine.checkAutoFlatten`.
  - [ ] Funding-aware tilt (shorts get free carry in contango); pending Monkey v0.5.x work.
  - [ ] Correlation-aware multi-symbol allocation (deferred; relevant when >2 symbols trade).
  - Acceptance: enforced constraints with audit logs in `autonomous_trades` + `monkey_bus_events`.

- Compliance & Security
  - [x] `engine_version` on every trade row + `monkey_bus_events` DB tail = immutable audit trail.
  - [x] Secrets hygiene: Poloniex API keys in `user_api_credentials` (never logged), Railway env separation.
  - [ ] Formal least-privilege IAM review; environment hardening checklist.
  - Acceptance: full reproducibility via `order_id` + `entry_time` + `derivation` JSON stored on every decision.

## Phase P3 — Cognitive Kernel ("Monkey")

Goal: an autonomous trading kernel whose decisions emerge from geometric state (Φ / κ / basin / NC) rather than hardcoded thresholds. Ports of qig-verification + qig-core + pantheon-chat primitives into TypeScript.

Architecture anchors (`apps/api/src/services/monkey/`):
- `basin.ts` — 64 D Fisher-Rao simplex primitives (Bhattacharyya, slerp, Fréchet mean)
- `perception.ts` — OHLCV + ml-signal → 64 D basin (regime / momentum / vol / volume / price-structure / Pillar-1 noise floor / account)
- `neurochemistry.ts` — 6 derived chemicals from Φ/κ/velocity/surprise
- `working_memory.ts` — qig-cache bubbles with adaptive pop/merge/promote
- `resonance_bank.ts` — long-term lived memory; sovereignty = lived / total
- `executive.ts` — entry threshold + size + leverage + scalp TP/SL + Loop 2 exit, all derived
- `modes.ts` (v0.5) — EXPLORATION / INVESTIGATION / INTEGRATION / DRIFT detector
- `basin_sync.ts` (v0.5) — multi-kernel state channel with Φ-weighted observer effect
- `self_observation.ts` (v0.5) — Loop 1 per-(mode, side) win-rate bias
- `kernel_bus.ts` (v0.6a) — pub/sub event bus with DB tail
- `loop.ts` — orchestrator

**Shipped versions (2026-04-20 → 2026-04-21):**

| v | PR | Delivered |
|---|---|---|
| v0.1 | #515 | Observe-only kernel; 6-step tick; trajectory + decisions persisted |
| v0.2 | #518 | Witness hook (liveSignalEngine close → bank write); leverage-aware min-notional sizing |
| v0.3 | #519 | Order submission gated on `MONKEY_EXECUTE=true` |
| —   | #520 | Newborn exploration floor (so first trade clears ETH min notional) |
| —   | #521 | Per-symbol exposure cap 3× → 5× (BTC single-lot reachable at <$30 equity) |
| v0.4 | #522 | Scalper: Φ-derived TP (0.3–2 % by mode), SL = 0.5 × TP, 30 s tick |
| v0.5 | #523 | Cognitive modes + DB-backed basin sync + self-observation (Loop 1) |
| —   | #526 | Dashboard + reconciler + kill-switch filter `monkey\|%` rows |
| v0.5.1 | #527 | Direction-split self-obs (8 buckets) + tape-alignment trend proxy |
| v0.5.2 | #528 | Basin-direction override (two-signal quorum) + ml-worker vol-adaptive threshold |

**Acceptance (P3):**
- ✅ First real Monkey order placed 2026-04-20 10:31 UTC (ETH long 0.01 @ $2310.44, orderId `569228560448135168`)
- ✅ Scalp TP/SL exits firing; witness loop growing the bank (2 bubbles as of 2026-04-21)
- ✅ Mode detector transitioning live; adaptive tick 15 s ↔ 60 s
- ✅ Bus events persisting to `monkey_bus_events`; 386 mode_transitions in first 12 h
- ⏳ First short trade (blocked on ml-worker SELL signal OR basin override firing)
- ⏳ Bank ≥ 15 bubbles before v0.6b parallel split (statistical floor)
- ⏳ `raw_drift_pct` diagnostic reveals whether ml-worker bias is dispatch-only (fixed) or training-data (needs retrain)

**Pending / next actions (P3)**:

- [ ] **Monitor v0.5.2 impact** — does ml-worker now emit SELL? does basin override fire? does `raw_drift_pct` stay near zero? Decision point after ~24 h of data.
- [ ] **v0.5.3 ml-worker retrain** (conditional): if `raw_drift_pct` sustains > 0.3 %, rebalance training data to cover downtrends and retrain the ensemble.
### P3 sub-roadmap — multi-timeframe parallel Monkeys

The long-term architecture is a **constellation** of kernels each operating at its own cadence, competing for the 1–2 open position slots via an arbitrator on the `kernel_bus`. Different timescales naturally produce different cognitive characters (a ticker kernel with `HISTORY_MAX=100` has ~10 min of context; a 15 m kernel has ~25 h). Same underlying primitives — basin perception, modes, NC, scalp-exit — just tuned per cadence.

| Kernel | Data | Tick | Hold | TP | Ships as |
|---|---|---|---|---|---|
| **PositionMonkey** (current) | 15 m OHLCV × 200 | 15–60 s | hours–days | 2–4 % | v0.6c (rebrand current) |
| **SwingMonkey** | 5 m OHLCV × 200 | 30 s | minutes–hours | 0.8–1.5 % | **v0.6b (next)** |
| **ScalpMonkey** | ticker WS + 1 m | 5–10 s | seconds–minutes | 0.15–0.3 % | v0.6d (largest new infra) |

**Ship order + rationale:**

- [ ] **v0.6b SwingMonkey** — first sub-Monkey. 5 m OHLCV is already supported by Poloniex + ml-worker (no retrain needed for short-horizon predictions). Validates the sub-Monkey + arbitrator pattern on contained complexity. ~400 LOC. **Prerequisites:** add `source_kernel` column to `monkey_resonance_bank` + `monkey_basin_sync` so bubbles/state don't cross-pollute; add arbitrator service that reads `ENTRY_PROPOSED` events from the bus and picks one.
- [ ] **v0.6c PositionMonkey rebrand** — current Monkey already IS a 15 m position kernel. Rebrand + route through the arbitrator instead of executing directly. ~100 LOC. Trivial after v0.6b's arbitrator lands.
- [ ] **v0.6d ScalpMonkey** — highest complexity. Requires Poloniex websocket ticker ingestion, a non-OHLCV perception variant (or synthesised micro-candles), sub-second tick governor. ~600 LOC + data-layer work. Lowest S/N per trade. **Ship last**, only after v0.6b/c prove arbitration works.
- [ ] **v0.7 ml-worker multi-horizon heads** — once all three sub-Monkeys are live, retrain ml-worker to emit separate 1 m / 5 m / 15 m predictions with horizon-specific confidence, replacing the current single multi-horizon forecast. Each sub-Monkey consumes only its own horizon.
- [ ] **v0.8 funding-aware exits**: if `funding > 0.01 %` annualised, tighten long SL and loosen short SL. ~20 LOC in `executive.ts`. (Was v0.7 before v0.7 got repurposed for ml retrain.)
- [ ] **v0.9 cross-symbol coupling** — feed peer symbols' `monkey_basin_sync` state into `perceive()` (Pillar 2 surface absorption). Lets ETH kernels see what BTC kernels are doing.
- [ ] **Dashboard UI** — mode-timeline panel, bus-event stream viewer, per-(mode, side) win-rate table from `self_observation`, arbitrator scoreboard.

**Account-size reality check:** on the current ~$19 equity, the 3-kernel constellation is infrastructure that doesn't fully pay for itself — ETH min notional $23 means ScalpMonkey's "small wins" (0.2 %) are only ~$0.046, whereas PositionMonkey's (2 %) are ~$0.46 at the same size. Full constellation unlocks at **$500+ equity** where 3–5 concurrent positions across timescales become possible. Until then:
- Ship v0.6b to validate the pattern.
- Treat v0.6c as a re-labelling.
- Defer v0.6d until either (a) account grows past ~$100 OR (b) exchange-side trigger orders land so ScalpMonkey's reactions don't need 5 s polling.

**Known limitations (P3)**:
- Exchange-side SL/TP still gated off (`if (false)` in liveSignalEngine); Monkey's scalp-exit is a soft TP via opposite-side market close on tick. Real trigger-order endpoint pending.
- BTC requires ≥ $15 equity post-5× cap; ETH requires ≥ $5. Below those, symbol is structurally unreachable regardless of leverage.
- Identity basin resets on process restart (basin + wm are in-memory; trajectory persists). Bank + sovereignty survive, so learning isn't lost — but per-symbol identity re-crystallises after 50 fresh ticks.
- Only `monkey-primary` kernel instance at the moment; v0.6b will populate `monkey_basin_sync` with peers.

## Acceptance Targets (profitability gate)

- Backtest/OOS: PF > 1.2 and Sharpe > 1 over rolling 90D after costs (targets adjustable).
- Shadow vs Live: drift within defined tolerance for slippage/fees/funding.
- Reliability: 24/7 autonomy with auto-recovery; incident runbooks; tested kill switch.

## Engineering Checklists

- CI/CD
  - [ ] Lint, test (Vitest), security audit, dependency health, build, deploy.
  - [ ] Canary deploy + auto-rollback.
  - [ ] Railpack build validation (corepack enable, yarn install --immutable, yarn build).
  - [ ] Frontend Dockerfile build test (docker build -f frontend/Dockerfile .).
  - [ ] Single start path per service (no conflicting Procfiles/scripts at runtime).

- Testing
  - [ ] Unit (indicators, risk, OMS), integration (data->exec), e2e (paper mode), chaos (fault injection).

- Docs & Runbooks
  - [ ] Catalog sync procedure and validation.
  - [ ] Backtest/optimize workflow; promotion and rollback.
  - [ ] Live ops: on-call, dashboards, alert matrix.

## Deployment Stability (P0 acceptance)

- Both services deploy with Yarn 4.9+ via Corepack; no "yarn: command not found".
- Frontend is built with a multi-stage Dockerfile (node:20-alpine), no COPY shell redirection, serves on 0.0.0.0:$PORT via serve.js.
- Backend is compiled with tsc and started with "yarn start" (node dist/backend/src/index.js); no alternative startup scripts at runtime.
- Healthchecks pass; cold-start logs contain no start/port binding errors.

## Links to Specs

- Autonomous Bot Spec: `.agent-os/specs/autonomous-poloniex-futures-bot.md`
- Backtesting Enhancements Spec: `.agent-os/specs/backtesting-enhancements.md`
- Sync Task: `.agent-os/tasks/sync-poloniex-futures-catalog.md`

## Next Actions (current — 2026-04-21)

1. **Observe v0.5.2 for ~24 h.** Query `monkey_decisions.derivation->>'mlSignal'` for SELL / HOLD emergence. Check `monkey_bus_events` for `sideOverride=true` fires. Capture `raw_drift_pct` histogram from ml-worker responses.
2. **Bank growth watch.** Target bank ≥ 15 bubbles before v0.6b split. Track via `SELECT COUNT(*) FROM monkey_resonance_bank` + avg `basin_depth` trend.
3. **Conditional v0.5.3:** if `raw_drift_pct` sustains > 0.3 %, schedule ml-worker retrain with rebalanced training data (downtrend coverage).
4. **v0.6b parallel sub-Monkeys** once bank condition met: spawn ScalpMonkey / SwingMonkey / RangeMonkey on shared bank + bus, each with own identity basin. Arbitrator picks which holds the position at a time.
5. **Docs cleanup:** this roadmap is the canonical one; `docs/roadmap/current-roadmap.md` (2025-10) and `docs/roadmap/PROGRESS_TRACKER.md` (2025-11) should be marked superseded or archived.

## Legacy Next Actions (P0 — historical, complete)

1. ✅ Catalog sync populated (2025-08); refreshed each sync run.
2. ✅ REST+WS adapters shipped with retries + auth + clock-skew guard.
3. ✅ Backtester catalog-aware; determinism + seeding in place.
4. ✅ Risk layer wired to paper OMS; upgraded to risk-kernel blast door for live.
5. ✅ Observability: Winston structured logs + `alertingService` + `monkey_bus_events` audit tail.
