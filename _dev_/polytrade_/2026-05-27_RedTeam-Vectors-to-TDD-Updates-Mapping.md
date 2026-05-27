# Red Team Attack Vectors → Required Updates to the Implementer's TDD Plan

**Date:** 2026-05-27  
**Source:** Red Team report from subagent 019e6991-9f37-7f33-93f2-c7a599951088 (7 vectors, full details in its isolated worktree packet).

This document is a compact, actionable mapping so the Implementer (019e6991-7809...) can update its TDD plan (or produce a delta attachment) without re-reading the entire Red Team report. Every vector below must be explicitly addressed in the TDD plan with:
- Specific atomic step(s) that close it.
- Negative test / smoke that would have caught the attacked scenario (using exact logged Polo phantom numbers).
- Fresh evidence requirements (Polo CSV vs DB diffs on attacked scenarios, hard enforcement, combined three-fix interaction tests, Railway MCP, 2+ Red Team re-attack rounds with zero survivors).
- Geometric tacking justification update.
- LIVED ONLY 5 / P24 / P5/P25 citations.

**The TDD plan is not considered complete for 2-stage review until this mapping is incorporated.**

---

### Vector 1: Residual 6× Injection After "Force-Harvest Change" (ExplicitPnl + Paper Branches)
**Red Team file:line:** loop.ts:6466-6472 (force-harvest still uses raw `pnl = $4` with `rowPnl = close.pnl ?? computeSafePnl`), loop.ts:6829-6844 (explicitPnl branch bypasses SAFE_PNL_FROM_ROW entirely), paperExchangeSimulator.ts:135-137 (non-identical arithmetic + slippage).

**Required TDD Plan Update:**
- Part A must add explicit atomic sub-steps for the *explicitPnl conditional branch* and the force-harvest paper path (not just "finish the rest").
- Negative test must inject via paperClosePosition + force-harvest paper path and prove the row written matches Polo *and* uses the fragment (or refuses).
- Hard post-write `verifyPnl` assert + refuse/quarantine must be added to *all* UPDATE paths, including the explicitPnl branch.
- Evidence: fresh grep showing zero remaining raw `pnl = $4` with caller values on real rows + Polo/DB diff on the injected scenario.

**Status in current TDD plan:** Partially addressed in A.2/A.4 but needs explicit call-out of the two bypass branches Red Team surfaced.

---

### Vector 2: Backfill + Reconciliation + Ghost Recovery Re-Inject Phantoms
**Red Team file:line:** backfillStackedGhostPnl.ts:135 (aggregate UPDATE), stateReconciliationService.ts:543 (COALESCE/rawPnl on ghost recovery), 504-507.

**Required TDD Plan Update:**
- Part A must include atomic steps for the backfill script and reconciliation recovery paths (not just live close paths).
- These paths must also route through safe computation + post-write verifyPnl, or be explicitly quarantined / skipped for chemistry.
- Negative test: trigger ghost recovery or backfill with divergent aggregate and prove no phantom written to the canonical table (or quarantined with provenance).
- LIVED ONLY 5 evidence must cover "recovery / repair tools do not poison the lived outcome table."

**Status:** Not explicitly called out in current TDD plan sections. Must be added.

---

### Vector 3: observerFib Cold-Start / MAD=0 Mute or Effective Knob
**Red Team file:line:** ocean_reward.ts:61/75 (TS) + ocean_reward.py:100/117 (cold-start len<2 returns 0/1; MAD=0/eps returns 0 or arbitrary).

**Required TDD Plan Update:**
- Part B must add explicit cold-start / low-history / MAD=0 test cases using realistic Polo-scale history (median/MAD ~0.0002, wins at 0.00042).
- Must prove that small truthful wins produce positive chemistry (or documented gentle ramp) rather than mute.
- Must address "combined three-fix interaction" (tiny truthful PnL + new fib scale + symmetry) so the reward path does not re-introduce effective muting under the new regime.
- Evidence: runtime smoke with the exact sub-1% numbers from the incident + negative test that would have reproduced "0 tier-1 on realistic scalp wins."

**Status:** Partially addressed in B.1/B.3; needs explicit cold-start + MAD=0 + three-fix interaction test matrix.

---

### Vector 4: Conviction Symmetry + Structural Long-Bias Creating New False Pos/Neg
**Red Team file:line:** tick.py:1934 (one-sided immediate gate + "No half-life, no streak" comment), mirrors in executive/loop, geometric_signal long bias.

**Required TDD Plan Update:**
- Part C must explicitly include Py/TS parity alignment as a bridge step (port minimal streak counter to Py using the existing per-lane pattern for regimeChangeStreakByLane) before the full sign-flip rate derivation.
- Must add negative tests for chop + long-bias scenario (fast harvest on winners, slow on losses) under the new symmetric gate.
- Must test interaction with the reward scale change (does symmetry + new fib produce different hold/11008 behavior?).
- Evidence: chop sequence test + 11008 rate under the combined fixes.

**Status:** Part C mentions symmetry and Py/TS parity, but needs the explicit bridge + interaction test matrix called out.

---

### Vector 5: Three-Fix Interaction Thrash / 11008 / Reward Starvation
**Red Team summary:** Truthful tiny PnL + fib scale change + symmetry change produces different chemistry and hold behavior; plan has no combined negative.

**Required TDD Plan Update:**
- Add a dedicated "combined three-fix interaction" negative test matrix (using Polo 0.042% scale wins + chop sequences + the exact phantom injection patterns).
- Must cover 11008 rate, median hold on winners, tier-1 reward firing, and conviction harvest behavior under the full set of changes.
- Evidence: before/after on the combined scenario with fresh Polo CSV vs DB + Railway MCP.

**Status:** Acknowledged as risk in the execution plan but not turned into explicit TDD steps + evidence requirements. Must be added.

---

### Vector 6: Hot Close Path Perf/Reliability Under 11008 Bursts
**Red Team concern:** Adding verifyPnl + asserts across the (currently under-wired) close paths while the system is already throwing 11008 bracket-revise races.

**Required TDD Plan Update:**
- Part A (and cross-cutting) must include a perf/reliability sub-step: measure or bound the added cost of the new guards under load, especially during 11008 bursts.
- Negative: sustained 11008 + close volume test that does not regress txn contention or close latency beyond acceptable bounds.
- Evidence: any available load/perf data or explicit statement that this is out of scope for the PR with justification.

**Status:** Not addressed in current TDD plan. Must be called out (even if scoped as "monitor in post-deploy" with specific Railway MCP metrics).

---

### Vector 7: Core LIVED ONLY 5 Failure (Bad Rows Remain in the Table Forever)
**Red Team core point:** Reconcile substitutes are chemistry-only. Bad rows stay in autonomous_trades for dashboards/operator/historical/rotation/etc. No hard post-write refusal/quarantine/DB constraint.

**Required TDD Plan Update:**
- Part A must make explicit that the goal is *truthful rows in the canonical table*, not just "chemistry sees safe values."
- Hard post-write assert + refuse/quarantine/rewrite must be the default for any divergence > phantom threshold (not just in live close paths).
- Backfills, recovery, and test paths must not be allowed to write divergent rows (or must quarantine them with provenance).
- Evidence: grep + runtime proof that after the PR, no production path (including repair/recon) can leave a phantom-class row in the table without quarantine + alert.

**Status:** This is the strongest LIVED ONLY 5 / P24 veto trigger from both Red Team and Principles Advocate. Current TDD plan language is close but must be hardened to "no bad rows left in the canonical table."

---

**Handoff to Implementer:**

Update the TDD plan (or produce a delta attachment titled "Red Team Vector Closure") that maps each of the 7 vectors above to specific atomic step(s), negative test, fresh evidence requirements, and geometric tacking update. This updated plan is what must pass the 2-stage review (Principles Advocate + Developer Advocate) + Verification Guardian Gate 1 before any code on the remaining findings begins.

All per QIG PURITY MANDATE (agents.md:236+), the active Principles Advocate veto, the Red Team's "ATTACK ACTIVE" framing, live-money standing authorization, and "execute don't ask — no stone unturned."

(End of mapping. Ready for the Implementer to consume and produce the required update to the TDD plan.)