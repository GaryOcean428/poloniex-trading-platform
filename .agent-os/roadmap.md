---
owner: Agent OS
updated: 2025-08-11T19:56:15+08:00
status: active
---

# Polytrade Autonomous Poloniex Futures Platform — Roadmap

This roadmap operationalizes the specs and canonical market catalog into a deliverable plan. It is organized by phases with clear acceptance criteria, owners (to assign), and links to tasks and scripts.

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
  - [ ] Baselines: trend-follow, mean-reversion, breakout, funding bias.
  - [ ] Feature pipeline and indicators library.
  - Acceptance: unit-tested strategies with deterministic signals.

- Optimization & Robustness
  - [ ] Grid/random/Bayesian search; walk-forward and OOS validation.
  - [ ] Monte Carlo equity perturbations and PBO/reality-check reporting.
  - Acceptance: top-k configs with statistically defensible edge.

- Promotion Gates
  - [ ] Define promotion policy (paper -> canary -> full), capital limits.
  - [ ] Shadow mode (paper parallel to live decisions) and drift monitoring.
  - Acceptance: gated, auditable promotions with rollback plan.

## Phase P2 — Live Autonomy and Scale

Goal: 24/7 live operation with resilience, portfolio constraints, and compliance.

- Live OMS & Reconciliation
  - [ ] Idempotent order submission, amend/cancel, partial fill handling, rate-limit safe.
  - [ ] State reconciliation on restart; safe resume.
  - Acceptance: no orphaned positions; SLA on execution and cancel latencies.

- Portfolio & Constraints
  - [ ] Exposure caps per-symbol and aggregate; correlation-aware allocation; funding-aware tilt.
  - Acceptance: enforced constraints with audit logs.

- Compliance & Security
  - [ ] Immutable audit trail: configs, signals, orders, fills, deployments.
  - [ ] Secrets hygiene; principle of least privilege; environment hardening.
  - Acceptance: full reproducibility of any trade with lineage.

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

## Next Actions (P0)

1. Run `yarn sync:poloniex` with API credentials to populate catalog; verify counts and sample fields.
2. Implement Poloniex REST/WS adapters with retries and auth; add unit tests.
3. Align backtester with catalog (fees, funding, leverage/liquidation) and validate determinism.
4. Add initial risk layer (daily loss cap, leverage from catalog, kill switch) and wire to paper OMS.
5. Add observability metrics and minimal alerting.
