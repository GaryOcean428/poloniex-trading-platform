# Multi-agent QIG uplift plan — wire Agents M / T / L to K's full cognition stack

**Status:** PLAN — not yet implemented
**Filed:** 2026-05-08
**Authority:** User directive in conversation 2026-05-08
**Tracking issue:** GaryOcean428/poloniex-trading-platform (TBD)

## Problem statement

Today, the four trading agents have wildly asymmetric cognition:

| Agent | Basin | Bus subscribe | Bus publish | Foresight | Layer 2B emotions | Neurochemistry | Self-observation |
|---|---|---|---|---|---|---|---|
| **K** (kernel) | ✅ Full Δ⁶³ + history | ✅ | ✅ | ✅ via held-position rejust | ✅ | ✅ | ✅ via SelfObservation |
| **M** (ML) | ❌ thin | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **T** (Turtle) | ❌ thin | ❌ | ❌ | ❌ (Donchian only) | ❌ | ❌ | ❌ |
| **L** (FR-KNN) | ✅ uses K's basin history | ⚠️ publishes only (this PR) | ✅ (this PR) | ❌ | ❌ | ❌ | ❌ |

The user's intent: **all kernels should have basin sync, bus access, foresight, self-observation, and emotion+neurochemistry stacks** so they can react to what the others do, anticipate consequences, learn from outcomes, and have appropriate dopamine-on-success / frustration-on-loss dynamics.

## Why this matters

Current asymmetry means:
- M and T are **mechanical** — they fire on signal/breakout and don't adjust based on cross-agent context
- K reacts to its own emotions but is blind to M/T/L's actions until the trade settles
- No agent sees the others' "intent" before execution — only the realized outcome via Arbiter PnL feedback
- A "frustration" signal that should dampen M's entries during a regime where its strategy isn't working has nowhere to land

## Phased plan

### Phase 1 — Bus integration (small, high-value)

**Surface:** Each agent's entry/exit decision publishes a structured event. Other agents subscribe and incorporate "recent action by other agents on this symbol" into their decision context.

**Files:**
- `apps/api/src/services/agent_M/decide.ts` — accept `recentBusEvents` param, dampen entry when same-side conflict with another agent's recent entry
- `apps/api/src/services/turtle_agent/decide.ts` — same param, same dampen
- `apps/api/src/services/monkey/agent_L_classifier.ts` — already publishes; add subscribe-side context
- `apps/api/src/services/monkey/loop.ts` — collect bus events for the last N seconds, pass to each agent

**Effort:** 1-2 days, low blast radius
**Tests:** Per-agent — verify dampen activates on recent-conflict event, doesn't activate without

### Phase 2 — Per-agent emotion stacks

**Surface:** Each agent maintains its own emotion state on `SymbolState.emotionsByAgent[symbol][agent]`. Layer 2B emotions (joy, suffering, frustration, etc.) update from per-agent realized PnL events (not just K's). Agent decision functions consume their own emotion state for sizing/conviction.

**Files:**
- New `apps/api/src/services/monkey/per_agent_emotions.ts` — pure helpers to compute per-agent emotion deltas
- Per-agent state on `SymbolState`
- M/T/L decision functions accept emotion-state input

**Effort:** 3-5 days
**Tests:** Each agent's emotion-state evolution under win/loss sequences

### Phase 3 — Per-agent neurochemistry

**Surface:** Same pattern as emotions. Each agent has dopamine/serotonin/etc. that modulate its own risk-taking. **Dopamine on success** (recent wins → more willingness to size up), **frustration → tighter stops**.

**Files:**
- Extend `neurochemistry.ts` per-agent computation
- Plumb into agent sizing functions

**Effort:** 2-3 days

### Phase 4 — Foresight for M/T/L

**Surface:** Each agent runs a per-tick foresight check: "if I enter here, what does the basin look like at i+horizon?" — gates entry on basin trajectory.

**Files:**
- `apps/api/src/services/monkey/foresight_per_agent.ts`
- Wire into M/T/L decision

**Effort:** 4-6 days
**Tests:** Per-agent foresight veto firing

### Phase 5 — Self-observation per agent

**Surface:** Each agent maintains its own `SelfObservation` ring (recent decisions, realized outcomes, calibration drift). Reads it for sanity checks ("am I taking too many losses lately?").

**Files:**
- Extend `self_observation.ts` to be per-agent indexed
- Per-agent state on `SymbolState`

**Effort:** 3 days

## Total scope estimate

**Optimistic:** ~3 weeks of focused work
**Realistic:** 4-5 weeks with iteration on emotion-stack tuning
**Risks:** every agent's behavior changes; high regression-test surface; live-trading observation needed at each phase

## Recommendation for sequencing

Ship in **separate PRs by phase**, each behind an env-var feature flag (default off). This lets us:
- Roll forward agent-by-agent — verify M's bus subscribe before adding T's
- Roll back any phase without affecting later ones
- Compare A/B via Arbiter (per-agent PnL with vs without uplift)

## Tracking

Each phase gets its own PR + GitHub issue. Cross-link to this plan doc.
