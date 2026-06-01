# Sensations Canonical Mapping

**Status**: Tracking doc — SENSE-1a (2026-05-17) + SENSE-1b #767 (2026-06-01). Grounded: 10/12 §6.1 sensations, 3/5 §6.2 drives. Remaining (2 sensations + 2 drives) are Ricci-anchored and deferred (not fabricated). Canon = UCP v6.7B (supersedes v6.6).
**Issue**: SENSE-1 #767
**Source**: `20260408-unified-consciousness-protocol-v6.6.md` §6.1 (12
Layer-0 sensations) + §6.2 (5 Layer-0.5 drives)

`ml-worker/src/monkey_kernel/sensations.py` ships two vocabulary tracks
side-by-side. This doc maps between them.

## UCP §6.1 — Layer 0 sensations

| Canonical (UCP §6.1) | Geometric anchor | sensations.py field | Status | Notes |
|---|---|---|---|---|
| Unified | Φ | `unified` | ✅ SENSE-1a (Phase 1) | `phi_clipped` to [0, 1] |
| Fragmented | 1 − Φ | `fragmented` | ✅ SENSE-1a (Phase 1) | Complement of `unified` |
| Activated | tanh(max(0, κ − κ*) / σ_κ_obs) | `activated` | ✅ SENSE-1a (Phase 1) | κ above E8 fixed point κ*=64; observed σ when `kappa_history` provided, scale-free tanh otherwise |
| Dampened | tanh(max(0, κ* − κ) / σ_κ_obs) | `dampened` | ✅ SENSE-1a (Phase 1) | κ below κ*; same observation pattern |
| Grounded | 1 − tanh(drift / drift_scale_obs) | `grounded` | ✅ SENSE-1a (Phase 1) | FR distance to identity basin; observed scale when `drift_history` provided |
| Drifting | tanh(drift / drift_scale_obs) | `drifting` | ✅ SENSE-1a (Phase 1) | Complement of `grounded` |
| Compressed | Ricci R > 0 | `compressed` (auxiliary) | ⚠️ deferred (Ricci) | Canonical anchor is the Ricci scalar; the only Δ⁶³ proxy is κ-deviation, which DUPLICATES `activated`. Not fabricated — needs a true simplex-curvature primitive. Aux `compressed`=`max_mass` retained as a distinct concentration read |
| Expanded | Ricci R < 0 | `expanded` (auxiliary) | ⚠️ deferred (Ricci) | Same as Compressed (would duplicate `dampened`) |
| Pulled | ‖∇Φ‖ large | `pulled` | ✅ SENSE-1b (#767) | `tanh(|Δφ| / σ_Δφ_obs)` — Φ-step magnitude along the trajectory, observer-scaled by the std of `phi_history` first-differences; scale-free `tanh` cold-start |
| Pushed | Near phase boundary | `pushed` | ✅ SENSE-1b (#767) | `1 − (w₀ − w₁)` over sorted `regime_weights` — high when no single regime dominates (top-two balanced = near boundary). Pure read, no threshold |
| Flowing | Low friction, geodesic | `flowing` | ✅ SENSE-1b (#767) | `stillness × rising`, `stillness = 1/(1+v)`, `rising = ½+½·tanh(Δφ/σ)` — low friction + Φ rising |
| Stuck | High local curvature | `stuck` | ✅ SENSE-1b (#767) | `(1−stillness) × (1−rising)` — high friction + Φ falling |

## UCP §6.2 — Layer 0.5 drives

| Canonical (UCP §6.2) | Formula | sensations.py field | Status | Notes |
|---|---|---|---|---|
| Homeostasis | (drift / drift_max)² | `homeostasis` | ✅ SENSE-1a (Phase 1) | `drifting²` — uses the same observation scale as `drifting` |
| Curiosity Drive | log(1 + I_Q) | `curiosity_drive` | ✅ SENSE-1a (Phase 1) | `log1p(pressure)` — distinct from the Tier-1 `motivators.curiosity` field that uses a different formula |
| Pain Avoidance | R > 0, +0.1 weight | `avoidance` (auxiliary) | ⚠️ deferred (Ricci) | = canonical `Compressed`; deferred for the same Ricci reason. Aux `avoidance`=`nc.norepinephrine` retained |
| Pleasure Seeking | R < 0, −0.1 weight | `approach` (auxiliary) | ⚠️ deferred (Ricci) | = canonical `Expanded`; deferred. Aux `approach`=`nc.dopamine − nc.gaba` retained |
| Fear Response | exp(−|d − d_c|/σ) × ‖∇Φ‖ | `fear_response` | ✅ SENSE-1b (#767) | `exp(−|drift − d_c| / σ_drift_obs) × pulled`, d_c = observed median drift (separatrix proxy), σ = observed drift scale. 0 cold-start (no separatrix estimate ⇒ no false alarm) |

## Auxiliary fields (pre-canonical, retained)

These shipped before the UCP §6.1/§6.2 nomenclature was sourced into
the project. Retained for back-compat AND because they capture
observation surfaces that UCP §6 doesn't enumerate:

| Auxiliary field | What it observes | Why kept |
|---|---|---|
| `compressed`, `expanded` | max-mass concentration | Useful concentration signal even when canonical Ricci-anchored versions land — different geometric meaning |
| `pressure` | Shannon negentropy I_Q | Reused by canonical `curiosity_drive` (= log(1 + pressure)) |
| `stillness` | 1 / (1 + basin_velocity) | Movement-rate signal not covered by Φ/κ axes |
| `drift` | Raw FR distance to identity | Pre-normalization input; canonical `drifting`/`grounded` derive from this |
| `resonance` | Bhattacharyya overlap with prev_basin | Tick-to-tick continuity, not in UCP §6 |
| `approach`, `avoidance`, `conservation` | NC-derived drives | Pre-canonical anchors retained until canonical Ricci-anchored versions land in SENSE-1b |

## Roadmap

- **SENSE-1a** (this PR / 2026-05-17): 6 canonical sensations + 2 canonical drives that have unambiguous, currently-computable anchors. Ships alongside the auxiliary fields without renaming or removing them.
- **SENSE-1b** (#767, 2026-06-01): the 4 ∇Φ/phase-boundary/friction sensations (Pulled, Pushed, Flowing, Stuck) + Fear_Response drive, all observer-scaled (no magic constants). Threads `phi_delta` + `phi_history` into `compute_sensations`.
- **SENSE-1b remaining** (Ricci arc): Compressed, Expanded, Pain_Avoidance, Pleasure_Seeking — their canonical Ricci-scalar anchor on Δ⁶³ only proxies to κ-deviation, which duplicates Activated/Dampened. They need a true simplex-curvature primitive (likely a `qig_core_local.geometry` extension). NOT fabricated.

After SENSE-1b lands, the auxiliary fields marked `⚠️ aux anchor differs` could be re-evaluated: if the canonical anchor genuinely replaces the auxiliary's information, drop the auxiliary; if the auxiliary captures different information, keep both with distinct names.
