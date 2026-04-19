# Dashboard Scorched-Earth Prune + State-of-the-Bot Card

## Context

Production UI review (2026-04-19) showed the autonomous-agent dashboard was confusing and dishonest: a "Live Trading Active" banner while nothing had traded for 12 hours, "Backtest Results" cards averaging across 1,791 legacy rows with NULL `engine_version` (producing nonsense like −733% avg, +3813% best, −23581% worst), an Integration Status panel leaking from the login layout onto every authenticated page, and decorative blocks (Technical Indicators / Risk Parameters / Entry/Exit Conditions / Capability Tiers) that display empty zeros when the agent isn't mid-generation.

Root cause: rapid prototyping left many components that render regardless of whether they have real data, and aggregate queries pre-date the `engine_version` migration (PR #496) so they still pull legacy rows.

## Goals

1. The user should be able to answer "what is the bot doing right now, and is it making money?" in under 5 seconds from the dashboard.
2. Nothing shown should be stale, mocked, or averaged across provenance-unknown data.
3. Removal first, fix second — delete components that can't honestly show live data today.

## Non-goals (deferred)

- **P2** — Periodic DB↔exchange reconciler + time-bounded stacking guard. (Separate PR next.)
- **P3** — P&L math audit: short-side sign verification, decimal vs percent unit consistency, on-the-fly backend calc reconciliation, leverage-as-bandit-dimension. (Separate PR after P2.)
- **Legacy row hard-delete** — for now we filter by `engine_version IS NOT NULL` in aggregates; actual deletion waits until the legacy purge PR.

## Design

### Removals

**Remove unconditionally:**
- `Integration.tsx` rendered globally at `apps/web/src/App.tsx:149` — leaks "Integration Status" panel onto every authenticated page. Gate behind `!isAuthenticated` or remove entry from `App.tsx` and only render on `/login`.
- "Capability Tiers" card (`AutonomousAgentDashboard.tsx:1229–1260`) — always shows zeros in prod; the `/api/agent/capabilities` route returns `{tier1: 0, tier2: 0, tier3: 0}` hardcoded.
- "Backtesting Results" aggregate card inside `AgentOverviewPanel` — legacy numbers (−733.2% / +3813.7% / −23581.5%) from NULL-engine_version rows. Remove the whole sub-card; detailed per-strategy view lives on `/backtesting`.
- Decorative "Technical Indicators / Risk Parameters (all 0%) / Entry Conditions / Exit Conditions" blocks in `StrategyGenerationDisplay.tsx:199–280`. Hide entire decorative block when the generation has no indicators/conditions populated.
- "Strategy Pipeline" copy "Start the agent to generate..." when agent IS running (line 1198–1200 in dashboard). Either hide the section when running, or show real pipeline stats (generated / backtested / paper / live counts).

**Make dismissable permanently:**
- `PWAInstallPrompt.tsx` — current localStorage dismiss re-triggers on new device or cleared storage. Add a hard "never show again" toggle and default the banner to disabled in prod.

### Additions

**New component: `StateOfTheBotCard.tsx`** — single headline card placed at the top of `/autonomous-agent`, above everything else. Structure:

```
┌─────────────────────────────────────────────────────────────┐
│  [PHASE BADGE]  Last tick: 0:23 ago    Mode: Auto           │
│  ─────────────────────────────────────                       │
│  TRADING | SKIPPING | PAUSED | DEGRADED  (dominant, large)   │
│  Why: "BTC has open position, skipping entry"               │
│                                                              │
│  [24h] [7d] [30d] [all]  ←segmented toggle                  │
│  P&L: +$0.03  (0.11%)  — across 4 realized trades           │
│                                                              │
│  Trades/hr: 2.1   Win rate (last 20): 55%                   │
│  Exchange open: 0 · DB open: 0  ✓ in sync                   │
│  Balance: $27.15 USDT  · Leverage in use: 3x                │
└─────────────────────────────────────────────────────────────┘
```

**Dominant metric is the Phase badge (c).** User's literal complaint was "hard to tell what it's actually doing" — phase answers that in one word. P&L with timeframe slider sits below it as secondary, activity stats below that.

**Backend endpoint:** `GET /api/agent/state-of-bot`. Returns:

```ts
{
  phase: 'trading' | 'skipping' | 'paused' | 'degraded' | 'evaluating',
  phaseReason: string,      // e.g. "BTC/ETH have open positions, skipping entry"
  executionMode: 'auto' | 'paper_only' | 'pause',
  lastTickAt: ISO8601,
  pnl: {
    '24h':  { realized: number, trades: number },
    '7d':   { realized: number, trades: number },
    '30d':  { realized: number, trades: number },
    'all':  { realized: number, trades: number },
  },
  tradesPerHour: number,    // last 24h
  winRateLast20: number,    // 0-1
  exchangeOpenPositions: number,
  dbOpenPositions: number,  // status='open' count
  balance: { equity: number, currency: 'USDT' },
  currentLeverage: number,
}
```

Computed from: `autonomous_trades`, `agent_execution_mode`, last liveSignal tick log (cache recent events in-memory), Poloniex `getAccountBalance` + `getPositions`.

Phase logic (priority order):
- `paused` if `execution_mode === 'pause'`
- `degraded` if Poloniex API unreachable OR lastTick > 5min ago
- `skipping` if last tick produced a signal but stacking guard / kernel veto fired
- `trading` if last tick actually placed an order
- `evaluating` otherwise (no qualifying signal)

### Filter engine_version on existing aggregates

All existing backtest aggregate queries add `WHERE engine_version IS NOT NULL` to stop pulling 1,791 legacy rows into averages. Files:
- `apps/api/src/routes/agent.ts:471–488` (`/api/agent/backtest/results`)
- `apps/api/src/routes/backtest.ts:581–673` (`/api/backtest/pipeline/summary`)
- any other aggregate SQL touching `backtest_results`

This is surgical — legacy rows still exist, just hidden from aggregates. P3 will purge them properly.

## Verification plan

Post-deploy, via Playwright + Railway MCP:
1. Login to prod, navigate `/autonomous-agent`
2. Confirm: no Integration Status panel at bottom
3. Confirm: State-of-the-Bot card at top, Phase reads `TRADING` or `EVALUATING` (not `SKIPPING`) now that P0 freed the stacking guard
4. Confirm: `-733%` etc. numbers absent (engine_version filter working)
5. Confirm: PWA install banner stays dismissed after page reload
6. Sidebar pages smoke test — click each of 8 routes, confirm none 404
7. Railway logs: liveSignal now placing orders (stacking guard not blocking)

## Out of scope, acknowledged as follow-ups

- **P2:** Periodic reconciler prevents phantom state from recurring (separate PR, next)
- **P3:** Math audit — why is `total_return` displayed as −89.60% when DB stores −0.0006; short-side sign inversion; leverage as bandit learning dimension (separate PR after P2)
