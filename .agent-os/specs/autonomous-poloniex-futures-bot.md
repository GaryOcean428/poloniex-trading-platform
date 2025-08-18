# Spec: Fully Autonomous Poloniex Futures Trading Bot

## Summary
Design and implement a fully autonomous Poloniex futures trading system built on the existing Polytrade codebase. The system must manage the entire lifecycle: data ingestion, strategy intelligence (ensembles, ML), risk/capital management, execution optimization, monitoring/self-healing, and production deployment on Railway. Target “set-and-forget” reliability with strict risk controls and continuous validation.

## User Stories (Given/When/Then)
- As an operator, given configured API keys and risk budgets, when I enable autonomous mode, then the bot trades continuously with dynamic position sizing and drawdown protections.
- As a researcher, given historical data, when I run backtests with walk-forward and Monte Carlo, then I receive metrics and confidence intervals comparable to paper/live results.
- As a maintainer, given monitoring and alerts, when components degrade (API, WS, latency), then the system self-heals or safely pauses trading.
- As a PM, given dashboards, when I review strategy health, then I can see real-time PnL, risk metrics, and recommendations.

## Non-Functional Requirements
- Reliability: 99.5% uptime target for live trading service; auto-restart and failover
- Security: secrets via Railway env vars; no plaintext logging of sensitive data
- Performance: end-to-end trade decision latency < 300ms under normal load
- Observability: structured logs, metrics, health endpoints, alerts
- Compliance: rate limits, exponential backoff, idempotent order submission

## Architecture & Components
- Strategy Intelligence
  - Multi-timeframe analysis (1m→1d)
  - Ensemble predictions (LSTM/Transformer/GBM/ARIMA/Prophet)
  - Volatility forecasting (GARCH + realized + implied)
- Risk & Capital
  - Kelly-derived dynamic sizing with liquidity/correlation adjustments
  - Portfolio-level VaR, stress tests, liquidity/correlation risk
  - Drawdown control, profit banking, circuit breakers
- Execution
  - TWAP/VWAP/Iceberg/Market/Limit with smart routing
  - Latency monitoring and low-latency endpoint selection
- Monitoring & Self-Healing
  - API/WS/DB/model/execution health checks
  - Automated remediation actions and safe-stop logic
- Deployment
  - Railway services (web, workers), health checks, volumes, restart policies

## Markets & Canonical Sources
- Canonical markets and API docs: `docs/railway-poloniex-docs.md` (covers Poloniex Futures v3 endpoints and the complete set of available futures markets).
- Normalized catalog for programmatic use: `docs/markets/poloniex-futures-v3.json`.
- Policy: include all Poloniex futures markets; use exchange maximum leverage and exchange fee schedule (maker/taker) as published by Poloniex.

## API & Data Contracts (TypeScript)
```ts
export interface TradingSignal {
  symbol: string;
  side: 'long' | 'short' | 'flat';
  confidence: number; // 0..1
  expectedReturn: number;
  winRate: number;
  timeframe: string;
  timestamp: string; // ISO
}

export interface PositionSize {
  size: number;
  confidence: number;
  riskMetrics: {
    positionVaR: number;
    leverage?: number;
  };
}

export interface ExecutionResult {
  orderId: string;
  status: 'filled' | 'partial' | 'rejected' | 'cancelled' | 'queued';
  avgPrice?: number;
  filledSize?: number;
  reason?: string;
  latencyMs: number;
}

export interface StrategyHealth {
  overallHealth: number; // 0..100
  performance: {
    currentPnL: number;
    dailyPnL: number;
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
  };
  modelAccuracy: number;
  riskMetrics: { var1d: number; drawdown: number };
  marketFit: number;
  recommendations: string[];
}
```

## UX (Dashboards)
- Strategy Health: health score, PnL, drawdown, alerts
- Risk: VaR, sizing, exposure, correlations
- Execution: order routes, slippage, latency
- Operations: component health, self-healing actions, logs

## Testing Plan
- Unit: signal generation, sizing, execution strategies, risk calculations (Vitest/Jest)
- Integration: end-to-end paper trade loop with mocked exchange
- Backtesting validation: walk-forward + Monte Carlo; parameter stability
- Chaos tests: WS disconnects, API rate limiting, latency spikes

## Rollout Plan
- Feature flags per strategy/module
- Staged rollout: paper → small live size → scaled live
- Automated daily validation runs; thresholds for promotion/rollback

## Milestones
- Phase 1 (Weeks 1–4): Risk, monitoring, real-time metrics
- Phase 2 (Weeks 5–8): Multi-timeframe, sentiment, predictive ensemble
- Phase 3 (Weeks 9–12): Self-healing, HA, Railway config
- Phase 4 (Weeks 13–16): Perf/scale, advanced analytics, production validation
```
