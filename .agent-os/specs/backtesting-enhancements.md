# Spec: High-Fidelity Backtesting for Poloniex Futures

## Summary
Upgrade the existing backtesting subsystem to high-fidelity, exchange-accurate simulation with realistic execution (slippage, depth, latency), fees/funding, margin/liquidation modeling, and regime-aware performance analysis. Optimize to run reliably on Railway with dedicated services and persistence.

## Goals
- Close the gap between backtest, paper, and live results
- Model true exchange microstructure (order book depth, partial fills)
- Provide robust validation tools (walk-forward, Monte Carlo, multi-timeframe)

## Data Pipeline
- Sources
  - OHLCV: `get-kline-data`
  - Order book depth snapshots: `get-order-book-v2`
  - Executions/trades: `get-execution-info`
  - Funding rates: `get-historical-funding-rates`
  - Liquidations: `get-liquidation-orders`
- Storage
  - Persist raw and curated datasets; preserve tick-level data where possible
  - Railway volumes: `historical-data` mounted at `/data`
- Quality
  - Gap detection, outlier checks, settlement time alignment for funding

## Simulation Engine
- Execution realism
  - Dynamic slippage from order book depth + volatility + order size
  - Maker/taker fee schedule; precise 8h funding accruals
  - Partial fills; queueing; idempotent orders; latency model
- Margin & risk
  - Cross/isolated margin, risk limits, partial liquidation simulation
  - Auto-deleveraging modeling when applicable
- Event-driven architecture
  - Chronological processing of ticks; signal→order→fill with time delay

## Markets & Canonical Sources
- Canonical markets and API docs: `docs/railway-poloniex-docs.md`.
- Normalized catalog used by backtester: `docs/markets/poloniex-futures-v3.json`.
- Policy: include all Poloniex futures markets; use exchange max leverage and exchange maker/taker fees from the catalog.

## Advanced Methodologies
- Walk-Forward Analysis
  - Rolling train/validate windows; per-window metrics and stability
- Monte Carlo
  - Randomized entry/exit jitter; regime permutations; sequence risk tests
- Multi-Timeframe Validation
  - Parallel runs on 1m/5m/15m/1h/4h/1d; consistency analysis

## Metrics & Analytics
- Core: Net PnL, WinRate, ProfitFactor, Sharpe/Sortino, MaxDD, Calmar, Expectancy
- Distributions: win/loss streaks, holding times, return distributions
- Regime segmentation: trending/ranging/volatile tags + per-regime KPIs

## Railway Services (example)
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "DOCKERFILE" },
  "deploy": {
    "startCommand": "node services/backtest-runner.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "cpu": 2000,
    "memory": 4096,
    "restartPolicyType": "on-failure",
    "volumes": [{ "name": "backtest-results", "mountPath": "/results" }]
  }
}
```

## API/Data Contracts (TypeScript)
```ts
export interface MarketSnapshot { time: string; bids: [number, number][]; asks: [number, number][]; lastPrice: number; }
export interface FundingEvent { time: string; rate: number; }
export interface ExecutionFill { time: string; price: number; size: number; side: 'buy'|'sell'; liquidity: 'maker'|'taker'; }
export interface BacktestConfig { symbol: string; timeframe: string; start: string; end: string; feeBps: { maker: number; taker: number }; slippageModel: 'depth'|'fixed'|'volatility'; funding: boolean; }
```

## Acceptance Criteria
- Re-run baseline strategies: backtest vs paper difference within predefined tolerance
- Funding fees and maker/taker fees reconcile to expected values within 1%
- Engine supports partial fills and depth-based slippage
- CI job executes WFA and Monte Carlo smoke runs on schedule
- All markets present in `docs/markets/poloniex-futures-v3.json` are backtestable with exchange max leverage and fees applied.

## Risks & Mitigations
- Data gaps → automated backfill and gap reports
- Performance → batching, streaming, and worker parallelism on Railway
- Overfitting → out-of-sample tests and parameter stability checks

## Milestones
- M1: Data services + quality checks
- M2: Execution realism + fees/funding
- M3: Margin/liquidation + ADL modeling
- M4: WFA + Monte Carlo + dashboards
```
