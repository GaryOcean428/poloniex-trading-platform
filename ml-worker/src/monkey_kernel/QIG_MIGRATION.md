# QIG Migration Queue — Monkey Kernel

**Last updated:** 2026-04-21 (post audit + user correction)

The v0.7 design doctrine (PR #538) is simple: **anything that does QIG math
moves to Python; TypeScript keeps only orchestration, IO, and trading-layer
rules (exchange, DB, risk kernel, kernel bus).**

Audit 2026-04-21 corrected an initial misplacement of several modules on the
TS side. Final queue below.

## Python (`ml-worker/src/monkey_kernel/`)

| Module | Status | Replaces TS | QIG math involved |
|---|---|---|---|
| `autonomic.py` | ✅ shipped v0.7 | `autonomic_kernel.ts`, `sleep_cycle.ts`, `neurochemistry.ts` | NC derivation, sleep phase, reward decay |
| `executive.py` | ✅ shipped v0.7.2 | `executive.ts` | entry thresh, size, leverage, harvest, scalp, DCA, Loop 2 |
| `modes.py` | ✅ shipped v0.7.2 | `modes.ts` | Mode detection, MODE_PROFILES |
| `perception_scalars.py` | ✅ shipped v0.7.2 | subset of `perception.ts` | basin_direction, trend_proxy |
| `state.py` | ✅ shipped v0.7 | — | frozen constants + dataclasses |
| `perception.py` | ⏳ v0.7.4 | `perception.ts` | 64-d basin construction from OHLCV + ml-signal |
| `basin.py` | ⏳ v0.7.5 | `basin.ts` | Fisher-Rao, slerp, Fréchet (re-export from `qig_core_local`) |
| `basin_sync.py` | ⏳ v0.7.6 | `basin_sync.ts` | Multi-kernel basin coordination — use `qig_core.BasinSync` directly |
| `self_observation.py` | ⏳ v0.7.7 | `self_observation.ts` | (mode × side) bucket stats, hierarchical fallback, entry-bias |
| `resonance_bank.py` | ⏳ v0.7.8 | `resonance_bank.ts` | Bubble storage + resonance matching, geometric similarity |
| `working_memory.py` | ⏳ v0.7.9 | `working_memory.ts` | Bubble lifecycle (pop/merge/promote) — uses fisher_rao for merge threshold |

## TypeScript (`apps/api/src/services/monkey/`)

Keeps what is NOT QIG cognition:

| Module | Purpose |
|---|---|
| `loop.ts` | Tick orchestrator — reads state, calls Python `/monkey/*` endpoints, persists outcomes |
| `kernel_bus.ts` | Pub/sub event routing (no math) |
| `autonomic_client.ts` | HTTP client → Python autonomic (v0.7) |
| `kernel_client.ts` | HTTP client → Python executive/mode (v0.7.3) |
| Poloniex v3 exchange IO | — |
| Postgres pool + queries | — |
| `riskKernel.ts` | Trading rules (per-symbol cap, self-match, DD) — NOT QIG |
| `liveSignalEngine.ts` | ML-signal trading engine (uses ml-worker for predictions, no QIG) |

## Out of scope (intentionally)

| Path | Reason |
|---|---|
| `ml-worker/src/models/{LSTM,Transformer,GBM,ARIMA,Prophet}_model.py` | Price-prediction ensemble, not QIG cognition. Uses TF.keras Adam/LayerNorm by design; does not ingest basin coordinates. Explicitly allowlisted in `qig_purity_check.py` via `ML_PREDICTION_LAYER_PREFIXES`. |
| `apps/web/src/ml/dqnTrading.ts` | Frontend DQN stubs — dead code. Delete or stub out cleanly; QIG not applicable. |
| `kernels/core/` | Orphan stubs from earlier architecture iteration; either import into the new layout or remove. |

## Cut-over plan

1. **v0.7.3** (this PR): TS HTTP client (`kernel_client.ts`) + broadened purity scope. No wiring yet.
2. **v0.7.4+**: port remaining Python modules per queue.
3. **v0.7.10** (est): wire `loop.ts` under `MONKEY_KERNEL_PY=true` feature flag. Shadow mode: call BOTH paths, log parity diffs via `logParityDiff()`.
4. **v0.7.11**: flip default to Python. Keep TS path as fallback for one week with `MONKEY_KERNEL_PY=false` override.
5. **v0.7.12**: delete the TS QIG modules, keep only the orchestration/client/bus/IO code.

## Purity guard

`ml-worker/scripts/qig_purity_check.py` is the structural gate. Forbids
`cosine_similarity`, `euclidean_distance`, `nn.Transformer`, `BertModel`,
`GPT2Model`, `CrossEntropyLoss`, certain non-geometric optimisers,
`nn.LayerNorm`, `layer_norm(`, `torch.flatten`, and non-geometric
scipy distances. Scope (as of 2026-04-21):

- `ml-worker/src/monkey_kernel/` (all files)
- `ml-worker/src/qig_core_local/` (vendored Fisher-Rao primitives)
- `ml-worker/src/qig_engine.py`

Explicitly excluded (ML-prediction layer):
- `ml-worker/src/models/` — price-prediction ensemble, not cognition

## Open items from audit 2026-04-21

- [ ] Add `qig-compute>=0.3.0` to `ml-worker/requirements.txt` and wire
  `check_amplitude` + `check_regime_coverage` into `qig_engine.py`.
  Would catch the next "2664 BUYs / 0 SELLs" class of model bias on
  day one via AMPLITUDE_COLLAPSE / REGIME_SINGLE detectors.
- [ ] Decide vendored `qig_core_local/` policy: pin to PyPI version
  (`qig-core==2.7.0` or `~=2.7`) with a CI diff check, OR remove it
  entirely and hard-require external `qig-core`. Today it's frozen at
  2026-04-18 with no refresh policy — same drift-risk class as the
  original TS ports.
- [ ] Port `WarpBubble.auto()` for backtest/strategy sweeps
  (`qig-warp>=0.4.3`), replacing any existing grid/random search.
