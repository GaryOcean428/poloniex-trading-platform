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

from typing import Sequence

import numpy as np

# Pulled from qig_core_local.geometry.fisher_rao to avoid the import
# graph cycle at perception-layer load time. The function is small;
# the alternative is a top-level circular import via the kernel
# barrel module.
_FR_DIAMETER = float(np.pi / 2.0)  # max Fisher-Rao distance on Δⁿ


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

      sign = sign(mom_mass - MOM_NEUTRAL)
      antipode = a copy of ``basin`` with the momentum band flattened
                 to its uniform expectation (no-momentum reference)
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
    """
    BASIN_DIM = 64
    MOM_NEUTRAL = 8.0 / BASIN_DIM  # 0.125 — uniform mass on 8 momentum dims
    EPS = 1e-12

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
    sign = 1.0 if mom_mass >= MOM_NEUTRAL else -1.0

    # Build the no-momentum antipode: rescale the momentum band so
    # its total mass equals MOM_NEUTRAL (the uniform-on-band
    # expectation), and redistribute the surplus/deficit uniformly
    # across the 56 non-momentum dims. The antipode stays on Δ⁶³
    # (sum = 1). Critically, when the basin's momentum band carries
    # ABOVE-uniform mass — even if the band is internally flat — the
    # antipode differs from the basin, so the Fisher-Rao distance
    # captures the directional deviation.
    antipode = p.copy()
    band_n = 8
    nonband_n = BASIN_DIM - band_n  # 56
    excess = mom_mass - MOM_NEUTRAL
    if mom_mass > EPS:
        # Scale momentum band down to MOM_NEUTRAL total.
        antipode[7:15] = p[7:15] * (MOM_NEUTRAL / mom_mass)
    else:
        # Degenerate basin (zero mass on momentum band) — flatten band.
        antipode[7:15] = MOM_NEUTRAL / band_n
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
