# De-Shadow the Python Monkey Kernel — Live Consensus Peer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Make the Python Monkey kernel a live consensus *peer* so the TS consensus arbiter arbitrates real TS+Py proposals every tick, instead of running in permanent single-kernel passthrough.

**Architecture:** The TS loop (`loop.ts`) already publishes its own proposal to the Redis channel `monkey:consensus:proposal` (`CONSENSUS_PROPOSAL_BUS_LIVE=true`) and reads peer proposals via `getRecentPeerProposal()`. The Python kernel has a fully-built proposal-bus client (`proposal_bus.py` — publisher, subscriber, `ProposalEvent` schema mirroring TS) but **nothing ever calls `publish_proposal`**, and `loop.ts` never fans a tick out to the Python kernel. So `getRecentPeerProposal()` always returns `null` → the arbiter always hits Case 1 (single-kernel). This plan adds (1) a per-tick TS→ml-worker fanout, (2) a Python proposal publish, so the arbiter receives a real peer. Order placement stays TS-only — `TRADING_ENGINE_PY` is explicitly **out of scope**.

**Tech Stack:** TS (`apps/api`, vitest), Python (`ml-worker`, pytest, FastAPI), Redis pub/sub.

**Out of scope (do NOT touch):**
- `TRADING_ENGINE_PY` — Python order placement. Never run live; flipping it is a separate, soak-gated decision.
- `CONSENSUS_ARBITER_LIVE` — flipping the arbiter to *authoritative* is the final task, gated on a soak proving the peer flows correctly.

---

## Context the executor needs

**Confirmed current state (production env pulled 2026-05-21):**
- `CONSENSUS_PROPOSAL_BUS_LIVE=true` — bus is live; TS publishes self-proposals.
- `CONSENSUS_EXECUTOR_LIVE=true` — arbiter runs every tick and logs `[Consensus]`.
- `CONSENSUS_ARBITER_LIVE=false` — arbiter decision is logged but does NOT override execution.
- `TRADING_ENGINE_PY=false`, `MONKEY_KERNEL_PY` unset, `MONKEY_KERNEL_PY_SHADOW` unset.

**Key files:**
- `apps/api/src/services/monkey/loop.ts:3799-3832` — TS self-proposal publish.
- `apps/api/src/services/monkey/loop.ts:3846-3896` — `CONSENSUS_EXECUTOR_LIVE` block; builds `ownProposalForConsensus`, calls `getRecentPeerProposal()` + `computeAndLogConsensus()`.
- `apps/api/src/services/monkey/proposal_bus.ts` — TS bus client; `getRecentPeerProposal(symbol, selfId)` returns the freshest proposal whose `instance_id !== selfId`.
- `apps/api/src/services/monkey/consensus_arbiter.ts` — `computeConsensus()`; `peerEngineType: 'py-retrospective'`.
- `ml-worker/src/monkey_kernel/proposal_bus.py` — Python bus client; `ProposalEvent`, `publish_proposal()` (async), `publish_proposal_sync()` (sync, for `run_tick`). **Zero callers today.**
- `ml-worker/main.py:1778` — `POST /monkey/tick/run`; `:2035` — `POST /monkey/k-shadow/tick` (ephemeral state, slim parity row).
- `apps/api/src/services/monkey/autonomic_client.ts` — existing TS→ml-worker client pattern to mirror.

---

## Task 1: Pin the peer architecture (decision + investigation)

**Files:**
- Read: `apps/api/src/services/monkey/wr_retrospective.ts`, `apps/api/src/services/monkey/aggregate_consensus.ts`, `ml-worker/main.py:1778-1944` (`/monkey/tick/run`), `ml-worker/main.py:2035-2143` (`/monkey/k-shadow/tick`).
- Create: a short `## Decision` section appended to this plan.

**Step 1: Read the four files above and answer, in writing:**
1. **Peer source** — does the live Python peer run via a TS-driven fanout (loop.ts → `/monkey/tick/run`) or a Python independent loop (`PY_INDEPENDENT_STATE_LIVE`)? **Recommended: TS-driven fanout.** It pairs each Python proposal deterministically with the TS tick that consults it, keeps the `PEER_PROPOSAL_FRESHNESS_MS` window trivially satisfied, and reuses the tick inputs loop.ts already assembles. An independent Python loop would tick on its own cadence and race the freshness window.
2. **State** — the peer must run with the *persistent* `_symbol_states` cache (`/monkey/tick/run`), NOT the ephemeral-per-call state of `/monkey/k-shadow/tick`. A consensus peer with amnesiac state is not a meaningful second opinion.
3. **Engine label** — confirm whether the arbiter's `peerEngineType: 'py-retrospective'` is correct for a *live forward* Python peer, or whether a new label (e.g. `py-live`) is needed so the WR matrix attributes its outcomes to the right cell. Resolve against `wr_retrospective.ts` / `wr_matrix.ts`.

**Step 2: Commit the decision**

```bash
git add docs/plans/20260521-deshadow-python-consensus-peer.md
git commit -m "docs(plan): pin peer architecture for consensus de-shadow"
```

---

## Task 2: Python — map a tick decision to a ProposalEvent

**Files:**
- Modify: `ml-worker/src/monkey_kernel/proposal_bus.py`
- Test: `ml-worker/tests/test_proposal_bus_from_decision.py` (create)

**Step 1: Write the failing test** — a pure mapper `proposal_from_tick_decision(symbol, instance_id, decision, basin, phi, kappa, mode, tick_id)` that returns a `ProposalEvent` with `proposed_action`/`side` derived from the tick decision's action, `side` non-null only for entries.

```python
def test_proposal_from_hold_decision_has_null_side():
    evt = proposal_from_tick_decision(
        symbol="BTC_USDT_PERP", instance_id="monkey-py",
        action="hold", side=None, size_usdt=0.0, leverage=1.0,
        entry_threshold=0.5, basin_signature=[0.1] * 8,
        phi=0.22, kappa=64.0, mode="investigation", tick_id="BTC|7",
    )
    assert evt.proposed_action == "hold"
    assert evt.side is None
    assert evt.instance_id == "monkey-py"

def test_proposal_from_enter_long_carries_side():
    evt = proposal_from_tick_decision(
        symbol="BTC_USDT_PERP", instance_id="monkey-py",
        action="enter_long", side="long", size_usdt=25.0, leverage=5.0,
        entry_threshold=0.6, basin_signature=[0.1] * 8,
        phi=0.3, kappa=64.0, mode="investigation", tick_id="BTC|8",
    )
    assert evt.proposed_action == "enter_long"
    assert evt.side == "long"
```

**Step 2: Run to verify it fails**

Run: `cd ml-worker && python -m pytest tests/test_proposal_bus_from_decision.py -v`
Expected: FAIL — `proposal_from_tick_decision` not defined.

**Step 3: Implement the minimal mapper** in `proposal_bus.py` — normalise `pyramid_long`/`pyramid_short` → `enter_long`/`enter_short`, `exit*` → `exit`, everything else → `hold`; `side` passthrough. Mirror the TS normalisation at `loop.ts:3806-3818`.

**Step 4: Run to verify it passes**

Run: `cd ml-worker && python -m pytest tests/test_proposal_bus_from_decision.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add ml-worker/src/monkey_kernel/proposal_bus.py ml-worker/tests/test_proposal_bus_from_decision.py
git commit -m "feat(monkey-py): map tick decision to ProposalEvent"
```

---

## Task 3: Python — publish the peer proposal from the tick endpoint

**Files:**
- Modify: `ml-worker/main.py` — the endpoint chosen in Task 1 (expected `/monkey/tick/run`).
- Test: `ml-worker/tests/test_tick_publishes_proposal.py` (create)

**Step 1: Write the failing test** — call the endpoint handler with a stub Redis publisher (monkeypatch `publish_proposal_sync`); assert it is called once with a `ProposalEvent` whose `instance_id` is the peer id (NOT the TS self id) and whose `symbol`/`tick_id` match the request.

**Step 2: Run to verify it fails**

Run: `cd ml-worker && python -m pytest tests/test_tick_publishes_proposal.py -v`
Expected: FAIL — endpoint does not publish.

**Step 3: Implement** — after `run_tick(...)` returns `decision`, build the event via `proposal_from_tick_decision(...)` and call `publish_proposal_sync(event)`. Fire-and-forget; the existing `publish_proposal_sync` already swallows Redis errors and no-ops when `CONSENSUS_PROPOSAL_BUS_LIVE` is off. Use the peer `instance_id` from Task 1.

**Step 4: Run to verify it passes** — and run the full kernel suite to confirm no regression.

Run: `cd ml-worker && python -m pytest tests/test_tick_publishes_proposal.py tests/ -q`
Expected: PASS, no regressions.

**Step 5: Commit**

```bash
git add ml-worker/main.py ml-worker/tests/test_tick_publishes_proposal.py
git commit -m "feat(monkey-py): publish peer proposal to consensus bus on tick"
```

---

## Task 4: TS — fan each live tick out to the Python kernel

**Files:**
- Create: `apps/api/src/services/monkey/peer_kernel_client.ts` (or extend `kernel_client.ts` — confirm in Task 1).
- Modify: `apps/api/src/services/monkey/loop.ts` — add the fanout next to the existing self-proposal publish (`:3799-3832`).
- Test: `apps/api/src/services/monkey/__tests__/peerKernelClient.test.ts` (create)

**Step 1: Write the failing test** — `fanoutToPeerKernel(inputs)` POSTs the tick inputs to `ML_WORKER_URL` + the Task-1 endpoint, fire-and-forget, never throws on network error, no-op when a `CONSENSUS_PEER_FANOUT_LIVE` flag is unset. Mirror `autonomic_client.ts` for the client shape and timeout (`DEFAULT_TIMEOUT_MS`).

**Step 2: Run to verify it fails**

Run: `node_modules/.bin/vitest run apps/api/src/services/monkey/__tests__/peerKernelClient.test.ts`
Expected: FAIL — module/function not defined.

**Step 3: Implement** the client + the loop.ts call site. The fanout runs *before* the `CONSENSUS_EXECUTOR_LIVE` block so the Python proposal lands on the bus before `getRecentPeerProposal()` is read on the *next* tick (the freshness window — `PEER_PROPOSAL_FRESHNESS_MS=60_000` — comfortably spans one tick interval). Flag-gate with `CONSENSUS_PEER_FANOUT_LIVE` so it can be deployed dark, then flipped.

**Step 4: Run to verify it passes** — plus the full monkey suite, excluding stale worktrees.

Run: `node_modules/.bin/vitest run apps/api/src/services/monkey/__tests__/ --exclude '**/.claude/**'`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/services/monkey/peer_kernel_client.ts apps/api/src/services/monkey/loop.ts apps/api/src/services/monkey/__tests__/peerKernelClient.test.ts
git commit -m "feat(monkey): fan each tick out to the Python consensus peer"
```

---

## Task 5: TS — verify a peer proposal drives a non-single-kernel verdict

**Files:**
- Test: `apps/api/src/services/monkey/__tests__/consensusArbiter.test.ts` (extend)

**Step 1: Write the failing test** — publish a peer `ProposalEvent` (distinct `instance_id`) to the bus via the TS `publishProposal`, let the in-process subscriber record it, then assert `getRecentPeerProposal()` returns it and `computeConsensus()` yields a verdict other than `single-kernel` (e.g. `same-side-slerp` when sides agree). Use `_resetProposalBus()` for isolation.

**Step 2: Run to verify it fails / Step 3: adjust / Step 4: pass / Step 5: commit** — standard TDD loop. This test is the regression guard that the peer path actually exercises the arbiter.

---

## Task 6: Deploy, soak, then flip the arbiter authoritative

**Step 1:** Merge Tasks 2–5 (each via the standard PR + full-gates flow). Deploy dark — `CONSENSUS_PEER_FANOUT_LIVE` unset.

**Step 2:** Flip `CONSENSUS_PEER_FANOUT_LIVE=true` on `polytrade-be` + `CONSENSUS_PROPOSAL_BUS_LIVE` already true on both services. Confirm in Railway logs that `[Consensus]` lines now show `verdict` values other than `single-kernel` and a non-null `peer_wr`.

**Step 3:** Soak — confirm over a meaningful window that the Python peer proposals are fresh, the verdicts are sane, and no tick latency regression. The arbiter is still non-authoritative (`CONSENSUS_ARBITER_LIVE=false`) so execution is unchanged — this is the safe observation window.

**Step 4:** Once the soak is clean, flip `CONSENSUS_ARBITER_LIVE=true` — the blended consensus decision becomes authoritative for execution (still TS placing the orders). This is the final de-shadow step and the point at which the Python kernel genuinely influences live trading.

**Step 5:** Update `[[polytrade-consensus-architecture]]` memory + close the loop in this plan doc.

---

## Verification checklist

- [ ] Every new TS function / Python function has a test written before it.
- [ ] Each test watched fail before implementation.
- [ ] `vitest` monkey suite green (excluding `.claude/worktrees`).
- [ ] `pytest` ml-worker kernel suite green.
- [ ] `tsc --noEmit` clean for `apps/api`.
- [ ] Production `[Consensus]` logs show non-`single-kernel` verdicts after the fanout flag flips.
- [ ] `TRADING_ENGINE_PY` untouched throughout.
