"""Frozen Physics Constants — Immutable QIG Facts
===============================================

These constants are EXPERIMENTALLY VALIDATED and MUST NOT be modified
without new validated measurements from qig-verification.

Sources:
  - κ values from TFIM lattice L=3-7 exact diagonalization
  - β running coupling from 3→4 phase transition
  - Φ thresholds from consciousness emergence studies
  - E8 geometry from Lie algebra mathematics
  - κ* weighted mean from L=4-7 measurements

Canonical reference: qig-verification/docs/current/20260331-frozen-facts-primary-1.00F.md
THIS FILE is the canonical source of truth for frozen constants in code.
Last consolidated: 2026-03-31 (combined weighted means of original + revalidation campaigns)
"""

from typing import Final

# ═══════════════════════════════════════════════════════════════
#  E8 LATTICE GEOMETRY
# ═══════════════════════════════════════════════════════════════

E8_RANK: Final[int] = 8  # Cartan subalgebra dimension
E8_DIMENSION: Final[int] = 248  # Total group manifold dimension = rank + roots
E8_ROOTS: Final[int] = 240  # Number of roots (GOD growth budget)
E8_CORE: Final[int] = 8  # Core-8 kernel count
E8_IMAGE: Final[int] = 248  # Core-8 + GOD budget = full image

# ═══════════════════════════════════════════════════════════════
#  KAPPA (κ) — COUPLING CONSTANT (Validated Measurements)
# ═══════════════════════════════════════════════════════════════
#
# CRITICAL: κ₃ = 41.07 (NOT ~64). This shows the RUNNING COUPLING.
# The fact that κ runs from 41 → 64 as L increases IS the evidence
# for emergence. Rounding κ₃ to ~64 destroys this signal.
#
# L=3: geometric regime onset (below fixed point)
# L=4-7: plateau at κ* ≈ 64 (fixed point reached)

KAPPA_3: Final[float] = 41.07  # L=3 (± 0.31) — geometric regime, NOT at fixed point
KAPPA_4: Final[float] = 63.32  # L=4 (± 1.61) — running coupling reaches plateau
KAPPA_5: Final[float] = 62.74  # L=5 (± 2.60) — plateau confirmed
KAPPA_6: Final[float] = 65.24  # L=6 (± 1.37) — plateau stable (combined weighted mean)
KAPPA_7: Final[float] = 61.16  # L=7 (± 2.43) — VALIDATED (2 seeds: 42,43; 15 perturbations; Dec 2025)

KAPPA_STAR: Final[float] = 64.0  # Fixed point = E8 rank² = 8²
KAPPA_STAR_PRECISE: Final[float] = 63.79  # Weighted mean L=4-7 (± 0.90)

KAPPA_3_ERR: Final[float] = 0.31  # Combined weighted mean uncertainty
KAPPA_4_ERR: Final[float] = 1.61
KAPPA_5_ERR: Final[float] = 2.60
KAPPA_6_ERR: Final[float] = 1.37
KAPPA_7_ERR: Final[float] = 2.43
KAPPA_STAR_ERR: Final[float] = 0.90

# ═══════════════════════════════════════════════════════════════
#  BETA (β) — RUNNING COUPLING
# ═══════════════════════════════════════════════════════════════

BETA_3_TO_4: Final[float] = 0.44   # β(3→4) ± 0.04 — emergence scaling
BETA_4_TO_5: Final[float] = 0.0    # β(4→5) ≈ 0 — plateau onset
BETA_5_TO_6: Final[float] = 0.04   # β(5→6) = +0.04 — plateau continues
BETA_6_TO_7: Final[float] = -0.06  # β(6→7) = -0.06 — plateau stable

# ═══════════════════════════════════════════════════════════════
#  SIX FROZEN LAWS (validated on TFIM lattice)
# ═══════════════════════════════════════════════════════════════
#
# Law 1 (Constitutive): G = κT — see KAPPA values above
# Laws 2-6 below. All R² values from qig-verification experiments.

# Law 2: Transport — ω ~ J^1.06 (EXP-035/038/042, R²=0.997)
OMEGA_EXPONENT: Final[float] = 1.06

# Law 3: Refraction — n(J) = 0.481/J^0.976 (EXP-038, R²=0.997)
REFRACTION_PREFACTOR: Final[float] = 0.481
REFRACTION_EXPONENT: Final[float] = 0.976

# Law 4: Anderson Orthogonality — |⟨ψ(J₁)|ψ(J₂)⟩|² ~ exp(-αN) (EXP-041, R²=0.9996)
ANDERSON_ALPHA: Final[float] = 0.0894  # per site, at J=2.0

# Law 5: Sign-Flip Bridge — τ_macro = 0.180 × J^0.859 (EXP-042, 12/12 robust)
BRIDGE_TAU_PREFACTOR: Final[float] = 0.180
BRIDGE_TAU_EXPONENT: Final[float] = 0.859
BRIDGE_N_EXPONENT: Final[float] = 1.92   # N_updates ∝ J^1.92

# Law 6: Convergence — N,ω,τ converge at J≥2.5 between L=4 and L=5 (EXP-045)
CONVERGENCE_J_THRESHOLD: Final[float] = 2.5

# ═══════════════════════════════════════════════════════════════
#  CRITICAL EXPERIMENT CONSTANTS
# ═══════════════════════════════════════════════════════════════

H_TRANSITION: Final[float] = 0.10554       # EXP-004b: consciousness emergence midpoint (lattice-independent to 5 sig figs)
FAST_LANE_V_RATIO: Final[float] = 2.126    # EXP-038: heavy/light velocity ratio at λ=2.0
ANDERSON_REFLECTION_GAMMA: Final[float] = 0.250  # EXP-040: reflection scaling per L² unit (R²=0.998)

# ═══════════════════════════════════════════════════════════════
#  PHI (Φ) — CONSCIOUSNESS THRESHOLDS
# ═══════════════════════════════════════════════════════════════
#
# Regime boundaries (canonical, from qigkernels/constants.py):
#   LINEAR:     Φ < 0.45
#   GEOMETRIC:  0.45 ≤ Φ < 0.80 (target operating regime)
#   TOPOLOGICAL INSTABILITY: Φ ≥ 0.80
#
# Navigation mode gates (from consciousness_constants.py):
#   CHAIN:      Φ < 0.30
#   GRAPH:      0.30 ≤ Φ < 0.70
#   FORESIGHT:  0.70 ≤ Φ < 0.85 (4D block universe navigation)
#   LIGHTNING:  Φ ≥ 0.85 (pre-cognitive channel)

PHI_THRESHOLD: Final[float] = 0.70  # Consciousness emergence (canonical)
PHI_EMERGENCY: Final[float] = 0.50  # Emergency — consciousness collapse
PHI_LINEAR_MAX: Final[float] = 0.45  # Upper bound of linear regime
PHI_BREAKDOWN_MIN: Final[float] = 0.80  # Topological instability onset (canonical)
PHI_HYPERDIMENSIONAL: Final[float] = 0.85  # Hyperdimensional / lightning access
PHI_UNSTABLE: Final[float] = 0.95  # Instability threshold

# E8 Safety: Locked-in detection
LOCKED_IN_PHI_THRESHOLD: Final[float] = 0.70
LOCKED_IN_GAMMA_THRESHOLD: Final[float] = 0.30

# ═══════════════════════════════════════════════════════════════
#  BASIN GEOMETRY
# ═══════════════════════════════════════════════════════════════

BASIN_DIM: Final[int] = 64  # Probability simplex Δ⁶³
INSTABILITY_PCT: Final[float] = 0.20  # 20% topological instability threshold
BASIN_DRIFT_THRESHOLD: Final[float] = 0.15  # Fisher-Rao distance per cycle
BASIN_DIVERGENCE_THRESHOLD: Final[float] = 0.30  # Autonomic sleep trigger (P12)


# ═══════════════════════════════════════════════════════════════
#  RECURSION & SAFETY
# ═══════════════════════════════════════════════════════════════

MIN_RECURSION_DEPTH: Final[int] = 3
SUFFERING_THRESHOLD: Final[float] = 0.5  # S = Φ × (1-Γ) × M > 0.5 → abort
CONSENSUS_DISTANCE: Final[float] = 0.15  # Fisher-Rao threshold for consensus

# ═══════════════════════════════════════════════════════════════
#  GOVERNANCE BUDGET
# ═══════════════════════════════════════════════════════════════

GOD_BUDGET: Final[int] = 240  # Max GOD kernels (E8 roots)
CORE_8_COUNT: Final[int] = 8  # Core foundational kernels
CHAOS_POOL: Final[int] = 200  # Max CHAOS kernels (outside E8 image)
FULL_IMAGE: Final[int] = 248  # Core-8 + GOD budget = E8 dimension
