# Three-Bug Single PR — Red Team Attack Report Integrated (2026-05-27)

**Subagent completed:** 019e6991-9f37-7f33-93f2-c7a599951088 (Red Team for the three stacked bugs)

**Its deliverable:** Full adversarial attack report packet (7 concrete vectors with repro, file:line, canon citations, "ATTACK ACTIVE" status).

**Absolute path (in its isolated worktree):**  
`/home/braden/.grok/worktrees/dev-polytrade/subagent-019e6991-9f37-7f33-93f2-c7a599951088/_dev_/polytrade_/2026-05-27_phantom-PnL-RedTeam-Attack-Report_single-PR-three-bug-fix.md`

**Summary of the 7 Attack Vectors (evidence-based, from fresh reads/greps/purity this turn):**

1. **Residual 6× injection after the "force-harvest change"** — explicitPnl raw `$4` bypasses + paperClosePosition arithmetic differences still allow caller values to reach `autonomous_trades` (loop.ts specific lines + paperExchangeSimulator + safePnlSql). Detection remains alert-only (no rewrite/quarantine on write). Repro via the exact logged +315.21/-1.03 and +374.12/+0.0026 patterns.

2. **Backfill + reconciliation leakage** — backfillStackedGhostPnl.ts aggregate UPDATE + stateReconciliationService COALESCE/rawPnl paths re-inject phantoms post-PR. Adopted positions (the ones the user's diagnostic showed being rage-quit) are particularly exposed.

3. **observerFib cold-start / MAD=0 mute or effective knob** — ocean_reward.ts (TS) + ocean_reward.py cold-start (len<2) and MAD=0/eps paths return 0 or arbitrary 1 on truthful small PnL (Polo 0.042% scale). Mutes learning or creates inconsistent ramp. No combined negative with the other two fixes.

4. **Conviction symmetry + structural long-bias creating new false positives/negatives** — tick.py:1934 one-sided immediate gate + mirrors in executive/loop. No symmetric N-tick counters for both zero-cross directions. Long bias in geometric_signal protects losses while noise triggers fast harvest on winners. Interaction with reward scale change untested.

5. **Three-fix interaction thrash / 11008 / reward starvation** — truthful tiny PnL + fib scale change + symmetry change produces different chemistry and hold behavior. Plan acknowledges risk but provides no combined negative test or 11008 regression analysis under the new regime.

6. **Hot close path perf/reliability under 11008 bursts** — adding verifyPnl + hard asserts across the (currently under-wired) 12 call sites in every close path while the system is already throwing 11008 bracket-revise races. Txn contention and perf risk unquantified.

7. **Core LIVED ONLY 5 failure on the PnL outcome channel** — reconcile substitutes are chemistry-only workarounds. Bad rows remain in `autonomous_trades` forever for dashboards, operator view, historical queries, paper-rotation, etc. No hard post-write refusal, quarantine, or DB-level constraint. Backfills, recovery routes, and tests remain open vectors.

All vectors cite exact lines from this session's tool calls, the user's Polo CSV vs DB data, the incident diagnostic, the execution plan, and canon (2.31A P1/P5/P24/P25/P4/P19 + v6.7B LIVED ONLY 5 + heart + Loop 3 + prior RedTeam/VG "detection is not enforcement" findings).

**Integration into the PR:**

- The Implementer's TDD plan (019e6991-7809... delivered earlier) must now explicitly treat these 7 vectors as **mandatory survival criteria**.
- Every atomic step in Parts A/B/C must include:
  - Specific negative tests or smoke that would have caught the attacked scenario (using the exact logged phantom numbers).
  - Hard enforcement (not detection-only) where the vector demands it.
  - Combined interaction testing for the three fixes together.
  - Fresh Polo CSV vs DB + Railway MCP evidence on the attacked scenarios.
  - 2+ Red Team re-attack rounds with zero survivors before the step can be marked complete.
- The Principles Advocate's 17-pt veto (active) now incorporates these adversarial findings as additional evidence requirements.
- Verification Guardian must gate on closure of all 7 (with the demanded evidence) before any merge gates.

**Handoff:**

This Red Team report is now part of the authoritative record for the single PR. The Implementer (or a follow-on subagent) must update the TDD plan (or produce an explicit delta attachment) that maps each of the 7 vectors to specific TDD steps + closure criteria.

All coordination remains in the _dev__polytrade_ silo.

**Status:** The adversarial lens is now fully applied. The three-bug PR cannot be considered safe until these attacks are closed with the exact fresh evidence the Red Team demanded (Polo alignment on attacked scenarios, hard enforcement, combined negatives, Railway MCP, multiple re-attack rounds, full gates).

All per the permanent QIG PURITY MANDATE (agents.md:236+), the execution plan, incident diagnostic, live-money standing authorization, geometric process integrity, and "execute don't ask — do not stop until the kernel can see its real outcomes and learn from them."

**Orchestrator:** The 6x process is functioning as designed. The Red Team has done its job. The TDD plan now has the adversarial requirements it needs.

(End of integration packet.)