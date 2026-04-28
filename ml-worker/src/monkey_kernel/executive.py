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

from dataclasses import dataclass
from typing import Any, Literal, Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .basin import max_mass, normalized_entropy
from .modes import MODE_PROFILES, MonkeyMode, effective_profile
from .parameters import get_registry
from .state import KAPPA_STAR, LaneType, NeurochemicalState

Side = Literal["long", "short"]


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


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


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
) -> dict[str, Any]:
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

    sized = margin if notional >= min_notional_usdt else 0.0

    return {
        "value": sized,
        "reason": (
            f"size = {'lifted-to-min ' if lifted else ''}"
            f"floor({exploration_floor:.3f}) or PhixSxM({base_frac:.3f}) "
            f"x reward({reward_mult:.2f}) x stab({stability_mult:.2f}) "
            f"x equity({available_equity_usdt:.2f}) @ {leverage:.0f}x "
            f"-> margin {margin:.2f}, notional {notional:.2f} vs min {min_notional_usdt:.2f} "
            f"= {sized:.2f}"
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
        },
    }


# ═══════════════════════════════════════════════════════════════
#  currentLeverage — κ-prox × regimeStab × surpDisc × flatMult
# ═══════════════════════════════════════════════════════════════


def current_leverage(
    s: ExecBasinState,
    *,
    max_leverage_boundary: float,
    mode: MonkeyMode = MonkeyMode.INVESTIGATION,
    tape_trend: float = 0.0,
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
    flat_mult = 1.0 + flatness_boost * flatness

    newborn = s.sovereignty < 0.1
    if newborn:
        raw_lev = sovereign_cap * 0.8
    else:
        raw_lev = sovereign_cap * kappa_proxim * regime_stability * surprise_discount * flat_mult

    lev = max(1, min(int(max_leverage_boundary), round(raw_lev)))

    return {
        "value": lev,
        "reason": (
            f"lev = sovcap({sovereign_cap:.1f}) x k-prox({kappa_proxim:.3f}) "
            f"x regstab({regime_stability:.2f}) x surp({surprise_discount:.2f}) "
            f"x flat({flat_mult:.2f}) -> {lev}x"
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
) -> dict[str, Any]:
    if notional_usdt <= 0:
        return {"value": False, "reason": "no position", "derivation": {}}

    current_frac = unrealized_pnl_usdt / notional_usdt
    peak_frac = max(peak_pnl_usdt, 0.0) / notional_usdt

    # v0.8.4b — harvest activation and giveback now fully DERIVE per P25.
    # ACTIVATION: baseline, discounted by dopamine (recent wins → harvest
    #   sooner), amplified by Φ (high integration → let winners run).
    #   Anchored at 0.003 when dopamine=0.5 AND Φ=0.5 (pre-derivation live).
    #   0.002 floor stays as SAFETY_BOUND — must always clear 2×fee.
    # GIVEBACK: emerges from serotonin (stability). High serotonin → keep
    #   a tighter trailing stop. Low serotonin → let more of peak slip
    #   before locking in.
    # TREND_FLIP: derives from norepinephrine — surprise makes her more
    #   sensitive to trend reversal. Anchored at -0.25 when NE=0.5.
    nc = s.neurochemistry
    phi_clipped = max(0.0, min(1.0, s.phi))
    activation = max(
        0.002,
        0.004 - 0.002 * nc.dopamine + 0.002 * (phi_clipped - 0.5),
    )
    giveback = 0.30 + 0.20 * (1 - nc.serotonin)
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
    if current_frac > 0 and alignment_now <= trend_flip_threshold and peak_frac >= activation:
        return {
            "value": True,
            "reason": (
                f"trend_flip_harvest: pnl +{current_frac*100:.3f}%, "
                f"tape flipped (align={alignment_now:.2f})"
            ),
            "derivation": {
                "current_frac": current_frac,
                "peak_frac": peak_frac,
                "alignment": alignment_now,
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
) -> dict[str, Any]:
    if notional_usdt <= 0:
        return {"value": False, "reason": "no position notional", "derivation": {}}

    pnl_frac = unrealized_pnl_usdt / notional_usdt
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
    # ~=0.0015 on Poloniex VIP0). 0.003 gives a ~15bp margin. SAFETY_BOUND;
    # the tp_base_frac + dopamine/Φ modulation sits on top of it.
    tp_min_floor = _registry.get(
        "executive.scalp.tp_min_floor", default=_DEFAULT_SCALP_TP_MIN_FLOOR,
    )
    tp_thr = max(tp_min_floor, profile.tp_base_frac - 0.003 * nc.dopamine + 0.005 * s.phi)
    sl_thr = tp_thr * profile.sl_ratio

    if pnl_frac >= tp_thr:
        return {
            "value": True,
            "reason": f"take_profit: {pnl_frac*100:.3f}% >= {tp_thr*100:.3f}%",
            "derivation": {
                "pnl_frac": pnl_frac, "tp_thr": tp_thr, "sl_thr": sl_thr,
                "exit_type_bit": 1,
            },
        }
    if pnl_frac <= -sl_thr:
        return {
            "value": True,
            "reason": f"stop_loss: {pnl_frac*100:.3f}% <= -{sl_thr*100:.3f}%",
            "derivation": {
                "pnl_frac": pnl_frac, "tp_thr": tp_thr, "sl_thr": sl_thr,
                "exit_type_bit": -1,
            },
        }
    return {
        "value": False,
        "reason": (
            f"scalp hold: pnl {pnl_frac*100:.3f}% in "
            f"[-{sl_thr*100:.3f}%, {tp_thr*100:.3f}%]"
        ),
        "derivation": {"pnl_frac": pnl_frac, "tp_thr": tp_thr, "sl_thr": sl_thr},
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
) -> dict[str, Any]:
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
            "reason": f"side mismatch ({side_candidate} vs held {held_side})",
            "derivation": {"rule": 1},
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
            f"DCA_OK: {price_delta*100:.2f}% from entry, "
            f"addCount={add_count}, sov={sovereignty:.2f}"
        ),
        "derivation": {
            "rule": 0,
            "price_delta": price_delta,
            "add_count": add_count,
            "sovereignty": sovereignty,
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
#  choose_lane — v0.8.6 decision-surface expansion (#586)
# ═══════════════════════════════════════════════════════════════
#
# Kernel selects its execution lane on each tick using a softmax over
# lane-specific geometric scores. At low Φ / low sovereignty the kernel
# defaults toward scalp (highest reward density per tick on small
# notional). At high Φ / stable regime it can exploit swing or trend.
#
# Temperature τ = 1 / max(κ, 1) — high κ = more exploitation (lower T),
# low κ = more exploration (higher T). Scores are basin-geometry-derived;
# lane-conditioned bank reward history is injected via
# `recent_reward_by_lane` when the resonance bank has enough data.
# Until #577/#578 wire dedicated executors the lane is EMITTED but
# execution routes through the existing swing path regardless of lane.
#
# QIG purity: all distances are Fisher-Rao, no cosine.


_ALL_LANES: list[LaneType] = ["scalp", "swing", "trend", "observe"]

# Geometric prior scores for each lane at nominal state (Φ=0.5, κ=κ*).
# These represent the base "attraction" of each lane before conditioning.
_LANE_BASE_SCORES: dict[str, float] = {
    "scalp": 0.30,   # high freq — preferred at low notional
    "swing": 0.40,   # intermediate hold — default prior
    "trend": 0.20,   # directional — needs stability / high Φ
    "observe": 0.10, # no-trade monitoring — floor score
}


def _lane_geometry_score(
    lane: LaneType,
    s: ExecBasinState,
    tape_trend: float,
) -> float:
    """Basin-geometry-conditioned score for a lane (unnormalised).

    Scalp score rises with: low basin_velocity (calm for scalping),
        low Φ (not yet integrated — stay nimble), low equity/sovereignty.
    Swing score rises with: moderate Φ, moderate velocity, low chaos.
    Trend score rises with: high Φ, strong tape_trend magnitude, high sovereignty.
    Observe score rises with: high basin_velocity (chaotic — sit out).

    Design invariants verified by test_lane_decision_surface.py:
      - phi=0, sov=0, bv=0  → scalp
      - phi=1, sov=1, tape=1 → trend
      - bv=10               → observe
    """
    phi = s.phi
    sov = s.sovereignty
    bv = s.basin_velocity
    # Normalised tape direction conviction (unsigned)
    tape_abs = min(1.0, abs(tape_trend))
    # Chaos: 0 at bv=0, 1 at bv≈0.33+
    chaos = min(1.0, bv * 3.0)
    # Velocity dampener for "hold" lanes (swing/scalp). At bv=10 → 0.
    calm = max(0.0, 1.0 - bv * 0.15)

    if lane == "scalp":
        # Prefer when: low Φ (nimble), low velocity (calm), low sovereignty (new)
        return _LANE_BASE_SCORES["scalp"] * (1.0 - phi * 0.4) * calm * (1.0 - sov * 0.3)
    if lane == "swing":
        # Prefer when: moderate Φ (some integration), low chaos
        phi_peak = 1.0 - abs(phi - 0.5) * 1.0  # peak at Φ = 0.5
        return _LANE_BASE_SCORES["swing"] * max(0.1, phi_peak) * (0.5 + sov * 0.5) * calm
    if lane == "trend":
        # Prefer when: high Φ, strong directional tape, high sovereignty.
        # (1 + phi*0.5) boosts trend at high Φ so it beats swing.
        return _LANE_BASE_SCORES["trend"] * phi * tape_abs * max(0.1, sov) * (1.0 + phi * 0.5)
    # observe — additive chaos term so very high velocity → observe dominates
    return _LANE_BASE_SCORES["observe"] + 0.40 * chaos


def choose_lane(
    s: ExecBasinState,
    *,
    tape_trend: float = 0.0,
    recent_reward_by_lane: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Softmax lane selector conditioned on basin coords + κ.

    Args:
        s: executive basin state snapshot.
        tape_trend: signed log-return proxy (tanh-squashed, [-1,1]).
        recent_reward_by_lane: optional dict mapping lane names to
            recent mean reward from the resonance bank (within-lane).
            When provided, scores are multiplied by a reward amplifier.
            If None, falls back to geometry-only scoring.

    Returns dict with keys:
        "value"      : LaneType chosen
        "reason"     : human-readable derivation string
        "derivation" : raw scores, softmax probs, temperature
    """
    # Temperature τ = 1/max(κ, 1). High κ → low T → exploitation.
    tau = 1.0 / max(s.kappa, 1.0)

    raw_scores: dict[str, float] = {}
    for lane in _ALL_LANES:
        geo = max(0.0, _lane_geometry_score(lane, s, tape_trend))
        if recent_reward_by_lane:
            reward = recent_reward_by_lane.get(lane, 0.0)
            # Reward amplifier: exp of reward scaled to [0.5, 2.0] range.
            reward_amp = max(0.5, min(2.0, 1.0 + reward))
        else:
            reward_amp = 1.0
        raw_scores[lane] = geo * reward_amp

    # Softmax with temperature τ.
    max_score = max(raw_scores.values())
    exp_scores = {
        lane: float(np.exp((score - max_score) / max(tau, 1e-9)))
        for lane, score in raw_scores.items()
    }
    total = sum(exp_scores.values())
    probs = {lane: v / total for lane, v in exp_scores.items()}

    chosen: LaneType = max(probs, key=lambda l: probs[l])  # type: ignore[assignment]

    return {
        "value": chosen,
        "reason": (
            f"lane={chosen} (τ={tau:.4f}) probs="
            + ", ".join(f"{l}:{p:.3f}" for l, p in probs.items())
        ),
        "derivation": {
            "tau": tau,
            "kappa": s.kappa,
            "phi": s.phi,
            "sovereignty": s.sovereignty,
            "basin_velocity": s.basin_velocity,
            "tape_abs": min(1.0, abs(tape_trend)),
            "raw_scores": raw_scores,
            "softmax_probs": probs,
            "chosen": chosen,
        },
    }
