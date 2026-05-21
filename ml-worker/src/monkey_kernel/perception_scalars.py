"""
perception_scalars.py — signed scalars read from basin + tape (v0.7.2).

These are NOT perception kernel internals — just the two scalar signals
the executive needs to gate direction: basinDirection (from the basin's
momentum spectrum dims 7..14) and trendProxy (log-return over last N
candles, tanh-squashed to [-1, 1]).

Both are computed server-side so the TS orchestrator doesn't have to
ship an OHLCV window AND basin for every tick — the Python side
receives the basin (required for QIG primitives) plus the most-recent
OHLCV window and derives both locally.

QIG purity: basin_direction is Fisher-Rao native (proposal #7) — it
uses the geodesic distance ``arccos(Σ √(p·q))`` on Δ⁶³, normalised by
the simplex diameter ``π/2``. No Euclidean distance, no cosine
similarity, no Adam-style gradient steps.
"""

from __future__ import annotations

import os
from typing import Sequence

import numpy as np

# Pulled from qig_core_local.geometry.fisher_rao to avoid the import
# graph cycle at perception-layer load time. The function is small;
# the alternative is a top-level circular import via the kernel
# barrel module.
_FR_DIAMETER = float(np.pi / 2.0)  # max Fisher-Rao distance on Δⁿ

# Noise-floor raw value — dims 39..54 of every perceive() basin are
# pinned here (mirror of perception.ts:NOISE_FLOOR_VALUE). basin_direction
# uses it as the exact simplex-scale anchor for the neutral reference.
_NOISE_FLOOR_VALUE = 0.0055


def basin_direction(basin: np.ndarray) -> float:
    """Signed directional reading from the momentum-spectrum dims 7..14.

    Returns a scalar in [-1, 1] WITHOUT clipping. Positive = recent
    uptrend seen in basin; negative = downtrend; magnitude = conviction.
    Independent of ml-worker's opinion — Monkey's own directional
    reading.

    Proposal #7 — Fisher-Rao reprojection. Replaces the prior
    ``tanh((mom_mass - neutral) * 16)`` formulation, which saturates
    at ~0.92 in mild bull regimes (verified on prod tape, 2026-04-26)
    and structurally suppresses short conviction. The new
    formulation computes a SIGNED, NORMALISED Fisher-Rao distance:

      sign = sign(mom_mass - neutral_mom_mass)
      antipode = a copy of ``basin`` with the momentum band rescaled
                 to ``neutral_mom_mass`` (the no-momentum reference)
      d_FR = arccos(Σ √(basin · antipode))
      return sign * d_FR / (π/2)

    This preserves Fisher-Rao discipline (no cosine similarity, no
    Euclidean) and returns values in [-1, +1] without artificial
    saturation: only at the simplex diameter (where the basin and its
    no-momentum antipode are maximally separated) does the magnitude
    approach 1.

    Symmetry property (tested explicitly): if you reflect the
    momentum band around uniform, the returned direction flips sign
    while preserving magnitude.

    Quarantine note (2026-04-30): bubbles persisted in
    ``working_memory`` BEFORE this commit had basinDir computed under
    the old saturating formula. Migration 041 flags those rows so
    the kernel can avoid re-using stale-coordinate-system bubbles
    (see UCP §11.8 — bubble quarantine on geometry change).

    BUG FIX history (2026-04-24): the pre-2026-04-24 code centred
    each dim at 0.5 (raw-sigmoid neutral) which after toSimplex
    produced basinDir ≈ −1.0 on every tick. The 2026-04-24 fix
    introduced ``mom_mass - MOM_NEUTRAL`` then tanh-saturated; this
    proposal replaces that with the Fisher-Rao reprojection above.

    BUG FIX (2026-05-21): the neutral reference was a hardcoded
    ``MOM_NEUTRAL = 8/64`` — the momentum-band mass of a *uniform*
    basin. perceive()'s real basin is not uniform: dims 39..54 are a
    noise floor pinned at 0.0055 (sub-uniform), which forces every
    other dim's mass share above uniform. So ``mom_mass`` exceeded
    8/64 even on a flat market → ``sign`` pinned +1 → basinDir never
    went negative → the live "only longs" bug (operator report,
    2026-05-21). Fixed by deriving the neutral from the basin's own
    direction-agnostic peer bands (volatility 15..22 + volume 23..30):
    ``neutral_mom_mass = 8 × mean(p[15:31])``. Observer-derived, no
    hardcoded knob (P1 / perception-workstream §8).
    """
    BASIN_DIM = 64
    EPS = 1e-12
    # Degenerate-basin fallback ONLY. The live neutral reference is
    # observer-derived below (``neutral_mom_mass``). A hardcoded 8/64 is
    # correct only for a uniform basin; perceive()'s sub-uniform noise
    # floor breaks that — see the 2026-05-21 BUG FIX note above.
    MOM_NEUTRAL_FALLBACK = 8.0 / BASIN_DIM

    arr = np.asarray(basin, dtype=np.float64)
    if arr.shape[0] != BASIN_DIM:
        # Defensive: pad/truncate to 64 dims so callers can't crash
        # the kernel with a malformed basin.
        fixed = np.zeros(BASIN_DIM, dtype=np.float64)
        n = min(arr.shape[0], BASIN_DIM)
        fixed[:n] = arr[:n]
        arr = fixed

    mass = float(arr.sum())
    if mass <= EPS:
        return 0.0
    p = arr / mass  # simplex-normalised basin

    mom_mass = float(np.sum(p[7:15]))

    # B1.1 — noise-floor-anchored neutral (EXACT). Mirror of
    # perception.ts:basinDirection — see that file for the full
    # rationale. The momentum band is built 0.5-neutral (momentum_coord /
    # _momentum_coord), so a neutral momentum band weighs 8×0.5=4 raw.
    # The noise band (39..54) is a fixed raw _NOISE_FLOOR_VALUE per dim,
    # which pins the simplex scale T = _NOISE_FLOOR_VALUE / noise_mean —
    # making the neutral momentum p-share exact:
    # (8·0.5)·noise_mean / _NOISE_FLOOR_VALUE.
    #
    # Supersedes #880's `8·peer_mean`: the volatility+volume peer bands
    # are NOT 0.5-centred (volume's log(volRatio) runs mostly negative),
    # so that estimate skewed low → sign pinned +1 even on a flat market
    # (production telemetry post-B1, 2026-05-21).
    #
    # The anchor is EXACT only on a genuine perceive() output (noise
    # dims at raw _NOISE_FLOOR_VALUE). It self-detects that: a real
    # perceive() noise band is ~0.4–0.9% of the basin, so the
    # `noise_sum < 0.02` guard (2%) engages on genuine basins and falls
    # through to #880's peer_mean for synthetic / non-perceive basins
    # (no regression). Gated MONKEY_PERCEPTION_EXPRESSIVE_LIVE. Final
    # fallback: the 8/64 degenerate constant.
    noise_sum = float(np.sum(p[39:55]))  # 16 noise-floor dims
    if (
        os.environ.get("MONKEY_PERCEPTION_EXPRESSIVE_LIVE") != "false"
        and EPS < noise_sum < 0.02
    ):
        noise_mean = noise_sum / 16.0
        neutral_mom_mass = (8.0 * 0.5 * noise_mean) / _NOISE_FLOOR_VALUE
    else:
        peer_mean = float(np.mean(p[15:31]))  # 16 direction-agnostic dims
        neutral_mom_mass = (
            8.0 * peer_mean if peer_mean > EPS else MOM_NEUTRAL_FALLBACK
        )
    sign = 1.0 if mom_mass >= neutral_mom_mass else -1.0

    # Build the no-momentum antipode: rescale the momentum band so its
    # total mass equals ``neutral_mom_mass`` (the observer-derived
    # no-momentum reference), and redistribute the surplus/deficit
    # uniformly across the 56 non-momentum dims. The antipode stays on
    # Δ⁶³ (sum = 1). When the momentum band carries above-neutral mass
    # — even if internally flat — the antipode differs from the basin,
    # so the Fisher-Rao distance captures the directional deviation.
    antipode = p.copy()
    band_n = 8
    nonband_n = BASIN_DIM - band_n  # 56
    excess = mom_mass - neutral_mom_mass
    if mom_mass > EPS:
        # Scale momentum band to the observer-derived neutral total.
        antipode[7:15] = p[7:15] * (neutral_mom_mass / mom_mass)
    else:
        # Degenerate basin (zero mass on momentum band) — flatten band.
        antipode[7:15] = neutral_mom_mass / band_n
    # Redistribute the excess across the non-momentum dims.
    if nonband_n > 0:
        non_mask = np.ones(BASIN_DIM, dtype=bool)
        non_mask[7:15] = False
        antipode[non_mask] = p[non_mask] + (excess / nonband_n)
    # Numerical safety: clip tiny negatives from float subtraction.
    antipode = np.maximum(antipode, 0.0)
    s = float(antipode.sum())
    if s > EPS:
        antipode = antipode / s

    # Fisher-Rao geodesic on Δ⁶³: d = arccos(Σ √(p·q)).
    bc = float(np.sum(np.sqrt(np.maximum(p, 0.0) * np.maximum(antipode, 0.0))))
    bc = float(np.clip(bc, -1.0, 1.0))
    d_fr = float(np.arccos(bc))

    # Normalise by the simplex diameter (π/2) so the return is in
    # [-1, +1]. Saturation is geometric, not artificial — the only
    # way to hit ±1 is to truly span the simplex.
    return sign * d_fr / _FR_DIAMETER


def trend_proxy(closes: Sequence[float], lookback: int = 50) -> float:
    """Log-return over lookback candles, tanh-squashed to [-1, 1].

    With 15-minute candles and lookback=50 this sees ~12.5 hours of
    tape — long enough to filter scalp noise, short enough to pivot on
    real reversals. At K×log-return>>1, saturates near ±1.
    """
    if len(closes) < lookback + 1:
        return 0.0
    last = float(closes[-1])
    base = float(closes[-1 - lookback])
    if base <= 0 or last <= 0:
        return 0.0
    r = float(np.log(last / base))
    return float(np.tanh(r * 50.0))
