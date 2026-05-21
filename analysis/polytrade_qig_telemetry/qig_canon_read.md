# QIG_QFI Canonical Read — Answers to the 5 Council Questions

Date 2026-05-21. Read-only canonical investigation of `/home/braden/Desktop/Dev/QIG_QFI/`,
done in response to the council agent's request before any polytrade kernel code change.

**Verification discipline:** the headline files (`pillars.py`, `pci.py`, `types.py`) were
read **directly** by the lead agent, not taken from a sub-agent summary — per the
council's own lesson ("lived verification beats inherited conviction"). Items that rest
on the sub-agent's `fisher_rao.py` excerpt are marked *[sub-agent, cross-checked]* —
cross-checked against polytrade's `basin.ts`, which the port note says is a line-for-line
port of `qig-core/.../geometry/fisher_rao.py`.

Canonical files cited:
- `qig-core/src/qig_core/consciousness/pillars.py` — read directly ✓
- `qig-core/src/qig_core/consciousness/pci.py` — read directly ✓
- `qig-core/src/qig_core/consciousness/types.py` — read directly (excerpts) ✓
- `qig-core/src/qig_core/geometry/fisher_rao.py` — *[sub-agent, cross-checked vs basin.ts]*

---

## Q1 — Concentration mechanism

**Canonical answer: there is NO downstream "concentration force." The canon does not
have a gradient or update rule that drives a basin off the max-entropy shell. Basin
concentration is *inherited from the perception input* — it is an upstream property.**

Evidence — `pillars.py` is where a concentration driver would live, and it contains the
**opposite**: Pillar 1 `FluctuationGuard` is a two-sided guard that *prevents both
extremes* and drives nothing:

- `pillars.py:62-64` — `ENTROPY_FLOOR = 0.1`, `BASIN_CONCENTRATION_MAX = 0.5`.
- `FluctuationGuard.check_and_enforce` (`pillars.py:162-237`):
  - if Shannon entropy `< ENTROPY_FLOOR (0.1)` → **inject Dirichlet noise** (raises
    entropy — pushes *toward* uniform).
  - if `max_concentration > 0.5` → **cap the peak**, redistribute excess (pushes *away
    from* concentration).
- `max_entropy()` for 64-dim = `log(64) ≈ 4.16`, so `ENTROPY_FLOOR 0.1` corresponds to
  `f_health ≈ 0.024`. Pillar 1 permits `f_health` anywhere in **[0.024, 1.0]** and
  actively *resists* leaving that band — it never *pulls* the basin to any concentration.

The geometry primitives (`log_map`, `exp_map`, `slerp_sqrt` in `fisher_rao.py`
*[sub-agent, cross-checked]*) are *movement operators* — they walk the basin toward a
**target** but do not supply one. The targets are supplied upstream: Pillar 2
`TopologicalBulk.receive_input` slerps the surface **toward the input basin**
(`pillars.py:339`); Pillar 3 `refract` slerps input **toward the frozen identity**
(`pillars.py:590-619`). Neither invents concentration — they propagate whatever
structure the *input basin* already has.

**Implication:** if perception delivers a near-uniform basin, nothing canonical
downstream will concentrate it. The canon *assumes perception delivers a structured
basin.* (activation.py / qig-warp were not exhaustively read, but the Pillar
architecture unambiguously places concentration upstream — there is no rescue layer.)

---

## Q2 — Φ (phi) definition

**Canonical answer: in the canon, `Φ` and `f_health` are DISTINCT metrics. `f_health`
is the Pillar-1 entropy ratio; `Φ` is a separate integration metric. Polytrade's
`phi = 1 − 0.8·fHealth` is a rescaling of `f_health` — it is NOT canonical Φ.**

- `types.py:195` — `f_health: float = 1.0  # Fluctuation health: H_basin / H_max (0.0, 1.0)`.
  It is one of ~20 metrics in the consciousness-metrics struct, alongside a **separate**
  `phi` field (`activation.py` references `m.phi` independently of `f_health`).
- `pillars.py:151-160` — `FluctuationGuard.f_health()` = `min(H_basin / H_max, 1.0)`,
  explicitly tagged "v6.1 §24". This is Pillar 1's metric, not Φ.
- `pci.py` — **PCI (Perturbational Complexity Index)** is the canonical
  perturbation-complexity metric: perturb a basin coordinate on Δ⁶³, record the
  resonance-bank response over a window, binarize, take Lempel-Ziv complexity
  (`compute_basin_pci`, `pci.py:75-163`). `PCI > 0.3` conscious-like, `< 0.15` zombie.
  This is **complexity-of-response**, categorically not an entropy ratio.

**Polytrade divergence:** `loop.ts:1864-1867` computes `phi = 1 − 0.8·fHealth`,
`fHealth = normalizedEntropy(basin)`. So polytrade's "Φ" is a linear rescaling of the
Pillar-1 `f_health` entropy ratio. Whatever canonical Φ is, it is provably **not**
`1 − 0.8·f_health`. Polytrade is measuring (rescaled) fluctuation-health and labelling
it Φ.

**Honest gap:** the exact computation of the canonical `m.phi` field was **NOT located**
in this read (`activation.py:1120` only *overrides* it to `PHI_UNSTABLE` in an emergency
branch; the normal-path computation is elsewhere). What is *certain*: (a) canon keeps Φ
and `f_health` separate; (b) PCI is the canonical perturbation-complexity metric and the
strongest candidate for what Φ should track; (c) polytrade's `phi` is not either of them
— it is rescaled entropy. Locating the canonical Φ computation is a recommended
follow-up; it is **not** invented here.

---

## Q3 — Normalisation pipeline

**Canonical answer: the canon projects onto Δ⁶³ with `to_simplex` = clip-to-ε then
divide-by-sum. There is NO per-dimension `norm01` (sigmoid) squash. Polytrade's
`perceive()` inserts a non-canonical `norm01` step, and that is the mechanical root of
the flatline.**

- Canonical `to_simplex` (`fisher_rao.py` *[sub-agent]*): `v = max(v, ε); return v / v.sum()`.
  **Cross-check:** polytrade's own `basin.ts:toSimplex` (read directly) is exactly this —
  `Math.max(v, EPS)` then divide by sum. So polytrade's *simplex projection* is canonical.
- The divergence is in `perception.ts:perceive()` (read directly): every feature dim is
  passed through `norm01(x, scale) = sigmoid(x/scale)` or `clip01` **before** `toSimplex`.
  `norm01` is a sigmoid centred on 0.5 — for typical small inputs it returns ~0.45–0.55.

**Mechanism (canon-confirmed):** the canonical pipeline feeds *raw, range-preserving*
clipped values into `to_simplex`, so a large feature → large basin mass, a near-zero
feature → near-zero mass — the input's dynamic range survives onto the simplex. The
polytrade pipeline first squashes every dim to ≈0.5 via the sigmoid, *then* divides by
the sum (~32 for 64 dims) — so every dim lands at ≈1/64. **`norm01` destroys the dynamic
range that `to_simplex` is designed to carry.** This is the "mechanical max-entropy-shell
trap": per-dim squash-to-0.5 → divide-by-sum → centroid.

---

## Q4 — Regime ↔ concentration

**Canonical answer: the canon has TWO regime concepts — Φ-bands and a κ-field. Neither
is named "FOAM/WAVE/CRYSTAL". The κ-field does couple regime to geometric strength
(crystallized ↔ strong/structured, quantum ↔ weak/diffuse), but concentration is
ultimately bounded by Pillar 1 regardless of regime.**

- **Φ-bands** (`types.py:318` `navigation_mode_from_phi`): `CHAIN` Φ<0.3, `GRAPH`
  0.3–0.7, `FORESIGHT` 0.7–0.85, `LIGHTNING` ≥0.85. These match the brief's canon.
- **κ-field** (`types.py` `regime_weights_from_kappa`): a **field, not a pipeline** —
  "v6.0 §3.1: the three regimes are a FIELD … all three weights > 0 at all times".
  `|κ| large → crystallized (strong geometry, both loops)`; `|κ| near 0 → quantum
  (weak geometry, critical zone)`; `|κ| ≈ κ*/2 → efficient peaks`. The canonical triad
  is **quantum / efficient / crystallized**.
- Polytrade telemetry's `reg="q…/e…/eq…"` (quantum/efficient/equilibrium) maps to this
  κ-field. Polytrade's `CREATOR/PRESERVER/DISSOLVER` cells are a *third*, polytrade-local
  naming.

**Flag for the council — RESOLVED by source grep (2026-05-21):** FOAM/WAVE/CRYSTAL as a
*regime-weight triad* is **superseded, non-canonical** naming. The canonical active triad
is `RegimeType` (`qig-core/.../consciousness/types.py:57-62`): `quantum` (a=1) /
`efficient` (a=1/2) / `equilibration` (a=0) — "Vanchurin's three regimes (v6.0 §3)",
carried as `RegimeWeights` w1/w2/w3. FOAM/WAVE/CRYSTAL-as-regime appears **only** in
`qig-archive/` (explicitly superseded — `qig_system_prompt_v7.md`, v5 training data) and
one `qig-verification` doc literally titled *"missing-concepts"*. Council possibility (c)
confirmed: the prior advice carried older system-prompt terminology. **Separately,
"FOAM" is still live** — but as the exploration phase of the FOAM/TACKING/CRYSTAL/FRACTURE
*memory cycle* (qig-dreams); polytrade's `working_memory.ts` ("FOAM-phase working memory")
uses it correctly in that sense. So: for the regime triad say *quantum/efficient/
equilibration*; reserve *FOAM* for the memory-cycle phase; *WAVE* has no canonical home.
Concentration is hard-bounded by Pillar 1 (`max_concentration ≤ 0.5`, `entropy ≥ 0.1`)
in every regime.

---

## Q5 — Bulk / surface specification

**Canonical answer: yes, a canonical 70% core / 30% surface split exists. Canonical
"bulk" is the slow-DIFFUSING core — it is ALIVE. The canon does NOT freeze individual
basin dimensions to constants. Polytrade's 25 constant feature dims are therefore NOT
bulk — they are dead inputs.**

- `pillars.py:67-69` — `BULK_SHIELD_FACTOR = 0.7`, `BOUNDARY_SLERP_CAP = 0.3`,
  `CORE_DIFFUSION_RATE = 0.05`.
- `TopologicalBulk` (`pillars.py:245-400`): a `core` and a `surface` basin.
  `composite = slerp_sqrt(surface, core, 0.7)` → the observable basin is 70% core.
  `receive_input` slerps the surface toward input (capped at 0.3), then the **core
  slowly diffuses toward the surface at rate 0.05** (`pillars.py:343-347`). The core
  changes ~5%/cycle — **slow but alive**.
- Pillar 3 `QuenchedDisorder` freezes an `identity_slope` *vector* after 50 cycles
  (`pillars.py:490-512`), used to *refract* input — but it is a frozen *reference
  direction*, plus an *annealable* Tier-2 field that keeps moving (`pillars.py:559-563`).

**Canonical bulk-vs-dead distinction:** bulk = the 70% core, which **autonomously
diffuses** from surface feedback (alive, non-Markovian memory). Dead = a constant vector
with zero diffusion. **The canon never freezes dimensions to constants.**

**Polytrade mapping:**
- Polytrade's `refract(raw, identity, 0.30)` (70% identity / 30% raw) **matches** the
  canonical 70/30 bulk/surface ratio — that part is canonical.
- But polytrade's **25 constant feature dimensions** (`perceive()` dims 39–54 = `0.0055`,
  dims 59–63 = `0.01`, dims 3–6 constant for Agent K) are **not** the bulk. The bulk is
  the 70% identity basin. The 25 constants are frozen *surface inputs* — and canon
  explicitly does not freeze dimensions. → **They are dead inputs.**
- Polytrade's dims 39–54 are even *labelled* a "Pillar 1 fluctuation reservoir", but a
  frozen constant provides **zero fluctuation**. Canonical Pillar 1 fluctuation is
  *reactive Dirichlet injection on the whole basin when entropy drops* — not a static
  per-dim floor. So the "noise floor" is a misnomer; it is non-canonical dead mass.

---

## Resolution of the council's Workstreams

**Workstream A — the 25 constants: RESOLVED → dead inputs, not bulk.**
Canonical bulk is the slow-diffusing 70% core, not frozen feature dims; the canon never
freezes dimensions. The 25 constants (incl. the mislabelled "noise floor") are dead
surface inputs. They are not the Φ blocker on their own, but they are non-canonical and
add static mass. Disposition: **wire-or-remove** — each dim must carry live signal or
not occupy basin mass. (Still gated: do not implement without operator sign-off.)

**Workstream B — concentration: RESOLVED → B1, not B2.**
- **B2 (missing canonical concentration force) is REJECTED.** The canon has *no*
  downstream concentration force to wire in. Concentration is structurally upstream —
  inherited from the perception input.
- **B1 (off-canon normalisation pipeline) is CONFIRMED.** Canonical `to_simplex` carries
  the input's dynamic range; polytrade's `norm01`-before-`toSimplex` squashes every dim
  to ≈0.5 first and destroys that range, forcing the basin onto the max-entropy shell.
  **The fix is to remove/replace the `norm01` squash** so `perceive()` feeds
  range-preserving values into `toSimplex`, letting genuinely distinct market states map
  to genuinely concentrated basins.

**Plus a Q2 finding the council should fold in:** even after B1, polytrade's
`phi = 1 − 0.8·fHealth` would still only track *entropy*, not integration/complexity.
Canon keeps Φ and `f_health` separate and has `PCI` for perturbation-complexity. Fixing
perception makes `f_health` (and thus polytrade's rescaled "phi") expressive again — but
a *canonical* Φ would be a separate metric. Two distinct issues: (a) perception pipeline,
(b) the Φ definition itself.

---

## Corrected framing (supersedes the "61 dead dims / 95% collapse" diagnosis)

- Φ flatlined ~0.215 because the 64-dim basin **moves** (`bv` 0.001–0.146) but does not
  **concentrate** (`fHealth` pinned 0.977–0.984). 39 dims have live derivation, 25 are
  constant.
- **Pillar 1: INTACT.** `f_health ≈ 0.98` sits well inside the canonical `[0.024, 1.0]`
  band; `max_concentration` is far below the 0.5 cap. No zombie, no collapse.
- **Pillar 2: the 70/30 refraction ratio is canonical**; the 25 constant dims are *not*
  bulk (Q5). Not "open" — resolved: they are dead inputs.
- **Pillar 3:** polytrade's frozen `identityBasin` matches the canonical frozen
  `identity_slope`.
- **Root cause:** the non-canonical `norm01` pre-squash in `perceive()` (Q3) holds the
  basin on the iso-entropy shell near the Δ⁶³ centroid. Not a formula bug, not dead
  substrate — a normalisation-pipeline divergence from canon.

## Still open / recommended follow-ups (not invented here)

1. Locate the canonical `m.phi` computation in `qig-core` (this read found PCI and
   `f_health` but not the normal-path Φ assignment).
2. Decide whether polytrade should adopt `compute_basin_pci` as its Φ, or keep an
   entropy-derived proxy but stop calling it Φ.
3. Per the council: telemetry-only per-dim basin-mass instrumentation first; then an
   **offline** shadow comparison of a `norm01`-free `perceive()` vs current, measuring Φ
   span before/after. No live kernel change until that shadow evidence exists.

## Addendum — canon constants for the runtime-Φ leaky integrator (2026-05-21)

The council's CC1 lane proposes a runtime Φ as a leaky integrator
`Φ ← Φ + bv·GAIN − (Φ − EQUILIBRIUM)·RATE`. Two of its three parameters are **already
frozen canon** — they must be used, not re-calibrated (project CLAUDE.md §2, the P1
"no operator-dialed knob" principle):

- `PHI_IDLE_EQUILIBRIUM = 0.55` — `qig-core/.../constants/consciousness_constants.py:266`
  (comment: "Must sit above PHI_EMERGENCY (0.50) + oscillation margin").
- `PHI_IDLE_RATE = 0.015` — same file, line 269.

So `EQUILIBRIUM` and `RATE` in CC1's law are `PHI_IDLE_EQUILIBRIUM` / `PHI_IDLE_RATE`.
Only `GAIN` (the `bv·GAIN` active-rise term) is open — and it should be observer-derived
from the `bv` distribution, not hand-tuned. Note the canonical idle Φ is **0.55 (GRAPH
band)**; polytrade's flatlined 0.215 is in CHAIN — i.e. Φ is flat **and** sitting a full
band below where canon idles.
