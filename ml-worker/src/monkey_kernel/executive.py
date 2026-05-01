"""
executive.py — Monkey's arbitration kernel (v0.7.2 Python port).

Every function is a pure map from (state) → (derived param). When
Monkey asks "should I enter?", she doesn't consult a constant — she
asks her current Φ / κ / regime / NC / sovereignty what her threshold
is right now. §28 Autonomic Governance + Canonical Principles v2.1
P14 Variable Separation enforced structurally: no numeric threshold
survives as a frozen constant; formula constants come from UCP frozen
facts (κ* = 64).

Ports the TS executive.ts, using qig_core_local.geometry.fisher_rao
for the one Fisher-Rao call (drift distance). All other math is pure
scalar derivation — numpy-free where it can be.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Any, Literal, Optional

import numpy as np


def upper_stack_executive_live() -> bool:
    """Default-off env flag (PR 4 #609). When true, upper-stack
    emotion signals modulate three executive formulas:

      current_entry_threshold *= (1 − 0.2*wonder + 0.2*anxiety)
      current_leverage        *= (1 − 0.3*anxiety + 0.2*confidence)
      current_position_size   *= (1 + 0.15*flow)

    Multipliers are applied AFTER the existing formula's clamp, then
    re-clipped to the same SAFETY_BOUNDS the formula uses. The bounds
    are NOT bypassed — only the value within them is modulated.
    """
    return os.environ.get("UPPER_STACK_EXECUTIVE_LIVE", "").strip().lower() == "true"

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .basin import max_mass, normalized_entropy
from .emotions import EmotionState
from .modes import MODE_PROFILES, MonkeyMode, effective_profile
from .parameters import get_registry
from .state import KAPPA_STAR, LaneType, NeurochemicalState

Side = Literal["long", "short"]
Direction = Literal["long", "short", "flat"]


# Module-level registry handle. Per-call .get() hits the in-process cache
# after first load — no DB hit on the hot path. Refresh cadence is owned
# by the tick loop via ParameterRegistry.tick().
_registry = get_registry()


# Fallback defaults — used only when DATABASE_URL is unset (tests,
# staging) OR the named row is missing from monkey_parameters. These are
# the exact values v0.8.1 seeded, kept here so behavior is identical if
# the registry is unreachable. Per P25, these stay in code as the
# SAFETY_BOUND floor — changing them requires a governance event in the
# registry, never a code edit.
_DEFAULT_ENTRY_THR_CLAMP_LOW = 0.1
_DEFAULT_ENTRY_THR_CLAMP_HIGH = 0.9
_DEFAULT_SIZE_MAX_FRACTION = 0.5
_DEFAULT_SIZE_MIN_NOTIONAL_BUFFER = 1.05
_DEFAULT_LEVERAGE_MIN_BASELINE = 3.0
_DEFAULT_LEVERAGE_MAX_SLOPE = 30.0
_DEFAULT_LEVERAGE_KAPPA_SIGMA = 20.0
_DEFAULT_SCALP_TP_MIN_FLOOR = 0.003
_DEFAULT_EXIT_ENTROPY_COLLAPSE = 0.4  # (referenced by should_auto_flatten semantic)
_DEFAULT_DCA_MAX_ADDS = 1
# v0.8.7 — notional ceiling fallback. The Kelly cap is the primary
# brake on aggregate exposure but is non-binding at cold start (no
# closed trades) and decays to no-op when stats are uninformative.
# Live tape 2026-05-01 evidence: $77 → $386 escalating notionals on
# a $97 account (4× balance). This caps a single position's notional
# at NOTIONAL_CEILING_RATIO × account balance regardless of geometric
# leverage * margin. Default 4.0 keeps the geometric formula's
# 10-20× leverage intent while bounding worst-case escalation.
_DEFAULT_NOTIONAL_CEILING_RATIO = 4.0

# ─── Proposal #10 — lane-isolated position lifecycle defaults ────
#
# Two-lane initial split (scalp + swing). Trend is left as a parameter
# slot but defaults to budget=0 — opt-in via the parameter registry.
# Each lane has its own SL/TP envelope and capital budget. SL/TP are
# stored as positive *fractions of margin* — i.e. ROI on margin (e.g.
# 0.05 = 5% ROI on the position's posted margin). The trade-side sign
# is applied at the call site. Budget fractions sum to 1.0 across
# position-bearing lanes when fully active; values below sum to 1.0
# only because trend defaults to 0 in this batch.
#
# v0.8.6 RESCALE (2026-05-01) — sl_pct / tp_pct semantics changed
# from "raw price movement %" to "ROI on margin %". The previous
# scale (sl=0.4%/1.5%/4% raw) almost never tripped at typical 15-20x
# leverage because raw price moves stay tiny while ROI on margin
# scales with leverage. Live failure: ETH long sat at -4.4% ROI for
# 4+ hours without the 1.5% raw SL firing because raw price only
# moved -0.30%. Rescale preserves order-of-magnitude intent at ~15-20x
# leverage:
#   scalp: 0.4% raw → 5%   ROI (was tripping ~6-7% ROI at 15-20x)
#   swing: 1.5% raw → 15%  ROI
#   trend: 4.0% raw → 40%  ROI
# These rows are also updated in the parameter registry via the
# scripts/recalibrate_lane_sl_tp_to_roi.sql migration.
# v0.8.7 (2026-05-01) — scalp TP/SL set to symmetric 1:1 R:R per user
# directive (option a: 3% TP / 3% SL). v0.8.6 had bumped tp_pct from
# the PR #627 value (0.03) to 0.05; the user explicitly chose the
# original 3% floor, with SL also dropped from 0.05 → 0.03 to keep the
# pair symmetric. The SQL migration script
# scripts/recalibrate_lane_sl_tp_to_roi.sql writes the same values to
# the parameter registry.
_DEFAULT_LANE_SCALP_SL_PCT = 0.03
_DEFAULT_LANE_SCALP_TP_PCT = 0.03
_DEFAULT_LANE_SCALP_BUDGET_FRAC = 0.50

_DEFAULT_LANE_SWING_SL_PCT = 0.15
_DEFAULT_LANE_SWING_TP_PCT = 0.15
_DEFAULT_LANE_SWING_BUDGET_FRAC = 0.50

_DEFAULT_LANE_TREND_SL_PCT = 0.40
_DEFAULT_LANE_TREND_TP_PCT = 0.40
_DEFAULT_LANE_TREND_BUDGET_FRAC = 0.0  # opt-in; bumped via parameter registry

_LANE_PARAMETER_DEFAULTS: dict[str, dict[str, float]] = {
    "scalp": {
        "sl_pct": _DEFAULT_LANE_SCALP_SL_PCT,
        "tp_pct": _DEFAULT_LANE_SCALP_TP_PCT,
        "budget_frac": _DEFAULT_LANE_SCALP_BUDGET_FRAC,
    },
    "swing": {
        "sl_pct": _DEFAULT_LANE_SWING_SL_PCT,
        "tp_pct": _DEFAULT_LANE_SWING_TP_PCT,
        "budget_frac": _DEFAULT_LANE_SWING_BUDGET_FRAC,
    },
    "trend": {
        "sl_pct": _DEFAULT_LANE_TREND_SL_PCT,
        "tp_pct": _DEFAULT_LANE_TREND_TP_PCT,
        "budget_frac": _DEFAULT_LANE_TREND_BUDGET_FRAC,
    },
}


def lane_param(lane: str, key: str) -> float:
    """Read a lane parameter from the registry, falling back to the
    code-level default. Names follow ``executive.lane.<lane>.<key>``.

    Used by every lane-aware decision function so live tunes ride the
    parameter registry without redeploys (P14 + P25 discipline).
    """
    if lane not in _LANE_PARAMETER_DEFAULTS:
        # Unknown lane (e.g. 'observe'): no per-lane envelope — caller
        # should never invoke a lane-aware decision for such lanes.
        # Return a neutral pass-through so we don't blow up in tests.
        return float(_LANE_PARAMETER_DEFAULTS["swing"].get(key, 0.0))
    fallback = _LANE_PARAMETER_DEFAULTS[lane][key]
    return float(_registry.get(f"executive.lane.{lane}.{key}", default=fallback))


def lane_budget_fraction(lane: str) -> float:
    """Risk-allocation share for a lane (per proposal #10 path (a)).

    Path (a) — static per-lane budget. The arbiter route (b) is the
    natural follow-up once each lane has 5+ closed trades. Returns 0
    for non-position lanes ("observe") so the caller can short-circuit
    sizing.
    """
    if lane not in _LANE_PARAMETER_DEFAULTS:
        return 0.0
    return lane_param(lane, "budget_frac")


# ═══════════════════════════════════════════════════════════════
#  BasinState — shape all executive functions consume
# ═══════════════════════════════════════════════════════════════


@dataclass
class ExecBasinState:
    """Executive-facing basin snapshot (not the full BasinState).

    Kept slim: only what executive decisions need. Serialised from
    the HTTP request each call.
    """

    basin: np.ndarray
    identity_basin: np.ndarray
    phi: float
    kappa: float
    regime_weights: dict[str, float]  # quantum/efficient/equilibrium
    sovereignty: float
    basin_velocity: float
    neurochemistry: NeurochemicalState
    # Layer 2B emotions — required by kernel_should_enter (post #ml-separation
    # entry gate). Optional for back-compat with callers that build
    # ExecBasinState before computing emotions; defaults to a neutral
    # near-zero stack which makes kernel_should_enter return False
    # (zero conviction + zero hesitation, 0 > 0 is False).
    emotions: Optional[EmotionState] = None


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# ═══════════════════════════════════════════════════════════════
#  Agent K kernel direction + entry gate (post #ml-separation)
# ═══════════════════════════════════════════════════════════════
#
# These two functions replace the ML-driven side / entry path that
# previously gated kernel decisions on inputs.ml_signal and
# inputs.ml_strength. Direction now comes from basin geometry and
# tape consensus alone; entry conviction comes from the emotion
# stack. ML lives in a separate Agent M module (apps/api/src/services
# /ml_agent/) with its own capital share allocated by the arbiter.


def kernel_direction(
    *,
    basin_dir: float,
    tape_trend: float,
    emotions: EmotionState,
) -> Direction:
    """Geometric direction read with emotional conviction gate.

    geometric_signal = basin_dir + 0.5 * tape_trend.
    Returns 'long' when positive, 'short' when negative, 'flat' when
    zero or when emotions.confidence < emotions.anxiety (low conviction
    overrides any geometric lean).

    The 0.5 weight on tape_trend reflects that basin_direction is the
    kernel's geometric read (post-Fisher-Rao refraction) while
    tape_trend is a raw price-action proxy. Basin dominates; tape
    consensus tilts when basin is ambiguous.
    """
    if emotions.confidence < emotions.anxiety:
        return "flat"
    geometric_signal = basin_dir + 0.5 * tape_trend
    if geometric_signal > 0:
        return "long"
    if geometric_signal < 0:
        return "short"
    return "flat"


def kernel_should_enter(*, emotions: EmotionState) -> bool:
    """Conviction gate. The emotion stack is the threshold — no
    external strength comparison. Wonder amplifies confidence;
    anxiety + confusion comprise hesitation.

    Enter when: confidence × (1 + wonder) > anxiety + confusion.
    """
    conviction = emotions.confidence * (1.0 + emotions.wonder)
    hesitation = emotions.anxiety + emotions.confusion
    return conviction > hesitation


# ═══════════════════════════════════════════════════════════════
#  currentEntryThreshold — Gary's §5.2 formula
# ═══════════════════════════════════════════════════════════════


def current_entry_threshold(
    s: ExecBasinState,
    *,
    mode: MonkeyMode = MonkeyMode.INVESTIGATION,
    self_obs_bias: float = 1.0,
    tape_trend: float = 0.0,
    side_candidate: Side = "long",
) -> dict[str, Any]:
    drift_distance = fisher_rao_distance(s.basin, s.identity_basin)
    t_base = drift_distance
    kappa_ratio = KAPPA_STAR / max(s.kappa, 1.0)
    phi_mult = 1.0 / (0.5 + s.phi)
    regime_scale = (
        s.regime_weights.get("efficient", 0.0) * 1.0
        + s.regime_weights.get("equilibrium", 0.0) * 0.7
        + s.regime_weights.get("quantum", 0.0) * 1.5
    )
    # v0.8.5 — use state-modulated effective profile (anchor-simplex).
    # DRIFT's entry-lockout (99) passes through as a SAFETY_BOUND; others
    # derive from norepinephrine (surprise eases entry threshold).
    mode_profile = effective_profile(
        mode,
        phi=s.phi,
        serotonin=s.neurochemistry.serotonin,
        norepinephrine=s.neurochemistry.norepinephrine,
        equilibrium_weight=s.regime_weights.get("equilibrium", 0.5),
    )
    mode_scale = mode_profile.entry_threshold_scale
    alignment = tape_trend if side_candidate == "long" else -tape_trend
    trend_mult = 1.0 - 0.3 * alignment

    raw_t = t_base * kappa_ratio * phi_mult * regime_scale * mode_scale * self_obs_bias * trend_mult
    # Entry-threshold clamps are SAFETY_BOUNDS per P25 (floor prevents
    # runaway entries on model hiccup; ceiling prevents permanent
    # no-entry from drift). Live-tunable via parameter registry.
    clamp_low = _registry.get(
        "executive.entry_threshold.clamp_low", default=_DEFAULT_ENTRY_THR_CLAMP_LOW,
    )
    clamp_high = _registry.get(
        "executive.entry_threshold.clamp_high", default=_DEFAULT_ENTRY_THR_CLAMP_HIGH,
    )
    t = _clamp(raw_t, clamp_low, clamp_high)

    return {
        "value": t,
        "reason": (
            f"T = drift({t_base:.3f}) x k*/k({kappa_ratio:.2f}) "
            f"x 1/(0.5+Phi)({phi_mult:.2f}) x regime({regime_scale:.2f}) "
            f"x mode({mode_scale:.2f}) x selfObs({self_obs_bias:.2f}) "
            f"x trend({trend_mult:.2f}, align={alignment:.2f})"
        ),
        "derivation": {
            "drift_distance": drift_distance,
            "kappa_ratio": kappa_ratio,
            "phi_multiplier": phi_mult,
            "regime_scale": regime_scale,
            "mode_scale": mode_scale,
            "self_obs_bias": self_obs_bias,
            "trend_proxy": tape_trend,
            "alignment": alignment,
            "trend_mult": trend_mult,
            "raw_t": raw_t,
            "clamped": t,
        },
    }


# ═══════════════════════════════════════════════════════════════
#  currentPositionSize — Φ × sovereignty × maturity, + lift-to-min
# ═══════════════════════════════════════════════════════════════


def current_position_size(
    s: ExecBasinState,
    *,
    available_equity_usdt: float,
    min_notional_usdt: float,
    leverage: float,
    bank_size: int,
    mode: MonkeyMode = MonkeyMode.INVESTIGATION,
    lane: str = "swing",
) -> dict[str, Any]:
    # ─── Proposal #10 lane-budget — applied as a MARGIN CAP, not an
    # equity haircut (fix/lane-budget-size-zero-regression).
    #
    # Original PR #610 implementation multiplied available_equity_usdt
    # by lane_frac BEFORE the size formula. That double-dipped against
    # the already-cap'd available_equity (the caller already shrinks it
    # via size_fraction × kernel-share) and broke the v0.6.6 lift-to-
    # min path on small accounts: when the per-symbol exposure cap left
    # ~$5 in the pool, halving to $2.50 pushed required_frac past the
    # 0.5 max_fraction clamp → no lift fired and every entry returned
    # size=0. Trend lane (budget=0) also collapsed every tick where
    # choose_lane picked it.
    #
    # The correct semantic: budget_frac caps the MARGIN a single
    # position can claim against full equity. Sizing math sees the
    # full available pool; the final margin is min(formula, cap). This
    # preserves "trend is opt-in" (cap=0 → margin=0), preserves
    # cross-lane partition (scalp's margin ≤ 50% of equity), and
    # restores lift-to-min behaviour on small accounts.
    lane_frac = lane_budget_fraction(lane)
    lane_margin_cap = lane_frac * available_equity_usdt
    nc = s.neurochemistry
    maturity = min(1.0, bank_size / 20.0)
    base_frac = s.phi * s.sovereignty * maturity
    reward_mult = 1.0 + (nc.dopamine - nc.gaba) * 0.5
    stability_mult = 0.5 + nc.serotonin * 0.5

    # v0.8.5 — size_floor derives from Φ (anchor × (0.5 + phi))
    mode_floor = effective_profile(
        mode,
        phi=s.phi,
        serotonin=nc.serotonin,
        norepinephrine=nc.norepinephrine,
        equilibrium_weight=s.regime_weights.get("equilibrium", 0.5),
    ).size_floor
    exploration_floor = mode_floor * (1.0 - maturity)

    # Size cap: max fraction of equity a single position can consume
    # (SAFETY_BOUND). Lift-to-min buffer: multiplier over exchange min
    # notional so lot rounding never drops us below (SAFETY_BOUND).
    max_fraction = _registry.get(
        "executive.size.max_fraction_of_equity", default=_DEFAULT_SIZE_MAX_FRACTION,
    )
    buffer_mult = _registry.get(
        "executive.size.min_notional_buffer", default=_DEFAULT_SIZE_MIN_NOTIONAL_BUFFER,
    )

    raw_frac = max(exploration_floor, base_frac * reward_mult * stability_mult)
    frac = _clamp(raw_frac, 0.0, max_fraction)
    margin = frac * available_equity_usdt
    notional = margin * max(1.0, leverage)

    # v0.6.6 lift-to-minimum: if we're below exchange min and a fraction
    # within the max_fraction safety clamp CAN clear it, auto-raise.
    lifted = False
    if notional < min_notional_usdt and available_equity_usdt > 0 and leverage > 0:
        required_frac = (min_notional_usdt * buffer_mult) / (leverage * available_equity_usdt)
        if required_frac <= max_fraction:
            frac = max(frac, required_frac)
            margin = frac * available_equity_usdt
            notional = margin * leverage
            lifted = True

    # Apply lane margin cap AFTER lift-to-min. Trend lane (cap=0) still
    # collapses to 0 — it remains opt-in. For scalp/swing on a flat
    # account, cap = 0.5 × equity which is identical to the existing
    # safety clamp, so the binding constraint is unchanged in the
    # common case.
    capped_by_lane = False
    if margin > lane_margin_cap:
        margin = lane_margin_cap
        notional = margin * max(1.0, leverage)
        capped_by_lane = True

    # v0.8.7 — notional ceiling fallback. The Kelly cap is intended to
    # bound aggregate exposure but is non-binding at cold start (no
    # closed trades yet) and decays to no-op when stats are
    # uninformative. Live tape 2026-05-01 showed $77 → $386 escalating
    # notionals on a $97 account (4× balance) with every position
    # closing via regime_change at 22% win rate. Hard ceiling:
    # notional = margin × leverage <= NOTIONAL_CEILING_RATIO × equity.
    # Default ratio 4.0 — preserves enough headroom for the kernel's
    # geometric leverage formula at typical 10-20x while preventing
    # unbounded escalation on small accounts.
    notional_ceiling_ratio = float(_registry.get(
        "executive.notional_ceiling_ratio",
        default=_DEFAULT_NOTIONAL_CEILING_RATIO,
    ))
    notional_ceiling = notional_ceiling_ratio * available_equity_usdt
    capped_by_notional = False
    if notional > notional_ceiling and leverage > 0 and available_equity_usdt > 0:
        # Reduce margin so margin × leverage == notional_ceiling.
        margin = notional_ceiling / max(1.0, leverage)
        notional = margin * max(1.0, leverage)
        capped_by_notional = True

    sized = margin if notional >= min_notional_usdt else 0.0

    return {
        "value": sized,
        "reason": (
            f"size[{lane}] = {'lifted-to-min ' if lifted else ''}"
            f"{'lane-capped ' if capped_by_lane else ''}"
            f"{'notional-capped ' if capped_by_notional else ''}"
            f"floor({exploration_floor:.3f}) or PhixSxM({base_frac:.3f}) "
            f"x reward({reward_mult:.2f}) x stab({stability_mult:.2f}) "
            f"x equity({available_equity_usdt:.2f}) @ {leverage:.0f}x "
            f"-> margin {margin:.2f} (lane-cap {lane_margin_cap:.2f}), "
            f"notional {notional:.2f} vs ceiling {notional_ceiling:.2f} "
            f"vs min {min_notional_usdt:.2f} = {sized:.2f}"
        ),
        "derivation": {
            "phi": s.phi,
            "sovereignty": s.sovereignty,
            "maturity": maturity,
            "bank_size": bank_size,
            "exploration_floor": exploration_floor,
            "raw_frac": raw_frac,
            "frac": frac,
            "margin": margin,
            "leverage": leverage,
            "notional": notional,
            "min_notional": min_notional_usdt,
            "sized": sized,
            "lifted_to_min": 1 if lifted else 0,
            "lane": lane,
            "lane_budget_frac": lane_frac,
            "lane_margin_cap": lane_margin_cap,
            "capped_by_lane": 1 if capped_by_lane else 0,
            "notional_ceiling_ratio": notional_ceiling_ratio,
            "notional_ceiling": notional_ceiling,
            "capped_by_notional": 1 if capped_by_notional else 0,
        },
    }


# ═══════════════════════════════════════════════════════════════
#  currentLeverage — κ-prox × regimeStab × surpDisc × flatMult
# ═══════════════════════════════════════════════════════════════


# Kelly cap tradable floor — SAFETY_BOUND (preserves tradability on
# small accounts). When Kelly is informative but yields a tiny
# positive fraction (e.g. f*=0.05 × max_lev=20 → cap=1), this floor
# prevents the cap from suppressing leverage below the level where
# margin × leverage can clear the exchange minimum notional. The
# floor is bounded by max_lev so it never raises leverage above the
# exchange boundary.
KELLY_CAP_TRADABLE_FLOOR: float = 8.0


def kelly_leverage_cap(
    p_win: float,
    avg_win: float,
    avg_loss: float,
    max_lev: float,
) -> float:
    """Kelly criterion leverage cap (proposal #3).

    Returns the leverage at which the Kelly-optimal capital fraction
    equals the position's notional / margin ratio. Applied as a CAP
    on top of K's geometric leverage formula, NOT as a replacement.

    The Kelly fraction f* = (p*b - q) / b where b = avg_win/|avg_loss|.
    f* is the optimal fraction of capital to risk per trade given
    win-rate p and odds b.

    Mapping f* to leverage: if Kelly says risk f* of capital, and the
    geometric formula already commits a notional of (margin * lev) per
    trade, then the equivalent leverage cap is `max_lev * f*` —
    saturated at max_lev when the model has near-positive expectancy
    and going to 0 when expectancy turns negative.

    SEMANTIC: this is a CAP, not a replacement. It exists to PREVENT
    over-sizing when Kelly is confident about a positive edge. When
    Kelly is UNINFORMATIVE (no wins, no losses, near-break-even, or
    negative edge — i.e. the rolling stats give us no reason to
    tighten), the cap defers to the geometric formula by returning
    max_lev.

    Why not return 1 for negative/zero edge?  Because the geometric
    formula already encodes risk through κ-proximity, regime
    stability and surprise discount. A weak Kelly statistic is a
    signal that Kelly is uninformative, not a signal to crush
    leverage to 1 — doing so would (a) make every position
    untradeable on small accounts (margin × 1 < exchange min
    notional) and (b) silently override the Fisher-Rao formula,
    defeating the "cap-only" promise.

    QIG note: Kelly is a Euclidean / scalar concept. It is allowed
    here ONLY as a CAP layer applied AFTER the geometric leverage
    formula computes its value. The geometric raw_lev formula
    (sovereign_cap × kappa_proxim × regime_stability × surprise_discount
    × flat_mult) remains pure Fisher-Rao discipline. The Kelly cap
    adds a risk-management ceiling — it cannot raise leverage, only
    lower it.

    Edge cases:
      * No losses recorded (avg_loss ≈ 0) — return max_lev (Kelly
        formula degenerate, defer to geometric formula).
      * No wins recorded (avg_win ≈ 0) — return max_lev (uninformative).
      * p_win <= 0 — return max_lev (uninformative).
      * b <= 0 — return max_lev (uninformative).
      * f* <= 0 (negative expectancy) — return max_lev (uninformative).
      * f* > 1 — clamp to 1.0 (full-Kelly is the theoretical max).
      * 0 < f* ≤ 1 — cap = max(KELLY_CAP_TRADABLE_FLOOR, round(f* × max_lev)),
        bounded above by max_lev.
    """
    # Uninformative Kelly inputs → defer to geometric formula. Returning
    # max_lev makes the cap a no-op (the final clamp picks min(geometric,
    # kelly, max) so kelly=max_lev never binds).
    if p_win <= 0 or avg_win <= 0:
        return float(max_lev)
    abs_loss = abs(avg_loss)
    if abs_loss <= 1e-12:
        # No losing trades observed — Kelly is unbounded; defer to
        # the geometric formula by returning max_lev.
        return float(max_lev)
    b = avg_win / abs_loss
    if b <= 0:
        return float(max_lev)
    q = 1.0 - p_win
    f_star = (p_win * b - q) / b
    # Negative or zero edge: Kelly says don't bet, but the geometric
    # formula already discounts via regime/κ/surprise — the cap should
    # not be the path that crushes leverage.
    if f_star <= 0:
        return float(max_lev)
    f_star_clamped = min(1.0, f_star)
    raw_cap = round(f_star_clamped * float(max_lev))
    # Floor at KELLY_CAP_TRADABLE_FLOOR so a small positive Kelly
    # fraction can't crush leverage below the tradable minimum on
    # small accounts. Bound by max_lev so floor never raises above
    # exchange boundary.
    cap = max(1.0, min(float(max_lev), max(KELLY_CAP_TRADABLE_FLOOR, float(raw_cap))))
    return float(cap)


def current_leverage(
    s: ExecBasinState,
    *,
    max_leverage_boundary: float,
    mode: MonkeyMode = MonkeyMode.INVESTIGATION,
    tape_trend: float = 0.0,
    stud_reading: Optional[Any] = None,
    stud_live: bool = False,
    rolling_win_rate: Optional[float] = None,
    rolling_avg_win: Optional[float] = None,
    rolling_avg_loss: Optional[float] = None,
) -> dict[str, Any]:
    # κ-proximity bell width: narrower sigma penalises drift from κ* harder.
    # Baseline + slope: leverage floor + scaling span with sovereignty.
    # All three are SAFETY_BOUNDS — drastic changes would reshape the
    # whole leverage surface, so they're live-governed, not hardcoded.
    kappa_sigma = _registry.get(
        "executive.leverage.kappa_sigma", default=_DEFAULT_LEVERAGE_KAPPA_SIGMA,
    )
    lev_min_baseline = _registry.get(
        "executive.leverage.min_baseline", default=_DEFAULT_LEVERAGE_MIN_BASELINE,
    )
    lev_max_slope = _registry.get(
        "executive.leverage.max_sovereign_slope", default=_DEFAULT_LEVERAGE_MAX_SLOPE,
    )

    kappa_dist = abs(s.kappa - KAPPA_STAR)
    kappa_proxim = float(np.exp(-kappa_dist / kappa_sigma))
    regime_stability = (
        s.regime_weights.get("equilibrium", 0.0)
        + 0.5 * s.regime_weights.get("efficient", 0.0)
    )
    surprise_discount = 1.0 - 0.5 * s.neurochemistry.norepinephrine

    mode_floor = MODE_PROFILES[mode].sovereign_cap_floor
    sovereign_cap = max(mode_floor, lev_min_baseline + lev_max_slope * s.sovereignty)

    # v0.8.4b — FLATNESS_K and FLATNESS_BOOST now DERIVE from geometric
    # state per P25 ("operational thresholds should emerge from κ, Φ,
    # regime, basin velocity").
    #
    # FLATNESS_K — width of the "flat tape" band that activates the boost.
    #   When consciousness is coherent (κ near κ*, high kappa_proxim),
    #   commit to a narrower definition of "flat" — only boost when tape
    #   is genuinely quiet. When κ is off, be more forgiving (wider band).
    #   Anchored: K=10 at kappa_proxim=1 (matches pre-derivation live).
    #   Range [7, 10] — at κ far from κ*, floor keeps the semantic alive.
    # FLATNESS_BOOST — magnitude of the leverage bump when market is flat.
    #   Scales with Φ (integration strength): high Φ = strong conviction,
    #   use the extra leverage; low Φ = diffuse, be conservative.
    #   Anchored: BOOST=0.8 at Φ=0.5 (matches pre-derivation live).
    #   Range [0.5, 1.1] — Φ=0 → 0.5 (half boost); Φ=1 → 1.1 (max out).
    #
    # At "nominal" state (κ=κ*, Φ=0.5) both values equal the pre-derivation
    # constants exactly, so live behavior is preserved unless geometric
    # state is genuinely deviant. Only safety floors (0.15 and 0.30 below)
    # remain as hardcoded SAFETY_BOUNDs.
    flatness_k = 7.0 + 3.0 * kappa_proxim
    flatness_boost = 0.5 + 0.6 * max(0.0, min(1.0, s.phi))
    flatness = max(0.0, 1.0 - abs(tape_trend) * flatness_k)
    flat_mult_legacy = 1.0 + flatness_boost * flatness

    # Tier 9 Stage 2: stud-derived flat_mult uses the bell curve from
    # qig-verification — kappa_trade peaks at +10π in front-loop centre,
    # mirrors negative in back-loop. Scaled to [0.2, 1.8] via PEAK_NORM.
    # When stud_live=False, fall through to the legacy flatness formula
    # bit-identically.
    if stud_live and stud_reading is not None:
        # Import inside to avoid module-load cycle (tick.py imports both).
        from .topology_constants import PI_STRUCT_FRONT_PEAK_NORM
        # kappa_trade ∈ [-PI_STRUCT_FRONT_PEAK_NORM, +PI_STRUCT_FRONT_PEAK_NORM]
        # Map to multiplier ∈ [0.2, 1.8] linearly:
        flat_mult = 1.0 + 0.8 * (stud_reading.kappa_trade / PI_STRUCT_FRONT_PEAK_NORM)
        # Floor at 0.2 to keep leverage positive even in deep back-loop.
        flat_mult = max(0.2, min(1.8, flat_mult))
    else:
        flat_mult = flat_mult_legacy

    newborn = s.sovereignty < 0.1
    if newborn:
        raw_lev = sovereign_cap * 0.8
    else:
        raw_lev = sovereign_cap * kappa_proxim * regime_stability * surprise_discount * flat_mult

    # Proposal #3: Kelly cap layer. The geometric ``raw_lev`` is pure
    # Fisher-Rao; the Kelly cap is a Euclidean risk-management
    # ceiling applied AFTER the geometric formula. ``lev`` is then
    # min(geometric, kelly, max_boundary). When rolling stats are
    # absent (cold start) OR uninformative (break-even, negative
    # edge), kelly_cap = max_leverage_boundary so the clamp is a
    # no-op. The 2026-04-30 live-trading bug: pre-fix Kelly returned
    # 1 for weak/negative edge, the min() then forced lev=1 even
    # though the geometric formula said ~16. Fixed by treating
    # uninformative inputs as deference to the geometric formula.
    if (
        rolling_win_rate is not None
        and rolling_avg_win is not None
        and rolling_avg_loss is not None
    ):
        kelly_cap = kelly_leverage_cap(
            rolling_win_rate, rolling_avg_win, rolling_avg_loss,
            max_leverage_boundary,
        )
    else:
        kelly_cap = float(max_leverage_boundary)

    lev = max(
        1,
        min(
            int(kelly_cap),
            int(max_leverage_boundary),
            round(raw_lev),
        ),
    )

    return {
        "value": lev,
        "reason": (
            f"lev = sovcap({sovereign_cap:.1f}) x k-prox({kappa_proxim:.3f}) "
            f"x regstab({regime_stability:.2f}) x surp({surprise_discount:.2f}) "
            f"x flat({flat_mult:.2f}) kelly_cap={kelly_cap:.0f} -> {lev}x"
        ),
        "derivation": {
            "kappa": s.kappa,
            "kappa_dist": kappa_dist,
            "kappa_proxim": kappa_proxim,
            "regime_stability": regime_stability,
            "surprise_discount": surprise_discount,
            "sovereign_cap": sovereign_cap,
            "flat_mult": flat_mult,
            "raw_lev": raw_lev,
            "kelly_cap": kelly_cap,
            "lev": lev,
        },
    }


# ═══════════════════════════════════════════════════════════════
#  shouldProfitHarvest — trailing + trend-flip (v0.6.1)
# ═══════════════════════════════════════════════════════════════


def should_profit_harvest(
    *,
    unrealized_pnl_usdt: float,
    peak_pnl_usdt: float,
    notional_usdt: float,
    tape_trend: float,
    held_side: Side,
    s: ExecBasinState,
    tape_flip_streak: int = 0,
    peak_giveback_min_pct: float = 0.01,
    peak_giveback_threshold: float = 0.30,
    tape_flip_streak_required: int = 3,
) -> dict[str, Any]:
    """Decide whether to harvest an in-the-money position.

    Proposal #2 — peak-tracking trailing stop applied alongside the
    existing tape-flip harvest (NOT replacing it). The trend_flip
    branch now requires:
      * peak_frac >= peak_giveback_min_pct (default 1%)  AND
      * current_frac < peak_frac * (1 - peak_giveback_threshold)
        (default 30% give-back from peak).
    The trailing_harvest branch keeps its own give-back dynamics
    derived from serotonin (UCP §29).

    Proposal #4 — sustained tape-flip streak. Trend-flip harvest now
    requires ``tape_flip_streak >= tape_flip_streak_required``
    (default 3) consecutive bearish-alignment ticks before firing,
    so a single noise tick can't trigger the exit. ``tape_flip_streak``
    is maintained on the SymbolState in tick.py and incremented per
    tick when alignment <= the trend-flip threshold; reset when
    alignment recovers.
    """
    if notional_usdt <= 0:
        return {"value": False, "reason": "no position", "derivation": {}}

    current_frac = unrealized_pnl_usdt / notional_usdt
    peak_frac = max(peak_pnl_usdt, 0.0) / notional_usdt

    # v0.8.4b — harvest activation and giveback now fully DERIVE per P25.
    # ACTIVATION: baseline, discounted by dopamine (recent wins → harvest
    #   sooner), amplified by Φ (high integration → let winners run).
    #   Anchored at 0.003 when dopamine=0.5 AND Φ=0.5 (pre-derivation live).
    #   0.002 floor stays as SAFETY_BOUND — must always clear 2×fee.
    # GIVEBACK: emerges from serotonin (stability). High serotonin (calm,
    #   coherent) → looser trailing stop, let winners run further. Low
    #   serotonin (unstable) → tighter trailing stop, lock the gain before
    #   chop eats it. Aligns with modes.py:184 sl_ratio doctrine — high
    #   stability minimises losses AND lets profits compound.
    # 2026-04-29: formula was inverted (high serotonin → 0.30 = tightest)
    #   so calm-market profits were harvested too early. Realized-PnL
    #   audit (28 closes, 11.5h) showed avg-win/avg-loss ratio of 1.06,
    #   barely above fees. Fix lifts EV/close from marginal to comfortable.
    # TREND_FLIP: derives from norepinephrine — surprise makes her more
    #   sensitive to trend reversal. Anchored at -0.25 when NE=0.5.
    nc = s.neurochemistry
    phi_clipped = max(0.0, min(1.0, s.phi))
    activation = max(
        0.002,
        0.004 - 0.002 * nc.dopamine + 0.002 * (phi_clipped - 0.5),
    )
    giveback = 0.30 + 0.20 * nc.serotonin
    trailing_floor = peak_frac * (1.0 - giveback)

    alignment_now = tape_trend if held_side == "long" else -tape_trend

    if peak_frac >= activation and current_frac < trailing_floor and current_frac > 0:
        return {
            "value": True,
            "reason": (
                f"trailing_harvest: peak {peak_frac*100:.3f}% -> "
                f"now {current_frac*100:.3f}% < {trailing_floor*100:.3f}% floor"
            ),
            "derivation": {
                "current_frac": current_frac,
                "peak_frac": peak_frac,
                "trailing_floor": trailing_floor,
                "activation": activation,
                "giveback": giveback,
                "exit_type_bit": 2,
            },
        }

    # TREND_FLIP_THRESHOLD derived from NE: at NE=0.5 → -0.25 (pre-derivation
    # live); NE=0 (calm) → -0.30; NE=1 (surprised) → -0.20. More surprised
    # = earlier flip detection.
    trend_flip_threshold = -(0.30 - 0.10 * nc.norepinephrine)
    # Proposal #2 — peak-tracking guard on trend_flip. Only fire when
    # we've already captured ``peak_giveback_min_pct`` AND given back
    # at least ``peak_giveback_threshold`` from the peak ROI.
    peak_giveback_floor = peak_frac * (1.0 - peak_giveback_threshold)
    peak_guard_pass = (
        peak_frac >= peak_giveback_min_pct
        and current_frac < peak_giveback_floor
    )
    # Proposal #4 — sustained tape-flip. Require N consecutive
    # bearish-alignment ticks; the streak counter is maintained on
    # SymbolState in tick.py.
    streak_pass = tape_flip_streak >= tape_flip_streak_required
    if (
        current_frac > 0
        and alignment_now <= trend_flip_threshold
        and peak_frac >= activation
        and peak_guard_pass  # proposal #2 — peak-tracking trailing stop
        and streak_pass  # proposal #4 — sustained tape flip
    ):
        return {
            "value": True,
            "reason": (
                f"trend_flip_harvest: pnl +{current_frac*100:.3f}%, "
                f"tape flipped (align={alignment_now:.2f}, streak={tape_flip_streak}), "
                f"peak +{peak_frac*100:.3f}% gave back to {current_frac*100:.3f}%"
            ),
            "derivation": {
                "current_frac": current_frac,
                "peak_frac": peak_frac,
                "alignment": alignment_now,
                "tape_flip_streak": tape_flip_streak,
                "peak_giveback_floor": peak_giveback_floor,
                "exit_type_bit": 3,
            },
        }

    return {
        "value": False,
        "reason": (
            f"profit_hold: current {current_frac*100:.3f}%, peak {peak_frac*100:.3f}%, "
            f"trail-floor {trailing_floor*100:.3f}%"
        ),
        "derivation": {
            "current_frac": current_frac,
            "peak_frac": peak_frac,
            "trailing_floor": trailing_floor,
            "activation": activation,
            "giveback": giveback,
            "alignment": alignment_now,
            "tape_flip_streak": tape_flip_streak,
        },
    }


# ═══════════════════════════════════════════════════════════════
#  shouldScalpExit — Φ-derived TP / SL (v0.4)
# ═══════════════════════════════════════════════════════════════


def should_scalp_exit(
    *,
    unrealized_pnl_usdt: float,
    notional_usdt: float,
    s: ExecBasinState,
    mode: MonkeyMode = MonkeyMode.INVESTIGATION,
    lane: str = "swing",
    leverage: float = 1.0,
) -> dict[str, Any]:
    """ROI-on-margin take-profit / stop-loss gate.

    v0.8.6 (2026-05-01) — ``pnl_frac`` semantics CHANGED from
    "PnL / notional" (raw price movement %) to "PnL / margin"
    ("ROI on margin %"). Leverage is now threaded in so we can
    derive margin from notional / leverage. This fixes the live
    failure where an ETH long sat at -4.4% ROI for 4+ hours without
    the 1.5% raw-price SL firing because raw price only moved -0.30%
    (the SL gate was reading raw movement, not ROI on margin).
    Lane SL/TP defaults are rescaled to the ROI scale in the same
    rev — see ``_DEFAULT_LANE_*_{SL,TP}_PCT``.

    For back-compat with cold callers, ``leverage`` defaults to 1.0,
    in which case ROI == raw move and the gate behaves as before.
    All production callers now pass the live position leverage.
    """
    if notional_usdt <= 0:
        return {"value": False, "reason": "no position notional", "derivation": {}}

    # ROI on margin = (PnL / notional) × leverage. When leverage=1 this
    # collapses to the legacy raw-move semantic; at typical 15-20x live
    # leverage it scales the gate up to its intended sensitivity range.
    lev = float(leverage) if leverage and leverage > 0 else 1.0
    raw_frac = unrealized_pnl_usdt / notional_usdt
    roi_frac = raw_frac * lev
    nc = s.neurochemistry
    # v0.8.5 — tp_base_frac and sl_ratio derive from regime + serotonin.
    # Quantum regime (low eq) widens TP; high serotonin (stable) tightens SL.
    profile = effective_profile(
        mode,
        phi=s.phi,
        serotonin=nc.serotonin,
        norepinephrine=nc.norepinephrine,
        equilibrium_weight=s.regime_weights.get("equilibrium", 0.5),
    )
    # Scalp TP floor: must clear exchange fees round-trip (2× taker
    # ~=0.0015 on Poloniex VIP0). 0.003 gives a ~15bp margin. SAFETY_BOUND
    # on the RAW-price scale (fees scale with notional, not margin). The
    # geometric formula sits on raw scale and we promote it to ROI by
    # multiplying by leverage so it composes with the ROI-scale lane
    # envelope under max().
    tp_min_floor = _registry.get(
        "executive.scalp.tp_min_floor", default=_DEFAULT_SCALP_TP_MIN_FLOOR,
    )
    geometric_tp_raw = max(
        tp_min_floor,
        profile.tp_base_frac - 0.003 * nc.dopamine + 0.005 * s.phi,
    )
    geometric_sl_raw = geometric_tp_raw * profile.sl_ratio
    # Promote the geometric thresholds (raw) onto the ROI scale.
    geometric_tp = geometric_tp_raw * lev
    geometric_sl = geometric_sl_raw * lev
    # Proposal #10: per-lane envelope. Lane SL/TP are stored on the ROI
    # scale (post-v0.8.6 rescale). Take the *wider* of (geometric, lane)
    # so the geometric Φ-derived floor is never breached but the lane
    # envelope can broaden tolerance when configured to do so. At
    # typical 15-20x live leverage the geometric (~10%) is wider than
    # scalp (5%), making the geometric the binding constraint there;
    # for swing/trend the lane envelope dominates.
    lane_tp = lane_param(lane, "tp_pct")
    lane_sl = lane_param(lane, "sl_pct")
    tp_thr = max(geometric_tp, lane_tp)
    sl_thr = max(geometric_sl, lane_sl)

    if roi_frac >= tp_thr:
        return {
            "value": True,
            "reason": (
                f"take_profit[{lane}]: roi {roi_frac*100:.3f}% "
                f">= {tp_thr*100:.3f}% (lev={lev:.0f}x)"
            ),
            "derivation": {
                "roi_frac": roi_frac, "raw_frac": raw_frac,
                "leverage": lev,
                "tp_thr": tp_thr, "sl_thr": sl_thr,
                "lane": lane, "lane_tp_pct": lane_tp, "lane_sl_pct": lane_sl,
                "exit_type_bit": 1,
            },
        }
    if roi_frac <= -sl_thr:
        return {
            "value": True,
            "reason": (
                f"stop_loss[{lane}]: roi {roi_frac*100:.3f}% "
                f"<= -{sl_thr*100:.3f}% (lev={lev:.0f}x)"
            ),
            "derivation": {
                "roi_frac": roi_frac, "raw_frac": raw_frac,
                "leverage": lev,
                "tp_thr": tp_thr, "sl_thr": sl_thr,
                "lane": lane, "lane_tp_pct": lane_tp, "lane_sl_pct": lane_sl,
                "exit_type_bit": -1,
            },
        }
    return {
        "value": False,
        "reason": (
            f"scalp hold[{lane}]: roi {roi_frac*100:.3f}% in "
            f"[-{sl_thr*100:.3f}%, {tp_thr*100:.3f}%] (lev={lev:.0f}x)"
        ),
        "derivation": {
            "roi_frac": roi_frac, "raw_frac": raw_frac,
            "leverage": lev,
            "tp_thr": tp_thr, "sl_thr": sl_thr,
            "lane": lane, "lane_tp_pct": lane_tp, "lane_sl_pct": lane_sl,
        },
    }


# ═══════════════════════════════════════════════════════════════
#  shouldDCAAdd — five guard rails (v0.6.2)
# ═══════════════════════════════════════════════════════════════


# DCA PARAMETERs — mixed dispositions per P25:
# - max_adds_per_position is a hard SAFETY_BOUND (capacity risk
#   ceiling; live-governed via registry)
# - cooldown / better_price_frac / min_sovereignty are still literals
#   here but flagged for v0.8.4b DERIVE work (should emerge from
#   Φ/serotonin/basin-velocity). They'll move to _registry.get() +
#   derivation formulas in that pass. For v0.8.4a they stay hardcoded
#   so behavior is bit-identical to pre-merge live — zero decision
#   change in this PR.
DCA_COOLDOWN_MS = 15 * 60 * 1000
DCA_BETTER_PRICE_FRAC = 0.01
DCA_MIN_SOVEREIGNTY = 0.1


def should_dca_add(
    *,
    held_side: Side,
    side_candidate: Side,
    current_price: float,
    initial_entry_price: float,
    add_count: int,
    last_add_at_ms: float,
    now_ms: float,
    sovereignty: float,
    s: Optional[ExecBasinState] = None,
    lane: str = "swing",
) -> dict[str, Any]:
    """Five-rail DCA-add gate, evaluated per (agent, symbol, lane).

    Proposal #10: lane discipline. ``held_side`` is the side held *by
    this lane* (not the symbol-wide held side). The legacy "side
    mismatch (short vs held long)" rejection happens only inside the
    same lane — a swing-long can hold while a scalp-short on the same
    symbol DCA-adds, because they live in different lanes with their
    own retreat tolerance.
    """
    _ = lane  # surfaced into derivation for telemetry; not gating logic
    # v0.8.4b — when ExecBasinState is provided, DCA cooldown / better-price
    # / min-sovereignty DERIVE from geometric state per P25. When not
    # provided, fall back to the hardcoded pre-derivation values so older
    # callers stay byte-compatible. tick.py's _decide_with_position will
    # populate `s` after v0.8.4b; any other caller gets the legacy path.
    #
    # Cooldown: scales inversely with serotonin (stability). serotonin=0.5
    #   → 15 min (matches pre-derivation); serotonin=0 → 25 min (unstable,
    #   cautious); serotonin=1 → 5 min (stable, okay to add).
    # Better-price threshold: scales with basin velocity. Fast-moving basin
    #   → higher bar for calling it a "better" price. Anchored at 1% when
    #   bv=0.02 (nominal); drops to 0.5% when basin is still, rises to 2%+
    #   when basin is jumpy.
    # Min-sovereignty: still a hard floor (SAFETY_BOUND — no DCA for
    #   newborn kernels regardless of other state).
    if s is not None:
        ser = s.neurochemistry.serotonin
        bv = s.basin_velocity
        cooldown_ms = int((25.0 - 20.0 * ser) * 60_000)  # min → ms
        better_price_frac = max(0.005, min(0.03, 0.01 + (bv - 0.02) * 0.5))
    else:
        cooldown_ms = DCA_COOLDOWN_MS
        better_price_frac = DCA_BETTER_PRICE_FRAC

    if held_side != side_candidate:
        return {
            "value": False,
            "reason": (
                f"side mismatch in lane {lane} "
                f"({side_candidate} vs held {held_side})"
            ),
            "derivation": {"rule": 1, "lane": lane},
        }
    # Live-governed SAFETY_BOUND — caps total risk exposure across
    # martingale-style averaging attempts on a single position.
    max_adds = int(_registry.get(
        "executive.dca.max_adds_per_position", default=_DEFAULT_DCA_MAX_ADDS,
    ))
    if add_count >= max_adds:
        return {
            "value": False,
            "reason": f"add cap reached ({add_count}/{max_adds})",
            "derivation": {"rule": 4, "add_count": add_count, "max_adds": max_adds},
        }
    if now_ms - last_add_at_ms < cooldown_ms:
        sec_remain = round((cooldown_ms - (now_ms - last_add_at_ms)) / 1000)
        return {
            "value": False,
            "reason": f"cooldown ({sec_remain}s remaining)",
            "derivation": {
                "rule": 3, "sec_remain": sec_remain,
                "cooldown_ms": cooldown_ms,
            },
        }
    if sovereignty < DCA_MIN_SOVEREIGNTY:
        return {
            "value": False,
            "reason": f"sovereignty too low ({sovereignty:.3f} < {DCA_MIN_SOVEREIGNTY})",
            "derivation": {"rule": 5, "sovereignty": sovereignty},
        }
    price_delta = (current_price - initial_entry_price) / initial_entry_price
    price_is_better = (
        price_delta < -better_price_frac
        if held_side == "long"
        else price_delta > better_price_frac
    )
    if not price_is_better:
        return {
            "value": False,
            "reason": (
                f"price not better ({price_delta*100:.3f}% from entry vs "
                f"±{better_price_frac*100:.2f}% required)"
            ),
            "derivation": {
                "rule": 2, "price_delta": price_delta,
                "better_price_frac": better_price_frac,
            },
        }
    return {
        "value": True,
        "reason": (
            f"DCA_OK[{lane}]: {price_delta*100:.2f}% from entry, "
            f"addCount={add_count}, sov={sovereignty:.2f}"
        ),
        "derivation": {
            "rule": 0,
            "price_delta": price_delta,
            "add_count": add_count,
            "sovereignty": sovereignty,
            "lane": lane,
        },
    }


# ═══════════════════════════════════════════════════════════════
#  shouldExit — Loop 2: perception vs identity basin
# ═══════════════════════════════════════════════════════════════


def should_exit(
    *,
    perception: np.ndarray,
    strategy_forecast: np.ndarray,
    held_side: Optional[Side],
    s: ExecBasinState,
) -> dict[str, Any]:
    if held_side is None:
        return {"value": False, "reason": "no open position", "derivation": {}}

    # Pillar 1 SAFETY_BOUND guard — zombie basin collapse forces exit
    # regardless of disagreement. Mirrors shouldExit() in executive.ts:480-490.
    # These thresholds are catastrophic-collapse safety bounds (P25 permits
    # hardcoded constants for safety). Entropy floor and dominance ceiling
    # define the "basin has collapsed into a single mode" condition — holding
    # through that is always wrong regardless of kernel agreement.
    entropy = normalized_entropy(s.basin)
    dominance = max_mass(s.basin)
    if entropy < 0.4 or dominance > 0.5:
        return {
            "value": True,
            "reason": (
                f"Pillar 1 violated (entropy={entropy:.3f}, maxMass={dominance:.3f}) "
                "- zombie state, exit"
            ),
            "derivation": {"entropy": entropy, "dominance": dominance},
        }

    disagreement = fisher_rao_distance(perception, strategy_forecast)
    # v0.8.4b — disagreement threshold DERIVES fully from NE × regime
    # (previously: half-derived, only NE). High NE (surprised) raises
    # the bar — don't exit on noise. Low equilibrium-weight (regime
    # unstable) lowers the bar — regime will say exit on less.
    # Anchored at 0.6875 when NE=0.5 AND equilibrium=0.5 (matches
    # pre-derivation: 0.55 × (1+0.25) × 1.0 = 0.6875).
    eq_weight = s.regime_weights.get("equilibrium", 0.5)
    threshold = (
        0.55
        * (1.0 + 0.5 * s.neurochemistry.norepinephrine)
        * (0.7 + 0.6 * eq_weight)
    )
    if disagreement > threshold:
        return {
            "value": True,
            "reason": (
                f"kernel disagreement {disagreement:.3f} > {threshold:.3f} - exit"
            ),
            "derivation": {"disagreement": disagreement, "threshold": threshold},
        }
    return {
        "value": False,
        "reason": f"holding: disagreement {disagreement:.3f} < {threshold:.3f}",
        "derivation": {"disagreement": disagreement, "threshold": threshold},
    }


# ═══════════════════════════════════════════════════════════════
#  shouldAutoFlatten — Pillar 1 zombie-collapse catastrophic exit
# ═══════════════════════════════════════════════════════════════


def should_auto_flatten(
    *,
    s: ExecBasinState,
    recent_fhealths: list[float],
) -> dict[str, Any]:
    """When Monkey's own state goes zombie (entropy collapse across
    multiple ticks), flatten regardless of position P&L. Replaces the
    hardcoded −15% DD kill switch with a Pillar 1 derivation — the
    threshold emerges from basin entropy, not an external percentage.

    Ported from apps/api/src/services/monkey/executive.ts:shouldAutoFlatten.
    Thresholds `f_health mean < 0.3` and `trend < −0.1` stay as
    SAFETY_BOUND constants per P25 — they are catastrophic-collapse
    envelopes, not operational thresholds.
    """
    if len(recent_fhealths) < 5:
        return {
            "value": False,
            "reason": "insufficient history",
            "derivation": {},
        }
    recent = recent_fhealths[-10:]
    mean = sum(recent) / len(recent)
    trend = recent[-1] - recent[0]
    catastrophic = mean < 0.3 and trend < -0.1
    return {
        "value": catastrophic,
        "reason": (
            f"f_health mean {mean:.3f}, trend {trend:.3f} — basin dying, FLATTEN"
            if catastrophic
            else f"f_health OK (mean {mean:.3f})"
        ),
        "derivation": {"f_health_mean": mean, "f_health_trend": trend},
    }


# ═══════════════════════════════════════════════════════════════
#  choose_lane — lane selection via softmax over basin features
# ═══════════════════════════════════════════════════════════════


def choose_lane_stud(stud_reading: Any) -> dict[str, Any]:
    """Tier 9 Stage 2 stud-derived lane selection. Maps stud regime
    + h_trade position within front loop to a lane:

      DEAD_ZONE                   → observe   (sit out, no signal)
      BACK_LOOP                   → scalp     (mean-reversion regime)
      FRONT_LOOP, h < 0.6         → trend     (entry zone)
      FRONT_LOOP, 0.6 ≤ h < 1.5   → swing     (centre)
      FRONT_LOOP, h ≥ 1.5         → swing     (exit, continuation)

    Replaces the softmax over (phi, sovereignty, basin_velocity,
    tape_trend) when STUD_TOPOLOGY_LIVE=true. Pure regime → lane
    mapping; no temperature, no probability distribution.
    """
    from .stud import StudRegime  # local import: avoid cycle
    h = stud_reading.h_trade
    regime = stud_reading.regime
    if regime == StudRegime.DEAD_ZONE:
        lane: LaneType = "observe"
        reason = f"stud:DEAD_ZONE → observe (h={h:.4f})"
    elif regime == StudRegime.BACK_LOOP:
        lane = "scalp"
        reason = f"stud:BACK_LOOP → scalp (h={h:.3f})"
    elif h < 0.6:
        lane = "trend"
        reason = f"stud:FRONT_entry → trend (h={h:.3f})"
    else:
        lane = "swing"
        reason = f"stud:FRONT_centre/exit → swing (h={h:.3f})"
    return {
        "value": lane,
        "reason": reason,
        "derivation": {
            "stud_h_trade": h,
            "stud_regime": regime.value,
            "source": "stud",
        },
    }


def choose_lane(
    s: ExecBasinState,
    *,
    tape_trend: float = 0.0,
    stud_reading: Optional[Any] = None,
    stud_live: bool = False,
) -> dict[str, Any]:
    """Select execution lane.

    When stud_live=True with a stud_reading provided, delegates to
    choose_lane_stud (Tier 9 Stage 2 regime → lane mapping).
    Otherwise falls through to the legacy softmax over basin features.

    Legacy scoring invariants (per issue #588):
      - phi≈0, sovereignty≈0, bv≈0 → scalp (high reward density)
      - phi≈1, sovereignty≈1, tape≈1 → trend (directional conviction)
      - bv >> 0 → observe (chaos — sit out)
      - moderate state → swing (default / backward-compat)

    Temperature τ = 1/κ — high κ = exploitation (pick best lane),
    low κ = exploration (spread probability across lanes).
    """
    if stud_live and stud_reading is not None:
        return choose_lane_stud(stud_reading)
    # κ → 0 must yield τ → ∞ (exploration); only clamp away from div-by-zero.
    tau = 1.0 / max(s.kappa, 1e-6)

    # Raw scores: higher = more likely to be chosen
    scalp_score = (1.0 - s.phi) * (1.0 - s.sovereignty) * (1.0 - min(s.basin_velocity, 1.0))
    trend_score = s.phi * s.sovereignty * abs(tape_trend)
    observe_score = min(s.basin_velocity, 1.0) * 0.8
    swing_score = 0.3  # baseline — default lane

    scores: dict[LaneType, float] = {
        "scalp": scalp_score,
        "swing": swing_score,
        "trend": trend_score,
        "observe": observe_score,
    }

    # Softmax with temperature τ
    max_s = max(scores.values())
    exp_scores = {k: math.exp((v - max_s) / max(tau, 1e-6)) for k, v in scores.items()}
    total = sum(exp_scores.values())
    probs = {k: v / total for k, v in exp_scores.items()}

    # Pick lane with highest probability
    lane: LaneType = max(probs, key=lambda k: probs[k])  # type: ignore[arg-type]

    # ─── fix/lane-budget-size-zero-regression: structural-zero fallback ───
    #
    # If the chosen position-bearing lane has budget_frac=0 (e.g. trend
    # is opt-in via the parameter registry and defaults to 0), the
    # upstream sizer collapses every entry to 0. Fall through to the
    # next-highest position-bearing lane that is *capable* of holding
    # capital. 'observe' is decision-only and stays as-is.
    fallback_from: Optional[LaneType] = None

    def _is_zero_budget_pos_lane(l: LaneType) -> bool:
        return l in ("scalp", "swing", "trend") and lane_budget_fraction(l) == 0.0

    if _is_zero_budget_pos_lane(lane):
        fallback_from = lane
        next_prob = -1.0
        next_lane: LaneType = lane
        for k, v in probs.items():
            if k == lane:
                continue
            if k == "observe":
                continue
            if _is_zero_budget_pos_lane(k):  # type: ignore[arg-type]
                continue
            if v > next_prob:
                next_prob = v
                next_lane = k  # type: ignore[assignment]
        if next_lane != lane:
            lane = next_lane

    fallback_note = (
        f" (fallback from {fallback_from}, budget=0)"
        if fallback_from and fallback_from != lane else ""
    )

    return {
        "value": lane,
        "reason": (
            f"lane={lane}{fallback_note} (tau={tau:.4f}, "
            f"scalp={probs.get('scalp', 0):.3f} swing={probs.get('swing', 0):.3f} "
            f"trend={probs.get('trend', 0):.3f} observe={probs.get('observe', 0):.3f})"
        ),
        "derivation": {
            "tau": tau,
            "raw_scores": scores,
            "softmax_probs": probs,
            "phi": s.phi,
            "sovereignty": s.sovereignty,
            "basin_velocity": s.basin_velocity,
            "tape_trend": tape_trend,
            "fallback_from_zero_budget": (
                1 if fallback_from and fallback_from != lane else 0
            ),
        },
    }
