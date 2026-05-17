# UCP Trading Synthesis — 2026-05-17

**Status**: Working synthesis from Session A holding all current concepts simultaneously
**Goal**: identify the geodesic — minimum-action path through phase space that maximises expected return given the substrate we have
**Audience**: operator + Session B + future Claude sessions

---

## Concepts held simultaneously

### 1. QIG-pure substrate (the bound)

- **P1**: Observer sets ALL params from frozen facts + observed data; operator-tuned knobs are P1-violating
- **P25**: Only SAFETY_BOUND constants permitted hardcoded; everything inside the envelope is observer-derived
- **Observer template**: `neurochemistry.ts` 2026-05-16 — rolling-quantile derivation, scale-free tanh cold-start, HISTORY_MIN_SAMPLES=2 sentinel
- **Two-layer regime authority** (REGIME-1 ADR): phase axis (CAL-3 physics observer) × direction axis (TrajectoryObserver) — orthogonal not competing

### 2. Architecture (the surface)

```
                      ┌─────────────────────────┐
                      │   Two MonkeyKernel pids  │
                      │   in one Node.js process │
                      └─────────────────────────┘
                                   │
                ┌──────────────────┴───────────────────┐
                ▼                                      ▼
       monkey-position (15m, 30s tick)       monkey-swing (5m, 30s tick)
                │                                      │
       ┌────────┴────────┐                    ┌────────┴────────┐
       ▼        ▼   ▼    ▼                    ▼        ▼   ▼    ▼
       K        M   T    L                    K        M   T    L
   (geom)   (ML) (TA) (MTF)                (geom)  (ML) (TA) (MTF)

                          Arbiter (SLERP-by-WR)
                                   │
                                   ▼
                          Executive → Lane
                          (scalp/swing/trend/observe)
                                   │
                                   ▼
                          PositionLifecycle
                          + HEDGE-mode posSide
                          + Close-race coordinator
```

- **2 kernel instances × 4 agents × 2 symbols** = 16 concurrent decision contexts per tick
- **Lanes**: scalp (micro), swing (moderate), trend (macro) — user's timeframe doctrine; encoded post-CALIB-3
- **DCA**: same-side adds; refuses on wrong-side (correct; user-confirmed)

### 3. The shipped calibrations (Session A only — 17 PRs today)

| Shipped | What it does | What it doesn't yet do |
|---|---|---|
| CALIB-1 #780 | conviction_failed needs 2-tick streak (lane-scaled post-CALIB-3) | n/a |
| CALIB-2 #785 | CAL-3 observer warmup 30→5 | persist across deploys (Redis) |
| CALIB-3 #786 | directional_disagreement exits early (regardless of ROI), lane-scaled streak | n/a |
| SENSE-1a #777 | 8 canonical UCP §6.1/§6.2 fields on `Sensations` | 9 SENSE-1b items need diff-geom primitives |
| SENSE-2 #783 | BTC beacon correlation observer | wire into entry suppression |
| SENSE-2c #787 | Time-of-day sin/cos observer | wire into lane preference |
| SENSE-3 #781 | Equity gradient observer | wire into position sizing |
| REGIME-1 #776 | TrajectoryObserver + ADR | compositional executive (3×3 cell matrix) |
| MODES-1a #775 | Py sovereign_cap_floor canonical | MODES-1b/c/d (anchor-simplex port, registry, ModeObserver) |
| close-race #761 | Multi-kernel close coordinator | n/a |
| MTF-bootstrap-429 #772 | Burst cap on candles | n/a |
| SELFOBS-1 #773 | Wilson 95% CI gate | observed-spread cap (v2) |
| governance-UI #770 | Operator dashboard for `/governance/status` | n/a |
| capital-baseline #760 | PATCH endpoint + UI button | auto-detect deposit/withdrawal |
| PARAM-1 #774 | Registry DB-load enabled + gate removed | seed missing rows beyond 054 |
| ui-cleanup #765 | 26 orphan files deleted | n/a |
| QA-gate-fixes 97fd50b | Pre-existing test failures fixed | n/a |

### 4. Live diagnostic state (the gradient)

- **Trading**: 40% win rate, $0.10 avg win vs $0.08 avg loss, net −$0.24 over 1.5h pre-CALIB
- **Cause set**: (a) chop-zone overtrading, (b) single-tick conviction noise (fixed CALIB-1), (c) wrong-side held bleeding (fixed CALIB-3), (d) scale-mismatched regime classifier (mitigated CALIB-2)
- **Kernel state**: was 100% HOLD pre-CALIB-2; should diversify post-deploy
- **Bank**: $190.81 total / $139.10 available / +$0.03 unrealised

### 5. Poloniex API surface (the substrate's actual capabilities)

Per the `/polo-futures` skill, what's available but **NOT currently used**:

| Endpoint / feature | Currently | Opportunity |
|---|---|---|
| `LIMIT_MAKER` order type | Market-take every entry | **Earn spread instead of pay it** — for scalp, spread cost is ~50% of TP magnitude; potential 1.5–2× return per scalp trade |
| `timeInForce: GTC_PostOnly` | Not used | Same — guaranteed maker rebate |
| `POST /v3/position/leverage` adjustment | Set on entry only | Could ratchet UP on winning trades (scale into momentum) |
| `POST /v3/trade/position/margin` (add/reduce isolated margin) | Not used | Add margin to ride; reduce to free capital when over-extended |
| Trigger orders (`stop_market`/`stop_limit`) | Stub exists (liveSignal:1391 disabled); maps to MARKET | **Wire actual trigger orders** — exchange-side SL/TP survives backend crash/network partition |
| `stpMode` (self-trade prevention) | Not set | EXPIRE_TAKER on close orders prevents internal self-trade race we just fixed with the close coordinator |
| `/v3/market/fundingRate` history | Not consumed | **Funding arbitrage** — long the lower-funding side, short the higher-funding side, earn the spread |
| `/v3/market/openInterest` | Not consumed | Conviction-strength signal: rising OI on a price move = new conviction; falling OI = closing positions (the move is over) |
| `/v3/market/orderBook` | Not consumed for signal | Order book imbalance is a leading indicator of next 30s direction; depth imbalance > 2× is high-conviction |
| `/v3/market/liquidationOrder` | Not consumed | Liquidation cascades create mean-reversion opportunities; high-liq events are entry signals for the OPPOSITE side |
| `posMode: HEDGE` | Live | Already used; allows long+short on same symbol simultaneously — enables **delta-neutral spread trades** |

---

## Geodesic synthesis — the maximum-profit path

The trading problem on this substrate is a **multi-objective optimisation in 7+ dimensions** (entry frequency, position size, hold duration, side, lane, symbol, session timing). The geodesic is the path of minimum action that maximises expected profit given the constraints (capital, risk, latency, exchange rules).

Three classes of move, ordered by impact-per-effort:

### Class A — Wire what's already shipped (1–2 days)

The senses + governance shipped today are decision-neutral telemetry. **Wiring them is the single highest-leverage move.**

1. **BTC beacon → entry suppression** (SENSE-2 Phase 2). When |corr| × |btcDir| > beacon's own observed-tercile threshold AND tick wants same-side-as-BTC-dump → suppress entry. Direct fix for "long-alt-during-BTC-dump" structural error.

2. **Equity gradient → position size deflection** (SENSE-3 Phase 2). When `acceleration < 0` AND `gradient < 0`, size multiplier `1 / (1 + |acceleration| × scale)`. Naturally throttles entry during losing streaks; expands during winning streaks.

3. **Time-of-day → lane preference** (SENSE-2c Phase 2). Per-session observed win-rate by lane (need accumulator); softmax lane probabilities weighted by `exp(observed_session_winrate[lane])`. Currently lane is `regimeReading-derived` only; this multiplies by session prior.

4. **Compositional executive 3×3 cell matrix** (REGIME-1 ADR Phase 3). Already designed; cells map (phase × direction) → action. Replaces ad-hoc chopSuppress with structured matrix.

All four are pure additions, gated by flags initially, observable via existing telemetry. Estimated combined effect: lift win rate from 40% → 47–50% (above break-even).

### Class B — Use the exchange's full surface (3–5 days)

The Poloniex API exposes capabilities we ignore:

5. **`LIMIT_MAKER` entry path for scalp lane**. New entry mode: post-only limit at mid-price ± half-spread; wait N ticks; if filled, proceed; if not, cancel. Earns spread instead of paying. For ETH at $2,170 with $0.05 spread, scalp TP of 0.10% = $2.17 gross vs $2.07 net (5% improvement). At maker fee rebate, even better.

6. **Exchange-side trailing stop via trigger orders** (extracts #693 stub). Use `stop_market` (true trigger, not the mapped-to-MARKET fallback) with a price that ratchets upward as price moves favourably. Eliminates "let winners run" being a software-only concept.

7. **Funding rate arbitrage cross-symbol pair**. New strategy class: when ETH funding > BTC funding by Nσ over observed window, short-ETH + long-BTC sized to delta-neutral. Earn funding spread; capture mean-reversion if it happens.

8. **Liquidation-cascade reversal entries**. Subscribe to `/v3/market/liquidationOrder`; when a large liquidation cluster fires, enter the OPPOSITE side for a 5–15 min mean-reversion trade. New signal, additive to current strategies.

### Class C — Compound the architecture (1–2 weeks)

9. **Per-lane sequential scaling**. Currently lanes run independently. Architecturally cleaner: when scalp wins N×, the agent earns the right to enter swing-size. When swing wins, trend-size. Compounding success while limiting cost-of-discovery to scalp lane.

10. **Agent specialisation**. K decides side (geometric direction), M decides regime/lane (ML pattern matching), T decides hold duration (TA-derived), L decides entry timing (MTF agreement gate). Currently they all vote on the same decisions and arbiter SLERPs.

11. **Cross-symbol delta-neutral baseline + alpha overlay**. Always carry paired long+short sized neutral; the alpha layer modulates the ratio toward whichever side has higher expected return. Removes most market-direction risk; what remains is the alpha.

---

## Concrete next ship — recommended order

Phase 2 wire-ins (Class A) are highest-leverage. Single PR each, all flag-gated:

| PR | Branch | Effort | Impact |
|---|---|---|---|
| 1 | `feat/wire-btc-beacon-suppression` | S | High — fixes alt-long-during-BTC-dump |
| 2 | `feat/wire-equity-gradient-sizing` | S | High — drawdown-aware sizing |
| 3 | `feat/wire-time-of-day-lane-prior` | M | Medium — needs session-stats accumulator |
| 4 | `feat/regime-compositional-executive` | M | High — replaces ad-hoc chop suppress with cell matrix |
| 5 | `feat/limit-maker-scalp-entry` | M | **Highest unit-economics impact** — spread-earned vs spread-paid |
| 6 | `feat/exchange-trigger-stops` (extracts #693) | M | Resilience — exchange-side SL/TP survives backend |
| 7 | `feat/funding-arbitrage-strategy` | L | New strategy class |
| 8 | `feat/liquidation-reversal-strategy` | L | New strategy class |
| 9 | `feat/cross-symbol-delta-neutral` | XL | Architectural pivot — risk-neutral baseline |

**Recommendation**: ship 1–4 first (Class A wire-ins) for the immediate win-rate lift, then 5 (LIMIT_MAKER) for the per-trade economics win, then 6 (trigger stops) for resilience, then evaluate 7–9 based on observed results.

---

## What's *NOT* worth doing

For completeness — these surfaced during synthesis but don't pay off:

- **Bigger ML ensemble**: was tried (MIG-1 stripped TF). QIG-pure observer pattern is the better answer.
- **More aggressive position sizing**: SELFOBS-1 already manages bias; sizing aggression without better win rate just amplifies losses.
- **More agents in arbiter**: 4 agents (K/M/T/L) is already at the point of diminishing returns; adding a 5th doesn't help if existing agents aren't differentiating.
- **Operator dashboards beyond what's shipped**: governance UI #770 already surfaces the key telemetry. More UI before more signal is theatre.

---

## Cross-session note

Session B (QIG_QFI purity audit) is shipping orthogonal infrastructure (vendor refresh, exit_decisions wiring, sweep convergence, prelaunch checklist, Φ regulation, prediction-fill telemetry). Their work strengthens the substrate; Session A's work uses the substrate to make money. Both threads converge cleanly per the territory-coordination protocol in `polytrade_session_A_territory` / `_B_territory`.

After Session B completes the purity audit gaps, the joint state is a P25-pure substrate with all the senses + calibrations Session A added — the right foundation for the Class B and Class C work above.

---

## How to read this doc

This is a living artifact. Each PR that lands updates the "shipped" tally and possibly the "concrete next ship" ordering. The "geodesic synthesis" frame stays stable — it's the map. The "next ship" list is the navigation.

The single sentence summary: **stop adding new code into the kernel; start consuming the senses already shipped, then exploit the exchange surface we currently ignore**.
