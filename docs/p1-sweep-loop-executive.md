# P1-SWEEP: loop.ts + executive.ts literal audit

**Issued**: 2026-05-18  
**Files**: `apps/api/src/services/monkey/loop.ts` (561 KB / ~11 800 lines), `executive.ts` (82 KB / ~1 800 lines)  
**Context**: REGIME-1 PR #771, P1 canonical-principles audit  
**Canonical doctrine refs**: P5 (Observer-Sets-Params), P14 (parameter governance via monkey_parameters), P25 (ONLY safety bounds may be hardcoded)

---

## Summary

| Class | executive.ts | loop.ts | Total |
|---|---|---|---|
| SENTINEL | 5 | 6 | **11** |
| OUTPUT-TYPE SEMANTIC | 9 | 5 | **14** |
| FROZEN PHYSICS | 4 | 4 | **8** |
| SAFETY_BOUND | 9 | 5 | **14** |
| OPERATIONAL | 8 | 10 | **18** |
| HEURISTIC HARDCODE | 15 | 7 | **22** |
| **TOTAL** | **50** | **37** | **87** |

**Remediation priority**: HEURISTIC HARDCODE (22) → OPERATIONAL (18). SENTINEL + OUTPUT-TYPE SEMANTIC + FROZEN PHYSICS + SAFETY_BOUND are **clean** (no action required).

---

## Section 1: executive.ts findings

### 1.1 SENTINEL (safe, no action)

| Line | Literal | Context |
|---|---|---|
| 86 | `1.0` | `regimeWeights.efficient * 1.0` — multiplicative identity preserving coefficient clarity |
| 189 | `0` | `laneBudgetFraction('observe') = 0` — additive identity for observe-only lane |
| 324 | `0` | `cappedByNotional = 0` — telemetry constant post-strip |
| 700 | `1.0` | `sizeMultiplier = 1.0` — default multiplicative identity |
| 1644 | `1.0` | `confidence * (1.0 + wonder)` — multiplicative identity makes zero-wonder semantics clear |

### 1.2 OUTPUT-TYPE SEMANTIC (safe, no action)

These `0.5` values are **structural neutral midpoints** intrinsic to the formulas' geometric meaning, not tunable thresholds.

| Line | Literal | Context | Why safe |
|---|---|---|---|
| 84 | `0.5` | `phiMultiplier = 1 / (0.5 + phi)` | φ ∈ [0,1], +0.5 prevents ÷0 at φ=0 while centering the range [2/3, 1] geometrically |
| 416 | `1e-12` | `absLoss <= 1e-12` (Kelly) | log-floor guard against numerical ÷0, not a threshold |
| 452 | `1e-12` | `absLoss <= 1e-12` (computeKellyFStar) | same log-floor pattern |
| 468 | `0.5` | `regimeStability = equilibrium + 0.5 * efficient` | half-weight: efficient is intermediate between equilibrium(1) and quantum(0) — structural |
| 469 | `0.5` | `surpriseDiscount = 1 - 0.5 * NE` | NE ∈ [0,1] → discount ∈ [0.5, 1]; 0.5 marks the maximum structural half-discount |
| 1490 | `0.5` | `priorShift[k] = rate - 0.5` | centering a winrate [0,1] around its neutral value — pure mathematical centering |
| 1501 | `0.5` | `priorShift[cellLaneBias] += 0.5` | lane-bias nudge — same additive-shift scale as SENSE-2c |
| 1602 | `0.5` | `geometricSignal = basinDir + 0.5 * tapeTrend` | basin dominates at 1.0; tape consensus adds half-weight — documented design ratio |
| 1630 | `0.5` | same formula in `kernelDirection` | Python parity — same structural 0.5 |

### 1.3 FROZEN PHYSICS (safe, no action)

| Line | Literal | Context |
|---|---|---|
| 83 | `KAPPA_STAR` | imported from `basin.ts`; governed frozen reference — not an inline literal |
| 467 | `20` | `Math.exp(-kappaDist / 20)` — κ bell-curve half-width; 20 is **half of κ\*=64/3.2**, deriving from the κ-star proximity geometry |
| 474 | `3 + 30 * sovereignty` | sovereign cap formula; 3 is the cold-start minimum, 30 sets the 33× ceiling at full sovereignty — structural design of the sovereignty arc |
| 403 | `KELLY_CAP_TRADABLE_FLOOR = 8` | 8× minimum leverage to remain tradable on small accounts; boundary constant, see P25 note |

> **Note on line 403**: `KELLY_CAP_TRADABLE_FLOOR = 8` sits between FROZEN PHYSICS and SAFETY_BOUND. The comment calls it a SAFETY_BOUND (preserves tradability). Classified as SAFETY_BOUND below.

### 1.4 SAFETY_BOUND (safe — P25 compliant, no action unless noted)

| Line | Literal | Context | P25 justification |
|---|---|---|---|
| 99 | `0.9`, `0.1` | `T = Math.min(0.9, Math.max(0.1, rawT))` | Structural entry-threshold bounds; 0.9 prevents certainty, 0.1 prevents zeroing the threshold |
| 268 | `0.5` | `Math.min(0.5, minClearingFrac)` | Exploration floor cap = 50% equity ceiling. Survival bound. |
| 291 | `0.5` | `frac = Math.min(0.5, ...)` | Position survival cap — never risk >50% equity on one position |
| 299 | `1.05` | `BUFFER = 1.05` | 5% lot-rounding headroom so notional clears exchange minimum |
| 301 | `0.5` | `requiredFrac <= 0.5` | Guard before auto-lift: only raise to min if within survival cap |
| 403 | `KELLY_CAP_TRADABLE_FLOOR = 8` | Kelly cap floor; prevents f\*=0.01 × maxLev=20 → lev=1 = untradable |  P25 |
| 1364 | `0.5` | `dominance > 0.5` | Pillar 1 zombie check: single dimension >50% mass = collapsed basin |
| 1364 | `0.4` | `entropy < 0.4` | Pillar 1 zombie check: entropy below 40% = near-zero diversity |
| 1406 | `5` | `recentFHealths.length < 5` | Minimum history before catastrophic check fires — prevents spurious early trigger |

### 1.5 OPERATIONAL — remediation required (§ Section 4)

| Line | Name / value | Proposed registry key | Default | Bounds |
|---|---|---|---|---|
| 159 | `tpPct: 0.03` (scalp) | `MONKEY_LANE_SCALP_TP_PCT` | `0.03` | `[0.005, 0.20]` |
| 160 | `tpPct: 0.15` (swing) | `MONKEY_LANE_SWING_TP_PCT` | `0.15` | `[0.05, 0.50]` |
| 161 | `tpPct: 0.40` (trend) | `MONKEY_LANE_TREND_TP_PCT` | `0.40` | `[0.15, 1.00]` |
| 577 | `DCA_BETTER_PRICE_FRAC = 0.01` | `MONKEY_DCA_BETTER_PRICE_FRAC` | `0.01` | `[0.002, 0.05]` |
| 578 | `DCA_MIN_SOVEREIGNTY = 0.1` | `MONKEY_DCA_MIN_SOVEREIGNTY` | `0.10` | `[0.0, 0.5]` |
| 740 | `peakGivebackMinPct = 0.01` | `MONKEY_HARVEST_PEAK_MIN_PCT` | `0.01` | `[0.001, 0.05]` |
| 741 | `peakGivebackThreshold = 0.30` | → derived from serotonin (already done — see giveback line 794) | n/a | — |
| 1075 | `60 * 60` (60 min slow-bleed) | already removed by Path A doctrine; absBleedUsd=0 drives gate | n/a | — |

> Line 741 `peakGivebackThreshold = 0.30` is a **function parameter default**, already overridden by the computed `giveback = 0.30 + 0.20 * serotonin` at line 794. The function-signature default is vestigial; the live path uses the derived value. No new registry key needed; the signature default can be annotated.

### 1.6 HEURISTIC HARDCODE — remediation required (§ Section 3)

| Line | Literal | Expression | Issue |
|---|---|---|---|
| 87 | `0.7` | `regimeWeights.equilibrium * 0.7` | Equilibrium down-scale. Arbitrary — no observer derivation. |
| 88 | `1.5` | `regimeWeights.quantum * 1.5` | Quantum up-scale. Arbitrary — comment says "explore mode" but not derived. |
| 96 | `0.3` | `trendMult = 1 - 0.3 * alignment` | Tape-alignment discount rate. Arbitrary ±30% swing. |
| 252 | `0.75`, `0.5` | `stabilityMult = 0.75 + serotonin * 0.5` | STRUCTURAL range [0.75, 1.25]; doc says "design choice of mapping." Partially justified but the 0.75 base is arbitrary. |
| 467 | `20` | `Math.exp(-kappaDist / 20)` | κ bell-curve decay scale. Annotated as frozen-physics adjacent but the `20` literal is not explicitly frozen. See EXEC-1. |
| 502 | `10` | `FLATNESS_K = 10` | Flatness band width. Arbitrary (alternatives K=3/5 listed in comments). |
| 503 | `0.8` | `FLATNESS_BOOST = 0.8` | Max leverage boost at flat market. Arbitrary per-commit config. |
| 515 | `0.1` | `s.sovereignty < 0.1` — newborn test | Arbitrary newborn cutoff threshold. |
| 517 | `0.8` | `sovereignCap * 0.8` — newborn leverage | Arbitrary 80% of cap for newborn path. |
| 786 | `0.002`, `0.004` | `activation = max(0.002, 0.004 - 0.002 * dopamine)` | Harvest activation floor and ceiling. All three constants are arbitrary. |
| 794 | `0.30`, `0.20` | `giveback = 0.30 + 0.20 * serotonin` | Giveback base and serotonin gain. The range [0.30, 0.50] was tuned empirically. |
| 852 | `-0.25` | `TREND_FLIP_THRESHOLD = -0.25` | Tape-flip threshold. Arbitrary. |
| 1118, 1203 | `-0.2` | `alignment > -0.2` (slow-bleed + aggregate-bleed) | Adverse tape threshold. Appears 3× independently. Same value suggests shared constant. |
| 1309 | `0.003`, `0.005` | `tpBaseFrac - 0.003 * dopamine + 0.005 * phi` | TP adjustment gains per dopamine unit and per Φ unit. Arbitrary scaling constants. |
| 1378 | `0.55` | `threshold = 0.55 * (1 + 0.5 * NE)` | Fisher-Rao exit angle threshold. 0.55 rad ≈ 31° chosen for "meaningful non-overlap" but not observer-derived. |
| 1413 | `0.3`, `-0.1` | `mean < 0.3 && trend < -0.1` (shouldAutoFlatten) | Catastrophic health floor and trend slope. Arbitrary. |
| 1470 | `0.8` | `observeScore = basinVelocity * 0.8` | Observe-lane max score cap. Arbitrary. |
| 1471 | `0.3` | `swingScore = 0.3` | Fixed swing-lane base score. Arbitrary constant in simplex projection. |

---

## Section 2: loop.ts findings

### 2.1 SENTINEL (safe, no action)

| Line | Literal | Context |
|---|---|---|
| 440 | `2` | `STABILITY_TICKS_MIN_EVIDENCE = 2` — "1 = noise; ≥ 2 = signal" from CALIB-1 doctrine |
| 490–493 | `2` | `laneMultiplierFromTickPeriod` floor — minimum streak gate, sentinel from CALIB-1 |
| 507 | `2` | `CONVICTION_STREAK_FLOOR = 2` — same CALIB-1 sentinel |
| 523 | `1` | `Math.max(1, hesitationHistory.length - 1)` — division guard |
| 509 | `12` | `CONVICTION_STREAK_CAP = 12` — structural maximum conviction streak (observer-derived cap, not a tuning knob; higher caps don't exist in practice at the observed 20-tick window) |
| various | `0` | Array indices, loop bounds throughout |

### 2.2 OUTPUT-TYPE SEMANTIC (safe, no action)

| Line | Literal | Context |
|---|---|---|
| 3176 | `1/3` | `{ quantum: 1/3, efficient: 1/3, equilibrium: 1/3 }` — uniform prior when regime total = 0 (cold start) |
| 2324, 2335 | `1e-6` | Near-zero floor / zero-clamp for hindsight chemistry cache |
| 3166 | `0.5` | `(couplingHealth - 0.5)` — centering coupling health around its neutral midpoint |
| 2317 | `0.5` | `Math.pow(0.5, ...)` — half-life decay formula; 0.5 is the definition of "half" |
| 11149 | `2 / (...  + 1)` | EMA alpha formula (standard EMA, not heuristic) |

### 2.3 FROZEN PHYSICS (safe, no action)

| Line | Literal | Context |
|---|---|---|
| 94 | `KAPPA_STAR` | Imported from `basin.ts` — governed frozen physics reference |
| 2215 | `KAPPA_STAR` | `kappa: KAPPA_STAR` — initial kappa seed |
| 3167 | `KAPPA_STAR` | `state.kappa * 0.8 + (KAPPA_STAR + kappaDelta) * 0.2` — kappa EMA target |
| 398 | `20 * 60_000` | `REWARD_HALF_LIFE_MS = 20 min` — reward decay half-life; 20 min is the canonical "short-term memory window" from QIG doctrine |

> **Note on line 3167**: the `0.8` / `0.2` EMA smoothing and the kappa dynamics coefficients `5` / `10` (line 3166) are classified HEURISTIC HARDCODE (§ 2.6 below) while `KAPPA_STAR` itself is FROZEN PHYSICS.

### 2.4 SAFETY_BOUND (safe — P25 compliant)

| Line | Literal | Context | P25 justification |
|---|---|---|---|
| 319 | `0.15` | `ENTRY_MODIFIER_SAFETY_CAP = 0.15` | Labeled P25: max entry-threshold shift from any single signal |
| 328 | `0.10` | `ARBL_POSITION_SAFETY_CAP = 0.10` | Labeled P25: ARBL exposure ceiling; structural not operational |
| 2768 | `500` | `equityHistory.length > 500` | Labeled P25: ~30+ hours at 30s cadence — catastrophic-memory-growth guard |
| 3167 | `20`, `120` | `Math.max(20, Math.min(120, kappa))` | κ operational bounds; 20 = minimum coupling, 120 = 2×κ\* |
| 5405 | `480` | `basinHistory.length >= 480` | L-veto minimum basis: 480 ticks × 30s = 4h minimum history before veto fires |

### 2.5 OPERATIONAL — remediation required (§ Section 4)

| Line | Name / value | Proposed registry key | Default | Bounds |
|---|---|---|---|---|
| 359 | `OHLCV_LOOKBACK = 200` | `MONKEY_OHLCV_LOOKBACK` | `200` | `[50, 500]` |
| 362 | `HISTORY_MAX = 100` | `MONKEY_STATE_HISTORY_MAX` | `100` | `[20, 500]` |
| 401 | `REWARD_QUEUE_MAX = 50` | `MONKEY_REWARD_QUEUE_MAX` | `50` | `[10, 200]` |
| 402 | `REWARD_RPE_SIGMA_CACHE_TTL_MS = 60_000` | `MONKEY_RPE_CACHE_TTL_MS` | `60000` | `[5000, 300000]` |
| 508 | `CONVICTION_HESITATION_WINDOW = 20` | `MONKEY_CONVICTION_HESITATION_WINDOW` | `20` | `[5, 50]` |
| 1468 | `EFFECTIVE_COST_MAX_HISTORY = 100` | `MONKEY_EFFECTIVE_COST_HISTORY_MAX` | `100` | `[20, 500]` |
| 2316 | `HINDSIGHT_HALF_LIFE_MS = 20 * 60 * 1000` | `MONKEY_HINDSIGHT_HALF_LIFE_MS` | `1200000` | `[60000, 7200000]` |
| 11101 | `200` | `MONKEY_PNL_FRAC_HISTORY_MAX` | `200` | `[50, 1000]` |
| 11149 | `200` (EMA cap) | use same `MONKEY_PNL_FRAC_HISTORY_MAX` | shared | — |
| 10493 | `RETRY_DELAY_MS = 200` | `MONKEY_ORDER_RETRY_DELAY_MS` | `200` | `[50, 2000]` |

### 2.6 HEURISTIC HARDCODE — remediation required (§ Section 3)

| Line | Literal | Expression | Issue |
|---|---|---|---|
| 3166 | `5`, `10` | `kappaDelta = (couplingHealth - 0.5) * 5 - (bv - 0.2) * 10` | Gain constants on coupling-health deviation and basin velocity. Arbitrary scaling. |
| 3167 | `0.8`, `0.2` | `kappa * 0.8 + (KAPPA_STAR + kappaDelta) * 0.2` | EMA smoothing factor for kappa update. Arbitrary α=0.2. |
| 557 | `0.6` | `L_VETO_DEFAULT_CONVICTION_THRESHOLD = 0.6` | L-over-K veto conviction threshold. Arbitrary. Could be observer-derived from L's historical conviction distribution. |
| 5405 | `480` | `basinHistory.length >= 480` | Minimum basin history for L-veto. Documented as "4h at 30s" but that is an OPERATIONAL parameter (tick-count depends on tick cadence). See SAFETY_BOUND note above — reclassify if cadence changes. |
| 3176 | `1/3` | Equal-weight fallback for regime cold-start | Classified OUTPUT-TYPE SEMANTIC above but note: if regime prior is ever non-uniform by design, this needs updating. Flag for future review. |
| 11494 | `256` | `witnessExitDedup.size > 256` | Dedup set cap. Arbitrary. Should match `MONKEY_REWARD_QUEUE_MAX` or have its own registry entry. |

---

## Section 3: HEURISTIC HARDCODE — remediation plan

### EXEC-1: executive.ts heuristic literal cluster

**Filed as GitHub issue** (EXEC-1 — see §5 below).

#### EXEC-1a: Regime weight scales (lines 87–88)

```typescript
// Current (HEURISTIC):
s.regimeWeights.efficient * 1.0 +
s.regimeWeights.equilibrium * 0.7 +
s.regimeWeights.quantum * 1.5
```

**Proposed path**: Make the three regime scale factors (`w_efficient`, `w_equilibrium`, `w_quantum`) parameters in `monkey_parameters` table under category `OPERATIONAL`, key names `MONKEY_REGIME_SCALE_EFFICIENT` / `EQUILIBRIUM` / `QUANTUM`. Defaults `1.0`, `0.7`, `1.5`. Bounds `[0.1, 3.0]`. Long-term: observe per-regime win-rate and derive scale from observed EV ratio.

#### EXEC-1b: Trend alignment discount (line 96)

```typescript
const trendMult = 1 - 0.3 * alignment;
```

**Proposed path**: `MONKEY_TREND_ALIGNMENT_DISCOUNT` in registry (default `0.3`, bounds `[0.0, 0.8]`). Long-term: derive from observed edge difference between aligned vs counter-trend entries.

#### EXEC-1c: Stability multiplier base (line 252)

```typescript
const stabilityMult = 0.75 + nc.serotonin * 0.5;
```

The base `0.75` and gain `0.5` encode the range [0.75, 1.25] as a serotonin modulation band. **Proposed path**: `MONKEY_STABILITY_MULT_BASE` (default `0.75`, bounds `[0.5, 1.0]`) and `MONKEY_STABILITY_MULT_GAIN` (default `0.5`, bounds `[0.1, 1.0]`). These are currently well-documented structural constants; the HEURISTIC flag is mild.

#### EXEC-1d: Flatness leverage boost (lines 502–503)

```typescript
const FLATNESS_K = 10;      // narrow "flat" band
const FLATNESS_BOOST = 0.8; // up to +80% leverage at dead-flat
```

**Proposed path**: `MONKEY_FLATNESS_K` (default `10`, bounds `[1, 20]`) and `MONKEY_FLATNESS_BOOST` (default `0.8`, bounds `[0.0, 2.0]`). The operator's choice of `K=10, BOOST=0.8` ("aggressive") is explicitly cited in comments and is purely OPERATIONAL.

#### EXEC-1e: Harvest activation and giveback (lines 786, 794)

```typescript
const activation = Math.max(0.002, 0.004 - 0.002 * nc.dopamine);
const giveback = 0.30 + 0.20 * nc.serotonin;
```

**Proposed path (observer-derivation)**: `activation` bounds (`0.002`, `0.004`) should be derived from `computeObserverLossFloorRoi` — use the same floor the harvest gate already checks. The literal `0.002` minimum can become `max(NOISE_FLOOR_ROI / maxLev, 0.002)`. For `giveback`, the `0.30` base and `0.20` gain are candidates for registry: `MONKEY_GIVEBACK_BASE` (default `0.30`) and `MONKEY_GIVEBACK_SEROTONIN_GAIN` (default `0.20`).

#### EXEC-1f: Trend-flip and tape-adverse thresholds (lines 852, 1118, 1203)

```typescript
const TREND_FLIP_THRESHOLD = -0.25;
// ... alignment > -0.2 (slow_bleed, aggregate_bleed)
```

`-0.2` appears **three times independently** (should be a named constant). `-0.25` is a separate threshold. **Proposed path**: 
- Promote `-0.2` to `export const TAPE_ADVERSE_THRESHOLD = -0.2` in executive.ts (dedup).
- Both thresholds should then migrate to registry: `MONKEY_TAPE_ADVERSE_THRESHOLD` (default `-0.20`) and `MONKEY_TREND_FLIP_THRESHOLD` (default `-0.25`). Bounds `[-1.0, 0.0]`.

#### EXEC-1g: Scalp TP adjustment gains (line 1309)

```typescript
profile.tpBaseFrac - 0.003 * nc.dopamine + 0.005 * s.phi
```

**Proposed path**: `MONKEY_TP_DOPAMINE_GAIN` (default `0.003`) and `MONKEY_TP_PHI_GAIN` (default `0.005`). Bounds `[0.0, 0.02]`.

#### EXEC-1h: Fisher-Rao exit threshold (line 1378)

```typescript
const threshold = 0.55 * (1 + 0.5 * s.neurochemistry.norepinephrine);
```

`0.55` is described as the angle (~31°) at which basins lose meaningful overlap. This has a geometric motivation (cos(0.55) ≈ 0.85) but is not formally derived. **Proposed path**: observer-derive from the rolling distribution of `fisherRao(perception, forecast)` at trade close — use the 75th percentile of disagreement when trades close profitably as the "appropriate threshold". Until then, registry param `MONKEY_EXIT_DISAGREEMENT_THRESHOLD` (default `0.55`, bounds `[0.1, 2.0]`).

#### EXEC-1i: shouldAutoFlatten thresholds (line 1413)

```typescript
const catastrophic = mean < 0.3 && trend < -0.1;
```

**Proposed path**: `MONKEY_AUTO_FLATTEN_FHEALTH_FLOOR` (default `0.3`) and `MONKEY_AUTO_FLATTEN_TREND_FLOOR` (default `-0.1`). These are effectively P25 safety-ish bounds (P25 overlap) so migration should be cautious — document before moving.

#### EXEC-1j: Lane-selection scores (lines 1470–1471)

```typescript
const observeScore = Math.min(s.basinVelocity, 1) * 0.8;
const swingScore = 0.3;
```

`swingScore = 0.3` is a fixed baseline score for the swing lane in the simplex projection — it exists to prevent swing from scoring zero when basin-velocity and tape are both quiet. `0.8` caps observe at 80% of max velocity score. **Proposed path (architectural)**: These should be observer-derived from per-lane utilization rates — swing's base score should be proportional to its historical contribution to positive P&L. Requires a new `per_lane_score_observer.ts` module. File separate architectural issue (EXEC-2).

### LOOP-1: loop.ts heuristic literal cluster

**Filed as GitHub issue** (LOOP-1 — see §5 below).

#### LOOP-1a: Kappa EMA dynamics (line 3166–3167)

```typescript
const kappaDelta = (couplingHealth - 0.5) * 5 - (bv - 0.2) * 10;
state.kappa = Math.max(20, Math.min(120, state.kappa * 0.8 + (KAPPA_STAR + kappaDelta) * 0.2));
```

Three heuristic constants:
- `5`: gain on coupling-health deviation from 0.5
- `10`: gain on basin velocity above 0.2
- `0.8 / 0.2`: EMA smoothing factor (α = 0.2 = 1/5 tick memory)

**Proposed path**: The EMA α should be observer-derived from tick period: `alpha = tickMs / (halfLifeMs + tickMs)` using `REWARD_HALF_LIFE_MS` or a dedicated kappa half-life. The gain constants `5` and `10` should be `MONKEY_KAPPA_COUPLING_GAIN` (default `5`, bounds `[1, 20]`) and `MONKEY_KAPPA_VELOCITY_GAIN` (default `10`, bounds `[1, 30]`).

#### LOOP-1b: L-veto conviction threshold (line 557)

```typescript
export const L_VETO_DEFAULT_CONVICTION_THRESHOLD = 0.6;
```

**Proposed path**: Already env-backed (`L_VETO_CONVICTION_THRESHOLD`). Migrate to monkey_parameters registry: `MONKEY_L_VETO_CONVICTION_THRESHOLD` (default `0.6`, bounds `[0.0, 1.0]`). Long-term: derive from observed L-veto outcomes — P(L correct | vetoed) should exceed P(K correct | K entry) as the threshold's empirical validation.

#### LOOP-1c: Witness exit dedup size (line 11494)

```typescript
if (this.witnessExitDedup.size > 256) {
```

**Proposed path**: Tie to `MONKEY_REWARD_QUEUE_MAX * 4` or introduce `MONKEY_WITNESS_EXIT_DEDUP_MAX` registry entry (default `256`, bounds `[64, 1024]`).

---

## Section 4: OPERATIONAL — registry migration plan

All items below should be added to the `monkey_parameters` table with `category = 'OPERATIONAL'`. Migration SQL template:

```sql
INSERT INTO monkey_parameters (key, value, category, description, min_value, max_value)
VALUES
  ('MONKEY_OHLCV_LOOKBACK', '200', 'OPERATIONAL',
   'OHLCV lookback window for candle-based signals. ml-worker shares this constant.',
   50, 500),
  ('MONKEY_STATE_HISTORY_MAX', '100', 'OPERATIONAL',
   'Max loop-state history entries for f_health trend (HISTORY_MAX). FIFO eviction.',
   20, 500),
  ('MONKEY_REWARD_QUEUE_MAX', '50', 'OPERATIONAL',
   'Max ActivityReward entries retained; FIFO eviction.',
   10, 200),
  ('MONKEY_RPE_CACHE_TTL_MS', '60000', 'OPERATIONAL',
   'TTL for prediction-error RPE sigma cache.',
   5000, 300000),
  ('MONKEY_CONVICTION_HESITATION_WINDOW', '20', 'OPERATIONAL',
   'Tick window for hesitation sign-flip rate in observerConvictionStreakRequired.',
   5, 50),
  ('MONKEY_HINDSIGHT_HALF_LIFE_MS', '1200000', 'OPERATIONAL',
   'Hindsight cache exponential decay half-life (20 min default).',
   60000, 7200000),
  ('MONKEY_PNL_FRAC_HISTORY_MAX', '200', 'OPERATIONAL',
   'Max pnlFracHistory entries per symbol state; also caps EMA window.',
   50, 1000),
  ('MONKEY_LANE_SCALP_TP_PCT', '0.03', 'OPERATIONAL',
   'Scalp lane take-profit as fraction of margin ROI.',
   0.005, 0.20),
  ('MONKEY_LANE_SWING_TP_PCT', '0.15', 'OPERATIONAL',
   'Swing lane take-profit as fraction of margin ROI.',
   0.05, 0.50),
  ('MONKEY_LANE_TREND_TP_PCT', '0.40', 'OPERATIONAL',
   'Trend lane take-profit as fraction of margin ROI.',
   0.15, 1.00),
  ('MONKEY_DCA_BETTER_PRICE_FRAC', '0.01', 'OPERATIONAL',
   'Minimum price improvement fraction required for a DCA add.',
   0.002, 0.05),
  ('MONKEY_DCA_MIN_SOVEREIGNTY', '0.10', 'OPERATIONAL',
   'Minimum sovereignty before DCA adds are permitted.',
   0.0, 0.5),
  ('MONKEY_HARVEST_PEAK_MIN_PCT', '0.01', 'OPERATIONAL',
   'Minimum peak ROI fraction before trailing harvest activates.',
   0.001, 0.05);
```

> The lane TP percentages (`LANE_PARAMETER_DEFAULTS`) are the highest-priority entries — they directly govern trade profitability and operators have expressed the need to tune them without a code deployment.

---

## Section 5: Sub-issues filed

### EXEC-1: Observer-derive or registry-manage executive heuristic literals

**Title**: `EXEC-1: observer-derive or registry-manage executive.ts heuristic literals`  
**Labels**: `p1-purity`, `monkey-kernel`  
**Scope**: All items in § 3 EXEC-1a through EXEC-1j.  
**Priority**: HIGH — regime-weight scales (1a), giveback formula (1e), tape-adverse threshold dedup (1f) directly affect live trade decisions every tick.

### LOOP-1: Kappa dynamics + loop orchestration heuristic literals

**Title**: `LOOP-1: observer-derive loop.ts kappa EMA + orchestration heuristic literals`  
**Labels**: `p1-purity`, `monkey-kernel`  
**Scope**: All items in § 3 LOOP-1a through LOOP-1c.  
**Priority**: MEDIUM — kappa dynamics heuristics (1a) have large leverage impact; L-veto threshold (1b) is already env-backed.

### EXEC-2 (architectural): Observer-derived lane-selection scores

**Title**: `EXEC-2 (architectural): replace fixed lane scores with per-lane utilization observer`  
**Labels**: `p1-purity`, `monkey-kernel`, `architectural`  
**Scope**: `swingScore = 0.3` and `observeScore * 0.8` in `chooseLane`. Requires `per_lane_score_observer.ts`.  
**Priority**: LOW — simplex projection is already QIG-pure; fixed baseline doesn't violate P5 as severely as the regime-weight scale factors.

### OPER-1: Registry migration for OPERATIONAL literals

**Title**: `OPER-1: migrate OPERATIONAL literals to monkey_parameters registry`  
**Labels**: `p14-governance`, `monkey-kernel`  
**Scope**: All items in § 4 (both files). The lane TP percentages are highest priority.  
**Priority**: HIGH for lane TPs; MEDIUM for window sizes.

---

## Appendix: Already-clean patterns (no action)

The following patterns were investigated and confirmed **clean**:

1. **`1/(0.5 + phi)` denominator** — structural shift to prevent division-by-zero while centering phiMultiplier geometrically; NOT a threshold.
2. **`Math.max(0, Math.min(1, ...))` clip01 patterns** — probability simplex normalisation; SENTINEL.
3. **`(rate - 0.5)` centering** in SENSE-2c — mathematical neutral-point centering, not a threshold.
4. **`0.5` survival cap** on position fraction — explicitly P25-compliant per inline audit trail (#916, 2026-05-25 doc).
5. **`KAPPA_STAR` references** — all use the imported symbol from `basin.ts`, never an inline `64` literal.
6. **`1e-12` in Kelly formulas** — numerical log-floor guard, OUTPUT-TYPE SEMANTIC.
7. **Bracket exit `exitTypeBit` values** (11, 12, 9, 10, etc.) — enum-style integers for telemetry; SENTINEL.
8. **`NOISE_FLOOR_ROI = 0.01`** — explicitly derived from the Fibonacci reward tier-0 boundary (#950 doctrine); FROZEN PHYSICS / OUTPUT-TYPE SEMANTIC.
9. **`Math.tanh`, `Math.exp` in kappa-proximity formulas** — QIG-pure decay functions; the specific shape is documented as proximity geometry, not a tunable threshold.
10. **`DCA_MAX_ADDS_PER_POSITION = 1`** — structural hard cap, P25 intent clear from comment.
