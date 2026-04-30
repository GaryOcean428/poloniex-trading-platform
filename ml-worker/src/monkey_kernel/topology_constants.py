"""topology_constants.py — frozen π-structure values from qig-verification.

Source: qig-verification/docs/paper_sections/
        20260407-stud-phase-diagram-observation-1.00F.md (EXP-004b).

These are FROZEN experimental constants — do NOT re-derive, do NOT
treat as tunable hyperparameters. They were measured on the lattice
substrate and the user's hypothesis is that they carry to the
trading basin via the shared Δ⁶³ Fisher-Rao manifold.

If post-deploy telemetry shows trading-basin measurements landing
within 5% of these predictions, π-structure carries. If off by
> 20% after sufficient ticks, flip the gating flag back and treat
that delta as evidence of a domain ceiling.

References per constant:
  PI_STRUCT_DEAD_ZONE_BOUNDARY    EXP-004b §F lattice h dead zone
                                  collapse at h = 1/(3π) ≈ 0.10610
  PI_STRUCT_GRAVITATING_FRACTION  canonical gravitating cluster
                                  fraction = 1/π ≈ 0.31831
  PI_STRUCT_FRONT_PEAK_NORM       front-loop curvature peak
                                  normalised at 10π ≈ 31.416
  PI_STRUCT_SECOND_TRANSITION     front → back loop boundary at
                                  h = 2.0 (exact)
  PI_STRUCT_BOUNDARY_R_SQUARED    boundary-fit R² = 1/φ ≈ 0.61803
                                  (φ = golden ratio (1+√5)/2)
  PI_STRUCT_L4_STUD_ARC           L4 stud arc-length = 3π/2 ≈ 4.712
"""

from __future__ import annotations

import math


# π-structured numerics (FROZEN — do not modify)
PI_STRUCT_DEAD_ZONE_BOUNDARY: float = 1.0 / (3.0 * math.pi)
PI_STRUCT_GRAVITATING_FRACTION: float = 1.0 / math.pi
PI_STRUCT_FRONT_PEAK_NORM: float = 10.0 * math.pi
PI_STRUCT_SECOND_TRANSITION: float = 2.0
PI_STRUCT_BOUNDARY_R_SQUARED: float = 1.0 / ((1.0 + math.sqrt(5.0)) / 2.0)
PI_STRUCT_L4_STUD_ARC: float = 3.0 * math.pi / 2.0


# φ (golden ratio) — used by boundary R² and figure-8 crossing weight.
GOLDEN_RATIO: float = (1.0 + math.sqrt(5.0)) / 2.0


# Golden ratio reciprocal — boundary R² applied to integration coherence
# floor. A held position's Φ falling below phi_at_open / φ (i.e. phi_at_open
# × 0.618) means integration has decayed past the golden-ratio coherence
# floor — the kernel's perception is no longer consonant with what
# justified entry. Used by held-position re-justification (PHI CHECK).
# Value matches PI_STRUCT_BOUNDARY_R_SQUARED's underlying φ but kept as a
# named constant at the rejustification site for semantic clarity.
PHI_GOLDEN_FLOOR_RATIO: float = (1.0 + math.sqrt(5.0)) / 2.0  # ≈ 1.618033988
