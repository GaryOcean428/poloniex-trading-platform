# QIG Purity Reference for Kernel Work — `poloniex-trading-platform`

For agents shipping kernel-path changes (regime-conditional sizing, MTF
expansion, classifier extensions). This is doctrine, not theory — every
rule maps to a concrete code-level constraint. Anchored to UCP v6.6
§1.3 (Geometric Purity), Canonical Principles v2.1 P1 and P14, and the
frozen facts in `Dev/QIG_QFI/`.

## §0 The inviolate layer

Four rules apply to **every** line of code touching the kernel substrate.
Violating any of them is a P1 purity failure regardless of intent.

1. **Basins live on Δ⁶³ only.** A `Basin` is a `Float64Array` of length 64,
   non-negative, sums to 1 ± `EPS` (1e-12). Every operation must accept
   simplex membership as input and either preserve it or explicitly
   project back via `toSimplex()`. No off-simplex intermediates may
   persist across a function boundary.
2. **Distance is Fisher-Rao, similarity is Bhattacharyya.** The *only*
   legal pairwise scalar between two basins is
   `fisherRao(p,q) = arccos(Σ √(p_i q_i))` ∈ [0, π/2], or its underlying
   inner product `bhattacharyya(p,q) = Σ √(p_i q_i)` ∈ [0, 1]. Anything
   else — Euclidean, cosine, Manhattan, Mahalanobis, Lorentzian
   log-warp — is rejected.
3. **Means are Fréchet, interpolation is SLERP.** Centroids on the
   simplex must use `frechetMean(basins, iterations=20)`. Two-point
   blending must use `slerp(p, q, t)` in sqrt-coords. Arithmetic
   averaging of basin Float64Arrays is forbidden even when the inputs
   happen to be on the simplex — the average leaves the geodesic and
   biases toward the centroid of the Euclidean embedding, not the
   manifold.
4. **No TS port of kernel code. Kernel work happens in Python; TS calls
   Python.** Since PR #674 (cutover/python-authoritative-kernel),
   `ml-worker/src/monkey_kernel/` is the single canonical site for
   perception, basin evolution, neurochemistry, mode detection, regime
   sizing, Agent L, MTF, emotions, motivators, working memory, and every
   other kernel-cognitive operation. The TS tier calls `callTickRun()`
   (and the sibling `call*Decide()` HTTP clients) and consumes the
   resulting `TickRunDecision`. The previous TS port files (`basin.ts`,
   `perception.ts`, `neurochemistry.ts`, `modes.ts`, `regime.ts`,
   `regimeSizing.ts`, `emotions.ts`, `motivators.ts`, `candlePatterns.ts`,
   `self_observation.ts`, `basin_sync.ts`, `working_memory.ts`,
   `agent_L_classifier.ts`, `mtfLClassifier.ts`, `mtfBootstrap.ts`)
   no longer exist on the kernel path. Reintroducing any of them — or
   defining a TS-side implementation of Fisher-Rao, Fréchet mean,
   SLERP, Bhattacharyya, perceive, refract, basinDirection, trendProxy,
   detectMode, MODE_PROFILES, computeNeurochemicals, regimeScore,
   regimeSizing, mtfDecide, or agentLDecide — is a P1 purity failure.
   Same for resurrecting the deleted shadow-flag infrastructure
   (`MONKEY_KERNEL_PY`, `MONKEY_TICK_PY_SHADOW`, `RISK_KERNEL_PY_SHADOW`,
   `LIVE_SIGNAL_PY_SHADOW`, `AUTONOMOUS_TRADER_PY_SHADOW`, and the
   parity-diff helpers); Python is authoritative — no shadow path
   exists or is permitted.

## §1 Legal primitive vocabulary (`basin.ts`)

These are the ONLY tools that compose into new basin operations. If a
function in this codebase needs something not on this list, it must
build the something from this list — not import from `numpy`, `lodash`,
or `mathjs`.

| Primitive | Signature | Use |
|---|---|---|
| `uniformBasin(dim?)` | `→ Basin` | Maximum-entropy initial state |
| `toSimplex(v)` | `ArrayLike<number> → Basin` | Projection — the only legal escape from the simplex back to it |
| `shannonEntropy(b)` / `normalizedEntropy(b)` | `Basin → number` | Pillar 1 fluctuation diagnostic |
| `maxMass(b)` | `Basin → number` | Collapse detection |
| `bhattacharyya(p,q)` | `(Basin, Basin) → number` | The only valid inner product on Δ⁶³ |
| `fisherRao(p,q)` | `(Basin, Basin) → number` | Geodesic distance — the canonical metric |
| `slerp(p,q,t)` | `(Basin, Basin, number) → Basin` | Geodesic two-point interpolation |
| `frechetMean(basins, iter?)` | `(Basin[], number?) → Basin` | Geodesic centroid |
| `injectDirichletNoise(b,α?)` | `(Basin, number?) → Basin` | Pillar 1 fluctuation injection |
| `velocity(prev,curr)` | `(Basin, Basin) → number` | Fisher-Rao geodesic speed |

Auxiliary surface primitives that ARE allowed because they read from
basins without operating on them as vectors: `basinDirection(b)` from
`perception.ts` (Fisher-Rao reprojection, NOT a dot product despite
the name).

## §2 Forbidden vocabulary (categorical, no exceptions)

These never appear in code under `apps/api/src/services/monkey/`,
`ml-worker/src/monkey_kernel/`, or anything else on the kernel path.

- **Distances:** `cosine`, `cosine_similarity`, `dot_product`,
  `np.linalg.norm`, `euclidean`, `manhattan`, `chebyshev`, `mahalanobis`,
  `lorentzian_distance`, `log(1 + |a-b|)`
- **Optimizers:** `Adam`, `AdamW`, `SGD` on basin params, anything with
  a `momentum` term on the simplex
- **Normalizations:** `LayerNorm`, `BatchNorm`, `RMSNorm`, `normalize()`,
  `softmax` *as a kernel output* (use `toSimplex` instead — same shape,
  principled derivation)
- **Re-shapes:** `flatten()`, `reshape()` on basins (a basin is
  intrinsically 64D — flattening loses simplex constraint)
- **Naming:** `embedding`, `tokenize`, `vector` for basin variables.
  The coordizer is not a tokenizer; basins are not embeddings. Use
  `coordize` and `basin` consistently.
- **Means:** `np.mean(basins, axis=0)`, `lodash.mean(basins)`,
  arithmetic averaging — always `frechetMean`.

Naming exception: `basinDirection` is allowed because it's a
documented Fisher-Rao reprojection, not a dot product.

## §3 Per-surface notes

For each subsystem touched by kernel work, the specific purity demands.

### `kernel_bus.ts` — inter-kernel bus

- **Payload contract.** Messages between kernels carry basin coordinates
  + scalar QIG metrics (Φ, κ, regime label, confidence). Never raw
  logits, never model weights, never serialized tensors.
- **Size discipline.** A2A packets target < 4KB. 64 floats × 8 bytes
  = 512 bytes for the basin; everything else must fit under that
  ceiling.
- **No bus-side ops.** The bus transports; it does not compute. Don't
  fold any of the §1 primitives into the bus layer.
- **Routing.** Dispatch by `fisherRao(payload.basin, kernel.basinCenter)`
  — O(K) over registered kernels. Not by string match, not by topic.

### `basin_sync.ts` — coordinate-based state sharing

- **Sync semantics.** Synchronization between two kernels' basins is
  `slerp(local, peer, syncRate)` where `syncRate ∈ [0, 1]` is the
  coupling strength. Never `(local + peer) / 2`.
- **Multi-party reconciliation.** Three or more kernels reconciling
  competing basins use `frechetMean([b1, b2, b3, ...])`. Iteratively
  SLERP-based; converges to the geodesic centroid.
- **Identity preservation.** A kernel's identity basin is updated via
  `slerp(identityBasin, currentBasin, identityDriftRate)` with
  `identityDriftRate << syncRate`. Identity drifts; it doesn't jump.
- **Disagreement metric.** "How much do these kernels disagree" =
  `fisherRao(b1, b2)`. Not L2, not cosine. The
  `held_position_rejustification` threshold (currently 0.55) is in
  Fisher-Rao radians.

### `working_memory.ts` — QIG-RAM

- **Storage shape.** Memory entries are
  `{ basin: Basin, scalars: { Φ, κ, regime, t }, payload: arbitrary }`.
  The basin is the address. The payload is data carried by association.
- **Retrieval.** Top-K by `fisherRao(query, entry.basin)`, returned in
  ascending distance. K is observer-set, never hardcoded.
- **Decay.** Forgetting is NOT L2 weight decay. It is
  `slerp(entry.basin, uniformBasin(), decayRate * Δt)` — the basin
  diffuses toward maximum entropy over time, which corresponds to
  losing specificity. The associated payload is dropped when
  `normalizedEntropy(entry.basin) > forgetThreshold`.
- **Consolidation.** Multiple entries within
  `fisherRao < consolidationRadius` of each other consolidate via
  `frechetMean` of their basins, payload union. This is the geometric
  analog of episodic-to-semantic memory.

### `per_agent_foresight.ts` — 4D foresight

- **Submanifold.** The 4D foresight space is `(h, J_x, J_y, τ)` per
  `CANONICAL_HYPOTHESES_v2`. *Hypothesis* (open in Node 1 of the
  observer-dimensionality experiment): signature is (3,1) — Lorentzian.
  Until Node 1 returns measured signature, code must NOT assume
  signature; compute and respect what the local metric tensor reports.
- **Trajectory propagation.** Forward extrapolation is *geodesic
  extension* on the local metric, not linear extrapolation of basin
  coords. If predicting basin at t+Δt, integrate the geodesic equation
  under the current metric, not `current + velocity·Δt`.
- **Frozen anchor.** Transport relation `τ ∝ J^{1.06 ± 0.02}` (EXP-042,
  frozen). Any predicted τ must lie on this curve or the foresight
  call must explicitly mark itself as out-of-regime.
- **Pole structure.** `χ(ω)` Lorentzian pole at `ω* ≈ 7.61` (L=4,
  frozen). Dynamic responses near this frequency are amplified;
  static-to-dynamic bridging is the one quantitative link we have.
  Foresight near `ω*` must surface this in its confidence output.

### `regime.ts` + `modes.ts` — the regime layer

- **Regime stays geometric.** `classifyRegime` reads basin trajectory
  via `basinDirection`. Don't add price-derived features (RSI, ATR,
  ADX) here — the file is currently QIG-pure and must stay so. If you
  need a price-derived signal, it goes in a separate file that the
  executive composes with the regime output, not into `regime.ts`
  itself.
- **Mode hierarchy.** Per `modes.ts`: basin proximity primary,
  motivators secondary, surprise tertiary. Preserve this hierarchy
  if extending `detectMode`. Adding a fourth tier requires explicit
  doctrine update.
- **Continuous, not discrete.** Prefer regime-confidence-weighted
  interpolation between adjacent mode anchors over hard mode
  switches. The downstream code can then read a continuous
  `effectiveLeverage` rather than stair-stepping at mode transitions.
  See `regimeSizing.ts` for the continuous-interpolation building
  block.

### `resonance_bank.ts`, `self_observation.ts`, `forge.ts`

The general pattern: anything that *measures the kernel observing
itself* must use the same Fisher-Rao primitives as everything else.
Self-observation does not get a Euclidean shortcut "because it's
introspection." If `self_observation.ts` is computing trajectory
variance, it uses `velocity()` and `frechetMean()` — never `np.std()`
on raw basin coords.

### `executive.ts`, `loop.ts` — orchestration (large files)

These files are too large to edit wholesale. Edit directly with
targeted changes. Doctrine still applies: any sizing/leverage/horizon
math must compose §1 primitives, and any new function added must be
pure (no I/O, no globals, no `Date.now()` inside the math — pass
timestamps as args).

## §4 Specific to regime-sizing work

1. **The new `regimeSizing` function in `regimeSizing.ts` is pure.**
   Inputs: `RegimeScore`, optional config. Output:
   `{ leverage, sizeFraction, holdMs, stopBps, marginHeadroomFloor }`.
   No global state, no module-level mutation, deterministic.
2. **No hardcoded literals (P14 follow-up).** Per P14: max leverage,
   min leverage, mode anchors — all read from a parameter registry
   or env, never inlined as numeric literals. The existing
   `MODE_PROFILES` const in `modes.ts` is a P14 violation flagged
   for follow-up. New code should not reproduce that pattern at scale.
3. **Interpolation in linear lev-space, not log-lev-space, *unless*
   you justify otherwise.** Linear is intuitive and matches the user's
   stated intent ("proportionately ease back"). Log-space interpolation
   is defensible but is a deliberate choice that needs documenting.
4. **Headroom rails stay regime-conditional via *function*, not via
   mutating defaults.** The `agentEquityBound.computeAgentNotionalHeadroom`
   takes `notionalRatio` as an arg. Pass `regimeAdjustedNotionalRatio(regime)`
   at the call site, not change the default in the function.
5. **The MTF replay harness (if built) is read-only.** It pulls from
   the DB, computes, writes a JSON/CSV report. It does NOT touch the
   live trading path, does NOT mutate any DB row, does NOT call any
   exchange API. Sandbox by construction.

## §5 Verification gates

Before any kernel-path PR merges:

1. **PurityGate static scan passes** if `.github/workflows/qig-purity.yml`
   exists. The grep on the forbidden vocabulary list (§2) must return
   empty across all changed files. Fail-closed: any hit blocks merge.
2. **Simplex assert on output basins.** Tests for any new function
   returning a `Basin` must assert `|Σ b_i − 1| < 1e-9` and
   `min(b_i) ≥ 0` on the output. The simplex contract is part of the
   type, even though TypeScript can't enforce it.
3. **Round-trip stability.** `toSimplex(b)` applied twice must equal
   `toSimplex(b)` once within machine epsilon. Smoke test that
   catches accidental drift.
4. **Fisher-Rao symmetry.** `fisherRao(p, q) === fisherRao(q, p)` for
   all test basins.
5. **SLERP invariants.** `slerp(p, p, t) === p` for all t;
   `slerp(p, q, 0) === p`; `slerp(p, q, 1) === q`.

## §6 Frozen facts that constrain implementation

These are non-negotiable physics anchors. Code that contradicts them
is wrong even if it compiles.

- `κ_h ≈ -0.00475` (window-invariant, size-invariant, PSD-correct
  field channel)
- `κ_J` running with `β_L ≈ 0.25` (coupling channel, scale-dependent)
- `κ ≈ 64` is **retired** — the legacy algebraic formula
  `g_01 = 0.5·(F[s,xy_nbr] − F[s,x_nbr] − F[s,y_nbr])` is impure
  (picks up ZZ bond cross-correlations). Do not reintroduce it.
- `ξ = 1/φ` (screening length, 0.03% match at L=5)
- `τ ∝ J^{1.06}` (bridge / transport law)
- `χ(ω)` Lorentzian pole at `ω* ≈ 7.61` (L=4)
- Bipartite even/odd L parity confirmed; h/J anisotropy closes at
  large δ
- C4 isotropy decomposition **FALSIFIED** — do not assume

## §7 Provenance and observability

For every new function touching the kernel:

- Log inputs and outputs at the regime/mode boundary, including:
  `{ regime, regimeConfidence, mode, basinKappa, basinPhi,
     basinVelocity, decision }`.
- Surface enough state that an offline harness can replay the
  decision deterministically from logs alone.
- Observer sets all numeric params (per `Observer sets ALL params`).
  No hardcoded `num_predict`, `max_tokens`, `lookback`, `k` outside
  their respective config objects.

## §8 What to do when a doctrine question arises mid-implementation

In order:

1. Search the local `Dev/QIG_QFI/` for the relevant `CANONICAL_*.md`
   or `FROZEN_FACTS.md` entry.
2. Check `TYPE_SYMBOL_CONCEPT_MANIFEST.md` for terminology.
3. Check this document.
4. Ask the user — flag the doctrine question explicitly, don't infer.

Don't import from a Python library "because the algorithm needs it"
without first checking whether the §1 primitives compose into the
algorithm. They almost always do.

---

**Anchor:** UCP v6.6 §1.3 (Geometric Purity) + Canonical Principles
v2.1 P1 & P14. Where this document and those disagree, those win.
The frozen facts in §6 win over everything.
