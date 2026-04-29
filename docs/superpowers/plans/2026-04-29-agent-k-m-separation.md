# Agent K / Agent M Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sever ML-signal influence from the kernel decision path. Run Agent K (geometry-only kernel) and Agent M (ML-only) as independent agents whose capital share is set by an Arbiter from rolling PnL.

**Architecture:** Strip six ML touch points from the Python kernel. Add `kernel_direction()` + `kernel_should_enter()` to the executive that derive direction from basin geometry and entry conviction from the emotion stack. Mirror in TS for parity until v0.8.8 cut-over. Delete `turning_signal.ts`. Add `ml_agent/` (TS) as a thin threshold-based decision module. Add `arbiter/` (TS) with a 50-trade rolling reward window, 10% floors, and exp-soft allocation. Restructure `loop.ts` to run K and M independently against arbiter-allocated capital. New `agent` column on `autonomic_trades`; new `arbiter_allocation` telemetry table. **No flag.** Rollback = `git revert`.

**Tech Stack:** Python 3.11 (ml-worker, FastAPI), TypeScript (apps/api), Postgres migrations (apps/api/database/migrations/), Vitest (TS), pytest (Python), Yarn 4.

---

## Decisions explicitly noted (not asked, but flagged)

1. **Perception: ml dims default to neutral.** `perception.py` encodes ml_signal/ml_strength into basin dims 3, 4, 5 (`v[3]`, `v[4]`, `v[5]`). When `TickInputs` loses those fields, `PerceptionInputs.ml_signal` and `ml_strength` become **optional with neutral defaults** (`'HOLD'`, `0.0` → produces `v[3]=0.01, v[4]=0.01, v[5]=0.5`). BASIN_DIM stays at 64. This is the only sane choice given "no flag, no migration" — alternative is shifting BASIN_DIM which ripples through QIG, persistence histories, and resonance bank. Surfaced explicitly so the geometric implication is visible: dims 3-5 will be ~constant across all ticks rather than ML-modulated. Other geometric quantities (Φ, basin_velocity, drift_from_identity, momentum spectrum dims 7-14) are unaffected.

2. **`coupling_health` replacement.** Currently `coupling_health = inputs.ml_strength` at tick.py:278, feeding `kappa_delta = (coupling_health - 0.5) * 5.0 - (bv - 0.2) * 10.0`. New formula: `coupling_health = phi * (1.0 - min(bv, 1.0))` — high integration + low volatility = strong internal coupling. Stays in [0, 1], preserves the kappa update contract, replaces ML signal quality with kernel state quality.

3. **OVERRIDE_REVERSE deletion.** With `kernel_direction()` deriving from `basin_dir + 0.5*tape_trend`, the OVERRIDE_REVERSE quorum becomes redundant — direction is geometric from the start, not a mutation of ml_side. Delete the quorum entirely (lines 466-487 of tick.py and 614-654 of loop.ts).

4. **REVERSION mode flip.** tick.py:489-495 flips side_candidate when `mode == REVERSION`. This stays — it's not ML-derived, it's a stud-topology mode reading. Adapted to flip `kernel_direction()`'s output instead of `ml_side`.

5. **`/monkey/tick/run` API contract change.** The endpoint stops requiring `ml_signal` / `ml_strength` in the inputs payload. They'll be ignored if sent (back-compat for callers mid-deploy). After deploy, callers update to omit them. No API version bump — this is a single-PR change with `git revert` as rollback.

6. **`liveSignalEngine.ts` is not touched.** It's the parallel engine, not the kernel. Filter it out of the change set.

---

## File Structure

### Files to create
- `apps/api/src/services/ml_agent/decide.ts` — Agent M decision logic
- `apps/api/src/services/ml_agent/types.ts` — `MLAgentInputs`, `MLAgentDecision`
- `apps/api/src/services/ml_agent/__tests__/decide.test.ts`
- `apps/api/src/services/arbiter/arbiter.ts` — capital allocation
- `apps/api/src/services/arbiter/__tests__/arbiter.test.ts`
- `apps/api/database/migrations/039_agent_separation.sql`
- `ml-worker/tests/monkey_kernel/test_kernel_direction.py` — unit tests for new direction logic
- `ml-worker/tests/monkey_kernel/test_kernel_should_enter.py` — unit tests for new entry gate

### Files to modify
- `ml-worker/src/monkey_kernel/tick.py` — remove ML touch points, call new kernel direction/entry
- `ml-worker/src/monkey_kernel/executive.py` — add `kernel_direction()`, `kernel_should_enter()`; gate `should_dca_add()` callers (no signature change — DCA gate stays)
- `ml-worker/src/monkey_kernel/perception.py` — make ml fields optional with neutral defaults
- `ml-worker/main.py` — TickInputs construction stops requiring ml_signal/ml_strength
- `apps/api/src/services/monkey/executive.ts` — TS parity for new kernel direction/entry
- `apps/api/src/services/monkey/loop.ts` — strip turning signal + override; restructure for K + M independent paths
- `apps/api/src/services/monkey/perception.ts` — TS parity for neutral-default ml dims
- `apps/api/src/services/monkey/kernel_client.ts` — drop ml fields from request schema
- 8 Python test files (see Task 11)
- `apps/api/src/services/monkey/__tests__/turning_signal.test.ts` — delete

### Files to delete
- `apps/api/src/services/monkey/turning_signal.ts`
- `apps/api/src/services/monkey/__tests__/turning_signal.test.ts`

---

## Task 1: New Python kernel direction + entry-gate functions (TDD)

**Files:**
- Modify: `ml-worker/src/monkey_kernel/executive.py` (add at top of file alongside other public helpers)
- Test: `ml-worker/tests/monkey_kernel/test_kernel_direction.py` (new)
- Test: `ml-worker/tests/monkey_kernel/test_kernel_should_enter.py` (new)

- [ ] **Step 1.1: Write failing tests for `kernel_direction`**

```python
# ml-worker/tests/monkey_kernel/test_kernel_direction.py
import numpy as np
from monkey_kernel.executive import kernel_direction
from monkey_kernel.emotions import EmotionState


def _emotions(confidence=0.5, anxiety=0.1, **k):
    return EmotionState(
        wonder=k.get("wonder", 0.3),
        frustration=k.get("frustration", 0.1),
        satisfaction=k.get("satisfaction", 0.5),
        confusion=k.get("confusion", 0.1),
        clarity=k.get("clarity", 0.5),
        anxiety=anxiety,
        confidence=confidence,
        boredom=k.get("boredom", 0.1),
        flow=k.get("flow", 0.0),
    )


def test_long_when_basin_and_tape_positive():
    # geometric_signal = 0.4 + 0.5*0.4 = 0.6 > 0 → long
    assert kernel_direction(basin_dir=0.4, tape_trend=0.4, emotions=_emotions()) == "long"


def test_short_when_basin_and_tape_negative():
    assert kernel_direction(basin_dir=-0.4, tape_trend=-0.4, emotions=_emotions()) == "short"


def test_flat_when_signal_neutral():
    # basin_dir cancels tape: 0.2 + 0.5*(-0.4) = 0.0
    assert kernel_direction(basin_dir=0.2, tape_trend=-0.4, emotions=_emotions()) == "flat"


def test_flat_when_anxiety_exceeds_confidence():
    # Even with positive geometric signal, low conviction → flat
    assert kernel_direction(
        basin_dir=0.5, tape_trend=0.5,
        emotions=_emotions(confidence=0.1, anxiety=0.5),
    ) == "flat"


def test_basin_alone_dominates_when_tape_zero():
    assert kernel_direction(basin_dir=0.3, tape_trend=0.0, emotions=_emotions()) == "long"
    assert kernel_direction(basin_dir=-0.3, tape_trend=0.0, emotions=_emotions()) == "short"
```

- [ ] **Step 1.2: Run test, verify failures**

Run: `cd ml-worker && python -m pytest tests/monkey_kernel/test_kernel_direction.py -v`
Expected: ImportError — `kernel_direction` doesn't exist yet.

- [ ] **Step 1.3: Implement `kernel_direction` in `executive.py`**

Add near top of file, after existing imports and before `current_entry_threshold`:

```python
def kernel_direction(
    *,
    basin_dir: float,
    tape_trend: float,
    emotions: EmotionState,
) -> str:
    """Direction from basin geometry + tape consensus, gated by emotional conviction.

    geometric_signal = basin_dir + 0.5 * tape_trend
    Returns 'long' if geometric_signal > 0 and conviction sufficient,
    'short' if geometric_signal < 0 and conviction sufficient,
    'flat' otherwise. Conviction = confidence > anxiety.
    """
    if emotions.confidence < emotions.anxiety:
        return "flat"
    geometric_signal = basin_dir + 0.5 * tape_trend
    if geometric_signal > 0:
        return "long"
    if geometric_signal < 0:
        return "short"
    return "flat"
```

Add `from .emotions import EmotionState` to executive.py imports if not already there.

- [ ] **Step 1.4: Run, verify pass**

Run: `cd ml-worker && python -m pytest tests/monkey_kernel/test_kernel_direction.py -v`
Expected: 5 passed.

- [ ] **Step 1.5: Write failing tests for `kernel_should_enter`**

```python
# ml-worker/tests/monkey_kernel/test_kernel_should_enter.py
from monkey_kernel.executive import kernel_should_enter
from monkey_kernel.emotions import EmotionState


def _e(**k):
    base = dict(wonder=0.3, frustration=0.1, satisfaction=0.5, confusion=0.1,
               clarity=0.5, anxiety=0.1, confidence=0.5, boredom=0.1, flow=0.0)
    base.update(k)
    return EmotionState(**base)


def test_enters_when_conviction_exceeds_hesitation():
    # conviction = 0.5 * (1 + 0.3) = 0.65; hesitation = 0.1 + 0.1 = 0.2
    assert kernel_should_enter(emotions=_e()) is True


def test_refuses_when_anxiety_high():
    # conviction = 0.5 * (1 + 0.3) = 0.65; hesitation = 0.7 + 0.1 = 0.8
    assert kernel_should_enter(emotions=_e(anxiety=0.7)) is False


def test_refuses_when_confusion_high():
    # conviction = 0.5 * 1.3 = 0.65; hesitation = 0.1 + 0.7 = 0.8
    assert kernel_should_enter(emotions=_e(confusion=0.7)) is False


def test_wonder_amplifies_confidence():
    # Without wonder: conviction = 0.4 * 1.0 = 0.4 < hesitation 0.5 (anxiety 0.4 + confusion 0.1)
    # With wonder=1.0: conviction = 0.4 * 2.0 = 0.8 > 0.5
    assert kernel_should_enter(emotions=_e(confidence=0.4, anxiety=0.4, wonder=0.0)) is False
    assert kernel_should_enter(emotions=_e(confidence=0.4, anxiety=0.4, wonder=1.0)) is True
```

- [ ] **Step 1.6: Run, verify failures**

Run: `cd ml-worker && python -m pytest tests/monkey_kernel/test_kernel_should_enter.py -v`
Expected: ImportError.

- [ ] **Step 1.7: Implement `kernel_should_enter`**

Add to executive.py below `kernel_direction`:

```python
def kernel_should_enter(*, emotions: EmotionState) -> bool:
    """Conviction gate. Enter when confidence (amplified by wonder) exceeds
    hesitation (anxiety + confusion). No external strength threshold —
    the emotion stack is the threshold."""
    conviction = emotions.confidence * (1.0 + emotions.wonder)
    hesitation = emotions.anxiety + emotions.confusion
    return conviction > hesitation
```

- [ ] **Step 1.8: Run, verify pass**

Run: `cd ml-worker && python -m pytest tests/monkey_kernel/test_kernel_should_enter.py -v`
Expected: 4 passed.

- [ ] **Step 1.9: Commit**

```bash
git add ml-worker/src/monkey_kernel/executive.py ml-worker/tests/monkey_kernel/test_kernel_direction.py ml-worker/tests/monkey_kernel/test_kernel_should_enter.py
git commit -m "feat(monkey): add kernel_direction + kernel_should_enter — geometry-only direction & emotion-gated entry"
```

---

## Task 2: Strip ML touch points from `tick.py`

**File:** `ml-worker/src/monkey_kernel/tick.py`

The kernel must compute side, entry, and coupling without `ml_signal` or `ml_strength`. Six edits in one file.

- [ ] **Step 2.1: Update `TickInputs` dataclass (lines 141-155)**

Remove the `ml_signal` and `ml_strength` fields:

```python
@dataclass
class TickInputs:
    """Everything one tick needs, modulo prior state."""
    symbol: str
    ohlcv: list[OHLCVCandle]
    account: AccountContext
    bank_size: int
    sovereignty: float
    max_leverage: int
    min_notional: float
    size_fraction: float = 1.0
    self_obs_bias: Optional[dict[str, dict[str, float]]] = None
```

- [ ] **Step 2.2: Update PerceptionInputs construction (lines 261-270)**

Drop ml_signal/ml_strength/ml_effective_strength from the call:

```python
raw_basin = perceive(PerceptionInputs(
    ohlcv=ohlcv,
    equity_fraction=inputs.account.equity_fraction,
    margin_fraction=inputs.account.margin_fraction,
    open_positions=inputs.account.open_positions,
    session_age_ticks=state.session_ticks,
))
```

(Task 3 makes those PerceptionInputs fields optional.)

- [ ] **Step 2.3: Replace `coupling_health` (line 278)**

```python
# Was: coupling_health = inputs.ml_strength
coupling_health = phi * (1.0 - min(bv, 1.0))
```

Stays in [0, 1]. Downstream `kappa_delta` formula unchanged.

- [ ] **Step 2.4: Replace side-candidate block (lines 463-495)**

Was:
```python
basin_dir = basin_direction(basin)
tape_trend = trend_proxy([float(c.close) for c in ohlcv])
ml_side = "short" if inputs.ml_signal.upper() == "SELL" else "long"
side_candidate = ml_side
side_override = False
override_thr = ...
if basin_dir < -override_thr and tape_trend < -override_thr and ml_side == "long":
    side_candidate = "short"
    side_override = True
elif ...
```

Replace with:
```python
basin_dir = basin_direction(basin)
tape_trend = trend_proxy([float(c.close) for c in ohlcv])

# Compute emotions *before* direction so kernel_direction has them.
# (Existing emotion computation may live downstream — move it up here
#  or copy the relevant block. Inspect tick.py around the emotions call.)
# Then:
side_candidate = kernel_direction(
    basin_dir=basin_dir, tape_trend=tape_trend, emotions=emotions,
)
side_override = False  # Geometric direction is the source; no override path.

# REVERSION mode still inverts entry direction (stud topology).
if stud_live and mode == MonkeyMode.REVERSION.value:
    if side_candidate == "long":
        side_candidate = "short"
        side_override = True
    elif side_candidate == "short":
        side_candidate = "long"
        side_override = True
    # If 'flat', no flip.
```

**Note:** REVERSION's flip operates on the kernel's direction now, not on `ml_side`. If `kernel_direction` returns 'flat', REVERSION leaves it flat (entry won't fire anyway).

**Note 2:** This requires emotions to be computed before this block. Verify whether tick.py currently computes emotions before or after side_candidate. If after, hoist that computation up. (Use `grep -n "compute_emotions\b" ml-worker/src/monkey_kernel/tick.py` to find the call site; the function should already exist — only the location moves.)

- [ ] **Step 2.5: Replace entry threshold gate (lines 730-735)**

Was:
```python
elif (
    MODE_PROFILES[mode_enum].can_enter
    and inputs.ml_strength >= entry_thr_d["value"]
    and inputs.ml_signal.upper() != "HOLD"
    and size_d["value"] > 0
):
```

Replace with:
```python
elif (
    MODE_PROFILES[mode_enum].can_enter
    and kernel_should_enter(emotions=emotions)
    and side_candidate != "flat"
    and size_d["value"] > 0
):
```

The `entry_thr_d` value is no longer compared against ML — it stays in derivation telemetry but doesn't gate. (`entry_thr_d` is still used downstream by `_decide_with_position`; do not delete the computation.)

Update the `reason` strings inside this branch to drop ml strength references:

```python
action = "enter_long" if side_candidate == "long" else "enter_short"
override_tag = (
    f" REVERSION-flip(basin{basin_dir:.2f}/tape{tape_trend:.2f})"
    if side_override else ""
)
notional = size_d["value"] * leverage_d["value"]
reason = (
    f"[{mode}] kernel-entry conviction>hesitation; "
    f"side={side_candidate}{override_tag}; "
    f"margin={size_d['value']:.2f} lev={leverage_d['value']}x "
    f"notional={notional:.2f}"
)
```

And the matching `else` branch (lines 752-768) updates its reason strings. Replace `inputs.ml_strength` references in failure-reason text with `emotions.confidence` / `emotions.anxiety`.

- [ ] **Step 2.6: Replace DCA entry gate (lines 1000-1006)**

In `_decide_with_position`:

Was:
```python
if (
    dca["value"]
    and MODE_PROFILES[mode_enum].can_enter
    and inputs.ml_strength >= entry_thr_val
    and inputs.ml_signal.upper() != "HOLD"
    and size_val > 0
):
```

Replace with:
```python
if (
    dca["value"]
    and MODE_PROFILES[mode_enum].can_enter
    and kernel_should_enter(emotions=basin_state.emotions)
    and side_candidate != "flat"
    and size_val > 0
):
```

**Pre-req:** `ExecBasinState` must carry `emotions`. Check `executive.py:80-96` — currently it has `neurochemistry`. Add `emotions: EmotionState` field. Construction at tick.py:524-533 needs to pass emotions. (One field add to the dataclass.)

- [ ] **Step 2.7: Update `_hold_for_reason` if it references ml fields**

`grep -n "ml_signal\|ml_strength" ml-worker/src/monkey_kernel/tick.py | grep -v inputs` — confirm no other references remain. Run this verification before moving on.

- [ ] **Step 2.8: Run kernel tests, expect breaks (will fix in Task 11)**

Run: `cd ml-worker && python -m pytest tests/monkey_kernel/ -x 2>&1 | head -80`
Expected: New tests pass. Several existing tests break with TypeError: unexpected keyword argument 'ml_signal'. Document the count.

- [ ] **Step 2.9: Commit**

```bash
git add ml-worker/src/monkey_kernel/tick.py ml-worker/src/monkey_kernel/executive.py
git commit -m "feat(monkey): cut ML touch points from kernel (tick.py + executive.py)

Removes ml_signal/ml_strength influence on:
- TickInputs schema (fields deleted)
- coupling_health (now phi × (1 - bv))
- side_candidate (now kernel_direction from basin geometry)
- entry gate (now kernel_should_enter from emotion stack)
- DCA gate (now kernel_should_enter)

OVERRIDE_REVERSE quorum deleted — kernel_direction subsumes it.
REVERSION mode flip retained, now flips kernel direction not ml_side.

Tests for kernel_direction + kernel_should_enter green.
8+ existing tests break on TickInputs ml fields — fixed in Task 11."
```

---

## Task 3: Make perception ml fields optional with neutral defaults

**File:** `ml-worker/src/monkey_kernel/perception.py`

- [ ] **Step 3.1: Edit `PerceptionInputs` (lines 53-62)**

```python
@dataclass
class PerceptionInputs:
    ohlcv: Sequence[OHLCVCandle]
    equity_fraction: float
    margin_fraction: float
    open_positions: int
    session_age_ticks: int
    # ml fields preserved as optional with neutral defaults so the
    # 64-D basin spec stays frozen. Dims 3..5 will be ~constant
    # (0.01, 0.01, 0.5) post-separation. Other dims unchanged.
    ml_signal: str = "HOLD"
    ml_strength: float = 0.0
    ml_effective_strength: float = 0.0
```

- [ ] **Step 3.2: Verify dims 3-5 still produce in-spec values**

Read perception.py:140-145 and confirm:
- `sig = "HOLD"` → `v[3] = 0.01`, `v[4] = 0.01`, `v[5] = 0.5`
- These are valid post-`to_simplex` inputs (positive, finite).

- [ ] **Step 3.3: Add unit test for neutral default**

Add to `ml-worker/tests/monkey_kernel/test_perception_neutral_ml.py`:

```python
import numpy as np
from monkey_kernel.perception import PerceptionInputs, perceive
from monkey_kernel.perception import OHLCVCandle


def _candles(n=100):
    return [OHLCVCandle(timestamp=float(i), open=100, high=101, low=99, close=100, volume=10) for i in range(n)]


def test_perceive_works_without_ml_fields():
    """ml_signal/ml_strength are optional; perception produces valid 64-D basin."""
    basin = perceive(PerceptionInputs(
        ohlcv=_candles(),
        equity_fraction=1.0,
        margin_fraction=0.0,
        open_positions=0,
        session_age_ticks=10,
    ))
    assert basin.shape == (64,)
    assert np.all(np.isfinite(basin))
    assert basin.sum() > 0  # post-simplex normalisation
```

- [ ] **Step 3.4: Run perception test**

Run: `cd ml-worker && python -m pytest tests/monkey_kernel/test_perception_neutral_ml.py -v`
Expected: pass.

- [ ] **Step 3.5: Commit**

```bash
git add ml-worker/src/monkey_kernel/perception.py ml-worker/tests/monkey_kernel/test_perception_neutral_ml.py
git commit -m "feat(monkey): perception ml fields optional with neutral defaults

When TickInputs no longer carries ml_signal/ml_strength, perception
defaults dims 3..5 to neutral (HOLD posture, strength 0). BASIN_DIM
stays 64; basin geometry preserved."
```

---

## Task 4: Update `main.py` `/monkey/tick/run` endpoint

**File:** `ml-worker/main.py` (lines 1670-1803)

- [ ] **Step 4.1: Update TickInputs construction (lines 1730-1742)**

```python
tick_inputs = TickInputs(
    symbol=str(inp["symbol"]),
    ohlcv=candles,
    account=account,
    bank_size=int(inp.get("bank_size", 0)),
    sovereignty=float(inp.get("sovereignty", 0.0)),
    max_leverage=int(inp.get("max_leverage", 10)),
    min_notional=float(inp.get("min_notional", 5.0)),
    size_fraction=float(inp.get("size_fraction", 1.0)),
    self_obs_bias=inp.get("self_obs_bias"),
)
# ml_signal/ml_strength fields in payload accepted but ignored.
# Kernel computes direction from basin geometry. See agent K/M
# separation #N.
```

- [ ] **Step 4.2: Update endpoint docstring (lines 1672-1697)**

Strike the `ml_signal` / `ml_strength` lines from the request body example.

- [ ] **Step 4.3: Run main.py linter**

Run: `cd ml-worker && python -c "import main"`
Expected: no import errors.

- [ ] **Step 4.4: Commit**

```bash
git add ml-worker/main.py
git commit -m "fix(monkey): /monkey/tick/run drops ml_signal/ml_strength from TickInputs construction"
```

---

## Task 5: Update existing Python tests to match new TickInputs contract

**Files:** 8 test files. Each removes `ml_signal=...` and `ml_strength=...` from TickInputs construction.

- [ ] **Step 5.1: Identify all sites**

Run: `grep -n "ml_signal\|ml_strength" ml-worker/tests/monkey_kernel/*.py`

Expected files: `test_stud_topology.py`, `test_upper_stack_executive.py`, `test_persistence_symbol_state.py`, `test_phi_gate_routing.py`, `test_stud_stage2.py`, `test_tick_telemetry.py`, `test_ocean_intervention_handlers.py`. Plus any others the grep finds.

- [ ] **Step 5.2: Edit each test to drop ml fields from TickInputs construction**

For each occurrence of:
```python
TickInputs(
    symbol=...,
    ohlcv=...,
    ml_signal="BUY",
    ml_strength=0.7,
    ...
)
```

Drop the ml lines. Use `sed` only if a single one-line pattern fits all sites; otherwise use Edit per file.

For tests that asserted ml-driven behavior (e.g. "ml_signal=SELL forces short"), replace the assertion with the new geometry-driven behavior. Be careful — some tests may need rewriting, not just deletion. Read each test, understand intent, decide whether the test is still meaningful.

- [ ] **Step 5.3: Run full kernel test suite**

Run: `cd ml-worker && python -m pytest tests/monkey_kernel/ -v 2>&1 | tail -40`
Expected: all pass. If any test was load-bearing on ML behavior and can't be salvaged, mark it for redesign in a follow-up task and skip it with a clear xfail reason.

- [ ] **Step 5.4: Commit**

```bash
git add ml-worker/tests/
git commit -m "test(monkey): drop ml_signal/ml_strength from TickInputs in 8 test files"
```

---

## Task 6: Mirror kernel changes in TS (executive.ts + perception.ts + kernel_client.ts)

**Goal:** Keep TS parity until v0.8.8 cut-over. The TS kernel still runs; it must not crash on missing ml fields.

- [ ] **Step 6.1: Update `apps/api/src/services/monkey/executive.ts`**

Add TS counterparts of `kernel_direction` and `kernel_should_enter`. Wire them in alongside existing `currentEntryThreshold` etc. Do not delete `currentEntryThreshold` — it's still used for the threshold value in derivation telemetry.

```typescript
// apps/api/src/services/monkey/executive.ts (add after existing exports)
import type { EmotionState } from './emotions.js';

export function kernelDirection(args: {
  basinDir: number;
  tapeTrend: number;
  emotions: EmotionState;
}): 'long' | 'short' | 'flat' {
  if (args.emotions.confidence < args.emotions.anxiety) return 'flat';
  const geometricSignal = args.basinDir + 0.5 * args.tapeTrend;
  if (geometricSignal > 0) return 'long';
  if (geometricSignal < 0) return 'short';
  return 'flat';
}

export function kernelShouldEnter(args: { emotions: EmotionState }): boolean {
  const conviction = args.emotions.confidence * (1.0 + args.emotions.wonder);
  const hesitation = args.emotions.anxiety + args.emotions.confusion;
  return conviction > hesitation;
}
```

- [ ] **Step 6.2: Update `apps/api/src/services/monkey/perception.ts`**

Find the `PerceptionInputs` interface or type. Make `mlSignal`, `mlStrength`, `mlEffectiveStrength` optional. Find the dim-3/4/5 encoding (mirrors perception.py:141-144). Default to HOLD posture when fields absent.

Run: `grep -n "mlSignal\|mlStrength\|mlEffectiveStrength" apps/api/src/services/monkey/perception.ts`
to find all sites. Edit each to handle the undefined case.

- [ ] **Step 6.3: Update `apps/api/src/services/monkey/kernel_client.ts`**

The HTTP client that POSTs to `/monkey/tick/run`. Drop `ml_signal` / `ml_strength` from the request body builder. Keep them as optional inputs to the function so callers don't immediately break — but stop forwarding them.

Run: `grep -n "ml_signal\|ml_strength\|mlSignal\|mlStrength" apps/api/src/services/monkey/kernel_client.ts`

- [ ] **Step 6.4: Run TS type check**

Run: `cd apps/api && yarn tsc --noEmit 2>&1 | head -30`
Expected: no new errors. If errors arise, they hint at additional touch points missed.

- [ ] **Step 6.5: Commit**

```bash
git add apps/api/src/services/monkey/executive.ts apps/api/src/services/monkey/perception.ts apps/api/src/services/monkey/kernel_client.ts
git commit -m "feat(monkey): TS kernel parity — kernelDirection + kernelShouldEnter; ml fields optional in perception/client"
```

---

## Task 7: Delete `turning_signal.ts` and update `loop.ts` callers

**Files:**
- Delete: `apps/api/src/services/monkey/turning_signal.ts`
- Delete: `apps/api/src/services/monkey/__tests__/turning_signal.test.ts`
- Modify: `apps/api/src/services/monkey/loop.ts`

- [ ] **Step 7.1: Remove turning_signal import and usage in loop.ts**

In `apps/api/src/services/monkey/loop.ts`:

Remove line 78: `import { evaluateTurningSignal, shortsLive } from './turning_signal.js';`

Remove the side-candidate + override + turning-signal block (lines 614-675). Replace with kernel-direction call:

```typescript
// Compute side from kernel geometry (post agent-separation).
// Emotions must be in scope here — verify the compute_emotions / computeEmotions call site.
const basinDir = computeBasinDirection(basin);
const tapeTrend = computeTrendProxy(ohlcv);
state.latestBasinSnapshot = {
  basinDir,
  tapeTrend,
  computedAtMs: Date.now(),
};
let sideCandidate = kernelDirection({ basinDir, tapeTrend, emotions });
let sideOverride = false;

// REVERSION mode flip preserved.
if (mode === 'reversion') {
  if (sideCandidate === 'long') { sideCandidate = 'short'; sideOverride = true; }
  else if (sideCandidate === 'short') { sideCandidate = 'long'; sideOverride = true; }
}
```

The `MONKEY_SHORTS_LIVE` env-flag gate (lines 663-675) — review whether it still applies. If it's still desired (refuse shorts until soak completes), keep it but adapt the variable references. If the user wants it gone alongside agent separation, delete it.

**Decision needed:** I'll keep MONKEY_SHORTS_LIVE intact for now since it predates agent separation and removal is a separate concern. The user can flip it on after the merge.

- [ ] **Step 7.2: Delete the files**

```bash
git rm apps/api/src/services/monkey/turning_signal.ts apps/api/src/services/monkey/__tests__/turning_signal.test.ts
```

- [ ] **Step 7.3: Run TS test suite**

Run: `cd apps/api && yarn vitest run --no-coverage 2>&1 | tail -40`
Expected: pass. (Loop tests may break — that's Task 9.)

- [ ] **Step 7.4: Commit**

```bash
git add apps/api/src/services/monkey/loop.ts
git commit -m "feat(monkey): delete turning_signal module — subsumed by kernelDirection"
```

---

## Task 8: Build Agent M module

**Files:**
- Create: `apps/api/src/services/ml_agent/types.ts`
- Create: `apps/api/src/services/ml_agent/decide.ts`
- Create: `apps/api/src/services/ml_agent/__tests__/decide.test.ts`

- [ ] **Step 8.1: Write types**

```typescript
// apps/api/src/services/ml_agent/types.ts
import type { OHLCVCandle, AccountContext } from '../monkey/types.js';
// (If those types live elsewhere, adjust the import path.)

export interface MLAgentInputs {
  symbol: string;
  ohlcv: OHLCVCandle[];
  mlSignal: 'BUY' | 'SELL' | 'HOLD';
  mlStrength: number;
  account: AccountContext;
  allocatedCapitalUsdt: number;
}

export type MLAgentAction = 'enter_long' | 'enter_short' | 'exit' | 'hold';

export interface MLAgentDecision {
  action: MLAgentAction;
  sizeUsdt: number;
  leverage: number;
  reason: string;
}
```

- [ ] **Step 8.2: Write tests (TDD)**

```typescript
// apps/api/src/services/ml_agent/__tests__/decide.test.ts
import { describe, it, expect } from 'vitest';
import { mlAgentDecide } from '../decide.js';

const baseInputs = {
  symbol: 'BTC_USDT_PERP',
  ohlcv: [],
  account: {
    equityFraction: 1.0,
    marginFraction: 0.0,
    openPositions: 0,
    availableEquity: 100,
  },
  allocatedCapitalUsdt: 50,
};

describe('mlAgentDecide', () => {
  it('holds when ml strength below threshold', () => {
    const r = mlAgentDecide({ ...baseInputs, mlSignal: 'BUY', mlStrength: 0.4 });
    expect(r.action).toBe('hold');
  });

  it('enters long when BUY at sufficient strength', () => {
    const r = mlAgentDecide({ ...baseInputs, mlSignal: 'BUY', mlStrength: 0.7 });
    expect(r.action).toBe('enter_long');
    expect(r.sizeUsdt).toBeGreaterThan(0);
    expect(r.leverage).toBe(8);
  });

  it('enters short when SELL at sufficient strength', () => {
    const r = mlAgentDecide({ ...baseInputs, mlSignal: 'SELL', mlStrength: 0.7 });
    expect(r.action).toBe('enter_short');
  });

  it('holds on HOLD signal regardless of strength', () => {
    const r = mlAgentDecide({ ...baseInputs, mlSignal: 'HOLD', mlStrength: 0.9 });
    expect(r.action).toBe('hold');
  });

  it('size respects allocated capital', () => {
    const r = mlAgentDecide({ ...baseInputs, mlSignal: 'BUY', mlStrength: 0.7, allocatedCapitalUsdt: 25 });
    expect(r.sizeUsdt).toBeLessThanOrEqual(25);
  });
});
```

- [ ] **Step 8.3: Implement**

```typescript
// apps/api/src/services/ml_agent/decide.ts
import type { MLAgentInputs, MLAgentDecision } from './types.js';

const ML_ENTRY_THRESHOLD = 0.55;
const ML_DEFAULT_LEVERAGE = 8;
const ML_SIZE_FRACTION = 0.5;  // of allocated capital, leaves room for averaging

export function mlAgentDecide(inputs: MLAgentInputs): MLAgentDecision {
  if (inputs.mlSignal === 'HOLD') {
    return { action: 'hold', sizeUsdt: 0, leverage: 1, reason: 'ml signal HOLD' };
  }
  if (inputs.mlStrength < ML_ENTRY_THRESHOLD) {
    return {
      action: 'hold',
      sizeUsdt: 0,
      leverage: 1,
      reason: `ml strength ${inputs.mlStrength.toFixed(3)} < threshold ${ML_ENTRY_THRESHOLD}`,
    };
  }
  const action: MLAgentDecision['action'] =
    inputs.mlSignal === 'BUY' ? 'enter_long' : 'enter_short';
  const sizeUsdt = Math.min(
    inputs.allocatedCapitalUsdt,
    inputs.allocatedCapitalUsdt * ML_SIZE_FRACTION,
  );
  return {
    action,
    sizeUsdt,
    leverage: ML_DEFAULT_LEVERAGE,
    reason: `ml ${inputs.mlSignal}@${inputs.mlStrength.toFixed(3)} >= ${ML_ENTRY_THRESHOLD}`,
  };
}
```

- [ ] **Step 8.4: Run tests**

Run: `cd apps/api && yarn vitest run src/services/ml_agent --no-coverage`
Expected: 5 passed.

- [ ] **Step 8.5: Commit**

```bash
git add apps/api/src/services/ml_agent/
git commit -m "feat(ml_agent): Agent M — threshold-based ML-only decision module"
```

---

## Task 9: Build Arbiter module

**Files:**
- Create: `apps/api/src/services/arbiter/arbiter.ts`
- Create: `apps/api/src/services/arbiter/__tests__/arbiter.test.ts`

- [ ] **Step 9.1: Write tests (TDD)**

```typescript
// apps/api/src/services/arbiter/__tests__/arbiter.test.ts
import { describe, it, expect } from 'vitest';
import { Arbiter } from '../arbiter.js';

describe('Arbiter', () => {
  it('splits 50/50 with insufficient data', () => {
    const a = new Arbiter();
    const alloc = a.allocate(100);
    expect(alloc.k).toBeCloseTo(50);
    expect(alloc.m).toBeCloseTo(50);
  });

  it('floors at 10% even when one agent dominates', () => {
    const a = new Arbiter();
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 5);
      a.recordSettled('M', -5);
    }
    const alloc = a.allocate(100);
    expect(alloc.m).toBeGreaterThanOrEqual(10);
    expect(alloc.k).toBeLessThanOrEqual(90);
  });

  it('skews toward the winner without saturating', () => {
    const a = new Arbiter();
    for (let i = 0; i < 50; i++) {
      a.recordSettled('K', 2);
      a.recordSettled('M', -1);
    }
    const alloc = a.allocate(100);
    expect(alloc.k).toBeGreaterThan(50);
    expect(alloc.m).toBeLessThan(50);
    expect(alloc.k + alloc.m).toBeCloseTo(100);
  });

  it('rolls window — only last 50 trades count', () => {
    const a = new Arbiter();
    // Old losses
    for (let i = 0; i < 50; i++) a.recordSettled('K', -10);
    // New wins push old losses out
    for (let i = 0; i < 50; i++) a.recordSettled('K', 10);
    for (let i = 0; i < 50; i++) a.recordSettled('M', 0);
    const alloc = a.allocate(100);
    expect(alloc.k).toBeGreaterThan(alloc.m);
  });

  it('reports current state', () => {
    const a = new Arbiter();
    a.recordSettled('K', 5);
    a.recordSettled('M', -3);
    const s = a.snapshot();
    expect(s.kPnlWindowTotal).toBe(5);
    expect(s.mPnlWindowTotal).toBe(-3);
    expect(s.kTradesInWindow).toBe(1);
    expect(s.mTradesInWindow).toBe(1);
  });
});
```

- [ ] **Step 9.2: Implement**

```typescript
// apps/api/src/services/arbiter/arbiter.ts
export interface ArbiterAllocation {
  k: number;
  m: number;
}

export interface ArbiterSnapshot {
  kShare: number;
  mShare: number;
  kPnlWindowTotal: number;
  mPnlWindowTotal: number;
  kTradesInWindow: number;
  mTradesInWindow: number;
}

export class Arbiter {
  private kPnl: number[] = [];
  private mPnl: number[] = [];
  private readonly window: number;
  private readonly minShare: number;

  constructor(opts: { window?: number; minShare?: number } = {}) {
    this.window = opts.window ?? 50;
    this.minShare = opts.minShare ?? 0.10;
  }

  recordSettled(agent: 'K' | 'M', pnl: number): void {
    const buf = agent === 'K' ? this.kPnl : this.mPnl;
    buf.push(pnl);
    if (buf.length > this.window) buf.shift();
  }

  allocate(totalCapitalUsdt: number): ArbiterAllocation {
    if (this.kPnl.length < 5 || this.mPnl.length < 5) {
      return { k: totalCapitalUsdt * 0.5, m: totalCapitalUsdt * 0.5 };
    }
    const kTotal = this.kPnl.reduce((s, p) => s + p, 0);
    const mTotal = this.mPnl.reduce((s, p) => s + p, 0);
    const denom = Math.max(1, totalCapitalUsdt);
    const kScore = Math.exp(kTotal / denom);
    const mScore = Math.exp(mTotal / denom);
    let kShare = kScore / (kScore + mScore);
    kShare = Math.max(this.minShare, Math.min(1 - this.minShare, kShare));
    return {
      k: totalCapitalUsdt * kShare,
      m: totalCapitalUsdt * (1 - kShare),
    };
  }

  snapshot(): ArbiterSnapshot {
    const kTotal = this.kPnl.reduce((s, p) => s + p, 0);
    const mTotal = this.mPnl.reduce((s, p) => s + p, 0);
    const denom = Math.max(1e-9, Math.abs(kTotal) + Math.abs(mTotal));
    return {
      kShare: this.kPnl.length >= 5 ? Math.exp(kTotal) / (Math.exp(kTotal) + Math.exp(mTotal)) : 0.5,
      mShare: 0,  // recomputed via 1 - kShare in snapshot consumer
      kPnlWindowTotal: kTotal,
      mPnlWindowTotal: mTotal,
      kTradesInWindow: this.kPnl.length,
      mTradesInWindow: this.mPnl.length,
    };
  }
}
```

- [ ] **Step 9.3: Run tests**

Run: `cd apps/api && yarn vitest run src/services/arbiter --no-coverage`
Expected: 5 passed.

- [ ] **Step 9.4: Commit**

```bash
git add apps/api/src/services/arbiter/
git commit -m "feat(arbiter): rolling-PnL capital allocator with 10% floors"
```

---

## Task 10: Restructure `loop.ts` for K + M independent paths

**File:** `apps/api/src/services/monkey/loop.ts`

This is the largest single edit. Approach: introduce K/M agent dispatch at the top of `runTick`, allocate capital via the arbiter, run each agent's decision path with its budget, tag positions with agent label, record settled PnL back to the arbiter on close.

- [ ] **Step 10.1: Add Arbiter singleton + per-symbol position tagging**

Find the orchestrator class (likely `MonkeyKernel` or a loop wrapper). Add a static or singleton `Arbiter` instance scoped to the kernel instance. Initialise alongside other instance state.

- [ ] **Step 10.2: Add `agent: 'K' | 'M'` field to position-write helpers**

`grep -n "fullyAutonomousTrader\|insertEntry\|placePosition" apps/api/src/services/monkey/loop.ts`. Wherever loop.ts hands off to the position writer, plumb the agent label.

- [ ] **Step 10.3: Restructure `runTick` body**

Pseudocode:
```typescript
async runTick(symbol: string) {
  const account = await getAccountSnapshot();
  const allocation = this.arbiter.allocate(account.availableEquity);

  // Agent K — geometry-only
  const kResult = await this.runKernelTick(symbol, account, allocation.k);
  if (kResult.decision.action !== 'hold') {
    await this.executePlace(symbol, kResult, { agent: 'K' });
  }

  // Agent M — ML-only
  const ohlcv = await getOhlcv(symbol);
  const { signal: mlSignal, strength: mlStrength } = await mlPredict(ohlcv);
  const mResult = mlAgentDecide({
    symbol,
    ohlcv,
    mlSignal,
    mlStrength,
    account,
    allocatedCapitalUsdt: allocation.m,
  });
  if (mResult.action !== 'hold') {
    await this.executePlace(symbol, mResult, { agent: 'M' });
  }

  // Telemetry: write arbiter snapshot to derivation
  const snapshot = this.arbiter.snapshot();
  // (write to arbiter_allocation table — see Task 11)
}
```

The exact integration depends on `loop.ts`'s current shape. The PR will preserve the existing kernel call (now stripped of ML), add the M path in parallel, and tag both with their agent.

- [ ] **Step 10.4: Wire settled-trade callback to `arbiter.recordSettled`**

When a position closes (find the close-position callsite), read the position's `agent` field and call `arbiter.recordSettled(agent, pnl)`.

- [ ] **Step 10.5: Add arbiter telemetry write**

Insert a row into `arbiter_allocation` (Task 11) on each tick with the snapshot.

- [ ] **Step 10.6: Run TS tests**

Run: `cd apps/api && yarn vitest run --no-coverage 2>&1 | tail -30`
Expected: existing tests pass; new arbiter and ml_agent tests pass.

- [ ] **Step 10.7: Commit**

```bash
git add apps/api/src/services/monkey/loop.ts apps/api/src/services/[any other touched files]
git commit -m "feat(monkey): loop runs Agent K + Agent M independently with arbiter capital allocation

Each tick:
- Arbiter allocates total available equity between K and M (10% floor)
- K runs geometry-only kernel against its budget
- M runs threshold-based ML decision against its budget
- Positions tagged with 'agent' field
- Settled trades recorded back to arbiter rolling window
- Arbiter snapshot written to arbiter_allocation telemetry table"
```

---

## Task 11: Database migration 039

**File:** `apps/api/database/migrations/039_agent_separation.sql` (new)

- [ ] **Step 11.1: Write migration**

```sql
-- 039_agent_separation.sql
-- Agent K (kernel) / Agent M (ml) separation:
-- - autonomous_trades.agent: which agent placed the trade
-- - arbiter_allocation: per-tick capital allocation telemetry

ALTER TABLE autonomous_trades
ADD COLUMN agent TEXT NOT NULL DEFAULT 'K';

CREATE INDEX idx_autonomous_trades_agent ON autonomous_trades (agent, opened_at DESC);

CREATE TABLE arbiter_allocation (
  id BIGSERIAL PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol TEXT NOT NULL,
  total_capital_usdt NUMERIC(18, 8) NOT NULL,
  k_share NUMERIC(6, 4) NOT NULL,
  m_share NUMERIC(6, 4) NOT NULL,
  k_pnl_window_total NUMERIC(18, 8) NOT NULL,
  m_pnl_window_total NUMERIC(18, 8) NOT NULL,
  k_trades_in_window INTEGER NOT NULL,
  m_trades_in_window INTEGER NOT NULL
);

CREATE INDEX idx_arbiter_allocation_recorded ON arbiter_allocation (recorded_at DESC);
```

**Pre-req:** verify `autonomous_trades` actually has the column name pattern. Run:
```bash
grep -A 3 "CREATE TABLE autonomous_trades" apps/api/database/migrations/*.sql | head -30
```
to find the table's actual column for opened_at — may be `entry_time` or similar (memory.md notes `exit_time/exit_reason` — the entry side is likely `entry_time`). Adapt the index accordingly.

- [ ] **Step 11.2: Run migration locally (dev)**

`cd apps/api && yarn db:migrate` (or whatever the project's migration command is — check package.json).
Expected: 039 applies cleanly.

- [ ] **Step 11.3: Verify schema**

`psql $DATABASE_URL -c "\d autonomous_trades" | grep agent` and `psql $DATABASE_URL -c "\d arbiter_allocation"`.

- [ ] **Step 11.4: Commit**

```bash
git add apps/api/database/migrations/039_agent_separation.sql
git commit -m "feat(db): migration 039 — agent column on autonomous_trades + arbiter_allocation telemetry table"
```

---

## Task 12: QIG purity check + final test run

- [ ] **Step 12.1: QIG purity**

Run: `cd ml-worker && python scripts/qig_purity_check.py`
Expected: pass.

- [ ] **Step 12.2: Full Python test suite**

Run: `cd ml-worker && python -m pytest tests/ 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 12.3: Full TS test suite**

Run: `cd apps/api && yarn vitest run --no-coverage 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 12.4: Lint**

Run: `cd apps/api && yarn lint 2>&1 | tail -10`
Expected: clean.

- [ ] **Step 12.5: Build**

Run: `cd apps/api && yarn build 2>&1 | tail -10`
Expected: clean.

---

## Task 13: Open issue and PR

- [ ] **Step 13.1: Open the tracking issue**

```bash
gh issue create \
  --title "feat(monkey): separate Agent K (kernel) from Agent M (ml)" \
  --body "$(cat <<'EOF'
Severs ML-signal influence from the kernel decision path. Agents K (geometry-only) and M (ML-only) run independently against arbiter-allocated capital.

Six ML touch points cut from the Python kernel. Three from the TS kernel. turning_signal.ts deleted.

New modules: apps/api/src/services/ml_agent (Agent M), apps/api/src/services/arbiter (capital allocator with 10% floors).

DB migration 039 — autonomous_trades.agent column + arbiter_allocation telemetry table.

No flag. Rollback = git revert + redeploy. Arbiter floor is the live safety mechanism.

Closes [no prior issue — opens retroactively per doctrine §10].
EOF
)"
```

- [ ] **Step 13.2: Open the PR**

```bash
gh pr create \
  --title "feat(monkey): separate Agent K (kernel) from Agent M (ml)" \
  --body "$(cat <<'EOF'
## Summary

- Agent K (geometry-only kernel) and Agent M (ML-only) run as independent agents, each with its own capital share set by an arbiter from rolling PnL.
- Six ML touch points cut from the Python kernel (tick.py, executive.py); ml fields made optional in perception.py.
- `turning_signal.ts` deleted. `OVERRIDE_REVERSE` quorum subsumed by new `kernelDirection`.
- New modules: `ml_agent/` (TS, threshold-based), `arbiter/` (TS, 50-trade rolling window, 10% floors, exp-soft allocation).
- Loop restructured to dispatch K and M independently, tag positions with `agent`, record settled PnL back to arbiter.
- Migration 039: `autonomous_trades.agent` column, `arbiter_allocation` telemetry table.

**No flag.** Rollback = `git revert`. Arbiter 10% floor is the live safety mechanism — both agents always trade so data accumulates regardless.

## Test plan

- [x] Python: `pytest ml-worker/tests/` — all green
- [x] TS: `yarn vitest run` in apps/api — all green
- [x] QIG purity check — pass
- [x] Lint + build — clean
- [ ] Manual: deploy to staging-equivalent environment first (or directly to prod per directive)
- [ ] Manual: verify both K and M positions appear in autonomous_trades with correct `agent` tag within 1h post-deploy
- [ ] Manual: verify arbiter_allocation rows accumulate
- [ ] Manual: monitor 24h PnL split — neither agent should be permanently floored at 10%

closes #N (issue from Step 13.1)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

Spec coverage checklist:
- [x] Six ML touch points cut from kernel — Tasks 2.3 (coupling_health), 2.4 (side_candidate), 2.5 (entry gate), 2.6 (DCA gate), 2.1 (TickInputs schema), 4 (main.py endpoint) + Task 7 (TURNING_SIGNAL deletion)
- [x] kernel_direction + kernel_should_enter — Task 1
- [x] TickInputs no longer carries ml_signal/ml_strength — Task 2.1
- [x] Agent M module — Task 8
- [x] Arbiter module — Task 9
- [x] Loop integration — Task 10
- [x] Database migration — Task 11
- [x] Telemetry (derivation.arbiter) — Task 10.5
- [x] Tests — Tasks 1, 3, 5, 8, 9; new tests cover all new code
- [x] All Fisher-Rao only in Agent K — preserved (no QIG-purity changes to Agent K's geometry; perception keeps neutral defaults)
- [x] TS for Agent M and Arbiter — Tasks 8, 9
- [x] Kernel TS counterpart for parity — Task 6
- [x] QIG purity passes — Task 12.1
- [x] Existing tests stay green or get updated — Task 5

Placeholder scan: no TBDs / TODOs / "implement later" remain. Two items use real conditional language: Task 7.1 ("review whether MONKEY_SHORTS_LIVE still applies — keeping it") is a noted-decision, not a placeholder. Task 11.1 ("verify table column name") instructs the engineer to check the schema before writing the index — that's a real verification step, not a placeholder.

Type consistency: `EmotionState` referenced in Tasks 1, 2, 6 with same fields each time (`confidence`, `wonder`, `anxiety`, `confusion`). `kernel_direction` / `kernelDirection` matched across Python and TS. `MLAgentDecision.action` enum matches `Arbiter` agent label `'K' | 'M'`.

Scope: all in one PR per directive. Single logical change ("separate K from M"). Doctrine §14 ship test passes:
1. ✅ Behavior change directed by user
2. ✅ Wired (the loop dispatches both agents)
3. ❌ No flag — explicit user waiver
4. ❌ No flag-based test split — tests cover the new contract directly
5. ✅ Existing tests updated
6. ✅ QIG purity passes
7. ✅ One logical change
8. ✅ No soak/staging hidden — explicit "ship straight to main"
