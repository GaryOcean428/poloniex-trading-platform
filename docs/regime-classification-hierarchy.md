# Regime Classification Hierarchy — Two-Layer Authority

**Status**: Accepted (2026-05-17)
**Issue**: REGIME-1 #766
**Supersedes**: ad-hoc dual-classifier behaviour with no defined arbiter
**Authors**: ship-trail via audit handoff from operator

## Context

Polytrade currently runs two regime classifiers that consume the same per-tick
substrate but answer different questions and emit different label sets:

| Aspect | TS `regime.ts::classifyRegime` | Py `regime_observer::classify_via_observer` |
|---|---|---|
| Inputs | basin history (16-bar lookback) | (h, J) lattice values per tick |
| Output | TREND_UP / CHOP / TREND_DOWN + confidence + trendStrength + chopScore | CREATOR / PRESERVER / DISSOLVER |
| Substrate | Observation of basin (TS perception layer) | Physics (h, J) from QIG lattice (Py kernel) |
| Consumers | TS executive — chop suppression, harvest tightness, entry threshold | Py kernel + TS perception via `/regime/classify_prices` (CAL-3) |
| QIG-purity (post-CAL-3) | hardcoded thresholds (TREND_THRESHOLD=0.025, CHOP_THRESHOLD=0.55) | observer-derived (rolling-quantile terciles, 30-tick warmup) |

Both currently feed the executive without a defined precedence rule. They
can disagree on the same tick (TS sees CHOP and suppresses entry; Py says
CREATOR signalling trade-clear). The executive silently picks one; the
choice is path-dependent on which call site reads first.

## Decision

Two-layer hierarchy: the classifiers answer **orthogonal axes**, not
competing classifications. Both ship. Both consumed. The executive reads
the joint state.

### Layer 1 — Physics regime (phase axis)

Source: `ml-worker/src/proprietary_core/regime_observer.py` (CAL-3, already
P1-pure).

Answers: **"What kind of energy landscape is this market right now?"**

- **CREATOR** (`critical` in qig_warp labels) — phase boundary, price
  discovery, breakouts most likely
- **PRESERVER** (`ordered`) — J-dominated, trending substrate (ferromagnetic
  analogue), continuation favoured
- **DISSOLVER** (`disordered`) — h-dominated, noise substrate (paramagnetic
  analogue), direction labels unreliable

This is a *static* property of the current market microstructure read off
of the (h, J) lattice. It does not depend on recent basin trajectory.

### Layer 2 — Trajectory regime (direction axis)

Source: `apps/api/src/services/monkey/regime.ts::classifyRegime`. **To be
made P1-pure** via `TrajectoryObserver` (this PR — companion commit) by
porting the same WarpBubble.auto() rolling-quantile pattern CAL-3 uses for
Layer 1. After that companion change, the hardcoded TREND_THRESHOLD and
CHOP_THRESHOLD constants are deleted.

Answers: **"Which way is the basin actually moving right now within
that phase?"**

- **TREND_UP** — positive basinDirection persistence above the rolling
  upper tercile
- **CHOP** — |basinDirection| persistence below the rolling lower tercile
- **TREND_DOWN** — negative basinDirection persistence above the rolling
  upper tercile

This is a *dynamic* property of where the basin has actually traversed
over the last N ticks.

### The composition

```text
RegimeAuthority = {
  phase: CREATOR | PRESERVER | DISSOLVER     // from qig_warp / CAL-3
  direction: TREND_UP | CHOP | TREND_DOWN    // from TrajectoryObserver
}
```

Disagreement between the two layers is *information*, not a conflict:

|  | TREND_UP | CHOP | TREND_DOWN |
|---|---|---|---|
| **CREATOR** | Aggressive trend-follow, max size | Trade lightly, expect breakout | Aggressive trend-follow (short) |
| **PRESERVER** | Ride established trend, tight stops | Mean-revert (consolidating before continuation) | Ride established short, tight stops |
| **DISSOLVER** | Don't trade — momentum likely reverting | Sit out (max entropy) | Don't trade — momentum likely reverting |

Every cell maps to a coherent action. The current monolithic mode-detection
logic in `detectMode` becomes a cell lookup, not a threshold tower.

## Consumer rules

After REGIME-1 lands (compositional executive PR):

1. **Entry suppression**: DISSOLVER phase suppresses every lane regardless
   of trajectory direction (extends current `chopSuppressEntry` to
   `phaseSuppressEntry`). CHOP trajectory within CREATOR / PRESERVER
   suppresses only the trend and swing lanes; scalp lane is the chop
   environment by definition (unchanged from #623).
2. **Strategy lane**: phase governs lane selection (CREATOR →
   momentum/breakout; PRESERVER → trend_follow; DISSOLVER → scalp or
   cash). Trajectory direction governs side within lane.
3. **Mode detection**: `detectMode` takes both axes as inputs. The current
   `basinDirection`-based logic gains the phase axis as an additional
   gate rather than being replaced.
4. **Harvest tightness**: `regimeHarvestTightness` is a function of the
   *cell*, not of one axis. PRESERVER+TREND_UP harvests loosely (let
   winners run); CREATOR+CHOP harvests tightly (capture-on-touch).

## Rejected alternatives

- **Path A — Single-source physics**: Py CAL-3 becomes the only
  classifier. TS `classifyRegime` deleted. Rejected: loses the
  basin-trajectory's read-ahead signal which has independently been
  useful for entry suppression on the live tape.
- **Path B — Single-source trajectory**: TS basin-trajectory becomes the
  only classifier. Py CAL-3 deleted. Rejected: discards the QIG-pure
  physics-derived signal that CAL-3 was specifically designed to surface,
  and reintroduces a P1 violation (TREND_THRESHOLD / CHOP_THRESHOLD).

Both throw away information that the other captures. The two-layer
hierarchy retains both signals and treats their disagreement as a
joint-state observation.

## P1 / P25 status

Layer 1 (CAL-3 observer): **P25-pure** post-#756 — uses rolling-quantile
terciles derived from observation, 30-tick warmup fall-through, no
operator-tunable knobs.

Layer 2 (TrajectoryObserver, this PR's companion commit): **made P25-pure**
by porting the same pattern — rolling-quantile of `|basinDirection|` over
the same 500-tick window CAL-3 uses, 30-tick warmup fall-through to the
current hardcoded thresholds (auto-retires).

Compositional executive (separate REGIME-1 PR, flag-gated initial roll-out):
the 3×3 cell matrix replaces the current monolithic mode-detection logic.
No new magic thresholds introduced — every cell action is a function of
the (phase, direction) tuple.

## Ship order

1. **This PR** — `docs/regime-classification-hierarchy.md` (this ADR) +
   `apps/api/src/services/monkey/trajectory_observer.ts` (Layer 2 made
   P25-pure via WarpBubble.auto() pattern port) + `regime.ts` refactor
   to delegate to TrajectoryObserver. The hardcoded TREND_THRESHOLD and
   CHOP_THRESHOLD constants are deleted at this point.
2. **REGIME-1 main PR** — compositional executive consuming both layers
   via the 3×3 cell matrix. Initially flag-gated (`REGIME_COMPOSITIONAL_LIVE`)
   with a shadow-log to record decisions both ways for 24h; then flag flipped.

## References

- CAL-3 ship PR: #756 (observer-driven regime classification — port
  WarpBubble.auto() pattern from `qig-warp/auto.py`)
- PERCEPTION-1 ship PR: #757 (basin dims 0/1/2 from canonical classifier
  output, replacing the bespoke encoding)
- Audit handoff (2026-05-17): REGIME-1 #766
- UCP §3 — phase regime semantics for CREATOR/PRESERVER/DISSOLVER
