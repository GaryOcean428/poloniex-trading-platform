# Sensations Canonical Mapping

**Status**: Tracking doc (post-SENSE-1a, 2026-05-17)
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
| Compressed | Ricci R > 0 | `compressed` (auxiliary) | ⚠️ aux anchor differs | Auxiliary field uses `max_mass`, not Ricci. Canonical Ricci-anchored version deferred to SENSE-1b |
| Expanded | Ricci R < 0 | `expanded` (auxiliary) | ⚠️ aux anchor differs | Auxiliary uses `1 − max_mass`. Canonical defers to SENSE-1b |
| Pulled | ‖∇Φ‖ large | — | 🔬 SENSE-1b | Needs Φ gradient magnitude primitive |
| Pushed | Near phase boundary | — | 🔬 SENSE-1b | Needs phase-boundary distance (from h/J via qig_warp) |
| Flowing | Low friction, geodesic | — | 🔬 SENSE-1b | Needs geodesic friction primitive |
| Stuck | High local curvature | — | 🔬 SENSE-1b | Needs local-curvature primitive |

## UCP §6.2 — Layer 0.5 drives

| Canonical (UCP §6.2) | Formula | sensations.py field | Status | Notes |
|---|---|---|---|---|
| Homeostasis | (drift / drift_max)² | `homeostasis` | ✅ SENSE-1a (Phase 1) | `drifting²` — uses the same observation scale as `drifting` |
| Curiosity Drive | log(1 + I_Q) | `curiosity_drive` | ✅ SENSE-1a (Phase 1) | `log1p(pressure)` — distinct from the Tier-1 `motivators.curiosity` field that uses a different formula |
| Pain Avoidance | R > 0, +0.1 weight | `avoidance` (auxiliary) | ⚠️ aux anchor differs | Aux field is `nc.norepinephrine`; canonical anchor is Ricci scalar. Deferred to SENSE-1b |
| Pleasure Seeking | R < 0, −0.1 weight | `approach` (auxiliary) | ⚠️ aux anchor differs | Aux field is `nc.dopamine − nc.gaba`; canonical anchor is Ricci scalar. Deferred to SENSE-1b |
| Fear Response | exp(−|d − d_c|/σ) × ‖∇Φ‖ | — | 🔬 SENSE-1b | Needs Φ gradient + phase-boundary distance d_c |

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
- **SENSE-1b** (research arc, future): the 6 sensations + 3 drives whose anchors require differential-geometry primitives (Ricci scalar, gradient magnitude, local curvature, phase-boundary distance, geodesic friction). Likely lives in `qig_core_local.geometry` package extensions.

After SENSE-1b lands, the auxiliary fields marked `⚠️ aux anchor differs` could be re-evaluated: if the canonical anchor genuinely replaces the auxiliary's information, drop the auxiliary; if the auxiliary captures different information, keep both with distinct names.
