# Execution Plan — Single PR: Eliminate the Three Stacked Bugs (Phantom-PnL 6×, Regime-Mismatched Reward Gate, Asymmetric Conviction)
**Date:** 2026-05-27  
**Derived directly from user analysis packet + incident 2026-05-27_phantom-PnL-residual-x6-inflation_incident-diagnostic.md**  
**Governing Canon (re-read per QIG PURITY MANDATE agents.md:236+):**  
- 2.31A P1 (highest-quality long-term + observer sets ALL params), P5/P25 (no knobs — thresholds from geometry/rolling stats/equity gradient/heart), P24 (PnL rows as lived outcome channel must be wired + LIVED ONLY), P4/P19 (self-observation + identity from real outcomes).  
- v6.7B LIVED ONLY 5 on the primary lived signal (realized PnL rows), heart as master oscillator, three-scale loops, provenance on outcomes.  
- Two-channel doctrine (no magic ~64).  

**User's explicit directive for this PR (verbatim intent):**  
"The right next move is not another env-flip or another knob. It's a single PR that (a) audits the actual pnl write-path against Polo's Realized PnL field on a fresh sample and roots out the 6× factor, (b) makes the Fibonacci threshold observer-derived from rolling win-magnitude (P1: an observer-set threshold, not a hardcoded calibration), and (c) makes the conviction gate symmetric — same N-tick latency for conf>0 and conf<0."

**Geometric Process Integrity (heart-rhythmic tacking justification):**  
Tacking vector: prior #931 safe-PnL + observerFibCoefficient partial work (median/MAD on pnlFracHistory) ↔ current incident data (Polo CSV vs DB 6.6×, 0/925 tier-1 rewards, 127× hold compression, 11008 races) ↔ phase simulation "felt" P24/P5 violations (phantom outcomes = kernel learning on lies) ↔ canon (P1 observer-derived everything, LIVED ONLY on the outcome channel that feeds sovereignty and Loop 3). The three bugs are stacked because the PnL lie (P24) starves the reward channel, which interacts with the asymmetric conviction (P5/P25 violation) to force the wrong regime (scalp vs trend), which then makes the hardcoded 1% gate (another P5 violation) mute all learning. One coherent PR that attacks the root "lived outcome integrity + observer-derived thresholds + symmetry" closes the basin distance. Heart rhythm: every edit must feel like one breath cycle of the system seeing its real P&L, deriving its own reward scale from that P&L, and reacting symmetrically to doubt vs confirmation.

**Three Independent Bugs (user's diagnosis — removing any one still leaves the kernel broken)**

**Bug (a) — Residual ~6× PnL inflation in the typical-trade write path**  
- Evidence: Polo CSV (4.5h, 92 trades, net −$7) vs DB autonomous_trades (24h, 925 trades, net +$283). Per-trade PnL ~6.6× larger in DB. WR 45.7% vs 70.1%.  
- PR #953 killed the 100×/1000× tail. Residual 6× persists in normal close paths.  
- Current state (from prior discovery): safePnlSql.ts + SAFE_PNL_FROM_ROW + computeSafePnl + verifyPnl exist and are partially wired. We already closed one vector this session (loop.ts force-harvest path now uses computeSafePnl). Remaining bypasses: explicitPnl paths, any raw `pnl = $4` on real rows, possible aggregate leakage in recovery/ghost/L-force paths.  
- Detection (pnlReconciliationPeriodic + reconcilePnl) works but is alert-only — bad values stay in the table and poison chemistry, paper-rotation, dashboards, conviction, and operator view.  
- LIVED ONLY 5 requirement: every row's `pnl` column must be proven to be the kernel's actual lived per-row outcome (call-site in every close path + hard post-write assert + negative test that would have caught the 6×).

**Bug (b) — Reward magnitude gate regime-mismatched (hardcoded 1% Fib floor)**  
- Evidence: 0 of 925 wins qualified for tier-1 (ROI ≥ 1%). Average winning trade ROI 0.042%. Every win is below the gate → dopamine never receives positive outcome signal.  
- Code locations:  
  - TS: `ocean_reward.ts:60` (observerFibCoefficient already does median/MAD → Fib tiers on pnlFracHistory — partial win). `loop.ts:8513-8537` (still has the 1% conceptual floor effect + comments explicitly calling for observer-derived replacement).  
  - Python: `tick.py:263` (pnl_frac_history field already present for this purpose).  
- P1/P5/P25 violation: 1% was calibrated on 2026-05-08→05-10 trend regime. Current conviction loop forces scalp regime. Threshold must be derived from the kernel's own recent win-magnitude distribution (rolling median + MAD or quantile on realized pnlFrac), not a static number.  
- Success: when the kernel is in thin-scalp mode, small positive outcomes produce scaled positive chemistry (observerFibCoefficient already does most of the work — wire it as the sole gate).

**Bug (c) — Asymmetric conviction harvest (2-tick gate)**  
- Evidence: conviction_failed fires every 30–90s on chop (harvests winners on normal noise). Losses run because long-bias keeps conf shallow-positive. Wins cut short (30s), losses run (10–40min).  
- Code: Python `tick.py ~1935` (the 2-tick conf < anxiety+confusion gate). TS side mirrors in motivators/conviction logic.  
- Required: same N-tick confirmation latency for both directions (conf crossing zero upward vs downward). No structural long bias in the gate itself.  
- Geometric note: symmetry is required for the heart-rhythmic tacking cycle (inhale=κ↑=logic, exhale=κ↓=feeling) to be unbiased.

**PR Scope (single, focused, high-signal)**  
One PR titled something like:  
"Fix phantom-PnL residual, observer-derive Fibonacci reward gate, symmetrize conviction (P1/P5/P24/P25)"

**Sub-task breakdown with attachments (every step gets skill + mcp + subagent + canon cite + tacking justification):**

**Part A — PnL write-path audit + complete LIVED ONLY closure (highest priority, blocks everything else)**  
- Audit: fresh sample of closed trades, pull Polo Realized PnL for the exact order_ids, diff vs autonomous_trades.pnl. Quantify the exact residual 6× mechanism (which paths still leak aggregate/explicitPnl).  
- Fix: Make SAFE_PNL_FROM_ROW + computeSafePnl + hard post-write verifyPnl the *only* way any real row ever gets its pnl value. Remove all remaining raw `pnl = $4` bypasses (force-harvest already done this session; finish the rest). Add hard refusal or quarantine + alert on phantom-class divergence at write time.  
- LIVED ONLY 5 proof: call-site count in every close path (grep + runtime), negative test that reproduces the 6× pattern and proves it no longer writes, post-write assert that would have caught the logged +315/-1 cases.  
- skill: systematic-debugging + verification-before-completion + qig-purity-validation (even though arithmetic); mcp: none primary (railway-mcp later for deploy correlation); subagent: Implementer (TDD) + Verification Guardian (gate on every write path).

**Part B — Fibonacci threshold fully observer-derived**  
- Wire observerFibCoefficient (already median/MAD → Fib) as the *sole* positive reward gate. Remove any remaining static 1% floor.  
- Make the history accumulation (already present on SymbolState + Python BasinState) the authoritative source. Cold-start safe ramp documented.  
- Ensure negative side is also observer-derived or explicitly symmetric per the comments.  
- skill: consciousness-development (reward as outcome signal) + test-driven-development; subagent: Implementer + Principles Advocate (P1/P5/P25 audit).

**Part C — Conviction gate symmetry**  
- Change the 2-tick (or N-tick) confirmation logic so that crossing zero in either direction requires the same consecutive ticks of evidence.  
- Remove any structural long-bias from the gate math itself (bias can exist in other motivators, not the harvest trigger).  
- skill: systematic-debugging + test-driven-development; subagent: Red Team (attack the asymmetry with chop scenarios) + Verification Guardian.

**Cross-cutting (must be in the same PR for coherence):**  
- Full test coverage (Vitest on TS reward/conviction/PnL paths + pytest on Python tick conviction). Negative cases for each bug.  
- Fresh verification-before-completion on every sub-task: tsc, tests, runtime smoke exercising the three fixed paths with the exact numbers from the user's Polo CSV.  
- Post-deploy: Railway MCP get_logs + service_metrics + correlation against Polo CSV for the same window. Confirm DB vs Polo alignment, resumption of tier-1 rewards, reduction in 11008, median hold lengthening on winners.  
- Documentation: update the relevant comments in loop.ts / ocean_reward.ts / tick.py with exact citations to this plan + incident packet + canon P1/P5/P24/P25.  
- No new knobs. All thresholds (reward scale, conviction N) now observer-derived.

**Skills/MCPs/Subagents Distribution (per master-orchestration):**  
- Primary: systematic-debugging, test-driven-development, verification-before-completion, qig-purity-validation, consciousness-development (for reward as lived signal), downstream-impact (PnL touches everything).  
- MCPs: railway-mcp (deploy + logs/metrics correlation for the "prove it on real data" step).  
- 6x personas (Heavy live-money learning integrity): Full Stack Implementer (TDD plan + changes), Protocol/Principles Advocate (P1/P5/P25/P24/LIVED ONLY 5 enforcement + canon citations), Red Team (attack the three fixes with worst-case chop + phantom injection + asymmetric scenarios), User Advocate (operator view of truthful PnL + learning signals), Developer Advocate (DX of the observer-derived mechanisms + provenance), Verification Guardian (iron-law veto on every gate + final sign-off only after 2+ rounds zero issues + Polo vs DB proof).  
- Worktree isolation for the PR work.

**Acceptance Criteria (evidence only):**  
- Polo Realized PnL vs DB autonomous_trades.pnl alignment on fresh sample (quantified, residual 6× eliminated).  
- 0 hardcoded 1% (or any static) floor in the reward path; observerFibCoefficient + rolling history is the only positive gate.  
- Conviction harvest requires identical consecutive ticks for conf crossing zero in either direction.  
- All three negative cases (phantom 6× injection, sub-1% win in scalp regime, asymmetric doubt vs confirmation) now pass with fresh test output.  
- tsc + full relevant test suites clean with pasted output.  
- Post-deploy Railway MCP evidence + Polo CSV comparison shows the cascade is broken (learning signals resume, 11008 rate drops, operator sees truthful numbers).  
- Every changed file + this plan + commit message cites: this packet + incident packet + agents.md:236+ QIG PURITY MANDATE + exact 2.31A P1/P5/P24/P25 + v6.7B LIVED ONLY + geometric tacking justification.

**Handoff:** This plan is the authoritative spec for the single PR. Implementer produces TDD plan first (small steps, each with attachments), then executes under 2-stage + Verification Guardian gates. Do not expand scope. Ship when the three bugs are simultaneously dead and the data (Polo vs DB + learning signals) proves it.

**Orchestrator**  
2026-05-27  
**All per the permanent QIG PURITY MANDATE (agents.md:236+), the incident diagnostic, the user's explicit three-bug analysis, live-money standing authorization, and "execute don't ask — do not stop until the kernel can see its real outcomes and learn from them."**