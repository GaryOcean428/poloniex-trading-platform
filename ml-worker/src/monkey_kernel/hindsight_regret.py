"""hindsight_regret.py — legibility-gated counterfactual PREDICTION ERROR.

Python parity for apps/api/src/services/monkey/hindsightRegret.ts. Identical
formula, derivation, source labels, and fail-closed behaviour. See the TS
module's header for the full design rationale; this docstring summarises.

DESIGN HYPOTHESIS (operator-approved redesign of PR #1038, 2026-05-29),
flag-gated OFF (MONKEY_HINDSIGHT_REGRET_LIVE), for operator review — NOT a
finished truth. Replaces the rejected v1 (fixed 30-min window + fixed dopamine
caps + best-favourable-excursion + dopamine-only pain).

The signal is a legibility-gated counterfactual PREDICTION ERROR scaled by the
kernel's OWN outcome distribution (median+MAD z-score — the observer scale
observer_fib_coefficient / push_reward use). No fixed caps/taste constants.

PURITY KEYSTONE — eligibility / legibility gate. Regret is scaled by how
strongly ALL THREE hold:
  (1) the kernel OWNED the close (operator/manual/liquidation → not self-regret),
  (2) the continuation was LEGIBLE at close (qig-warp expectation favoured the
      held side, basin direction still leaned with the position, the hold was
      coherent),
  (3) the same REGIME persisted through the derived horizon.
If continuation was NOT legible → SURPRISE / NOISE, not regret → no aversive
signal. Weakly legible continuations remain learnable but weak: observer-scaled
prediction-error salience is multiplied by close-time legibility strength. Maps
onto QIG canon §31 (Sensory Intake & Predictive Coding): an unpredictable
continuation is surprise, not a learnable mistake.

QIG canon §29.1 (six-chemical E6 Cartan generators) governs the NT signs:
  ACh (ENTRAIN/E1) bind cues · dopamine (AMPLIFY/E2) reward/prediction-error ·
  GABA (DAMPEN/E3) inhibition (TARGETED here) · serotonin (ROTATE/E4)
  patience/temporal-trust · NE (NUCLEATE/E5) salience · endorphin (DISSOLVE/E6)
  relief. We do NOT invent chemistry semantics.

DOCTRINAL ANCHORS: P1 (observer-set magnitudes via median+MAD), P14 (own
channel), P15 (fail-closed — invalid price/margin → zero vector, never blocks).

PURE module (no I/O, no time, no DB).
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Literal, Optional

_EPS: float = 1e-12
# Minimum samples before the observer scale is trusted (mirrors push_reward /
# observer_fib_coefficient). Below → no signal (cold-start must not fabricate).
_MIN_SAMPLES: int = 5


def _is_finite(x: object) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(float(x))


@dataclass
class HindsightNtDeltas:
    """E6 six-chemical NT delta vector (canon §29.1). Signs are canonical
    roles; magnitudes are observer-scaled. Flag-OFF callers never read it."""

    dopamine_delta: float = 0.0
    acetylcholine_delta: float = 0.0
    norepinephrine_delta: float = 0.0
    serotonin_delta: float = 0.0
    gaba_delta: float = 0.0
    endorphin_delta: float = 0.0


@dataclass
class CloseSenseBundle:
    """Close-time sense bundle — drives the legibility gate + GABA binding."""

    kernel_owned_close: bool
    side_sign: int  # +1 long, -1 short
    warp_expectation_sign: int  # -1 short, 0 flat/observe, +1 long
    warp_expectation_confidence: float
    regime_at_close: str
    basin_dir_at_close: float
    tape_trend_at_close: float
    coherence_streak: int


@dataclass
class CounterfactualOutcome:
    """Counterfactual outcome resolved at the END of the derived horizon."""

    realized_pnl_usdt: float
    horizon_end_pnl_usdt: float  # NOT max favourable excursion
    margin_usdt: float
    regime_persisted: bool


@dataclass
class HindsightResult:
    nt: HindsightNtDeltas
    gaba_target: Optional[str]
    foregone_gain_usdt: float
    prediction_error_z: float
    source: str


def _ineligible(source: str) -> HindsightResult:
    return HindsightResult(
        nt=HindsightNtDeltas(),
        gaba_target=None,
        foregone_gain_usdt=0.0,
        prediction_error_z=0.0,
        source=source,
    )


def median_and_mad(xs: list[float]) -> tuple[float, float]:
    """(median, MAD) — the observer scale observer_fib_coefficient uses."""
    finite = [float(x) for x in xs if _is_finite(x)]
    if not finite:
        return (0.0, 0.0)
    s = sorted(finite)
    n = len(s)

    def _med(arr: list[float]) -> float:
        m = len(arr)
        return (arr[m // 2 - 1] + arr[m // 2]) / 2 if m % 2 == 0 else arr[m // 2]

    median = _med(s)
    devs = sorted(abs(x - median) for x in s)
    return (median, _med(devs))


def counterfactual_pnl_usdt(
    *,
    side_sign: int,
    qty: float,
    exit_price: float,
    realized_pnl_usdt: float,
    price: float,
) -> Optional[float]:
    """Counterfactual pnl (USDT) of holding the CLOSED position to ``price``.

    long  : (price - exit_price) * qty
    short : (exit_price - price) * qty
    Returns realised + marginal. None on any invalid input (fail-closed).
    """
    if not _is_finite(price) or price <= 0:
        return None
    if not _is_finite(qty) or qty <= 0:
        return None
    if not _is_finite(exit_price) or exit_price <= 0:
        return None
    if not _is_finite(realized_pnl_usdt):
        return None
    if side_sign not in (1, -1):
        return None
    marginal = (price - exit_price) * side_sign * qty
    return float(realized_pnl_usdt + marginal)


def _clamp_to_unit_interval(x: float) -> float:
    if not _is_finite(x):
        return 0.0
    return max(0.0, min(1.0, float(x)))


def legibility_strength(b: CloseSenseBundle, regime_persisted: bool = True) -> float:
    """Continuous legibility multiplier ∈ [0,1].

    Weak confidence / tiny basin lean / one-tick coherence scales regret down
    instead of merely opening a Boolean gate. Regime persistence is currently
    observed as a latch, so its strength is 1 when persisted and 0 after a flip.
    """
    if not regime_persisted:
        return 0.0
    warp_strength = (
        _clamp_to_unit_interval(b.warp_expectation_confidence)
        if b.warp_expectation_sign == b.side_sign
        else 0.0
    )
    basin_strength = (
        math.tanh(abs(float(b.basin_dir_at_close)))
        if _is_finite(b.basin_dir_at_close) and _sign(float(b.basin_dir_at_close)) == b.side_sign
        else 0.0
    )
    coherence = (
        float(b.coherence_streak) / float(b.coherence_streak + 1)
        if _is_finite(b.coherence_streak) and b.coherence_streak > 0
        else 0.0
    )
    return _clamp_to_unit_interval(warp_strength * basin_strength * coherence)


def is_continuation_legible(b: CloseSenseBundle) -> bool:
    """PURITY KEYSTONE part — was the continuation foreseeable at close?

    True iff the close-time senses showed evidence to HOLD: qig-warp
    expectation favoured the held side with positive confidence, basin
    direction still leaned the held way, and the hold was coherent for at
    least one tick. "Legible" = the kernel's own forecast pointed at
    continuation (low surprise per §31) → a continuation is a prediction
    error it could have avoided. Otherwise it is surprise/noise.
    """
    return legibility_strength(b) > _EPS


def _sign(x: float) -> int:
    if x > 0:
        return 1
    if x < 0:
        return -1
    return 0


def is_eligible_for_regret(
    b: CloseSenseBundle,
    regime_persisted: bool,
) -> tuple[bool, Literal["eligible", "not_owned", "not_legible", "regime_changed"]]:
    """owned ∧ legible-at-close ∧ regime-persisted."""
    if not b.kernel_owned_close:
        return (False, "not_owned")
    if not is_continuation_legible(b):
        return (False, "not_legible")
    if not regime_persisted:
        return (False, "regime_changed")
    return (True, "eligible")


def derive_magnitude(
    frac: float,
    pnl_frac_history: list[float],
) -> Optional[tuple[float, float]]:
    """(z, salience) observer-scaled magnitude, or None if no trusted scale.

    z = |frac| / MAD(history); salience = tanh(z) ∈ [0,1). With < MIN_SAMPLES
    or MAD≈0 → None (cold-start must not fabricate chemistry).
    """
    if not _is_finite(frac):
        return None
    if len(pnl_frac_history) < _MIN_SAMPLES:
        return None
    _, mad = median_and_mad(pnl_frac_history)
    if mad <= _EPS:
        return None
    z = abs(frac) / mad
    return (z, math.tanh(z))


def gaba_target_key(b: CloseSenseBundle) -> str:
    """Bind targeted GABA to the (regime, side) premature-close pattern."""
    side = "long" if b.side_sign == 1 else "short"
    regime = b.regime_at_close if isinstance(b.regime_at_close, str) and b.regime_at_close else "unknown"
    return f"premature_close:{regime}:{side}"


def resolve_hindsight(
    bundle: CloseSenseBundle,
    outcome: CounterfactualOutcome,
    pnl_frac_history: Optional[list[float]] = None,
) -> HindsightResult:
    """Resolve a watch at horizon end into the full NT vector. PURE.

    Mirrors resolveHindsight() in hindsightRegret.ts exactly.
    """
    if pnl_frac_history is None:
        pnl_frac_history = []

    realized = outcome.realized_pnl_usdt
    horizon_end = outcome.horizon_end_pnl_usdt
    margin = outcome.margin_usdt

    # fail-closed
    if not _is_finite(realized) or not _is_finite(horizon_end):
        return _ineligible("hindsight_invalid")
    if not _is_finite(margin) or margin <= 0:
        return _ineligible("hindsight_no_margin")

    # ownership gate (condition 1)
    if not bundle.kernel_owned_close:
        return _ineligible("ineligible_not_owned")

    foregone_gain = horizon_end - realized

    # good-close branch (avoided a worse/equal outcome)
    if foregone_gain <= _EPS:
        avoided_loss_frac = abs(foregone_gain) / margin
        mag = derive_magnitude(avoided_loss_frac, pnl_frac_history)
        if mag is None:
            return _ineligible("ineligible_noise")
        _z, s = mag
        return HindsightResult(
            nt=HindsightNtDeltas(
                dopamine_delta=float(s),
                acetylcholine_delta=float(s),
                norepinephrine_delta=float(s),
                serotonin_delta=float(s),
                gaba_delta=0.0,
                endorphin_delta=float(s),
            ),
            gaba_target=None,
            foregone_gain_usdt=0.0,
            prediction_error_z=float(_z),
            source="hindsight_good_close",
        )

    # legibility + regime-persistence gate (conditions 2 & 3)
    eligible, _reason = is_eligible_for_regret(bundle, outcome.regime_persisted)
    if not eligible:
        return _ineligible("ineligible_noise")

    # regret branch: legible premature close, observer-scaled
    regret_frac = foregone_gain / margin
    mag = derive_magnitude(regret_frac, pnl_frac_history)
    if mag is None:
        return _ineligible("ineligible_noise")
    z, salience = mag
    legibility = legibility_strength(bundle, outcome.regime_persisted)
    if legibility <= _EPS:
        return _ineligible("ineligible_noise")
    s = salience * legibility

    return HindsightResult(
        nt=HindsightNtDeltas(
            dopamine_delta=float(-s),
            acetylcholine_delta=float(s),
            norepinephrine_delta=float(s),
            serotonin_delta=float(-s),
            gaba_delta=float(s),
            endorphin_delta=0.0,
        ),
        gaba_target=gaba_target_key(bundle),
        foregone_gain_usdt=float(foregone_gain),
        prediction_error_z=float(z),
        source="hindsight_regret",
    )


def is_hindsight_regret_live() -> bool:
    """Feature flag. Default OFF — behaviour byte-identical when unset."""
    return os.environ.get("MONKEY_HINDSIGHT_REGRET_LIVE") == "true"


__all__ = [
    "HindsightNtDeltas",
    "CloseSenseBundle",
    "CounterfactualOutcome",
    "HindsightResult",
    "median_and_mad",
    "counterfactual_pnl_usdt",
    "is_continuation_legible",
    "legibility_strength",
    "is_eligible_for_regret",
    "derive_magnitude",
    "gaba_target_key",
    "resolve_hindsight",
    "is_hindsight_regret_live",
]
