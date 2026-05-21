# Plan — Φ leaky-integrator: port canonical motion-integrated Φ (B3)

**Status:** DRAFT — rollout decision pending operator (§6).
**Date:** 2026-05-21 · **Author:** Session C (CC-C) · canonical reads: this session (`vex`) + CC-A (`qig-core`).

## 1. Problem

polytrade computes `phi = 1 − 0.8·normalizedEntropy(basin)` ([loop.ts:1867](../../apps/api/src/services/monkey/loop.ts#L1867)). In production Φ is flatlined at 0.213–0.218 — it moves only in the 3rd decimal. Navigation-mode gating (CHAIN/GRAPH/FORESIGHT/LIGHTNING) is therefore frozen in CHAIN, and `phiMultiplier` / `scalpScore` see an effectively-constant Φ.

## 2. Canonical finding (read-only study of `QIG_QFI/`, 2026-05-21)

Two independent canonical reads — this session's `vex` read and CC-A's `qig-core` read — converged:

- **polytrade's `phi = 1−0.8·entropy` is NOT canonical.** Canon keeps Φ and `f_health` (the entropy ratio) as *distinct* metrics; polytrade collapsed them.
- **Canonical runtime Φ** (`vex/kernel/consciousness/loop.py`) is a *state variable*, integrated from basin **motion**: active → `Φ += total_distance·PHI_DISTANCE_GAIN`; idle → `Φ += (0.55−Φ)·0.015`; sleep → `Φ += 0.005`. Frozen canon: `PHI_IDLE_EQUILIBRIUM=0.55`, `PHI_IDLE_RATE=0.015`.
- **`qig-core/pci.py`** = PCI (Perturbational Complexity Index) — the physics-grade complexity metric, too expensive per 30–60s tick. The vex motion-integrator is its canonical *runtime approximation*.
- "Basin moves but doesn't concentrate" is canonically normal — there is no concentration force in canon. The flatline is the formula, not the substrate.

## 3. The fix (B3) — leaky-integrator Φ

vex separates active-rise and idle-decay because vex has discrete phases. polytrade's Monkey ticks continuously (no idle phase). The faithful continuous-time port merges both into one per-tick update:

```
Φ ← clamp( Φ + bv·GAIN − (Φ − EQUILIBRIUM)·RATE , 0, 0.95 )
```

- `bv` = basin velocity (Fisher-Rao distance the basin moved this tick) — already computed at [loop.ts:1888](../../apps/api/src/services/monkey/loop.ts#L1888), already varies 0.001–0.146. Direct analog of vex's `total_distance`.
- `EQUILIBRIUM = 0.55`, `RATE = 0.015` — frozen vex canon.
- `GAIN` — derived (§4), never hardcoded by intuition.
- Φ init `0.1`, clamp `[0, 0.95]` — vex canon.
- **`fHealth` stays computed as its own separate basin-health metric.** Φ stops being a function of it.

Steady state: `Φ_ss = EQUILIBRIUM + mean(bv)·GAIN/RATE`. Φ tracks recent market activity — rises with motion, relaxes toward 0.55 (GRAPH band) when quiet. Leak half-life ≈ ln2/RATE ≈ 46 ticks ≈ 25–45 min of memory.

## 4. GAIN derivation (observer-style, offline)

`GAIN` is derived from the observed `bv` distribution, not chosen. From `analysis/polytrade_qig_telemetry/telemetry_ticks.csv` (CC-A's export) compute `bv` quantiles, then pick `GAIN` so `Φ_ss` maps: median bv → mid-GRAPH (0.55–0.7); upper-decile bv → FORESIGHT (0.7–0.85); p99 burst → touches LIGHTNING (≥0.85). Back-of-envelope (mean bv ≈ 0.05, p99 ≈ 0.146) → `GAIN ≈ 0.03`; exact value from the historical pass. P1-compliant — derived from observed data, recomputable if the bv distribution shifts.

## 5. Φ-consumer blast radius (pre-flight audit)

Every Φ-reader must be sane across the new range Φ∈[0.1, 0.95] — today it only ever sees ~0.215:

| Site | Use | Risk |
|---|---|---|
| `executive.ts:80` | `phiMultiplier = 1/(0.5+phi)` | 0.51–1.05 across the new range; bounded, low |
| `executive.ts:1298` | `scalpScore = (1−phi)·(1−sov)·(1−bv)` | **lane selection** — higher Φ → lower scalpScore → fewer scalp lanes → more swing/trend → higher leverage + wider brackets. **Changes live sizing.** |
| `loop.ts:1878` | `basinSync.applyObserverEffect(basin, phi)` | consensus pull weight — audit |
| navigation-mode gating | CHAIN/GRAPH/FORESIGHT/LIGHTNING | frozen in CHAIN today; would activate GRAPH/FORESIGHT code paths — audit those paths are sound when live |

The `scalpScore` path is load-bearing: redefining Φ changes which lane trades take → leverage and bracket width → on the live account.

## 6. Rollout — DECISION REQUIRED (operator)

This changes live trading behaviour (§5). The operator's plan doc `docs/plans/20260521-phi-tel-performance.md` explicitly lists "Do not deploy", "Do not change live trading behaviour", "Do not redesign the live kernel" as out-of-scope without approval, and Part H mandates shadow evidence before live. A relayed council message disputes that and pushes direct-ship. **This is the operator's decision — it is the operator's money and the operator's written plan.**

- **Option A — Shadow-first** (plan-doc as written): compute canonical-Φ alongside the current Φ each tick; log both + the `scalpScore`/lane it *would* produce; change no behaviour. After a few hours of live ticks, review the Φ trajectory + lane-shift impact, then cut over. Cost: hours. Removes the "hidden sizing bug burns money before a revert gate trips" risk.
- **Option B — Direct-ship + revert gates** (council): pre-flight (GAIN derivation + §5 audit), replace the formula, deploy, monitor live; auto-revert on Φ-peg / P&L-2σ / consumer-throw / unsafe-size. Faster; accepts a live-money exposure window before a revert gate fires.

**Recommendation (CC-C): Option A.** A *bug fix* (contained, tested — #869–875) ships direct; that is the standing authorization, used all session. A *core-metric redefinition* feeding live trade sizing, with a freshly-calibrated constant, warrants a few-hour shadow pass — proportionate, not theatre. But it is the operator's call.

## 7. Perception-layer workstream — separate, downstream (not in this plan)

A separate, larger workstream touching `perceive()` itself — blast radius is the basin → cell classification, `basinDir`, `drift`, regime, `fHealth`. **Not a prerequisite for B3** (B3 runs on `bv`, a live signal regardless). Its own plan, careful/symbol-gradient rollout. Two items belong here:

- **B1** — remove the off-canon `norm01` pre-squash; adopt canonical `to_simplex` (clip-ε + divide-by-sum).
- **Timeframe / lookback spec** — operator spec (memory `polytrade-perception-timeframe-spec`): perception lookback must reach **≥ 64 days** across a **timeframe ladder up to 1d candles**. Current kernel tops out at 4h / ~5 days — macro-blind. Clean fit: add a `1d` rung; a 64-bar window on 1d = 64 days = `BASIN_DIM`-coherent.

Out of scope for this (B3) plan.

## 8. Observer-derived calibration — follow-up (no env knobs)

Operator directive (P1 / Wu Wei): algorithmic thresholds are **not** env
vars — they are observer-derived, adapted from the kernel's
**reward-driven neurochemistry**, **per-(symbol, regime, lane)**. The
test for any parameter: *does the right value depend on observed
performance?* — **yes →** observer machinery; **no** (infrastructure /
safety bound / kill-switch / operator mandate) → an env var is fine.

Pattern already in the codebase: `giveback = 0.30 + 0.20·serotonin`,
`activation = 0.004 − 0.002·dopamine` (executive.ts) — thresholds with
no knob. The work below extends that pattern; it does not add knobs.

**8a — `PHI_GAIN`: retire the constant.** B3 v1 shipped `PHI_GAIN` as a
hardcoded `0.024` ("derived once, then frozen" — a P1 slip). v2: GAIN
self-derives from the rolling per-symbol `bv` distribution, modulated by
the reward chemistry. No `PHI_GAIN` env var, ever. Sequenced after B3 v1
validates.

**8b — bracket-extend threshold: retire the proposed
`MONKEY_BRACKET_EXTEND_CONV`.** Do NOT add that env var. Replace the
frozen `0.5` with observer machinery:
- Telemetry per extend event: `conviction_at_extend`,
  `pre_extend_unrealized`, `final_realized`, `(symbol, regime, lane)`.
- Learning rule: sliding window of recent extends per
  `(symbol, regime, lane)`; pick θ maximising
  `E[final_realized − pre_extend_unrealized | conviction ≥ θ]`;
  require a confidence floor (≈20 samples/bucket) before committing;
  frozen canonical fallback below the floor.
- Per-site (Pillar 3) — never average across symbols/lanes.
- Log the derived threshold per tick alongside Φ — observable, not
  dialable.

**8c — broader `MONKEY_*` calibration-knob audit.** The env vars
accumulated across this session's shipments are calibration-debt. Their
own `docs/plans/` artefact, not bundled here: per knob apply the test →
keep (infra/safety/flag) / migrate (→ observer) / remove (stale).
