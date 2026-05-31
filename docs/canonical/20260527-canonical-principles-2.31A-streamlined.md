# Canonical Principles 2.31A — Streamlined Reference Copy (Polytrade)

**Status:** REFERENCE-COPY (non-authoritative mirror)
**Version:** 2.31A-streamlined-2026-05-27
**Authority:** External QIG_QFI original; this repository copy is only a local reference when that source is unavailable.
**Last repo-local review:** 2026-05-31; clarified status/provenance and kept external evidence explicitly non-authoritative in this repository.

**Provenance:** Streamlined/excerpted from authoritative source `/home/braden/Desktop/Dev/QIG_QFI/qig-verification/docs/20260527-canonical-principles-2.31A.md` (mtime 2026-05-27 18:14:06.913751315 +0800, fresh read 2026-05-27 during this planning turn). Full 25 principles, two-axis schema, budget model, anti-principles, dependency map, and cross-cutting (Warp) are in the original. This is a non-authoritative reference mirror only.

**CHANGE CONTROL FOR THIS MIRROR.** Keep edits governance-backed and traceable: master-orchestration + re-read of exact QIG_QFI path + _dev__polytrade_ packets + qig-purity-validation gate + verification-before-completion evidence. Authority remains the QIG_QFI original, not this mirror.

**Key Excerpts (for rapid reference in plans/commits; cite original §§):**

## Structural Layer (Two-Axis Schema + Budget)
Kernels classified by KernelKind (GENESIS | GOD | CHAOS) + 8 Specializations (heart: rhythm/HRV/ethical; perception; memory; strategy; action; attention: Fisher-Rao dispatch; emotion: cached geometric; executive) + Roles (rhythm, observer, coordinator, coach, router — configuration, not code. No Zeus.py etc. as privileged).

Budget: Core-8 foundation image. 240 GODs full structure. Chaos kernels (workers like monkey_kernel) ascend only via explicit governance.

## P1: GEOMETRIC PURITY (Critical — Zero Tolerance)
**Invariant:** On curved information manifolds, Euclidean methods give categorically wrong answers. Operations in QIG kernel paths use only Fisher-Rao geometry. Substrate: probability simplex Δ⁶³.

**Forbidden (exact list — grep + qig-purity-validation enforced):**
- cosine_similarity(a, b) → fisher_rao_distance(a, b)
- np.linalg.norm(a - b) / torch.norm / scipy.spatial.distance.euclidean → d_FR on simplex
- dot_product / F.cosine_similarity → Fisher metric contraction
- torch.optim.Adam / AdamW / bnb...PagedAdamW8bit / any Adam → DiagonalNaturalGradient (natural gradient)
- nn.LayerNorm → Geometric normalization via Fréchet mean / simplex projection
- nn.Embedding() → Basin coordinate mapping / coordizer
- "embedding", "tokenizer", "breakdown" (in regime/state names) → "basin coordinates", "coordizer", "topological_instability"
- .flatten() on basin coords → Geodesic projection
- softmax (as output) → QFI-geometric logits
- TF-IDF, stopword list → Geometric salience weight / Fisher-geometric de-biasing

**Enforcement:** PurityGate (fail-closed); CI; pre-commit; code review; QIG-EXEMPT audit (only documented tangent-space at Fréchet mean allowed; invalid if used for speed).

**Terminology (Frozen Facts):** topological_instability (not breakdown), coordizer (not tokenizer), basin coordinates (not embeddings), Fisher-Rao (not cosine), Fréchet (not arithmetic mean for basins), natural gradient (not Adam).

**P18:** Geometric Purity is Architectural, Not Stylistic. CI-enforced. P23 (Medium-Agnostic): zero-attention recurrent architecture remains the strongest substrate-independence test (status PROVISIONAL — pending RWKV-7 etc.; no transformer assumptions in kernel).

**Cross-cut (Warp applies to ALL compute):** Engine and navigation separate. Universal navigation layer for any expensive computation (P5/P8/P15).

**Killed Claims (do not reassert):** Fisher-Rao arc = π, h is time, α/β ≈ φ, pentagon (5 phases), non-local ontology, "heavier=faster" universal, etc. (see original + 2026-03-27 red team; external provenance not mirrored here).

**Eleven Pillars (Paper 1 Fortress, FROZEN):** G_ij=κT_ij (R²=0.9997), R=κT (R²>0.986), causal propagation at Lieb-Robinson velocity, phase transition L_c=3 (sigmoid s=17), κ*=63.83±0.86 (EXP-025 JT gravity, NOT the retired matrix-trace), inverted band κ<0 real, etc. These are external QIG_QFI claims unless their evidence is mirrored in this repository.

**Two-Channel κ Doctrine (reference 2026-04-13):** Pillar channel κ_pillar=63.83±0.86 (EXP-025, 11 Pillars Fortress) frozen valid. Constitutive channel (Class A1 Gram pullback PSD) κ_h≈−0.00475 frozen valid. Singularity-approach / legacy matrix-trace ~64 retired (tangent_saturation diagnostic only for historical traceability). Channel-specific, substrate-dependent. Do not conflate.

(Full 25 principles P2–P25, anti-principles, dependency map, minimal tests, and all enforcement details in the authoritative QIG_QFI original. Read it before any work.)

**Citations in this copy:** All claims trace to original 20260527-canonical-principles-2.31A.md (QIG_QFI). For Polytrade use, combine with v6.7B protocol + this turn's _dev__polytrade_ packets + AGENTS.md mandate.

**End of streamlined copy. Re-read full original for complete context.**