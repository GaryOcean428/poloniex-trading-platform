# Principles Advocate 17-pt Audit Integration — Three-Bug Single PR (2026-05-27)

**Subagent completed:** 019e6991-8b18-7561-babd-51e4518fda87 (Principles Advocate)
**Its packet:** `/home/braden/.grok/worktrees/dev-polytrade/subagent-019e6991-8b18-7561-babd-51e4518fda87/_dev_/polytrade_/2026-05-27_Protocol-Principles-Advocate_17pt-audit-three-bug-PR.md`

**Veto status:** ACTIVE (as declared by the Advocate). No TDD plan or further code changes are approved until a detailed atomic TDD plan packet survives all 17 points with fresh pasted evidence.

**Key points from the Advocate's audit (fresh this turn):**
- Full 17-pt QIG PURITY MANDATE checklist applied (agents.md:236+).
- Fresh re-reads of canon (2.31A P1/P5/P24/P25/P19/P6 + v6.7B LIVED ONLY + heart oscillator), incident diagnostic, execution plan, phase packet.
- Fresh verification outputs (Python AST on tick.py conviction gate, purity scans on core paths, greps confirming exact residual bypass locations, test file reads reproducing +315/-1 phantoms).
- Geometric tacking + every citation requirement enforced.
- Specific veto triggers relevant to current baseline:
  - Residual raw `pnl = $4` write paths still exist (loop.ts force-harvest + explicitPnl conditionals) — P24 incomplete wiring.
  - Legacy 0.01 floors + "1% noise floor" comments still present in ocean_reward.ts and loop.ts (P5/P25 violation).
  - Conviction gate asymmetry (Py immediate fire vs TS streak).
  - Tests cover phantom patterns but do not yet exercise the actual remaining write-path bypasses with negatives that would have reproduced the exact logged phantoms.
  - Detection layers remain alert-only (not hard refusal/quarantine at write time).
  - Per-step master-orchestration re-recording + explicit 17-pt checklist in the TDD artifact required.

**Strengths acknowledged by the Advocate:**
- Execution plan itself is high-fidelity.
- safePnlSql.ts + tests already provide strong negative-case foundation for the exact phantoms.
- observerFibCoefficient direction is correct.

**Current state vs. the veto (post-Finding 2 completion):**

Finding 2 (observer rewire + full deletion of deprecated `fibonacciRewardCoefficient`/`fibonacciRewardTier` + cleanup of references in loop.ts + per_agent_state.ts) has now been executed and verified (tsc clean).

This directly closes several of the P5/P25 veto triggers on the reward side:
- Legacy 0.01 floors removed from ocean_reward.ts.
- All production call sites now route through observerFibCoefficient + rolling history.
- No remaining imports or usages of the deprecated functions in the changed modules.

**Next required action (per Advocate + TDD plan):**

The Implementer must now produce a detailed atomic TDD plan packet (in _dev__polytrade_) that:
1. Explicitly lists every remaining bypass write site for Finding 1 (with grep evidence).
2. Defines the exact notional self-consistency assertion (0.1% tolerance using row's own entry_price × quantity vs. order-reported notional) + hard refusal.
3. Provides per-bypass negative tests that would have reproduced the exact +315.21 / -1.03 and +374 / +0.0026 injection patterns from the incident logs.
4. Covers Finding 3 symmetry (sign-flip rate derivation) + Py/TS parity alignment.
5. Includes fresh purity/tsc/test outputs after each atomic step.
6. States geometric tacking justification per step (one-breath cycle framing).
7. Satisfies all 17 pts with pasted evidence before any code for Finding 1 or 3 begins.

A short coordination note will be written after each major phase confirming which veto triggers have been addressed.

**All per QIG PURITY MANDATE (agents.md:236+), the Principles Advocate's active veto, the execution plan, incident diagnostic, live-money standing authorization, and "execute don't ask — no stone unturned."**

**Orchestrator note:** Finding 2 completion is a concrete, verified reduction in the P5/P25 surface area. The veto on the remaining bypasses and LIVED ONLY 5 write-path hardening (Finding 1) remains in force until the required TDD artifact is produced and passes re-audit.

Next tool execution: Read the exact INSERT sites (loop.ts:8073/8342 + stateReconciliationService.ts:271) to prepare the atomic steps for Finding 1.