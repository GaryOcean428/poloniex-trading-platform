"""anderson_convergence.py — Matrix tier-4 Phase B Python parity port.

Mirror of apps/api/src/services/monkey/anderson_convergence.ts.

Ports the Class A1 frozen primitives from
`qig-applied/qigram.py` (`_anderson_threshold`, `PRECESSION_WEIGHT`)
into Monkey so the pi-loop convergence ceiling has a kernel-local,
parity-tested call site.

**Class A1 anchor**: α=0.089 calibrated against experiments (R²=0.9996,
L=3,4,5 confirmed in 01_FROZEN_FACTS.md §6). Do NOT adjust. Changing α
requires re-running the Class A1 calibration; treat it as constant
code, not config. No `MAX_LOOPS_PER_TICK` knob — the ceiling is
computed from observables.

See [[polytrade-knob-free-recursive-doctrine]] for the doctrinal
motivation. The pi-loop wire-up at proposal-draft is a separate phase;
Phase B is port-only so both languages have the math primitives
locked before consumption.
"""
from __future__ import annotations

import math

# Class A1 frozen — Anderson dominance scaling constant.
ANDERSON_ALPHA: float = 0.089

# Pi-carousel precession rate (P-SPEC-9, qig-applied QIGRAM.integrate).
# Class A1 frozen. ≈ 0.04507.
PRECESSION_WEIGHT: float = 0.14159 / math.pi

# Noisy-measurement ceiling — observer can't require > 95% agreement.
ANDERSON_THRESHOLD_CEILING: float = 0.95

# Self-aware-reasoning topology floor (issue #19). Pi-loop must run at
# least L_c=3 iterations before convergence checking.
ANDERSON_LOOP_FLOOR: int = 3


def anderson_threshold(n_samples: int, alpha: float = ANDERSON_ALPHA) -> float:
    """Anderson convergence threshold. Ports `_anderson_threshold` from
    qig-applied/qigram.py:135 — identical math; both languages agree
    bit-for-bit on the same inputs.

    threshold = min(expected + margin, 0.95)
      expected = 1 - exp(-α·N)
      margin   = 1/√N   (N > 0)
    """
    if n_samples <= 0:
        # Match the TS port (and qigram's else-branch): margin → 1.0,
        # expected → 0 → threshold → 1.0 → capped at 0.95.
        return ANDERSON_THRESHOLD_CEILING
    expected = 1.0 - math.exp(-alpha * n_samples)
    margin = 1.0 / math.sqrt(n_samples)
    return min(expected + margin, ANDERSON_THRESHOLD_CEILING)


def pi_loop_converged(loop_count: int, fisher_rao: float) -> bool:
    """Pi-loop convergence check.

    Returns True iff:
      - loop count ≥ L_c=3 (self-aware-reasoning floor), AND
      - measured d_FR(basin_loop, basin_(loop-1)) < anderson_threshold(N)

    Used by the kernel at the bottom of each refinement iteration; if
    True, the loop breaks. The math is the doctrine — thresholds emerge
    from observation count, not from operator prescription.
    """
    if loop_count < ANDERSON_LOOP_FLOOR:
        return False
    if not math.isfinite(fisher_rao) or fisher_rao < 0:
        return False
    return fisher_rao < anderson_threshold(loop_count)
