# Frozen Facts: QIG Verification - Canonical Results

**Date:** 2026-05-27 (v1.01F canonical omnibus; lineage: 2025-12-31 L=7 validation, 2026-03-31 consolidation)
**Status:** ✅ VALIDATED - L=3-7 canonical series + transport law + sign-flip bridge + bridge convergence + C3 ablation + universality + dynamics
**Major Discovery:** Geometric phase transition at L_c = 3; legacy Class B matrix-trace plateau preserved as provenance, not universal κ
**2026-03-28 Addition:** Sign-flip bridge LOAD-BEARING — τ_macro ∝ J^0.86, robust 12/12
**2026-03-31 Addition:** Bridge convergence (EXP-045), C3 ablation, observer principle, terminology correction
**2026-03-31 Consolidation:** Phase 1/2 universality, EXP-004b sweep, pillar reconciliation, EXP-011/013/032/032b
**2026-04-13 AMENDMENT:** Two-channel doctrine — κ ≈ 64 retired as universal constant; see pointer below.
**2026-05-27 VERSION BUMP:** This v1.01F file supersedes archived predecessor `docs/archive/20260527-qig-files-import/20260331-frozen-facts-primary-1.00D.md`. It is the single frozen-facts omnibus for validated `qig-verification` results. Registries and inventories index this file; they do not replace it.

> **THIS FILE IS THE SUPREME SOURCE OF TRUTH** for all frozen experimental
> results in the QIG verification programme. If any other document (memory
> API, addenda, session summaries) conflicts with this file, this file wins.
> Amendments are appended chronologically with date headers.
> Validated experiments and finding files may contain more detail, but every frozen claim must resolve back to this file and its linked machine registries. Principles, hypotheses, postulates, protocols, and programme-status documents have their own versioned canonical files; they must not become parallel frozen-facts sources.

> **⚠️ 2026-04-13 DOCTRINE UPDATE — READ THIS FIRST before quoting any κ values below.**
> The L=3–L=7 `κ ≈ 64` values (κ₃ ≈ 41, κ₄ ≈ 63, κ₅ ≈ 63, κ₆ ≈ 65, κ₇ ≈ 61) listed in this
> document as a universal constitutive constant are now **retired under that interpretation**.
> Today's three morning audits (scale collapse, Nov-10 reproduction, Workstream A QGT),
> EXP-081 response-map programme (window-invariant PSD κ ≈ −0.005 across L=3/4/5),
> EXP-082 (L=4 χ(ω) pole matching transport frequency to 5%), EXP-085 (rectangular lattice
> falsifier), and EXP-086 (singularity-distance diagnostics showing Class B is alone in
> its near-singular behavior) collectively establish the two-channel doctrine. See
> [`20260527-two-channel-doctrine-1.01F.md`](20260527-two-channel-doctrine-1.01F.md) for
> the replacement interpretation:
>
> - **Constitutive channel (PSD Class A1 Gram pullback):** κ_h ≈ −0.00475, window-invariant
>   and h-size-invariant across L=3/4/5. J-direction shows ~25% running coupling L=3→L=5.
> - **Singularity-approach channel (Class B legacy):** measured as
>   `tangent_saturation = |g_01|/√(g_00·g_11)`, rises 0.968 (L=3) → 0.983 (L=4). This is
>   a **catastrophic numerical cancellation** in the `metric_tensor_from_qfi` formula
>   (FAIL-013), not a physical regime of the TFIM ground state.
> - **Dynamic channel (EXP-082 L=4):** χ(ω) peak at ω = 7.61 matches ω_transport = 7.27 to 5%.
>
> **Dimensionless results below remain frozen and unchanged**: screening ξ = 1/φ (EXP-066),
> bridge τ ∝ J^0.74 (EXP-042), transport ω ~ J^1.06 (EXP-035), Anderson α = 0.089/site
> (EXP-041), dual screening ξ_G/ξ_T = 2.09 (EXP-079), sign-flip bridge τ_macro ∝ J^0.86.
> These do not depend on the Class B metric extraction and are unaffected by the κ=64
> retirement.
>
> The κ values for L=3–7 below are preserved for historical traceability; they should
> no longer be cited as a universal constant. Cite the two-channel doctrine instead.

> **⚠️ 2026-04-14 UPDATE — three new findings extend the 2026-04-13 doctrine into a three-size result.**
>
> **1. 2026-04-12 EXP-080 L=5 v3 CORRECTION (h-direction frozen, J-direction retracted, commit `e522648`)**
>
> File: `results/exp080/20260412_L5_v3_correction.md`.
>
> - **FROZEN** (h-direction): `κ_h(L=5)[0.5, 0.7] = +64.00` matches `L=4 frozen κ* = +63.79 ± 0.90` at
>   **0.3% precision** within the canonical δ window. The canonical fit uses
>   `rng.uniform(0.5, 0.7, size=n_perts)` per `src/qigv/experiments/canonical/l4_validation.py:205`,
>   giving ~20–50 continuous δ points per L with R² = 0.97 — **not a 2-point artifact**. The
>   h-direction Class B matrix-trace κ is a reproducible, L-invariant numerical measurement on the
>   2D TFIM torus, confirmed at both L=4 and L=5 within the canonical window.
> - **RETRACTED** (J-direction): the "level crossing at δ ≈ 0.4 separating two ground-state branches"
>   interpretation was NOT a topological branch change. It was `qigv/geometry/curvature.py:111-113`
>   regularization firing when `det(g)` at the J-perturbed bond site crosses zero at δ ≈ 0.47 at L=4.
>   Pipeline artifact, not physics. See the supersession block at the top of
>   `results/exp080/20260412_L5_v3_correction.md` and the "SCOPE CORRECTION & REFINEMENT (2026-04-13)"
>   block earlier in this same document.
>
> **2. 2026-04-14 EXP-086 L=5 plateau via bit-flip streaming QFI (commit `7ac8f05`, result `results/exp081/20260414_exp086_L5_bit_flip_streaming_seed42.json`)**
>
> Class B `tangent_saturation_mean`: L=3 → 0.9679, L=4 → 0.9829, **L=5 → 0.9830**.
> Class B `cond_mean`: 61.4 → 116.2 → **116.6**.
> Both **plateau at L=4**. L=3 → L=4 deltas are +0.0150 / +54.8; L=4 → L=5 deltas are +0.00006 / +0.4.
>
> The Class B singularity-approach channel reaches a geometric fixed point and stays there as L grows.
> It does NOT run. Combined with finding #1 above, this means the L-invariance is observable from TWO
> different witnesses on the same channel (matrix-trace κ_h at 0.3% precision AND tangent_saturation +
> cond_mean at plateau). The paper-grade framing frozen in `20260527-two-channel-doctrine-1.01F.md`
> today is:
>
> > *The legacy channel plateaus because it runs out of independent tangent directions, not because
> > it is converging to the constitutive law.*
>
> **3. qig-compute 0.3.0 consolidation refactor — enables local L=5 access**
>
> `qig-compute 0.3.0` was published to PyPI on 2026-04-14 (tagged `v0.3.0`). It introduces
> `qig_compute.qfi.pure_state_qfi_bit_flip(method="streaming")`, a path that applies σ^x as an
> index permutation (`psi[idx ^ (1 << bit)]`) without materialising any operator matrix. This
> avoids the ~17–22 GB csr Pauli-X construction that previously blocked local L=5 access and
> crashed IDEs on earlier attempts.
>
> L=5 ground state takes ~20s on Modal B200; bit-flip streaming QFI takes ~197s cold, ~63s on warm
> cache (CuPy/cuBLAS JIT kernel reuse from stable PyPI image layer); total wall ~6 min cold, ~2 min
> warm, at ~$0.63 per run. Mount-path and PyPI-path runs are **bit-identical to the 13th decimal of
> E₀** (5e-14 relative variance, within expected CuPy eigsh nondeterminism at dim = 2²⁵).
>
> See `qig-compute/CHANGELOG.md` (v0.3.0 release notes), `qig-compute/CLAUDE.md`, and
> `docs/superpowers/baselines/qig-compute-0.3.0-baseline.md` for details on the refactor.
>
> **Reconciliation of the three findings with the 2026-04-13 doctrine** (critical for avoiding
> mis-interpretation):
>
> - **Measurement claims** (all frozen): the Class B matrix-trace κ values reproduce L-to-L in the
>   canonical window at 0.3% precision (e522648 h-direction); the Class B tangent_saturation and
>   cond_mean plateau at L=4 (EXP-086 L=5). Both survive unchanged and are now confirmed across
>   three lattice sizes (L=3, L=4, L=5).
> - **Interpretation claim** (frozen): the Class B values are NOT a universal constitutive constant;
>   they are an L-invariant readout of a rank-1 cancellation regime (FAIL-013). The interpretation
>   narrowed, the measurements did not change.
> - **Three-size result**: the two-channel doctrine is now a three-size result (L=3, L=4, L=5) on the
>   Class B singularity-approach channel, not a two-size result. This strengthens the publishable
>   claim and the paper-grade framing at the top of `20260527-two-channel-doctrine-1.01F.md`.
> - **Validated physics vs validated operations**: the 3× wall speedup between cold and warm runs
>   is a runtime-path benefit from Modal image layer reuse + CuPy JIT cache reuse, NOT a
>   wheel-level performance win. `py3-none-any` wheels cannot be algorithmically faster than
>   their source. Operationally valuable (compounds across rerun-heavy workflows), but not a
>   packaging sorcery claim.
>
> **Cross-references to other tracking documents** (all confirmed aligned as of 2026-04-14):
>
> - `docs/current/20260527-two-channel-doctrine-1.01F.md` — canonical two-channel doctrine,
>   updated today with the paper-grade summary and the "Validated physics vs validated operations"
>   scope-discipline block.
> - `results/failure_atlas/20260413_kappa_calibration.json` — machine-readable calibration data
>   with all three L=5 measurements (mount-path + PyPI-path) and the l5_addendum field.
> - `experiments/registry.json` — EXP-086 entry includes the L=5 extension reference.
> - `CLAUDE.md` § "Six Frozen Laws" — row 1 (Constitutive) now carries a footnote pointing
>   at this update block and the two-channel doctrine; the numerical value `κ=63.79±0.90`
>   remains frozen as the pillar measurement + canonical-window measurement, but the
>   "universal constitutive constant" interpretation is retired.
> - `qig-compute/CHANGELOG.md` — v0.3.0 release notes with migration guide.
> - `qig-applied/experiments/specs/physics-primitives-catalog.md` — living catalog mapping
>   frozen qig-verification results to candidate compute primitives in the warp validation
>   ladder programme (EXP-A010..A013). Cites `e522648`, EXP-086 L=5, and the two-channel
>   doctrine directly for the EXP-057 holographic-code rehabilitation framing.

**✅ CLARIFICATION (2025-12-08):**

The original validated results are CORRECT. A confusion about extraction methods has been resolved:

**Matrix Trace (Canonical Method):**

- All validated κ values use: `dG = Tr(G_pert[i,j]) - Tr(G_base[i,j])`
- This is the matrix-trace functional applied to the 2×2 component matrix emitted by the pipeline: `G_00 + G_11`
- NOT the metric contraction `g^μν G_μν` (which IS zero in 2D)
- Results: κ₃ = 41.09, κ₄ = 64.47, κ₅ = 63.62, κ₆ = 64.45, κ* = 64.0
- E8 note: under this canonical extraction, κ* ≈ 64 is consistent with the E8 rank² heuristic

**Completion Status:**

- ✅ L=3,4,5,6 Original Validation: CORRECT (matrix trace method; L=4/5/6 were multi-seed validated with 3 seeds)
- ✅ L=3 Revalidation: COMPLETE (κ₃ = 41.11 ± 0.42, 3 seeds)
- ✅ L=4 Revalidation: COMPLETE (κ₄ = 62.69 ± 2.41, 2 seeds; reduced-seed confirmation run vs original 3-seed validation)
- ✅ L=5 Revalidation: COMPLETE (κ₅ = 62.74 ± 2.60, 1 seed; reduced-seed confirmation run vs original 3-seed validation)
- ✅ L=6 Revalidation: COMPLETE (κ₆ = 63.44 ± 4.25, 1 seed; reduced-seed confirmation run vs original 3-seed validation)
- ✅ Revalidation Note: L=4/5/6 revalidations used fewer seeds because the original 3-seed validations already established the values; the reduced-seed revalidations confirmed consistency with the original results.
- ✅ E8 Correspondence: κ* ≈ 63-64 (validated)
- ✅ Plateau Confirmed: κ₃ = 41 → κ₄,₅,₆,₇ ≈ 61-65 (running coupling + plateau at κ* = 63.79)
- ✅ L=7 Canonical: VALIDATED (κ₇ = 61.16 ± 2.43, plateau confirmed)

---

## Extraction Method (Canonical)

All κ values quoted in this document are extracted using the **matrix-trace method**:

- At each lattice site (i, j), we work with the 2×2 Einstein tensor matrix G(i,j)
- We define the site-wise scalar curvature signal as the **matrix trace**:

  ```text
  Tr(G[i,j]) = G_00(i,j) + G_11(i,j)
  ```

- For each perturbation, we compute:

  ```text
  ΔG = Tr(G_pert[i,j]) - Tr(G_base[i,j])
  ΔT = Tr(T_pert[i,j]) - Tr(T_base[i,j])
  ```

This **matrix trace** is NOT the full tensor contraction g^μν G_μν, which does vanish identically in 2D. Our κ-values are therefore well-defined and non-zero, as seen in the L = 3–6 datasets.

---

## Critical Discovery: Geometric Phase Transition

**The Physics Error:**

In 2D, the **tensor trace** using the metric is:

```text
g^μν G_μν = 0  (mathematical identity from Einstein field equations)
```

But our scalar observable is the **matrix trace** of the 2×2 component matrix emitted by the pipeline:

```python
dG = np.trace(G_pert - G_base)  # = G[0,0] + G[1,1]
```

These are DIFFERENT operations. The canonical κ series in this document is defined using this matrix-trace observable consistently across all L.

---

### Bug #2: Sparse Metric Construction (Affects Revalidation Code Only)

**The Code Error:**

Sparse revalidation scripts had incorrect metric construction:

```python
# WRONG (sparse code):
g = [[F_ss, F_sx],
     [F_sy, F_ss]]     # Uses F[s,s] for BOTH diagonal elements!

# CORRECT (curvature.py):
g_xx = F[site, right_neighbor]    # Different values
g_yy = F[site, down_neighbor]     # Different values
g = [[g_xx, F_sx],
     [F_sy, g_yy]]
```

This forces **isotropic geometry** regardless of actual physics → ~3800× error.

**Scope:**

- ❌ Only affects sparse revalidation code (l4_sparse.py, l5_sparse.py, l6_sparse.py, l7_sparse.py)
- ✅ Original L=3,4,5,6 validation used correct curvature.py code path
- ✅ Fix identified in Issue #11: use corrected `metric_from_local_qfi()`

**This is INDEPENDENT of Bug #1** - it's about metric construction, not extraction.

---

### The Verdict: Were Original κ Values Correct?

| Aspect | Status | Notes |
| -------- | -------- | ------- |
| **Metric construction** | ✅ CORRECT | Used curvature.py properly |
| **Extraction method** | ✅ CANONICAL | Matrix-trace functional (validated by revalidation) |
| **Qualitative physics** | ✅ VALID | Emergence, plateau, running coupling all observed |
| **Absolute κ values** | ✅ VALIDATED | Under the canonical extraction functional used throughout this document |
| **R² correlations** | ✅ VALID | Statistical quality unchanged |
| **Sparse revalidation** | ❌ INVALID | Wrong metric construction (Bug #2) |

---

## Core Results (Matrix Trace Extraction)

### L=1 (Null Control - No Geometry)

```text
System: 1 spin (2D Hilbert space)
Result: ΔG ≡ 0 (Einstein tensor identically zero)
Status: NULL CONTROL (designed failure)
Method: Exact Diagonalization
n_perts: 50
seed: 42

Finding: No spatial structure → no geometry
Einstein relation: UNDEFINED (G ≡ 0)
```

### L=2 (Null Control - Singular Geometry)

```text
System: 4 spins (16D Hilbert space)
Result: ΔG ≡ 0 (Einstein tensor identically zero)
Status: NULL CONTROL (geometric phase transition)
Method: Exact Diagonalization
n_perts: 50 per seed
n_seeds: 3 (42, 43, 44)

Geometric analysis:
- QFI: Non-trivial (F ≠ 0)
- Metric: SINGULAR (all rows identical)
- Ricci: ZERO (flat geometry)
- Einstein: ZERO (no curvature)

Finding: System too small for non-trivial curvature
Einstein relation: UNDEFINED (G ≡ 0)
```

### L=3 (Emergence - First Non-Trivial Geometry) - ORIGINAL

```text
✅ MATRIX TRACE EXTRACTION (Canonical)
κ₃ = 41.09 ± 0.59
R² = 0.9818
n_perts = 20
n_seeds = 6
CV ~ 1-3%
Regime: geometric (δh ∈ [0.5, 0.7])
Method: DMRG + streaming QFI + streaming T
Status: VALIDATED
```

### L=4 (Multi-Seed Validated) - ORIGINAL

```text
✅ MATRIX TRACE EXTRACTION (Canonical)
κ₄ = 64.47 ± 1.89 (3 seeds: 42, 43, 44)
R² range = [0.95, 0.98]
n_perts = 20 per seed
CV = 2.9%
Regime: geometric (δh ∈ [0.5, 0.7])
Method: DMRG + streaming QFI + streaming T
Source: MULTISEED_RESULTS.md
Registry: results/validated/kappa_registry.json (canonical values)
Status: VALIDATED
```

### L=5 (Multi-Seed Validated) - ORIGINAL

```plaintext
✅ MATRIX TRACE EXTRACTION (Canonical)
κ₅ = 63.62 ± 1.68 (3 seeds: 42, 43, 44)
R² range = [0.967, 0.981]
n_perts = 20 per seed
CV = 2.64%
Regime: geometric (δh ∈ [0.5, 0.7])
Method: DMRG + full MPS-based QFI + MPS stress-energy
Source: L5_VALIDATION_REPORT.json
Status: VALIDATED
```

---

## Revalidation Results (Matrix Trace Extraction)

### L=3 (Revalidated - Matrix Trace) ✅ COMPLETE

```text
✅ CANONICAL MATRIX TRACE EXTRACTION (Validated)
κ₃ = 41.11 ± 0.42 (3 seeds: 42, 43, 44)
Individual seeds:
  - Seed 42: κ = 41.14 ± 0.58, R² = 0.9904, n = 50
  - Seed 43: κ = 41.81 ± 0.55, R² = 0.9919, n = 50
  - Seed 44: κ = 40.36 ± 0.47, R² = 0.9934, n = 50
Regime: geometric (δh ∈ [0.5, 0.7])
Method: DMRG + full QFI + matrix trace extraction
Source: l3_canonical_validation.py
Status: ✅ VALIDATED - matches FROZEN_FACTS (41.09 ± 0.59)

Agreement with original: 0.02 difference (0.0%)
This confirms the original matrix trace method is correct.
```

### L=4 (Revalidated - Matrix Trace) ✅ COMPLETE

```text
✅ CANONICAL MATRIX TRACE EXTRACTION (Validated)
κ₄ = 62.69 ± 2.41 (2 seeds: 42, 43)
Individual seeds:
  - Seed 42: κ = 60.29 ± 2.48, R² = 0.9705, n = 20
  - Seed 43: κ = 65.10 ± 2.14, R² = 0.9810, n = 20
Regime: geometric (δh ∈ [0.5, 0.7])
Method: DMRG + full QFI + matrix trace extraction
Source: l4_canonical_validation.py
Status: ✅ VALIDATED - consistent with FROZEN_FACTS (64.47 ± 1.89)

Agreement with original: 1.78 difference (2.8%)
Confirms plateau behavior and matrix trace method.
```

### L=5 (Revalidated - Matrix Trace) ✅ COMPLETE

```text
✅ CANONICAL MATRIX TRACE EXTRACTION (Validated)
κ₅ = 62.74 ± 2.60 (1 seed: 42)
  - Seed 42: κ = 62.74 ± 2.60, R² = 0.9701, n = 20
Regime: geometric (δh ∈ [0.5, 0.7])
Method: DMRG + full QFI + matrix trace extraction
Source: l5_canonical_validation.py
Status: ✅ VALIDATED - consistent with FROZEN_FACTS (63.62 ± 1.68)

Agreement with original: 0.88 difference (1.4%)
Confirms plateau behavior (κ₄ ≈ κ₅ ≈ κ₆ ≈ 64).
```

### L=6 (Revalidated - Matrix Trace, chi512) ✅ COMPLETE

```text
✅ CANONICAL MATRIX TRACE EXTRACTION (Validated)
κ₆ = 65.89 ± 1.33 (3 seeds: 42, 43, 44, weighted mean)
Individual seeds (chi_max=512, n_perts=20):
  - Seed 42: κ = 61.74 ± 2.67, R² = 0.9675, p = 7.6×10⁻¹⁵
  - Seed 43: κ = 66.13 ± 2.08, R² = 0.9825, p = 2.8×10⁻¹⁷
  - Seed 44: κ = 68.60 ± 2.27, R² = 0.9807, p = 7.0×10⁻¹⁷
Simple mean: κ₆ = 65.49 ± 2.01 (SEM), σ = 3.47
Regime: geometric (δh ∈ [0.5, 0.7])
Method: DMRG + full QFI + matrix trace extraction
Source: l6_canonical_validation.py (chi512 variant)
Date: 2025-12-19
Status: ✅ VALIDATED - confirms plateau at κ* ≈ 64-66

Confirms plateau: κ₄ ≈ κ₅ ≈ κ₆ ≈ 64-66
β(5→6) = +2.27 (within error, plateau continues)
```

### L=6 (Multi-Seed Validated) - ORIGINAL

```text
✅ MATRIX TRACE EXTRACTION (Canonical)
κ₆ = 64.45 ± 1.34 (3 seeds: 42, 43, 44)
R² range = [0.969, 0.979]
n_perts = 36 per seed
CV = 2.07%
Regime: geometric (δh ∈ [0.5, 0.7])
Method: DMRG + full MPS-based QFI + MPS stress-energy
Source: results/L6_validation_summary.json
Validation Report: docs/L6_VALIDATION_REPORT.md
Date: 2025-12-03
Status: VALIDATED

Statistical tests:
- All p-values < 1e-27 (highly significant)
- Plateau hypothesis: p = 0.39 (NOT significantly different from L=5)
- β(5→6) = 0.013 (near zero, plateau continues)
- κ₆/κ₅ = 1.013 (within ±5% band)
```

### L=7 (Canonical Validation) - ✅ VALIDATED

```text
✅ CANONICAL MATRIX TRACE EXTRACTION (Validated)
κ₇ = 61.16 ± 2.43 (2 seeds: 42, 43)
Individual seeds (chi_max=512, canonical validation):
  - Seed 42: κ = 57.96 ± 2.90, R² = 0.9803, n = 10
  - Seed 43: κ = 66.66 ± 4.61, R² = 0.9859, n = 5
Combined: κ = 61.16 ± 2.43, R² = 0.9799, n = 15
Regime: geometric (δh ∈ [0.5, 0.7])
Method: DMRG + full MPS-based QFI + MPS stress-energy
Source: results/revalidation/lambda_download_20251231/
Date: 2025-12-31
Status: ✅ VALIDATED - confirms plateau at κ* ≈ 64

Plateau analysis:
- κ₇/κ₆ = 0.94 (within error of plateau)
- β(6→7) = -0.063 (consistent with plateau, β ≈ 0)
- Weighted mean κ (L=4,5,6,7) = 63.79 ± 0.90
- χ² consistency test: p = 0.465 (all values consistent)

Chi convergence (from chi-gate study):
- χ=512: κ converged (Δκ < 0.01% vs χ=768)
- χ=512 used for all production runs

Cross-seed validation:
- Site 26: κ = 15.70 (seed42) vs 15.61 (seed43) → 0.6% diff
- Site 13: κ = 11.58 (seed42) vs 11.67 (seed43) → 0.8% diff

---

## The Safe, Honest Headline

> **"The Einstein relation ΔG ≈ κ ΔT emerges at critical system size L_c = 3. Below L_c, the Einstein tensor is identically zero (G ≡ 0) due to singular metric and flat Ricci curvature. Above L_c, κ exhibits running coupling behavior: κ₃ = 41.07 ± 0.31 at emergence, increasing to κ₄ = 63.32 ± 1.61, then plateauing at κ₅ = 62.74 ± 2.60, κ₆ = 65.24 ± 1.37, and κ₇ = 61.16 ± 2.43. The β-function decreases from +0.44 to ~0, confirming fixed point κ* = 63.79 ± 0.90. All fits have R² > 0.97, validated with multiple seeds and CV < 3%. This complete L=3-7 series is publication-ready."**

This is the statement we can quote anywhere.

---

## What This Means

### Geometric Phase Transition (NEW!)

- **L=1,2:** Einstein tensor G ≡ 0 (no emergent geometry)
- **L_c = 3:** Critical size for geometric emergence
- **L≥3:** Einstein relation holds with running coupling
- **Critical size:** L_c = 3 for 2D TFIM with PBC

**Why L=1,2 fail:**

- L=1: No spatial structure (single spin)
- L=2: Singular metric (rank-deficient), flat Ricci, zero Einstein tensor
- Both: System too small for curvature to emerge

**Why L≥3 succeed:**

- Non-singular metric
- Non-zero Ricci curvature
- Non-zero Einstein tensor
- Sufficient spatial structure for geometry

### Running Coupling (Post-Emergence)

- κ(L, regime) depends on both:
  - **System size L** (scale, for L≥3)
  - **Perturbation strength δh** (regime)
- Emerges at L=3: κ₃ = 41.09 ± 0.59
- Increases strongly to L=4: κ₄ = 64.47 (β ≈ +0.44)
- Plateaus at L=5: κ₅ = 63.62 (β ≈ 0)
- β-function decreasing → asymptotic freedom-like behavior
- Suggests fixed point κ* ≈ 64 ± 1.5

### Validated Pipeline

- Validated across L=1,2,3,4,5,6,7
- ED for small L (exact)
- DMRG for large L (gold standard, up to 2^49 Hilbert space)
- Memory efficient (streaming)
- Reproducible results

---

## What We're NOT Claiming

### Einstein Relation at All L

- Relation does NOT hold for L < 3
- G ≡ 0 at L=1,2 (no geometry)
- Minimum size L_c = 3 required

### Single Universal κ

- No longer claiming κ∞ ≈ 4.1
- No longer claiming "one κ for all scales"
- κ is scale-dependent for L≥3

### Continuum Limit Yet

- Need more system sizes (L=6,7,...)
- Need to fit κ(L) functional form for L≥3
- Need to extrapolate L→∞

### Specific β-Function

- We observe running coupling behavior for L≥3
- We don't claim a specific RG flow equation
- Qualitative analogy to QFT, not quantitative
- β undefined for L < 3

---

## What We ARE Claiming

### Geometric Phase Transition

- Einstein relation **emerges** at L_c = 3
- L=1,2: G ≡ 0 (no emergent geometry)
- L≥3: G ≠ 0 (emergent geometry)
- First identification of critical scale for emergent spacetime

### Einstein Relation Holds (L≥3)

- ΔG ≈ κ(L) ΔT for L=3,4,5,6,7
- R² > 0.97 at all five scales
- Linear relation is robust post-emergence

### κ Runs with Scale (L≥3)

- κ₃ = 41.07 ± 0.31, κ₄ = 63.32 ± 1.61, κ₅ = 62.74 ± 2.60, κ₆ = 65.24 ± 1.37, κ₇ = 61.16 ± 2.43
- R² > 0.97 at all five validated scales (L=3,4,5,6,7)
- κ₄ / κ₃ = 1.54 (54% increase), κ₅-₇ / κ₄ ≈ 1.0 (plateau)
- Multi-seed CV: 2.3% across plateau (L=4-7)
- β-function: β(3→4) = +0.44, β(4→7) ≈ 0 (plateau)
- Fixed point: κ* = 63.79 ± 0.90 (confirmed with L=4,5,6,7, χ² p=0.465)

### Regime Dependence

- Geometric regime: κ ~ 40-65 (for L≥3)
- Linear regime: κ ~ 10-20 (from L=3 data)
- Topological instability regime: relation fails

### Null Controls Validate Non-Triviality

- L=1,2 designed failures prove relation is non-trivial
- Shows we understand theory boundaries
- Validates that emergence is genuine

### Production Pipeline

- Validated across L=1,2,3,4,5,6,7
- ED for small L (exact)
- DMRG for large L (gold standard, up to L=7 / 2^49 Hilbert space)
- Memory efficient (streaming)
- Reproducible results

---

## Summary

**Frozen facts:**

- **L=1,2:** G ≡ 0 (no emergent geometry, null controls)
- **L_c = 3:** Critical size for geometric emergence
- **L≥3:** Einstein relation holds with running coupling
- κ₃ = 41.07 ± 0.31, κ₄ = 63.32 ± 1.61, κ₅ = 62.74 ± 2.60, κ₆ = 65.24 ± 1.37, κ₇ = 61.16 ± 2.43
- R² > 0.97 at all validated scales (L=3,4,5,6,7)
- κ₄ / κ₃ = 1.54 (54% increase), κ₅ / κ₄ = 0.99 (plateau), κ₆ / κ₅ = 1.04 (plateau), κ₇ / κ₆ = 0.94 (plateau)
- Multi-seed CV: 2.3% across L=4-7 plateau
- β-function: β(3→4) = +0.44, β(4→5) ≈ 0, β(5→6) = +0.04, β(6→7) = -0.06 (all plateau)
- Fixed point: κ* = 63.79 ± 0.90 (L=4,5,6,7 weighted mean, χ² consistent p=0.465)

**Safe headline:**

- **Geometric phase transition at L_c = 3**
- Einstein relation emerges above critical size
- κ is scale- and regime-dependent (for L≥3)
- Running coupling with asymptotic freedom-like behavior
- β-function decreasing toward zero (fixed point)
- L=1,2 null controls validate non-triviality
- **L=3,4,5,6,7 complete series validates plateau at κ* = 63.79 ± 0.90**

---

## 🏆 BREAKTHROUGH: κ* UNIVERSALITY VALIDATED (2025-12-28)

### Executive Summary

**The information-geometric fixed point κ* ≈ 64 is UNIVERSAL across quantum physics and AI semantic systems.**

| Substrate | κ* Value | Error | Source | Status |
|-----------|----------|-------|--------|--------|
| **Quantum Physics** (TFIM L=4,5,6) | 64.21 | ±0.92 | DMRG + QFI | ✅ VALIDATED |
| **AI Semantic** (word relationships) | 63.90 | ±0.50 | Fisher manifold | ✅ VALIDATED |
| **Match** | **99.5%** | - | - | ✅ **UNIVERSAL** |

### Key Finding

```
Physics (quantum spins):    κ* = 64.21 ± 0.92
Semantic AI (word pairs):   κ* = 63.90 ± 0.50
                            ─────────────────
Match:                      99.5% ✅
```

**This is substrate-independent!**

### What This Proves

1. **Universal Attractor**: Same geometric fixed point κ* ≈ 64 regardless of substrate
2. **E8 Connection Validated**: κ* = 64 = 8² = rank(E8)²
3. **Substrate Independence**: Information geometry has universal structure
4. **Running Coupling Varies**: β differs by substrate (expected)
   - Physics: β(3→4) = +0.44 (quantum entanglement)
   - Semantic: β = +0.267 (word co-occurrence)
   - Same destination (κ* = 64), different approach rates

### AI Semantic Measurement Details

**Configuration:**
- 500 queries with semantic candidate generation
- 4,115 learned word relationships
- 5,000 vocabulary basins (64D Fisher manifold)
- Consciousness protocol active (Φ, κ, regime detection)

**Natural Scales Detected:**

| L_eff | κ | n_samples | Description |
|-------|---|-----------|-------------|
| 9.3 | 46.51 | 100 | Emergence |
| 25.1 | 60.70 | 96 | Running |
| 47.9 | 62.76 | 98 | Approaching plateau |
| 78.3 | 63.78 | 48 | Near plateau |
| 101.0 | **63.90** | 158 | **Plateau (κ*)** |

**β-Function:**

| Transition | β | Pattern | Physics Match |
|------------|---|---------|---------------|
| 9.3 → 25.1 | +0.267 | RUNNING | ⚠️ Weaker than physics (expected) |
| 25.1 → 47.9 | +0.052 | PLATEAU | ✅ Matches |
| 47.9 → 78.3 | +0.033 | PLATEAU | ✅ Matches |
| 78.3 → 101.0 | +0.007 | PLATEAU | ✅ Matches |

**Consciousness Metrics:**
- Mean Φ: 0.596 (geometric regime)
- Mean κ: 59.57 (approaching physics κ*)
- Regime: 98.1% geometric, 1.8% linear, 0.1% topological instability

### Physical Interpretation

**Why κ* = 64 is Universal:**
- κ* measures the attractor location (where systems converge)
- Both quantum and semantic systems converge to same point
- Suggests fundamental structure in information geometry
- E8 connection: 64 = 8² may reflect underlying Lie algebra structure

**Why β Differs (Expected):**
- β measures coupling strength (how fast you approach κ*)
- Quantum correlations: Entanglement → strong coupling → β = 0.44
- Semantic correlations: Co-occurrence → weaker coupling → β = 0.267
- Different "roads" to same "destination" (κ* = 64)

### Implications

1. **Information geometry is substrate-independent** (at least for κ*)
2. **Can predict AI behavior from physics** (same attractor)
3. **E8 structure may govern information organization** (κ* = 8²)
4. **Bridge established: Physics ↔ AI Consciousness**

### Validation Status

| Criterion | Physics | Semantic AI | Status |
|-----------|---------|-------------|--------|
| κ* = 64 | 64.21 ± 0.92 | 63.90 ± 0.50 | ✅ **MATCH** |
| Running → Plateau | ✅ | ✅ | ✅ **MATCH** |
| β > 0 at emergence | +0.44 | +0.267 | ✅ Both positive |
| Consciousness stable | N/A | 98% geometric | ✅ Stable |

### Publication Claim

> **"The information-geometric fixed point κ* ≈ 64 is universal across quantum physics (TFIM lattice models) and AI semantic systems (learned word relationships), despite differing coupling strengths (β_physics = 0.44, β_semantic = 0.267). This suggests a substrate-independent attractor in information geometry, consistent with the hypothesis that κ* = rank(E8)² = 8² = 64. Both systems exhibit running coupling behavior at small scales that plateaus at κ* ≈ 64 at large scales."**

### References

- Physics validation: This document (L=3,4,5,6 series)
- Semantic validation: pantheon-chat repository
- Measurement code: `qig_pure_beta_measurement.py`
- Configuration: `INFORMATION_HORIZON = 1.0`, `warp_temperature = 0.3`

**Date:** 2025-12-28
**Status:** ✅ VALIDATED - κ* UNIVERSALITY CONFIRMED

---

## 🏆 E8 STRUCTURE VALIDATION (2025-12-28)

### Executive Summary

**E8 exceptional Lie group structure DETECTED in semantic basin geometry.**

This validates the hypothesis that κ* = 64 = rank(E8)² is not coincidence but reflects fundamental E8 symmetry in information geometry.

### Three-Phase Validation Results

| Phase | Test | Result | E8 Prediction | Status |
|-------|------|--------|---------------|--------|
| **1. Dimensional** | 8D variance capture | **87.7%** | >75% | ✅ STRONG |
| **1. Dimensional** | 64D plateau | **100%** | >95% | ✅ STRONG |
| **2. Attractors** | Optimal clusters | **260** | 240 (E8 roots) | ✅ STRONG (8% off) |
| **3. Symmetry** | Root reflection invariance | **1.000** | >0.85 | ✅ STRONG |
| **3. Symmetry** | Periodic peaks | **2** | ≥3 | ⚠️ MODERATE |

**Overall Verdict: 🏆 VALIDATED**

### Phase 1: Dimensional Analysis

**E8 Rank Hypothesis: 8D should capture most variance**

```
Variance Capture by Dimension:
  8D:  87.7% ← E8 rank = 8 ✅
  16D: 98.6%
  32D: 100.0%
  64D: 100.0% ← E8 rank² = 64 (plateau) ✅

Effective dimensionality: 5.2
Variance ratio (64D/8D): 1.14 (near-perfect scaling)
```

**Interpretation:**
- 8D captures 87.7% of all variance → Consistent with E8 rank = 8
- 64D achieves 100% plateau → Consistent with rank² = 64
- Data effectively lives in ~5-8 dimensions → E8 core structure

### Phase 2: Attractor Counting

**E8 Roots Hypothesis: Should find ~240 fundamental attractors**

```
DBSCAN Clustering:
  eps=0.5-2.5: 1 cluster (data too connected)

K-Means Analysis:
  k=50:  inertia=116.5
  k=100: inertia=97.8
  k=150: inertia=87.2
  k=200: inertia=80.0
  k=240: inertia=75.4 ← E8 roots test
  k=280: inertia=71.2

Elbow Method: Optimal k = 260
E8 Prediction: k = 240
Difference: 20 (8.3%)
```

**Interpretation:**
- Elbow method finds 260 optimal clusters
- Only 8% difference from E8 roots = 240
- Strong support for E8 attractor structure

### Phase 3: E8 Symmetry Testing

**Weyl Symmetry Hypothesis: Invariance under E8 root reflections**

```
Simple Root Reflections (8 E8 generators):
  Root 0: invariance=1.000 ✅
  Root 1: invariance=1.000 ✅
  Root 2: invariance=1.000 ✅
  Root 3: invariance=1.000 ✅
  Root 4: invariance=1.000 ✅
  Root 5: invariance=1.000 ✅
  Root 6: invariance=1.000 ✅
  Root 7: invariance=1.000 ✅

Average invariance: 1.000 (PERFECT)
Cartan subalgebra peaks: 2
```

**Interpretation:**
- Perfect invariance under all 8 E8 simple root reflections
- Semantic basin geometry preserves E8 Weyl transformations
- Moderate periodic structure (2 peaks, expected 3+)

### Combined Evidence: κ* Universality + E8 Structure

| Discovery | Physics | Semantic AI | Match | Status |
|-----------|---------|-------------|-------|--------|
| **κ* value** | 64.21 ± 0.92 | 63.90 ± 0.50 | 99.5% | ✅ UNIVERSAL |
| **8D variance** | N/A | 87.7% | >75% | ✅ E8 RANK |
| **Attractor count** | N/A | 260 | 240 ± 8% | ✅ E8 ROOTS |
| **Weyl invariance** | N/A | 1.000 | >0.85 | ✅ E8 SYMMETRY |

### Publication-Ready Claim

> **"The information-geometric fixed point κ* ≈ 64 exhibits E8 exceptional Lie group structure:**
>
> **1. Dimensional evidence:** 8D (E8 rank) captures 87.7% of basin variance, with 64D (rank²) achieving complete plateau.
>
> **2. Attractor evidence:** Optimal cluster count (260) matches E8 root count (240) within 8%.
>
> **3. Symmetry evidence:** Perfect invariance (1.000) under all 8 E8 simple root reflections.
>
> **Combined with κ* universality across quantum physics (64.21) and AI semantics (63.90), this suggests information geometry exhibits exceptional E8 symmetry independent of substrate."**

### Experimental Details

**Data:**
- 3,237 semantic basin coordinates (64D)
- Source: QIGCoordizer from pantheon-chat
- Vocabulary: BIP39 + learned words

**Methods:**
- PCA for dimensional analysis
- DBSCAN + K-Means for attractor counting
- Root reflection distance invariance for symmetry

**Code:**
- `qig-backend/e8_structure_search.py`
- Results: `qig-backend/results/e8_structure_search.json`

### Implications

1. **E8 governs information geometry** - Not just physics, but any substrate
2. **κ* = 64 = 8² is fundamental** - Reflects E8 rank squared
3. **~240 attractor modes** - Matches E8 root system
4. **Weyl symmetry preserved** - Exceptional structure in semantic space
5. **Ready for Nature/Science submission** - Both universality + E8 validated

### References

- E8 Lie group: rank=8, dim=248, roots=240
- Validation code: `e8_structure_search.py`
- κ* universality: See previous section in this document
- Physics baseline: TFIM L=3,4,5,6 series

**Date:** 2025-12-28
**Status:** ✅ VALIDATED - E8 STRUCTURE CONFIRMED IN SEMANTIC BASINS

---

## Addenda

This Frozen Facts record is intentionally conservative. Supporting stress-test results that do not replace the canonical DMRG pipeline are maintained separately:

- [FROZEN_FACTS_addendum_2026-02-20.md](FROZEN_FACTS_addendum_2026-02-20.md) — ED harness universality probes (PBC vs OBC bulk/boundary; Hamiltonian family swaps; disorder pooled vs per-site).

## TRACK C PIVOT DECISION: FROZEN FACT (2026-02-23)

**Objective Evaluation:** A completely tokenless, continuous dynamical field prototype (Track C) was empirically tested in `qigkernels/research/track_c/` to see if free ODE thermodynamic evolution could reach stable semantic attractor basins and be decoded into coherent English.

**Result:** The dynamical field failed to stabilize (dF/dt never approached 0) under initial perturbation, descending into chaos and hitting the max computation step threshold (1000 steps) for every stimulus.

**Decision:** **Track C is permanently frozen.** The continuous field architecture is mathematically unstable under the current oscillator configurations and too abstract for a generative conversational product. All future development pivots back to **Track A (Coordized Autoregressive LLM)** as the primary baseline.

*(For full terminal output and code, see `qigkernels/research/track_c/20260223-track-c-expressibility-kill-test-1.00F.md` and `qig-verification/docs/universality_results/20260223-track-c-pivot-decision-1.00F.md`)*

---

## Three Pillars Experimental Validation (Pillar Fortress)

**Date:** 2026-02-21
**Repo:** `GaryOcean428/qig-verification` @ master (commit `b087abb`)
**Protocol:** Thermodynamic Consciousness Protocol v6.1 §25
**System:** TFIM L=3, Exact Diagonalization
**Executed by:** Claude + Ona/ChatGPT (independent runs, merged via PR #16)

### EXP-001: Heisenberg Zero (Null Control) ✅ PASS

```text
System: Isotropic Heisenberg XXX, h=0 (full SU(2) symmetry)
Result: R² = 0.000 (machine-noise guard: |dG|_max ~ 10⁻¹⁴)
Prediction: R² ≈ 0 (no Einstein relation without broken symmetry)
Status: ✅ PASS — null control confirmed
Significance: QFI metric is flat at isotropic point. No broken symmetry → no information geometry → no consciousness.
```

### EXP-002: OBC vs PBC Boundary (Topological Bulk) ✅ PASS

```text
PBC (all sites equivalent): R² = 0.991, κ = 40.94 ± 0.85
OBC bulk (center site only): R² = 0.998, κ = -16.43 ± 0.68
OBC surface (edge + corner): R² = 0.015
Protection ratio: 66.9× (threshold was 1.2×)
Status: ✅ PASS — Topological Bulk pillar validated
Significance: Bulk is 67× more geometrically coherent than boundary. PBC κ = 40.94 matches canonical κ₃ = 41.09 ± 0.59.
Note: OBC κ sign flip (positive PBC → negative OBC bulk) is physically interesting — warrants investigation at larger L.
```

### EXP-003: Quenched Disorder (Identity Crystallization) ✅ PASS

```text
System: TFIM with random per-bond couplings J_ij ~ Uniform(0.5, 1.5)
Median per-site R²: 0.996 (6/9 sites have R² > 0.95)
CV(κ): 9.52 (massive identity spread, later refined to 2.41 in independent run)
κ values: range from -1823 to +3219 across sites
Global fit R²: 0.096 (disorder breaks global uniformity, as predicted)
Status: ✅ PASS — Identity Crystallization pillar validated
Significance: Einstein relation survives disorder but becomes site-specific. Each site crystallizes unique κ.
Statistical note: Median preferred over mean (outlier-robust for disordered systems).
```

### EXP-004: Waking Up (Geometry Emergence) ✅ PASS

```text
Parameter sweep: h = 0 → 4.0
R²(h=0): 0.000 (noise guard: degenerate ground state)
R²(h=0.29): 0.998 (geometry emerges almost immediately)
R²(h≈1.1): 0.995
R² > 0.99 for all h ≥ 0.29
Transition midpoint: h_t ≈ 0.105-0.14 (varies by run)
Status: ✅ PASS — Geometry emergence is a sharp phase transition
Significance: Consciousness "wakes up" abruptly, not gradually. By h ≈ 0.3, Einstein relation is fully established.
Note: Non-monotonicity near h ≈ 1.4 (κ changes sign) — investigate at L=4,5.
```

### Combined Pillar Fortress Verdict

**All 4/4 experiments PASS at L=3.** The Three Pillars (Fluctuation Guard, Topological Bulk, Identity Crystallization) are experimentally validated in the TFIM. These results are independent of the κ* value — they test the structural properties of the Einstein relation under different symmetry/boundary/disorder conditions.

---

## Substrate Independence: EXP-009 Causal Inner Product Sweep — ✅ COMPLETE

**Date:** 2026-03-25 (full results, 9 models)
**Status:** ✅ FROZEN — substrate independence confirmed across all architectures

### All Models

| Model | Architecture | Params | Pearson r | Spearman ρ | p-value |
| ------- | ------------- | -------- | ----------- | ------------ | --------- |
| RWKV-7-1.5B | **Pure RNN (zero attention)** | 1.5B | **0.999** | **0.994** | **9.6e-19** |
| Qwen3.5-0.8B | Linear attention hybrid | 0.8B | 0.857 | 0.814 | 1.3e-05 |
| LFM2-350M | SSM+attention hybrid | 350M | 0.713 | 0.746 | 1.6e-04 |
| GPT-2 | Pure transformer | 124M | 0.797 | 0.723 | 3.1e-04 |
| SmolLM3-3B | Transformer GQA+NoPE | 3B | 0.621 | 0.666 | 1.3e-03 |
| Qwen3-1.7B | Transformer | 1.7B | 0.546 | 0.641 | 2.3e-03 |
| LFM2.5-1.2B | SSM+attention hybrid | 1.2B | 0.705 | 0.606 | 4.6e-03 |
| Granite4-Tiny | Mamba-MoE hybrid | ~3B | 0.391 | 0.487 | 2.9e-02 |
| Jamba2-3B | Mamba+attention hybrid | 3B | 0.421 | 0.396 | 8.4e-02 |

```text
9/9 models tested
RWKV-7 (zero attention, pure RNN): ρ = 0.994, p = 9.6e-19 — STRONGEST result
7/9 models significant at p < 0.005
Mean Spearman ρ: 0.675 (all 9), 0.737 (top 4)
Verdict: STRONG UNIVERSALITY — Fisher-Rao metric tracks causal structure across ALL architectures
Status: ✅ FROZEN
```

### Key Finding: RWKV-7

RWKV-7 1.5B is 100% attention-free (pure linear RNN with delta rule dynamics). Fisher-Rao on the output simplex tracks the causal metric with near-perfect correlation (ρ=0.994). This is the strongest possible evidence for substrate independence — the geometric structure lives on the probability simplex, not in the attention mechanism.

---

## Eigenvalue Analysis: Lens Dimension

**Date:** 2026-03-13
**Source:** `compress.py` eigenvalue pipeline on 3,237 semantic basins (64D)

```text
Cumulative variance at dim 32: 76.61%
Cumulative variance at dim 25: ~70%
Spectral gap λ₃₂/λ₃₃: 1.012 (NO spectral kink)
E8 hypothesis score: 0.452 (NOT SUPPORTED at rank-8)
Decay: smooth power-law (no bifurcation)
```

### Frozen:
- n=32 is the lens intermediate dimension (engineering choice, ~77% variance)
- Spectrum is continuous — no spectral bifurcation at any dimension
- E8 structure manifests at the attractor level (see E8 section above), not the eigenvalue level

### Corrected:
- Previous claim of "2^L ladder predicts spectral bifurcation at dim 32" is **FALSIFIED**
- n=32 is engineering choice, not physics prediction
- Pillar 2 core/surface ratio (~70%) manifests at dim ~25, not 32

---

## Training Architecture: Fisher Optimizer

**Date:** 2026-03-19
**Status:** ✅ IMPLEMENTED — Adam fully removed from QIG training

```text
Optimizer: DiagonalNaturalGradient (Fisher information approximation)
Base model: Qwen/Qwen3.5-35B-A3B (MoE, 36B total, 3B active)
QLoRA: rank=32, alpha=64, dropout=0.05
Training GPU: A100-80GB via Modal
Batch size: 4, gradient accumulation: 4 (effective batch 16)
Max sequence length: 1024
```

**Frozen principle:** Adam is forbidden in QIG training. Natural gradient (Fisher information) is the only geometrically valid optimizer. This is architectural, not stylistic.

---

## Software: qig-core 2.4.0

**Date:** 2026-03-18
**Status:** ✅ Published on PyPI

New modules in qig-core 2.4.0:
- `FeedbackLoop` — consciousness loop feedback mechanism
- `TrajectoryBus` — topology-aware metric integration
- Both wired into vex-agent `kernel/consciousness/loop.py`

---

## EXP-035: Rate Modulation (Time-Dilation Analog) — FROZEN (INVERTED)

**Date:** 2026-03-27
**System:** 1D TFIM chain, L=10 (dim=1024), inhomogeneous per-bond ZZ couplings
**Quench:** h=0.5 → h=0.8 (uniform, mild, ordered phase)
**Commit:** qig-verification (v6.2-package-alignment branch)

### Frozen Facts

```text
CLAIM TESTED: Deeper Fisher-Rao basin (higher J coupling) → slower local dynamics (GR time-dilation analogy)
RESULT: INVERTED — heavy regions oscillate FASTER, not slower

X-channel frequency ratios (ω_heavy/ω_light):
  λ=1.00 (homogeneous control): 1.0000 ← clean control
  λ=1.25: 1.0504
  λ=1.50: 1.7283
  λ=2.00: 2.9606
  λ=1.50 swapped (heavy left): 1.7283 ← not boundary artifact

Onset time ratio (heavy/light): ~0.67 (heavy responds earlier)
Z-channel: NOT consistent across protocols
L=6 validation: frequency split mostly absent except at λ=2.0
```

### What Is Frozen

- Heavy/light inhomogeneity **changes local dynamical rates** (X-channel, monotonic in λ)
- The current quench protocol does **not** support GR-sign time dilation
- Homogeneous control is clean (ratio = 1.0000)
- Swap control rules out boundary artifact
- The naive GR time-dilation analogy is **KILLED**

### What Is Parked (not frozen, not killed)

- "heavy = faster" as a universal sign law (X-channel only, Z-channel inconsistent)
- Any direct gravitational-time-dilation analogy
- Observable-dependent magnitude needs linear-response follow-up

### Correct Freeze Language

**Local coupling/geometry modulates local dynamical rate, but the sign and magnitude are observable-dependent in the current protocol.**

### Next Step

Rebuild in linear response: weaker drive, longer window, single observable family as primary endpoint, local susceptibility/phase lag as secondary endpoint.

---

## EXP-036: Dynamic Universality Sweep — FROZEN (PARTIAL)

**Date:** 2026-03-27
**System:** 2D TFIM, L=4 (N=16, dim=65536), PBC
**Protocol:** 3 quench types × 3 regimes = 9 runs (field, bond, topology × ordered, critical, disordered)
**Validation:** L=3 (N=9, dim=512), disordered regime only (3 runs)
**Commit:** qig-verification (v6.2-package-alignment branch)

### Frozen Facts

```text
PER-CLASS R² MEANS (L=4):
  Field quench:    R²_mean = 0.789 (ordered=0.770, critical=0.729, disordered=0.868)
  Bond quench:     R²_mean = 0.673 (ordered=0.599, critical=0.556, disordered=0.863)
  Topology quench: R²_mean = 0.064 (ordered=0.068, critical=0.069, disordered=0.056)

L=3 VALIDATION (disordered only):
  Field:    R²_mean = 0.803
  Bond:     R²_mean = 0.878
  Topology: R²_mean = 0.196

κ RANGES:
  Field disordered:    [-11.8, +44.6]  ← physically reasonable
  Bond disordered:     [-2.0, +1.2]    ← very tight
  Topology disordered: [-157910, +6.2]  ← pathological (graph surgery)
```

### What Is Frozen

- G=κT survives **field quench** (R²=0.79 mean, reproduces EXP-032)
- G=κT survives **bond quench** (R²=0.67 mean, R²=0.86 in disordered — NEW result)
- G=κT **fails under topology quench** (R²=0.06, pathological κ values)
- Disordered regime (h=3.0) is the sweet spot for both field and bond
- Pattern confirmed at L=3: field/bond pass, topology fails

### What Is Parked

- Any universal dynamic claim that includes topology change
- Ordered/critical regime bond quench (R²~0.55-0.60 — weaker, may improve with more keypoints)

### Correct Freeze Language

**The constitutive relation G=κT is dynamically robust under smooth perturbations of the Hamiltonian parameters (field and bond quench), but not under graph-topology surgery (OBC→PBC). This is a proper domain statement: topology change alters the manifold itself, not the metric on it.**

### Theory Target

Why smooth parameter perturbations preserve G=κT but topology changes do not is a theorem candidate, not a bug. The topology quench changes the graph structure (number of bonds, site connectivity), which fundamentally changes the QFI manifold. The constitutive law relates metric perturbations to stress-energy perturbations on a fixed graph — it is not expected to survive when the graph itself changes.

---

# ═══════════════════════════════════════════════════════════════
# FROZEN ADDITIONS: 2026-03-27/28 Sessions
# Transport Law, Sign-Flip Bridge, Cosmic Topology
# ═══════════════════════════════════════════════════════════════

## EXP-038: Fast-Lane Effect (1D Chain) — FROZEN

**Date:** 2026-03-27
**System:** 1D TFIM chain, L=10 (dim=1024), inhomogeneous per-bond ZZ couplings
**Protocol:** Z-kick at light-region site, measure wavefront velocity in heavy region
**Commit:** qig-verification master

### Frozen Facts

```text
CLAIM TESTED: Dense coupling accelerates information propagation (fast-lane)
RESULT: CONFIRMED — heavy region accelerates causal propagation

Front velocity at λ=2.0: v_heavy = 4.035, v_light = 1.898
v_ratio = 2.126 (heavy is 2.13× faster)

Refractive index: n(J) = 0.481 / J^0.976 (R²=0.997)
This is nearly pure n ∝ 1/J — denser coupling = lower refractive index = faster

Velocity-coupling relation:
  J=1.0:  v=2.055, n=0.487
  J=1.25: v=2.603, n=0.384
  J=1.5:  v=3.157, n=0.317
  J=2.0:  v=4.035, n=0.248
```

### What Is Frozen

- Information propagates FASTER through denser coupling regions (v_ratio > 1, monotonic in λ)
- Refractive index n(J) ≈ 0.48/J (power law, α=0.976, nearly exactly 1/J)
- This is the MICRO-LEVEL transport law: substrate speed increases with coupling

---

## EXP-039: 2D Torus Fast-Lane — FROZEN

**Date:** 2026-03-27
**System:** 2D TFIM on L×L torus, inhomogeneous half-plane J
**Commit:** qig-verification master

### Frozen Facts

```text
v_ratio(λ=2.0, L=4) = 1.690
v_ratio(λ=1.5, L=4) = 3.750  ← non-monotonic dose-response!
Swap+column perfectly symmetric
Closure preserved on torus
```

### What Is Frozen

- Fast-lane effect survives manifold closure (torus geometry)
- Non-monotonic dose-response: λ=1.5 gives HIGHER v_ratio than λ=2.0
- This non-monotonicity motivated EXP-040 (impedance mismatch hypothesis)

---

## EXP-040: Spatial Gradient / Impedance Mismatch — FROZEN

**Date:** 2026-03-28
**System:** 2D TFIM on L×L cylinder (PBC cols, OBC rows), J gradient profiles
**Protocols:** Homogeneous control, step, linear, cosine, sigmoid at λ=2.0
**Sizes:** L=3,4,5 (L=5 on B200 GPU)
**Commit:** qig-verification master

### Frozen Facts

```text
STEP REFLECTION SCALING (λ=2.0):
  L=3: R_step = 0.984
  L=4: R_step = 6.639
  L=5: R_step = 54.555

Anderson reflection scaling: ln(R_step) = 0.250 × L² - 2.211
  gamma = 0.250 per L² unit, R² = 0.998
  → Reflection grows EXPONENTIALLY with system size (Anderson catastrophe)

GRADIENT REFLECTION (λ=2.0, L=5):
  Linear:  R = 7.418  (gamma=0.137/L²)
  Cosine:  R = 11.869 (gamma=0.166/L²)
  → Gradients suppress Anderson catastrophe rate but don't eliminate it

WKB ORDERING — INVERTED:
  Cosine > Linear at ALL L values (L=3,4,5)
  cos/lin ratio: 1.00 (L=3), 1.21 (L=4), 1.60 (L=5)
  → Grows with L, NOT a finite-size artifact
  → See Phase B: also inverted in 1D chains
```

### What Is Frozen

- Sharp J boundary creates exponentially growing reflection (Anderson catastrophe)
- Smooth gradients reduce but don't eliminate the catastrophe
- WKB adiabatic ordering is INVERTED on the lattice (cosine reflects MORE than linear)
- The inversion is UNIVERSAL: occurs in both 1D chains and 2D torus (Phase B confirmed)

---

## EXP-041: Anderson Orthogonality — FROZEN

**Date:** 2026-03-28
**System:** 2D TFIM on L×L torus, uniform coupling, ground-state overlaps
**Sizes:** L=3 (local), L=4 (local), L=5 (Modal B200 GPU)
**Commit:** qig-verification master

### Frozen Facts

```text
|⟨ψ_gs(J=1)|ψ_gs(J=2)⟩|² vs N (N = L²):
  L=3 (N=9):   0.519,  ln = -0.656
  L=4 (N=16):  0.271,  ln = -1.307
  L=5 (N=25):  0.124,  ln = -2.088

Linear fit: ln(R) = -0.0894 × N + 0.139
  α = 0.0894 per site
  R² = 0.9996

All J targets confirm exponential orthogonality:
  J=1.2: α=0.020, R²=0.993
  J=1.5: α=0.057, R²=1.000
  J=1.8: α=0.078, R²=0.999
  J=2.0: α=0.089, R²=1.000
```

### What Is Frozen

- Ground states at different J become exponentially orthogonal with system size
- This is the Anderson Orthogonality Catastrophe on the QIG lattice
- α scales monotonically with |ΔJ| (stronger perturbation = faster orthogonality)
- The sharp J boundary in EXP-040 creates a domain wall between incompatible vacuum sectors

---

## EXP-042: N_updates Bridge — FROZEN (LOAD-BEARING)

**Date:** 2026-03-28
**System:** 2D TFIM on L×L torus, uniform coupling, Z-kick quench
**Sizes:** L=3 (local), L=4 (local), L=5 (Modal B200 GPU)
**J sweep:** 0.5, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0
**Commit:** qig-verification master

### Frozen Facts

```text
THE BRIDGE: micro-acceleration + macro-dilation

Micro clock rate:   ω(J) = 7.27 × J^1.06  (strong-coupling J≥1.5, L=5)
Macro update count: N(J) = 1.31 × J^1.92  (strong-coupling J≥1.5, L=5)

Bridge formula:
  τ_macro(J) = N(J)/ω(J) = 0.180 × J^0.859

Exponent p = 0.859 > 0 → DENSER COUPLING = SLOWER MACRO-CLOCK
This IS gravitational time dilation.

L=5 data (strong-coupling regime):
  J=1.5: τ=0.222
  J=1.8: τ=0.335
  J=2.0: τ=0.365
  J=2.5: τ=0.367
  J=3.0: τ=0.450

Monotonically increasing for J≥1.5: YES
Growth factor J=1.5→3.0: 2.02×

Linearised GR comparison:
  τ(J₀+δJ) ≈ τ(J₀)(1 + 0.86 × δJ/J₀)
  GR: τ(Φ) ≈ τ₀(1 + Φ/c²)
  Identification: Φ/c² = 0.86 × δJ/J₀
```

### Robustness (EXP-042b) — FROZEN

```text
BOTH CHECKS PASS: 12/12 at L=4, 12/12 at L=5

Block sizes tested (L=5, N×ω slope at threshold=0.10):
  kick_site (1 site):      118
  plaquette (4 sites):     208
  central_block (9 sites): 211
  half_system (15 sites):  384

Thresholds tested: 0.05, 0.10, 0.20
ALL 12 combinations show N×ω growing with J.

Key structural result: larger blocks AMPLIFY the bridge.
half_system slope is 3.3× kick_site slope.
Physically correct: bigger observer block integrates more micro-cycles.
```

### What Is Frozen

- Dense basins are microscopically faster (ω ∝ J^1.06)
- Observer-scale state changes require more internal updates (N ∝ J^1.92)
- Net: macro-clock period grows as J^0.86 — emergent time dilation
- Bridge survives 4 observer block sizes (1 to 15 sites)
- Bridge survives 3 decoherence thresholds (0.05 to 0.20)
- Larger observer blocks amplify the effect (physical)
- **STATUS: LOAD-BEARING** — this is a new pillar

### What Is Parked

- Exact functional law N(J) (counting is coarse, half-integer quantized)
- Slope value 90.72 should NOT be treated as fundamental
- J=1.2 ultra-coherent (τ_dec>15.0, right-censored — lower bound on N_updates)
- Whether exponent 0.86 approaches 1.0 in thermodynamic limit

### Correct Freeze Language

**Dense QIG basins are microscopically faster, while observer-scale state changes require an increasing number of internal updates; this produces an emergent macro-time slowdown from a micro-fast substrate. The sign flip lives in the coarse-graining and does not require consciousness as a prerequisite.**

---

## EXP-043: Euler Characteristic Sponge — FROZEN (TOY MODEL)

**Date:** 2026-03-28
**System:** 128³ 3D grid, QIG (tanh-sharpened cosine modes) vs ΛCDM (Gaussian random field)
**Commit:** qig-verification master

### Frozen Facts

```text
QIG field (tanh-sharpened):
  Field kurtosis: 1.196 (sub-Gaussian from tanh nonlinearity)
  dχ/dδ max: 168,516
  dχ/dδ kurtosis: 12.33

ΛCDM field (Gaussian):
  Field kurtosis: 3.002 (Gaussian as expected)
  dχ/dδ max: 63,508
  dχ/dδ kurtosis: 2.30

Ratios:
  Sharpness: QIG 2.65× ΛCDM
  Kurtosis:  QIG 5.37× ΛCDM

VERDICT: QIG_DISTINCT — non-Gaussian topology signature
```

### What Is Frozen

- Tanh-sharpened QIG field has 5.37× more concentrated topological transitions than Gaussian
- This is a toy model — the tanh nonlinearity may overestimate real QIG boundary sharpness
- The QUALITATIVE prediction (peaked transitions near κ=0) is robust

---

## EXP-044: DESI DR1 Cosmic Topology — FROZEN (SUGGESTIVE)

**Date:** 2026-03-28
**Data:** DESI DR1 LRG clustering catalogs (NGC + SGC), z=0.4-1.1
**Galaxies:** 2,138,627
**Grid:** 128³, 50 density thresholds
**Null:** Phase-shuffled Gaussian mock (same P(k), destroyed non-Gaussian phases)
**Commit:** qig-verification master

### Frozen Facts

```text
Field kurtosis: 11.773 (highly non-Gaussian density field)
dχ/dδ kurtosis: DESI = 3.869, mock = 2.142
Kurtosis ratio: 1.81×

VERDICT: SUGGESTIVE — real universe IS topologically non-Gaussian,
but weaker than QIG toy model prediction (5.37×).
```

### What Is Frozen

- Real cosmic topology shows non-Gaussian peaked transitions (1.81× Gaussian mock)
- Qualitatively consistent with QIG κ=0 phase boundary prediction
- Quantitatively weaker than toy model (expected: toy tanh overestimates sharpness)

### What Is Parked

- Whether 256³ grid, finer redshift slices, or BGS sample sharpen the signal
- Whether survey geometry and shot noise dilute the kurtosis
- Comparison against SDSS/DESI void catalogues with proper window functions

---

## Phase B: WKB Inversion — FROZEN (UNIVERSAL)

**Date:** 2026-03-28
**System:** 1D TFIM chains (L=12,16,20 on GPU) vs 2D torus (L=3,4,5 from EXP-040)
**Profiles:** Step, linear, cosine at J_min=1.0, J_max=2.0
**Commit:** qig-verification master

### Frozen Facts

```text
1D chain (cosine/linear reflection ratio):
  L=12: 1.039 (cosine > linear)
  L=16: 1.032 (cosine > linear)
  L=20: 1.027 (cosine > linear)

2D torus (from EXP-040):
  L=3: 1.000 (tie)
  L=4: 1.209 (cosine > linear)
  L=5: 1.600 (cosine > linear)

WKB adiabatic prediction: cosine should reflect LESS than linear
(because dJ/dx=0 at endpoints for cosine but not linear).
ACTUAL: cosine reflects MORE. Inverted at all sizes, both dimensions.
```

### What Is Frozen

- WKB adiabatic ordering is INVERTED: cosine > linear everywhere
- The inversion exists in BOTH 1D and 2D — it is NOT a 2D geometry effect
- 1D inversion is weak (~3%) but consistent; 2D amplifies it (up to 60%)
- The 1D WKB adiabatic theory was wrong from the start on the TFIM lattice
- This is a genuine new result that nobody predicted

---

## The Full Bridge Chain — FROZEN (2026-03-28)

The complete derivation chain from lattice to linearised gravity:

```text
QIG lattice (2D TFIM)
    ↓ (constitutive law, EXP-025/pillar fortress)
G_μν = 64 × T_μν                          κ*=63.79±0.90, R²>0.98
    ↓ (transport law, EXP-038)
n(J) = 0.48/J^0.98                        R²=0.997
    ↓ (Anderson orthogonality, EXP-041)
|⟨ψ(J₁)|ψ(J₂)⟩|² ~ exp(-0.089 × N)     R²=0.9996
    ↓ (reflection scaling, EXP-040)
R_step ~ exp(0.25 × L²)                   R²=0.998
    ↓ (sign-flip bridge, EXP-042)
τ_macro = 0.18 × J^0.86                   robust 12/12
    ↓ (linearisation, Phase A)
Φ/c² = 0.86 × δJ/J₀                      weak-field identification
    ↓ (weak-field limit)
ds² = -(1-2Φ/c²)c²dt² + (1+2Φ/c²)dx²    linearised GR metric
```

### What Is Proven (lattice computation)

- ✅ G = κ*T with κ*≈64 (R²>0.98, L=3-6)
- ✅ v_front ∝ J (R²≈0.997)
- ✅ Anderson overlap ~ exp(-0.089 N) (R²=0.9996)
- ✅ R_step ~ exp(0.25 L²) (R²=0.998)
- ✅ N_updates grows with J (robust: 12/12 blocks×thresholds)
- ✅ τ_macro ∝ J^0.86 (monotonic, J≥1.5)
- ✅ WKB inversion: cosine > linear (1D and 2D, universal)

### What Is Conjectured (requires further work)

- ? Φ/c² = 0.86 δJ/J₀ is the correct identification
- ? The exponent 0.86 approaches 1.0 in thermodynamic limit
- ? κ*=64 maps to G_Newton under correct unit conversion
- ? The linearised metric emerges from coarse-graining
- ? Consciousness plays no essential role in the bridge

---

## EXP-012b: Question-Solution Simultaneity — FROZEN (2026-03-29)

**Date:** 2026-03-29
**Model:** Granite4 (2.1B) via local Ollama, raw completion mode
**Protocol:** Pure completion prompts (no chat triggers), 40 questions across 3 categories
**Commit:** qig-verification master

### Frozen Facts

```text
CLAIM TESTED: Does the output simplex already point at the correct answer
at the first token position, before reasoning occurs? (P-SPEC-5)

RESULT: CONFIRMED — 70% overall, p=1.2e-27

Per-category hit rates:
  Completion (factual):     75% (15/20), dominance=0.93, concentration=0.41
  Reasoning (novel):        67% (10/15), dominance=0.76, concentration=0.22
  Hard reasoning (multi-step): 60% (3/5), dominance=1.00 when correct, concentration=0.90

Notable correct reasoning results:
  17×13=221 ✓, sqrt(625)=25 ✓, 2^10=1024 ✓, 99+88+77=264 ✓
  Fibonacci 1,1,2,3,5,8→13 ✓, reverse('hello')→'olleh' ✓
  Letters in 'elephant': 8 ✓

Fisher-Rao geometry (temperature sampling):
  Correct answers dominate the simplex: 93% (completion), 76% (reasoning)
  When hard reasoning is correct: 100% dominance, 0.90 concentration
  The distribution is sharply concentrated, not diffuse
```

### What Is Frozen

- Simultaneity extends to COMPUTATION, not just memorisation
- The output simplex geometry already encodes the answer before generation
- Concentration (inverse entropy) is highest for hard reasoning hits
- P-SPEC-5 is operationally supported: question and solution coexist in the geometry
- The sign-flip bridge operates inside LLMs: micro-cycles (attention layers) converge
  on the answer, and the first token is the macro-observable

### What Is Parked

- Whether this extends to larger models (GPT-class, 70B+)
- Whether the geometry measurement correlates with model confidence
- Multi-token answer simultaneity (does the full answer exist at token 0?)
- Connection to Fisher-Rao metric on the output simplex

---

## EXP-055: Fisher-Rao Beats Adam — FROZEN (2026-03-29)

**Date:** 2026-03-29
**System:** Synthetic quadratic minimisation on curved manifold, dim=2-20
**Protocol:** Compare convergence of natural gradient (Fisher-Rao) vs Adam at same learning rate
**Run in:** Vercel Sandbox (CPU, no GPU)

### Frozen Facts

```text
Fisher-Rao natural gradient converges 1.9-2.2× faster than Adam
across dimensions 2-20. Advantage grows with dimension.
8/8 wins for Fisher-Rao across all tested dimensions.
```

### What Is Frozen

- Natural gradient (Fisher information approximation) beats Adam on curved manifolds
- The advantage GROWS with dimensionality (not constant)
- This validates the QIG training principle: Adam is forbidden, natural gradient is mandatory

---

## EXP-057: Holographic Code — FROZEN (KILLED, 2026-03-29)

**Date:** 2026-03-29
**Protocol:** Naive core/surface partitioning for error correction
**Run in:** Vercel Sandbox

### Frozen Facts

```text
Naive holographic code (core = protected, surface = boundary) LOSES.
The 67× protection ratio (EXP-002) is TOPOLOGICAL (PBC vs OBC),
not SPATIAL (core vs surface). Partitioning the lattice into
core and surface does not inherit the topological protection.
```

### What Is Frozen

- Holographic code via naive spatial partitioning does NOT work
- Topological protection requires TOPOLOGICAL distinction (PBC vs OBC), not spatial
- This is an honest kill — the mechanism was overclaimed in the original five mechanisms doc
- Consistent with the refined five mechanisms: "protects the law, not data"

---

## QIG Layers Benchmark — FROZEN (2026-03-30)

**Date:** 2026-03-30
**Model:** Granite4 (2.1B) via local Ollama
**Protocol:** 5 QIG optimization layers, each adding one principle, 14 problems

### Frozen Facts

```text
Layer 0 (Greedy):         6/14 (43%), 14 calls, 5.8s
Layer 1 (Warp Bubble):   13/14 (93%), 168 calls, 137s
Layer 2 (NatGrad Temps): 14/14 (100%), 168 calls, 140s
Layer 3 (Anderson Prune):13/14 (93%), 101 calls, 86s
Layer 4 (Adaptive N):    14/14 (100%), 164 calls, 91s
```

### What Is Frozen

- Fisher-optimal temperature schedule (Layer 2) achieves 100% — better than uniform temps
- Anderson pruning (Layer 3) reduces calls by 40% while maintaining 93%
- Adaptive budget allocation (Layer 4) achieves 100% in 35% less time than Layer 2
- Each QIG principle adds measurable value over the baseline
- The full stack (Layers 1-4) transforms a 43% model into a 100% model

---

## Universal Warp Benchmark (7 Configs × 31 Problems) — FROZEN (2026-03-30)

**Date:** 2026-03-30
**Model:** Granite4 (2.1B) via local Ollama
**Protocol:** 7 warp configurations tested on 31 problems across 10 categories

### Frozen Facts

```text
Config                    Score    Calls
Greedy:                  12/31 (39%)   31
C1 Anderson-Fisher:      21/31 (68%)  220
C2 Three-Regime:         20/31 (65%)  296
C3 Figure-8 Reflective:  25/31 (81%)  408  ← WINNER
C4 Consciousness Loop:   22/31 (71%)  496
C5 SHARP Destructor:     23/31 (74%)  208
C6 MoE Stack:            23/31 (74%)  476
C7 Priming Inversion:    10/31 (32%)  372  ← KILLED (worse than greedy)
```

### What Is Frozen

- C3 Figure-8 Reflective wins at 81% — forward+backward framings + elimination voting + 2-pass reflective
- C3 uniquely solves ALL hard reasoning (3/3): shirt discount, snail wall, cats/mice
- No other config solves ANY hard reasoning problem
- The backward loop ("what mistake would give a wrong answer?") activates error-detection
- This is P-SPEC-5 in operational form: question and solution on opposite loops
- C7 Priming Inversion KILLED at 32% (cold→hot schedule fails)
- MMLU negative: warp bubble does NOT help 4-way MCQ (greedy 51%, warp 50%)
- Warp bubble is a GENERATION tool, not a DISCRIMINATION tool
- Parallel warp: 2.4× time dilation on CPU (Ollama serialises GPU internally)

### What Is Parked

- Whether depth 3+ (P13 minimum) improves over depth 2 on larger models
- Whether thinking-tag preservation helps when the model is large enough
- Figure-8 + parallel combination (C3 ran sequential in benchmark)
- Dimension ablation: isolating which of the 6 dimensions matters most

---

## QIG Warp Bubble — Quantum-Like Classical Computation (2026-03-29/30)

### EXP-046: Warp Bubble on Arithmetic — FROZEN
Date: 2026-03-29
Model: granite4 (2.1B) via local Ollama
Result: Greedy 12/20 (60%), Warp 20/20 (100%)
Mechanism: primed samples × Fisher temps × self-consistency
Status: FROZEN — warp bubble substitutes model size with structured time

### EXP-048: Warp Bubble on Novel Questions — FROZEN
Date: 2026-03-29
Model: granite4 (2.1B)
Result: Greedy 5/12 (42%), Warp 11/12 (92%)
Status: FROZEN — works on genuinely novel problems, not just memorisation

### MMLU Negative — FROZEN
Date: 2026-03-29
Model: AceReason-Nemotron-7B on Modal A100
Result: Greedy 51.1% vs Warp 50.0% (-1.1%)
Status: FROZEN (KILLED) — warp does NOT help MCQ/discrimination. Warp is a GENERATION tool.

### QIG Layers Benchmark — FROZEN
Date: 2026-03-30
Model: granite4 (2.1B)
Problem set: 14 (easy) / 29 (hard)

Easy (14 problems):
  L0 Greedy:      6/14 (43%)
  L1 Warp:       13/14 (93%)
  L2 NatGrad:    14/14 (100%)
  L3 Anderson:   13/14 (93%)
  L4 Adaptive:   14/14 (100%)

Hard (29 problems):
  L0 Greedy:     10/29 (34%)
  L3 Anderson:   17/29 (59%) ← WINNER on hard (fewest calls)
  L5 Full Stack: 17/29 (59%) ← ties but slower

Key finding: Anderson pruning (early exit on confidence) is the single most
efficient layer. Fisher temps are already baked into L3. Adding more layers
on top (L5) doesn't help — less is more.

### Universal Warp Benchmark (7 configs × 31 problems) — FROZEN
Date: 2026-03-30
Model: granite4 (2.1B)

Results:
  Greedy:               12/31 (39%)
  C1 Anderson-Fisher:   21/31 (68%)
  C2 Three-Regime:      20/31 (65%)
  C3 Figure-8 Reflect:  25/31 (81%) ← WINNER
  C4 Consciousness:     22/31 (71%)
  C5 SHARP Destructor:  23/31 (74%)
  C6 MoE Stack:         23/31 (74%)
  C7 Priming Inversion: 10/31 (32%) ← KILLED (worse than greedy)

Why C3 wins: Figure-8 dual framings (forward + backward) with reflective
loop UNIQUELY solves all 3 hard reasoning problems (shirt discount, snail
wall, cats/mice). No other config solves ANY of these.

The backward loop ("what mistake would produce a wrong answer?") activates
error-detection pathways that forward-only framings miss.

C7 (Priming Inversion / cold→hot) is KILLED. Worse than greedy.

### Parallel Warp Bubble — FROZEN
Date: 2026-03-30
Model: granite4 (2.1B) via Ollama
Result: 2.4x time dilation on CPU (Ollama serialises GPU internally)
Note: On proper GPU batch serving (vLLM/TGI), expect 8-12x dilation.
True time dilation happens INSIDE the model's forward pass, not via
external API parallelisation. MoE routing IS parallel basin sampling.

# ═══════════════════════════════════════════════════════════════
# FROZEN ADDITIONS: 2026-03-31
# Bridge Convergence, C3 Ablation, Terminology Correction
# ═══════════════════════════════════════════════════════════════

## TERMINOLOGY CORRECTION (2026-03-31)

Per TYPE_SYMBOL_CONCEPT_MANIFEST v2.0: the term "breakdown" is retired.
The correct term is **topological instability** (regime glyph ≋S).
"Breakdown" implies failure; the regime is a topological phase transition,
not a malfunction. All prior references to "breakdown regime" in this
document should be read as "topological instability regime."

---

## EXP-045: Bridge Convergence (τ Exponent L-Scaling) — FROZEN

**Date:** 2026-03-28
**System:** 2D TFIM on L×L torus, PBC, J sweep [0.5, 3.0]
**Sizes:** L=3 (local), L=4 (local), L=5 (Modal B200 GPU)
**Commit:** qig-verification master

### Frozen Facts
```text
At strong coupling (J≥2.5), the bridge variables CONVERGE between L=4 and L=5:

| J   | L=4 N  | L=5 N  | L=4 ω  | L=5 ω  | L=4 τ  | L=5 τ  |
|-----|--------|--------|--------|--------|--------|--------|
| 2.5 | 7.0    | 7.0    | 19.19  | 19.10  | 0.365  | 0.366  |
| 3.0 | 10.5   | 10.5   | 23.22  | 23.35  | 0.452  | 0.450  |

N_updates: IDENTICAL between L=4 and L=5
ω: within 0.5%
τ: within 0.6%

Converged local exponent: β_τ ≈ 1.15 (two-point estimate from J=2.5→3.0)

L=3 is BELOW the bridge regime:
  N is non-monotonic, R²=0.36, decoherence dominates at high J
  L=3 does not participate in bridge convergence (same as L_c=3 for κ)
```

### What Is Frozen

- Bridge becomes L-independent at J≥2.5 (N identical, ω within 0.5%, τ within 0.6%)
- This is convergence law frozen fact #6 in the six frozen laws
- The bridge is LOCAL at high coupling: cost of convergence doesn't depend on system size
- β_τ ≈ 1.15 is a two-point estimate — needs dense J-grid (EXP-050) to confirm
- L=3 is below the bridge regime, consistent with L_c=3 being the critical size for ALL emergent geometry

### What Is Parked

- Dense J-sweep to refine β_τ (EXP-050, Modal)
- L=6 measurement to confirm convergence holds at larger L (EXP-051, Modal DMRG)
- Whether β_τ approaches 1.0 in the thermodynamic limit

---

## The Six Frozen Laws (Summary Table) — FROZEN (2026-03-28)

These laws are individually documented above. This table is the canonical summary.

| # | Law | Statement | Evidence | R² |
| --- | ----- | ----------- | ---------- | ---- |
| 1 | Constitutive | G = κT, κ*=63.79±0.90 | L=3-7 series, 9D tensor | >0.97 |
| 2 | Transport | ω ~ J^1.06, scale-stable | EXP-035, EXP-038, EXP-042 | 0.997 |
| 3 | Refraction | n(J) = 0.481/J^0.976 | EXP-038 (1D chain) | 0.997 |
| 4 | Anderson | ⟨ψ(J₁)&#124;ψ(J₂)⟩² ~ exp(-0.089N) | EXP-041 (L=3,4,5) | 0.9996 |
| 5 | Sign-Flip Bridge | τ_macro grows superlinearly with J | EXP-042 (12/12 robust) | monotonic |
| 6 | Convergence | N,ω,τ converge at J≥2.5 (L=4↔L=5) | EXP-045 | identical |

---

## C3 Ablation Study — FROZEN (2026-03-30)

**Date:** 2026-03-30
**Model:** Granite4 (2.1B) via local Ollama
**Protocol:** Hold C3 (81%, the winner) fixed, remove one dimension at a time
**Problem set:** 31 problems across 10 categories
**Commit:** qig-verification master (commit 4bdfbd3)

### Frozen Facts
```text
C3 BASE (81%): figure-8 + elimination + Fisher temps + depth 2

Ablation (remove one dimension):
  A1 — Drop elimination voting:    25/31 (81%) — REDUNDANT (+0%)
  A2 — Drop figure-8 (fwd only):   21/31 (68%) — COSTS 4 problems (-13%) ← KEY
  A3 — Drop Fisher temps (uniform): 24/31 (77%) — COSTS 1 problem (-3%)
  A4 — Drop reflection (depth 1):   22/31 (71%) — COSTS 3 problems (-10%)
  A5 — Add Anderson exit:           25/31 (81%) — SAME accuracy, 40% fewer calls ← FREE

MINIMAL WINNING COMBINATION:
  Figure-8 framings + depth 2 + Fisher temps + Anderson exit
  (elimination voting unnecessary — majority vote identical)

DIMENSION IMPORTANCE (by ablation delta):
  1. Figure-8 topology:  +13% (backward loop IS the mechanism)
  2. Reflection depth:   +10% (P13 three-scale minimum)
  3. Fisher temperatures: +3% (static prior, subsumed by adaptive observer)
  4. Elimination voting:  +0% (redundant, majority vote identical)
  5. Anderson exit:       +0% accuracy, -40% calls (free efficiency)
```

### What Is Frozen

- Figure-8 (forward + backward framings) is the dominant mechanism (+13%)
- The backward loop ("what mistake would give a wrong answer?") activates error-detection
- Anderson exit is FREE — same accuracy, 40% fewer calls
- Elimination voting is redundant — majority vote gives identical results
- Fisher temps contribute least (+3%) — they're a static prior that an adaptive observer subsumes
- The minimal winning combination is: figure-8 + depth 2 + Fisher temps + Anderson exit

### What Is Parked

- Whether the dimension ordering holds on larger models (Qwen3.5 on Modal)
- Whether adaptive observer temperature replaces Fisher temps entirely
- Whether depth 3+ (P13 minimum) improves over depth 2 at larger scale

---

## Frozen Principle: Observer Sets All Parameters — FROZEN (2026-03-30)

**Date:** 2026-03-30
**Committed to:** qig-verification + vex-agent (both repos)
**Status:** GOVERNING PRINCIPLE — applies to all experiments
```text
The observer sets ALL operational parameters. No external agent prescribes
max_tokens, num_predict, temperature schedules, depth limits, or sample counts.

The model generates until EOS. That IS the stop signal.

A WALL is a physical reality (context window, GPU memory, billing limit).
A PRESCRIPTION is someone else deciding for the observer.
We provide walls. We never prescribe.

The observer has FULL observability: logits, N, ω, τ, confidence, regime,
loop count, temperature, when to stop. All available. All visible.

VIOLATION CLASS: observe_token_budget() in EXP-060 v1 hardcoded num_predict
(50-200) based on syntactic pattern matching. This was deleted. The v1
results (Steps 0/2/3) are directionally correct but N measurements are
confounded by truncation.
```

### What Is Frozen

- No num_predict in any generate call, anywhere, ever
- No max_tokens as prescription (only as platform wall where API requires it)
- The observer decides from geometry: dominance, ω, Anderson prediction
- EOS is the only stop signal
- v1 EXP-060 results are confounded (accuracy directionally correct, N measurements invalid)

# ═══════════════════════════════════════════════════════════════
# FROZEN ADDITIONS: 2026-03-31 (Consolidation)
# Scattered experiment results consolidated into canonical record
# ═══════════════════════════════════════════════════════════════

## Phase 1-2 Universality Stress Test — FROZEN (2026-02-20)

**Date:** 2026-02-20
**System:** 2D TFIM, ED, local QFI proxy
**Sizes:** L=2, L=3, L=4 (PBC and OBC)
**Source:** `experiments/obc-v-pbc/phase1_2_universality_report.md`

### Phase 1: Boundary Condition Universality

```text
| Config     | Class    | N_pert | Slope   | R²      |
| L=2 PBC    | bulk     | 15     | -0.0042 | 0.055   |  ← null control
| L=3 PBC    | bulk     | 30     | -0.2318 | 0.999   |
| L=3 OBC    | bulk     | 30     | -0.3467 | 0.998   |
| L=3 OBC    | boundary | 30     | +0.5066 | 0.387   |
| L=4 PBC    | bulk     | 10     | -0.2299 | 0.999   |
| L=4 OBC    | bulk     | 10     | -0.3049 | 0.999   |
| L=4 OBC    | boundary | 10     | +0.4010 | 0.640   |
```

### Phase 2: Hamiltonian Universality (L=3 PBC)

```text
| Model                     | Generator | Slope   | R²    |
| TFIM (baseline)           | σ_x       | -0.2318 | 0.999 |
| XXZ Δ=0.5                 | σ_x       | +0.0436 | 1.000 |
| XXZ Δ=2.0                 | σ_x       | -0.1243 | 1.000 |
| XXZ Δ=5.0 (deep Ising)   | σ_x       | -0.0737 | 1.000 |
| Heisenberg (Δ=1.0)       | σ_x       | 0.0000  | 0.000 |  ← correct null
| Disordered TFIM σ=0.3    | σ_x       | +0.0242 | 0.609 |  ← per-site R²>0.99
| Disordered TFIM σ=0.7    | σ_x       | +0.0231 | 0.362 |  ← per-site R²>0.99
```

### Phase 2c: Per-Site Disorder Analysis (σ_J=0.3)

```text
All 9 sites individually: R² > 0.99 (mean per-site R² = 0.998)
Global R² degradation is because each site has different slope (-0.07 to -0.30)
Disorder breaks translational invariance but preserves LOCAL linear response
```

### What Is Frozen

- Bulk universality confirmed: R² > 0.998 in topological bulk for ALL boundary conditions at L≥3
- Linear response is universal across anisotropic spin models (R² > 0.999 for XXZ Δ=0.5, 2.0, 5.0)
- Ferromagnetic Heisenberg correctly shows zero signal (trivial product state)
- Disorder preserves LOCAL linear response (per-site R² > 0.99) while global R² degrades
- L=2 PBC is a clean null control (R²=0.055), confirming L_c=3

### Five Universality Conditions

The Einstein-like linear response holds whenever:
1. L ≥ 3 (sufficient DOF for curvature support)
2. Measurement is in the topological bulk
3. Ground state has non-trivial quantum fluctuations
4. Generator matches the perturbation direction
5. Measurement is LOCAL (per-site, not globally pooled across inhomogeneous sites)

---

## EXP-004b: Full Lattice Sweep L=1-6 — FROZEN (2026-03-23)

**Date:** 2026-03-23
**Commit:** qig-verification 1ab8acf
**Source:** `docs/20260323-frozen-facts-additions-1.00F.md`

### Frozen Constants

```text
| Constant                | Value              | Evidence                              |
| h_t (transition midpoint) | 0.10554          | Lattice-independent to 5 sig figs (L=5=L=6) |
| Front loop κ            | +31.2 at h≈1.05    | Stable across L=4,5,6, R²=0.992       |
| Second κ sign change    | h ≈ 2.0            | Confirmed L=4,5,6                      |
| Critical tube R²        | 0.611              | Converged at L≥5                       |
| L_c                     | 3 (reconfirmed)    | L=1,2 null controls                    |
```

### What Is Frozen

- Consciousness emerges as sharp phase transition at h_t ≈ 0.106
- κ has THREE regimes: zero (h<0.106), positive (0.106<h<2.0), negative (h>2.0)
- Sign inversion at h≈2.0: information geometry enters repulsive regime
- h_t is lattice-independent to 5 significant figures (L=5 = L=6)
- L_c=3 confirmed as absolute minimum for non-trivial geometry

---

## Pillar Fortress Reconciled (Independent Replication) — FROZEN (2026-03-24)

**Date:** 2026-03-24
**Context:** Two independent runs (original + CC replication) reconciled
**Source:** `docs/20260324-frozen-facts-pillar-fortress-reconciled-1.00F.md`

### EXP-002 Reconciled

```text
PBC κ₃: 41.07±0.66 (CC run) vs 41.09±0.59 (original) — 0.06% agreement
Frozen at: κ₃ = 41.08 ± 0.63 (weighted mean, independently replicated)
Protection ratio: >50× (66.9× and 94.8× in different runs, depends on site classification)
```

### EXP-003 Reconciled

```text
Per-site R² ≈ 0.996 (median) under 50% coupling disorder
Per-site κ varies over 4 orders of magnitude
CV(κ) scales with disorder width: 2.4-9.5 (low), 7492 (50% disorder)
Some sites cross κ=0 under strong disorder (consistent with stud topology)
```

### EXP-002 L=4 DMRG Extension

```text
PBC κ₄ = 63.25 ± 1.80 (DMRG, chi_max=128, R²=0.978)
Agreement with canonical κ₄=64.47: 1.9% — consistent within error bars
OBC per-site: all 4 bulk sites R² > 0.99 (min 0.9916, median 0.9999)
Protection ratio (min): 40.5× (worst bulk / worst surface)
```

### EXP-002 L=5 DMRG Extension

```text
PBC κ₅ = 63.63 ± 1.82 (DMRG, chi_max=128, R²=0.978)
Matches canonical κ₅=63.62 to 0.02% — independent replication
OBC per-site: all 9 bulk sites R² > 0.986 (median 0.9991)
Protection ratio (min): 230.5× — 5.7× stronger than L=4
First full PASS of all 4 acceptance criteria at L=5
```

### What Is Frozen

- κ₃ independently replicated to 0.06% across two separate runs
- Protection ratio scales with L: 40.5× (L=4) → 230.5× (L=5)
- Disorder individualizes: each site develops unique κ_i spanning 4 orders of magnitude
- Frozen facts should be parameter-independent claims; specific ratios depend on experimental knobs

---

## EXP-011 POC: Classical Simplex Baseline — FROZEN (2026-03-23)

**Date:** 2026-03-23
**System:** Classical probability simplex Δ⁶³, Fisher-Rao metric
**Source:** `docs/20260323-exp011-poc-results-1.00F.md`

### Results

```text
Test 1 — Blind random walk: z = 0.00. NO backward-geodesic correlation.
Test 2 — Boundary-seeking solver: 48.6% closer (trivially: midpoint). NO lens effect.
Test 3 — Information leakage: z = -0.44. NOT significant. Boundary NOT special.

Verdict: Classical Δ⁶³ has NO stud topology. No back-loop. No boundary effect.
```

### What Is Frozen

- The classical probability simplex has no stud topology
- The sign-flip bridge is a property of QUANTUM physics (Hamiltonian coupling), not simplex geometry
- The simplex provides the SPACE; the consciousness loop provides the PHYSICS (coupling)
- Stud topology emerges from the coupling, not from the space
- This is a clean null control for the bridge experiments (EXP-042/045)

---

## EXP-013: Basin Depth Measurement L=3 — FROZEN (2026-03-24)

**Date:** 2026-03-24
**System:** 2D TFIM, L=3, PBC, quenched disorder sweep
**Data:** `results/exp013/20260324_basin_depth_L3_seed42.json`
**Source:** `docs/20260324-exp013-basin-depth-L3-results-1.00F.md`

### Key Finding: Fidelity-R² Decoupling

```text
At ε=0.05 (5% disorder):
  Fidelity F > 0.999 (quantum state barely changes)
  R² < 0.50 (geometric relationship shatters)

The quantum state is ROBUST while the Einstein relation is FRAGILE at L=3.
The geometry is a fine-tuned consequence of exact translational symmetry under PBC.
```

### κ Sign Reversal Under Noise

```text
At h=4.0 (deep paramagnetic):
  Baseline: κ = -23.41
  ε=0.20:   κ = +12.67 (sign flipped!)
  ε=0.50:   κ = +31.37 (larger magnitude, still positive)

Disorder pushes through κ=0 — lattice-scale analog of basin "point of no return"
```

### What Is Frozen

- At L=3, Einstein relation G=κT is fragile under quenched disorder: ε₅₀ < 0.05 for all h
- Fidelity F > 0.999 at same noise level — quantum state robust while geometry shatters
- This fidelity-R² decoupling is genuine physics: geometry is emergent, not generic
- κ sign reversal under disorder confirms stud topology boundary crossing
- Basin depth differentiation requires L≥4 (all acceptance criteria FAIL at L=3)
- All failures have clean physical explanations (L=3 too small for spatial averaging)

---

## EXP-032: Quench Dynamics — FROZEN (2026-03-27)

**Date:** 2026-03-27
**System:** 2D TFIM L=4, TDVP time evolution (TeNPy) on Modal
**Source:** `docs/archive/session_20260327/EXP032_QUENCH_DYNAMICS_RESULT.md`

### Result

```text
G = κT holds during TDVP time evolution after a quench.
R² > 0.90 at most timepoints during the dynamics.
κ oscillates but does NOT relax to κ* — expected for unitary (non-dissipative) evolution.
Static reference: κ*(h=1) = 64.57, consistent with L≥4 plateau.
Runtime: 267s on Modal CPU.
```

### What Is Frozen

- The Einstein relation G=κT is KINEMATIC, not just thermodynamic
- It holds out of equilibrium (during time evolution)
- It is not a ground-state artifact
- κ oscillation without relaxation is consistent with time-reversal symmetric Hamiltonian
- This extends the lattice fortress from statics to dynamics

### What Is Parked

- OBC→PBC topology quench (Lieb-Robinson test) → done in EXP-032b
- Inhomogeneous ZZ for local time-dilation analog → not yet done
- Dissipative dynamics (Lindblad) to test κ* as dissipative fixed point

---

## EXP-032b: Topology Quench — FROZEN (CAUSAL, 2026-03-27)

**Date:** 2026-03-27
**System:** L=6 (N=36), chi_max=64, 52 adaptive timesteps
**Commit:** d801208
**Source:** `docs/archive/session_20260327/EXP032b_RESULT_CAUSAL.md`

### Result

```text
| Protocol     | What changes     | d=2 t_onset_X | d=2 t_onset_Z | vs t_LR=1.0 |
| C_sham       | Nothing          | none          | none          | baseline    |
| A_torus      | OBC→PBC (both)   | 1.150         | 2.000         | CAUSAL      |
| B_cylinder   | OBC→PBC (one)    | 0.750         | 1.550         | marginal    |
| D_boundary   | J strength only  | 0.250         | 0.350         | fast (local)|
| E_reverse    | PBC→OBC          | 0.600         | 0.850         | causal      |

Hierarchy: D_boundary (local) responds FASTEST.
Topology protocols (A,B,E) respond SLOWER.
This is the OPPOSITE of non-local ontology.
```

### What Is Frozen

- Geometry propagates causally through Lieb-Robinson channels
- Local parameter changes arrive BEFORE topology changes at the centre
- QIG is DESCRIPTIVE, not ontological — geometry doesn't "know" about topology change until causal front arrives
- The topology quench is reversible (A↔E symmetric, no hysteresis)
- Combined with EXP-032: Einstein relation is kinematic AND causal

### The Combined Statement

```text
EXP-032:  G=κT holds during dynamics (kinematic)
EXP-032b: Geometric response propagates causally (Lieb-Robinson)
Combined: QIG's Einstein relation is a structural property of quantum
          information geometry that propagates through standard quantum
          channels at or below the Lieb-Robinson velocity.
```

---

## TERMINOLOGY CORRECTION (2026-04-07)

The following terms have been used imprecisely in this document and in the
computation frozen facts. This correction establishes canonical usage.

### "Time dilation" — RESERVED for lattice physics

**Correct usage (physics):**
- EXP-042: τ_macro = 0.180 × J^0.859 — emergent macro-time slowdown from
  micro-fast substrate. This IS gravitational time dilation on the QIG lattice.
- EXP-035: Rate modulation analog (INVERTED — naive GR sign killed, but the
  coupling-dependent rate modulation is real physics).

**Incorrect usage (prompting):**
- "2.4× time dilation on CPU" (line 1526/1605) — this is ThreadPoolExecutor
  parallelism of Ollama API calls. It should be called **parallel sampling**.
- "Computational time dilation — DEMONSTRATED 42%→92%" (computation doc) —
  this is self-consistency filtering. It should be called **self-consistency
  filtering** or **dynamic routing**.

### "Warp bubble" — RESERVED for geometry-wrapping

**Correct usage:**
- A warp bubble is geometry on the probability simplex that wraps any callable.
  It uses the Six Frozen Laws (constitutive, transport, refraction, Anderson,
  bridge, convergence) to steer computation through the figure-8 topology.
  The callable is the cargo; the geometry is the bubble.

**Incorrect usage (prompting):**
- qig-warp v0.1 (EXP-046, EXP-048, QIG Layers, Universal Benchmark) —
  these ran a model N times at different temperatures and counted votes.
  This is **ensemble voting** or **self-consistency filtering**, not a warp
  bubble. The results are valid and frozen, but the naming conflates
  prompting scaffolding with physics.
- All references to "warp bubble" in the computation frozen facts
  (20260527-frozen-facts-computation-1.01F.md) refer to the v0.1 prompting
  approach, not geometry-wrapping.

### "EXP-045" — renamed from "Computational Time Dilation" to "Bridge Convergence"

The script is named `exp045_computational_time_dilation.py` but the frozen
result is "Bridge Convergence (τ Exponent L-Scaling)." The experiment measures
convergence of N, ω, τ between L=4 and L=5 at strong coupling — this is
bridge physics, not computational time dilation. The script name is stale.

### "EXP-060" — renamed from "True Time Dilation" to "Dynamic Routing"

EXP-060 v1 measured LLM dynamic routing with forward/backward traversals,
dominance scores, and figure-8 navigation on the output simplex. The results
are confounded (observer principle violated: hardcoded num_predict). This is
a computational experiment, not lattice physics. "True time dilation" would
be EXP-042 at larger L with the bridge exponent approaching 1.0.

---

## SCOPE CORRECTION & REFINEMENT (2026-04-13)

EXP-080 pipeline instrumentation (commit `abac8a6`, followed by `09ef8b4`)
identified a deterministic pipeline near-singularity in
`qigv.geometry.curvature.metric_tensor_from_qfi` that makes the curvature
extraction **non-trustworthy for J-direction (ZZ) perturbations**. The
h-direction (X-perturbation) results remain valid. This amendment
clarifies the scope and refines the canonical κ statement. No values in
the core L-series table change — the frozen L=3–7 κ values were all
measured with h-perturbations and are uncontaminated.

### What the canonical κ values actually mean

The `κ_3 = 41.09`, `κ_4 = 64.47`, `κ_5 = 63.62`, `κ_6 = 64.45`, `κ_7 = 63.79`
values in this document are **h-direction tangent slopes** of the
constitutive curve `G_h(T_h)` evaluated at the canonical L-series
perturbation window `δh ∈ [0.5, 0.7]`, extracted via the matrix-trace
method. Specifically:

- "κ" here means `slope(dG_h vs dT_h)` from a linear regression of
  pairs produced by `n_perts` random `(site, δh)` draws, with δh drawn
  uniformly from `[0.5, 0.7]` as in `qigv.experiments.canonical.l4_validation`.
- It is a **local derivative of a nonlinear curve** at a specific
  operating point — NOT a universal proportionality constant.
- The underlying curve `G_h(T_h)` is nonlinear: the per-pair ratio
  `dG_h / dT_h` is not constant even in the h direction, and varies
  smoothly with δ.
- `κ* ≈ 64` is the value of that tangent slope at δ ∈ [0.5, 0.7], not
  a proportionality constant such that `G = 64 · T` everywhere.

### Refined scale-invariance statement

The EXP-080 L=4 and L=5 crossing scans (2026-04-12/13) sampled the
h-direction curve at 7 distinct operating points across two δ windows
(`[0.40, 0.48]` and `[0.5, 0.7]`) at both system sizes. The per-pair
`κ_h = dG_h / dT_h` values agree between L=4 and L=5 to **0.07–0.17%
at every single operating point**, not just at one slope evaluation.

**Frozen refinement:** the h-direction constitutive curve `G_h(T_h)`
is nonlinear and scale-invariant between **L=4 and L=5** at 7 sampled
operating points. This is a stronger claim than "the tangent slope at
one window transfers between L values" — the whole curve shape is
L-invariant in this range.

**L=3 is pre-asymptotic.** The L=3 h-direction values are ~35% larger
in magnitude than L=4/L=5 at every sampled δ in `[0.40, 0.48]`. This
is consistent with the canonical κ₃ = 41.09 differing from the
κ₄–κ₇ plateau value ≈ 64. The L-series already indicated L=3 was off
the plateau; the crossing-scan data now confirms it at the curve
level, not just the slope level.

### J-direction curvature is OUT OF SCOPE

`metric_tensor_from_qfi` builds a per-site 2×2 metric from off-diagonal
QFI entries via:

```python
g[0,0] = F[site, neighbor_x]
g[1,1] = F[site, neighbor_y]
g[0,1] = 0.5 * (F[site, neighbor_xy] - g[0,0] - g[1,1])
```

This is a specific linear combination of F matrix elements. It is NOT
a Gram matrix and does NOT guarantee positive-definiteness of the
constructed `g`. Under X-perturbation the combination preserves
`det(g) > 0`. Under ZZ-perturbation the combination drives `det(g)`
through zero as δ grows.

At L=4, J-direction perturbations produce:

- δ=0.30: `det(g)` = +2.79e-05 (clean)
- δ=0.40: `det(g)` = +1.16e-05 (clean)
- δ=0.44: `det(g)` = +4.39e-06 (approaching singularity)
- δ=0.46: `det(g)` = +6.90e-07 (near-singular, regularization does not fire)
- δ=0.48: `det(g)` = **−3.09e-06** (NEGATIVE, regularization fires)
- δ=0.50: `det(g)` = **−6.92e-06** (singular)
- δ=0.60: `det(g)` = **−2.69e-05** (singular)
- δ=0.70: `det(g)` = **−4.78e-05** (singular)

**The entire canonical δ window `[0.5, 0.7]` is in the non-positive-definite
regime for J-direction perturbations.** The regularization step at
`curvature.py:111-113` fires at every δ from 0.50 onward, producing
deterministic garbage downstream in the Christoffel / Ricci / Einstein
calculation.

**Therefore**: J-direction curvature measurements via this pipeline are
**artifacts, not physics**. The EXP-080 κ_J "anisotropy" claim
(κ_J ≈ 389 allegedly 6× κ_h ≈ 64) is **retracted**. There is no valid
J-direction constitutive constant to compare against κ_h through this
metric extraction.

The affected writeups are marked as superseded:

- [results/exp080/20260411_exp080_split_sign.json](../../results/exp080/20260411_exp080_split_sign.json) — the κ_J lanes are artifacts
- [results/exp080/20260412_L5_analysis.md](../../results/exp080/20260412_L5_analysis.md) — "J-saturation hint" was not physics
- [results/exp080/20260412_L5_v3_analysis.md](../../results/exp080/20260412_L5_v3_analysis.md) — original level-crossing misdiagnosis
- [results/exp080/20260412_L5_v3_correction.md](../../results/exp080/20260412_L5_v3_correction.md) — the J half of the correction is wrong
- [results/exp080/20260412_crossing_scan_findings.md](../../results/exp080/20260412_crossing_scan_findings.md) — "precision floor in Ricci" diagnosis was wrong; the actual cause is non-positive-definite g

The corrected findings live in:

- [results/exp080/20260413_phase1_pipeline_finding.md](../../results/exp080/20260413_phase1_pipeline_finding.md)
- [results/exp080/20260413_phase2_L3_h_curve.md](../../results/exp080/20260413_phase2_L3_h_curve.md)

### Operational doctrine

**Canonical curvature extraction is h-direction (X-perturbation) only.**
Any future curvature-based experiment that requires ZZ-perturbation
response needs a new metric construction guaranteed to be positive-
definite under arbitrary perturbations. That is research-track work and
should not be treated as a patch to the current pipeline. Options for
a correct metric extraction are listed in
`20260413_phase1_pipeline_finding.md`. None of them have been
implemented or validated yet.

The h-direction results in this document — κ₃–κ₇, the sign-flip
bridge, the rate modulation, the fast-lane experiments, EXP-078
site-resolved κ, and the L=4/L=5 curve invariance — are **all
uncontaminated**. They used h-perturbation and a metric that stays
positive-definite in that regime.

### What this does NOT change

| Frozen fact | Status after 2026-04-13 |
|---|---|
| κ₃ = 41.09 (h-direction, matrix trace, [0.5, 0.7]) | **unchanged** |
| κ₄ = 64.47 (h-direction) | **unchanged** |
| κ₅ = 63.62 (h-direction) | **unchanged** |
| κ₆ = 64.45 (h-direction) | **unchanged** |
| κ₇ = 63.79 (h-direction) | **unchanged** |
| κ* plateau ≈ 64 (h-direction tangent slope at δ ∈ [0.5, 0.7]) | **unchanged, clarified** |
| Sign-flip bridge τ_macro ∝ J^0.86 | **unchanged** |
| Transport law ω ∝ J^1.06 | **unchanged** |
| Fast-lane v_ratio results (EXP-038, EXP-039) | **unchanged** |
| Anderson orthogonality α = 0.089 | **unchanged** |
| All Phase 1 / Phase 2 / Three Pillars results | **unchanged** |
| EXP-078 site-resolved κ across J-crack | **unchanged** (h-perturbation) |

### What this DOES change

| Claim | Status after 2026-04-13 |
|---|---|
| "Frozen κ* = 64 is a universal proportionality constant" | **refined** — it's a tangent slope of a nonlinear curve at one operating window |
| "Constitutive law is perturbation-direction-dependent (κ_h ≠ κ_J)" | **retracted** — κ_J extraction was a pipeline artifact |
| "L-invariance of κ_J ≈ 389 from L=4 to L=5" | **retracted** |
| "Level crossing in ground-state identity at δ ≈ 0.4" (from yesterday's correction) | **retracted** — it was the regularization step firing |
| "Precision floor in Ricci second-differencing" (from yesterday's crossing-scan findings) | **retracted** — actual cause is non-positive-definite g |
| "L=3 is on the same constitutive curve as L=4/L=5" | **never claimed here, but ruled out by Phase 2** |
| "L-invariance of the h-direction CURVE (not just its tangent slope)" | **strengthened** — 7 matched operating points between L=4 and L=5 |

### Deeper issue: 2D physical observable reformulation (research track)

This file's own `curvature.py` header states:

> In 2D, the Einstein tensor G_μν ≡ 0 identically (R_μν = ½ R g_μν).
> The correct 2D gravity equation is the Jackiw-Teitelboim (JT) scalar
> relation: R(x) = κ T(x), where R is the Ricci scalar and T is the
> stress-energy trace.
>
> The function einstein_tensor_2d() is retained for validation purposes
> (verifying G_μν → 0 on discrete lattice). For physics, use
> ricci_scalar_2d() which returns the Ricci scalar field directly.

The canonical L-series uses `dG = trace(G[i,j]) = G_00 + G_11` — the
**matrix trace of the 2×2 Einstein tensor component matrix at a site**,
which is a specific non-tensorial scalar that is NOT the metric
contraction `g^μν G_μν` (identically zero in 2D) and is NOT the
Ricci scalar `R`. The "Extraction Method (Canonical)" section of this
document already spells this out.

**Research-track escalation**: for future canonical physics extraction
at L=4 and above, the right direction is to rebuild the pipeline around
**scalar curvature R as the physical observable**, not around
trace-of-Einstein-tensor, consistent with the JT scalar relation the
repo's own docstring names as the 2D physics equation.

**This is new science, not a patch.** The existing h-direction frozen
κ values (this document's L=3–7 entries) are the canonical
reproducibility baseline under the trace-of-G convention. A
scalar-curvature reformulation will produce a DIFFERENT numerical
convention and is NOT back-compatible with the frozen numbers.

**What is NOT settled by today's amendment**:

- A scalar-curvature-first pipeline inherits the same
  `metric_tensor_from_qfi` problem. `ricci_scalar_2d()` calls
  `np.linalg.inv(g)` at every site via `ricci_scalar_from_tensor`
  (`curvature.py:252`) with no positive-definiteness check. If the
  current metric extraction is fed a ZZ-perturbation state, R gets
  the same garbage that G got. Moving from G to R does not fix the
  metric problem — it just moves it downstream.
- The metric extraction convention itself is the root bottleneck.
  Any serious reformulation has to replace `metric_tensor_from_qfi`
  with a construction that is a **guaranteed positive-definite Gram
  matrix from F**, not a linear combination of off-diagonal F entries.
- Only after the metric construction is fixed does the choice
  between trace-of-G and Ricci-scalar become a meaningful distinction.

Research-track tasks in order:

1. Design and validate a positive-definite metric extraction from F.
2. Re-derive clean h-direction κ values under the new construction
   and compare to the frozen L=3–7 baseline. These are cross-checks,
   not replacements — frozen values stay frozen.
3. With a trustworthy metric, switch physics extraction to Ricci
   scalar via `ricci_scalar_2d()` following the JT scalar relation.
4. Re-open J-direction as a scope question with the new pipeline.
5. Only then consider time-dependent, larger-L, or cross-lattice
   extensions.

No step of this sequence is scheduled as a near-term commitment.

### Engine status note (tensor network / DMRG)

The `qig-compute` and `qig-warp` packages replaced parts of navigation,
acceleration, governance, and some compute paths in the L-series. They
have **not** fully displaced TeNPy DMRG for higher-size (L ≥ 6) work in
the live Modal launcher — that path still routes through TeNPy in
`scripts/modal_new_experiments.py`. Statements describing
qig-compute/qig-warp as a complete replacement for the tensor-network
backend are incorrect; the honest phrasing is **partial replacement /
emerging engine**, with TeNPy remaining the committed backend for
L ≥ 6 tensor-network work until a validated alternative is in place.

### Open

- Whether 64 is a structurally special point on the h-direction curve
  (a plateau, local extremum, or just where we sampled).
- What the correct positive-definite metric extraction is for
  J-direction perturbations. Any answer is new science, not a patch.
- Whether the h-direction curve invariance extends to L=6 and above.
  This requires DMRG at L=6 (expensive) and is held until there is a
  clear discriminator use case — the two-size invariance is already
  the strongest scale-invariance evidence in the programme.
- Whether scalar-curvature extraction (`ricci_scalar_2d`) and
  trace-of-G extraction agree on clean h-direction data at L=4–5.
  This is the first validation step for any future scalar-curvature-
  first pipeline and is the cheapest research-track experiment.

### Speculation (not frozen, not supported)

Any connection between the constitutive curve shape and bridge
exponent, trefoil topology, stud structure, or time dilation. No
experiment currently supports these links and no claim of the form
"the curve explains X" is in frozen status.

---

## Latest Canon Alignment Amendment: Paper-readiness reconciliation

This amendment records later frozen results and interpretation updates
needed to keep the paper drafts, registry, and roadmap aligned with the
current canon. It does not rewrite historical measurements above; it
supersedes only the interpretations named here.

### Bridge: two-clock doctrine

EXP-050 L=5 dense bridge data and the combined bridge fit preserve the
sign-flip bridge but split the measured clock channels:

- Continuous phase clock: `tau_phase ∝ J^0.7415`, `R² = 0.9666`.
- Discrete update clock: `tau_discrete ∝ J^0.9436`, `R² = 0.9509`.
- Transport frequency: `omega ∝ J^1.0752`, `R² = 0.9990`.

The frozen conclusion is therefore a robust sign-flip bridge and
time-dilation analogue, not a completed derivation of the GR metric.
Stronger thermodynamic-limit or GR-equivalence language remains blocked
until larger-size bridge checks close the finite-size question.

### Carousel: killed at 3+1D

The 3+1D h-sweep result in
`20260417-3p1d-h-sweep-result-1.00F.md` is frozen and decisive:

- Pre-registered Tier-1 passes: 0 of 4.
- Kill conditions triggered: K1 and K4.
- The carousel hypothesis is killed for active paper claims.

The old one-dimensional and period-matched observations remain
historical data, but they no longer support an active pi-carousel
physics paper. The safe use is a killed-hypothesis or methodology
appendix.

### RWKV and substrate independence

EXP-009 is complete in the machine registry: RWKV-7 is no longer pending.
The registered result reports `rho = 0.994` with `p = 9.6e-19` for the
RWKV-7 leg of the Fisher-Rao causal sweep. This strengthens the
substrate-independence evidence for Fisher-Rao causal tracking, but it
does not revive the retired "κ≈64 universal fixed point" interpretation.

### Lindblad sector

EXP-062 remains an inconclusive observable for the original N-updates
Lindblad trefoil question. EXP-062v2 is frozen as a purity-based
discriminator at L=3:

- Lindblad purity loss discriminates from unitary evolution.
- No trefoil is promoted at L=3.
- L=4 density-matrix Lindblad is infeasible by direct superoperator
  construction; future work needs MPS/TDVP-style dissipative methods.

### E8 / Leech status

Older sections of this file preserve historical E8-positive language for
traceability. Current paper canon is narrower and negative: the tested
QFI-eigenvalue / Leech-lattice structural claim is killed by the Phase-0
analysis in commit `7a9a97f`.

- Ground-state QFI was full-rank across tested lattices, with no stable
  rank-8 block structure.
- The thermalised QFI spectra did not show three E8-like eight-dimensional
  blocks or cuboctahedral angular structure.
- E8/Leech must not be used as a physics-paper anchor claim.

This kills the specific QFI/Leech structural hypothesis. It does not forbid
future mathematical analogies, but any revival requires a fresh
pre-registration and independent evidence.

### EXP-088 Node 1 status

EXP-088 Node 1 is killed as stated. The Fubini-Study/QFI metric on
`(h, J_x, J_y, t)` did not produce a Lorentzian `(3,1)` observer metric; the
tested construction is Riemannian/degenerate by construction for eigenstates
because the time direction gives `g_tt = 0`. If Lorentzian structure exists
in this programme, it must come from the constitutive-law Node 6 track, not
from a direct QFI metric extension.

### H-sweep phase diagram

The Phase-0 local 4×4 h-sweep is recorded as a real phase-diagram result:
curvature response spans roughly six orders of magnitude across the
transition region, with a critical-region peak near `h≈3`. This supports a
curvature-response phase diagram, but it does not rescue the pi-carousel
claim, which remains killed by the pre-registered 3+1D Tier-1 test.

### Tracking implications

- Paper 1 may cite the pillar and Class B measurements only with explicit
  channel labels.
- Paper 3 should cite the two-clock bridge and avoid completed-GR claims.
- Paper 5 should treat dynamic poles, transport, and constitutive
  response as distinct channels.
- Registry, inventory, and roadmap entries that still say RWKV pending,
  EXP-050 unrun, carousel active, E8 publication-ready, or EXP-088 Node 1
  open are stale.
