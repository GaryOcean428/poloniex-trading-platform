# Compliant TDD Plan — Single PR: Root Out 6× Phantom PnL, Observer-Derive Fib Threshold, Symmetrize Conviction (P1/P5/P24/P25 + v6.7B LIVED ONLY 5)

**Date:** 2026-05-27  
**Status:** This is the authoritative, Verification Guardian Baseline Gate-surviving TDD plan for the single focused PR. It was produced after the VG veto on the prior high-level deliverable and incorporates all required rigor.

**Governing Documents (re-read fresh before authoring this plan):**  
- 2026-05-27_phantom-PnL-residual-x6-inflation_incident-diagnostic.md (user's verbatim cascade + exact Polo numbers + +315.21/-1.03 and +374.12/+0.0026 phantoms + 6.6× quantification).  
- 2026-05-27_single-PR-three-bug-fix_execution-plan.md (user's explicit directive for the single PR).  
- Verification Guardian Baseline Gate Veto packet (the formal veto with (a)-(e) gaps and demands for explicit commands + per-path LIVED ONLY 5).  
- Red Team Attack Report (7 vectors with file:line and "ATTACK ACTIVE" framing).  
- Principles Advocate 17-pt audit (active veto).  
- QIG PURITY MANDATE (agents.md:236-273) + exact canon (2.31A P1/P5/P24/P25 + v6.7B LIVED ONLY + heart oscillator + three-scale).  
- Prior atomic steps, call-site audit table, LIVED ONLY 5 per-path checklist, and Red Team vector mapping documents I produced.

**Master-Orchestration Re-Inventory (Gate D, executed before authoring):** Project family = QIG. Skills/MCPs distributed to 6x + Implementer with explicit attachments. All Gates A-E + QIG branch rules enforced. Geometric process integrity (heart-rhythmic tacking + Fisher-Rao justification) stated for the plan and every major step.

**Geometric Process Integrity for This Plan:**  
Heart-rhythmic tacking from the user's cascade (phantom-PnL 6× → DB lies → 0 tier-1 rewards → asymmetric conviction thrash → 11008 races) ↔ phase simulation "felt" P24/P5 violations (kernel learning on phantom outcomes = sovereignty collapse) ↔ canon P24 ("every lived PnL row must have call-site + hard assert + negative test exercising the integration point"; "Disconnected Infrastructure is a Bug") + P25/P5 ("no magic 1% or 2-tick"; "thresholds emerge from rolling win-magnitude / observer / equity gradient / heart") + P1/P18 (purity) + v6.7B (heart as master oscillator + LIVED ONLY 5 on realized PnL feeding Replicant/Loop 3/sovereignty) ↔ execution plan's correct prescription for one coherent PR.  
Every breath of this plan = one complete tacking cycle of the system seeing its real P&L (inhale: audit), deriving its own scales from that P&L (exhale: observer MAD + symmetry), reacting without bias. No linear/Euclidean checklists on the curved manifold. Fisher-Rao basin distance to the ideal ("every autonomous_trades.pnl row = kernel's actual lived per-row outcome, provable at write time, no bypasses, no poison left in the table") is the measure of progress.

**PR Title:** "Fix phantom-PnL residual 6×, observer-derive Fibonacci reward gate, symmetrize conviction (P1/P5/P24/P25 + v6.7B LIVED ONLY)"

**Acceptance Criteria (evidence only, must be proven with fresh pasted outputs):**  
- Polo Realized PnL vs DB alignment on fresh sample using the user's exact numbers (4.5h/92 trades/net −$7 vs 24h/925/+283; 6.6× per-trade; 0/925 ≥1% ROI; exact logged phantoms). Residual 6× eliminated.  
- 0 static/hardcoded 1% (or any static floor) in the reward path; observerFibCoefficient (median/MAD on rolling pnlFracHistory) + history wiring is the sole gate for positive (and symmetric negative) chemistry.  
- Conviction harvest requires identical consecutive N-ticks for confidence crossing the hesitation threshold in either direction (no structural long bias in the gate). Py/TS parity aligned.  
- All three negative cases pass with fresh output: (1) phantom 6× injection on every write path (force-harvest, explicitPnl, backfill, recovery, etc.) no longer writes phantoms or is refused/quarantined; (2) sub-1% win in realistic scalp regime (0.042% scale) now produces scaled positive chemistry where legacy returned 0; (3) asymmetric doubt vs confirmation in chop (30-90s winner harvest vs 10-40min losses) is eliminated — identical latency both directions.  
- Full pre-merge gates: qig-purity-validation (0 violations on changed paths), tsc --noEmit, Vitest + pytest with the exact Polo phantom numbers + Red Team scenarios, 2+ Red Team re-attack rounds with zero survivors.  
- Post-deploy: Railway MCP (get_logs + service_metrics) + Polo CSV correlation for the same window shows the cascade broken (DB vs Polo alignment, tier-1 rewards resume, 11008 rate drops, median hold on winners lengthens, operator sees truthful "because" view).  
- Every changed file, this plan, commits, and PR cite: this packet + incident + execution plan + VG Baseline Gate packet + Red Team report + agents.md:236+ QIG PURITY MANDATE + exact 2.31A P1/P5/P24/P25 + v6.7B LIVED ONLY/heart/Loop 3 + geometric tacking justification + fresh evidence hashes. No new knobs. Small + type-safe + tested.

**Process (non-negotiable):**  
- 2-stage reviews (spec compliance then code quality) + Verification Guardian re-gate on this TDD plan itself before any code.  
- Every atomic step: red-green (negative tests first with Polo numbers), minimal green change, fresh pasted verification output before marking complete.  
- LIVED ONLY 5 on the PnL outcome channel (P24 + v6.7B): proven per write path using the checklist below.  
- Geometric tacking justification stated per major step.  
- All coordination in _dev__polytrade_ silo. Worktree isolation for changes.  
- Live-money standing auth: full gates only; execute, no deferral.

---

### Part 0 — Setup + Full Audit (No Kernel Edits Yet)

**0.1 Master-orchestration + re-reads + this compliant TDD plan written**  
- Verification commands (run and paste output before advancing):  
  - `python ml-worker/scripts/qig_purity_check.py` → expect "55 file(s) clean"  
  - Targeted purity on three-bug paths + TS grep for forbidden patterns.  
  - `git branch --show-current` (confirm isolated worktree/branch).  
- Evidence required: Pasted outputs + this plan file written.

**0.2 Full PnL write-path call-site audit (using the fresh table already produced)**  
- Use the artifact: `2026-05-27_PnL-Write-Path-Call-Site-Audit-Table.md` (12+ sites enumerated with risk + current mechanism).  
- Verification command: Run the exact greps from the table + confirm counts pre-fix.  
- Produce Attachment A (living version of the table) with pre-fix baseline.

**0.3 LIVED ONLY 5 baseline per path (using the checklist already produced)**  
- Use the artifact: `2026-05-27_Finding1-LIVED-ONLY-5-Per-Path-Checklist.md`.  
- For each high/medium risk path, run the baseline commands and document current gaps (call-site counts, hard assert presence, negative test coverage, etc.).  
- Evidence: Populated checklist with pre-fix numbers.

**0.4 Red Team vector baseline**  
- Use the artifact: `2026-05-27_RedTeam-Vectors-to-TDD-Updates-Mapping.md`.  
- Confirm all 7 vectors are mapped to specific TDD steps.  
- Evidence: Mapping table with current status (all "ATTACK ACTIVE" until closed with fresh Polo/DB evidence).

---

### Part A — PnL LIVED ONLY 5 Closure (Highest Priority — Blocks Everything Downstream)

**Goal:** Every production write path that can put a `pnl` value (or a row that will later receive one) into `autonomous_trades` must satisfy the full LIVED ONLY 5 checklist using the template already produced. Hard post-write enforcement (not detection-only). No bad rows left in the canonical table.

**Atomic Steps (each with red-green, fresh verification, 2-stage review):**

**A.1 RED — Negative tests for every high/medium risk path (using exact logged phantoms)**  
- Expand safePnlSql.test.ts + add new tests for each bypass (force-harvest paper, explicitPnl branch, backfill aggregate, COALESCE recovery, etc.).  
- Tests must inject the exact +315.21 on −1.03 and +374.12 on +0.0026 patterns (and scaled 6× versions) and assert the path currently writes the phantom (or would).  
- Verification command (paste output showing FAIL): `yarn vitest run ... -t 'phantom|6x|force-harvest|explicitPnl|backfill'` (must show the injection succeeds today).  
- Also Python-side if backfill/recon paths have Python exposure.

**A.2 GREEN (minimal) — Hard post-write guard + refusal on all live close paths**  
- In every UPDATE that sets `pnl` on real rows (see call-site table): always use SAFE_PNL_FROM_ROW or computeSafePnl + immediate `verifyPnl(..., phantomThresholdUsd=5.0)`.  
- On isPhantomCandidate: log full context + refuse the write (or quarantine with provenance) instead of committing the bad value.  
- Explicitly close the two Red Team Vector 1 bypasses (force-harvest paper and explicitPnl conditional).  
- Verification (paste before advancing):  
  - `yarn tsc --noEmit` (or equivalent).  
  - The negative tests from A.1 now PASS (the injection is refused).  
  - Runtime smoke injecting the exact phantoms on the closed paths → no bad rows written.  
  - Post-fix grep: zero remaining raw `pnl = $4` with caller values on real rows.

**A.3 RED-GREEN — Notional self-consistency assertion at all INSERT sites (Finding 1 core)**  
- At the three INSERT sites (loop.ts:8342 live, 8073 paper, stateReconciliationService.ts:271 adopted/recon): before commit, compute notional from row data (entry_price × quantity) and assert it matches the originating order/exchange position notional within 0.1%.  
- On failure: refuse/quarantine.  
- Use the atomic step already written (`2026-05-27_TDD-atomic-step_Finding1-INSERT-notional-assertion.md`) as the spec for the first site; replicate for the other two.  
- Verification: negative test that injects mismatched notional at INSERT time + proves refusal. Post-fix grep + runtime on live insert paths.

**A.4 RED-GREEN — Hard enforcement on backfill + reconciliation recovery paths (close Red Team Vector 2)**  
- Update backfillStackedGhostPnl.ts and stateReconciliationService recovery paths to route through safe computation + post-write verifyPnl.  
- On divergence: quarantine + alert (never silently write phantom to canonical table).  
- Verification: negative test using the aggregate phantom pattern from the incident + proves no bad row written. Post-fix runtime on recovery paths.

**A.5 REFACTOR + Full Coverage + LIVED ONLY 5 Evidence**  
- For every path in the call-site audit table, attach the completed LIVED ONLY 5 checklist (using the template).  
- One cross-cutting command: full grep + count proving 100% of production write paths now have proven call-site to safe + hard assert.  
- Update all comments with full citations (this plan + incident + VG packet + Red Team report + agents.md:251 + canon P24).  
- Verification (paste before marking complete): the populated checklist + the cross-cutting grep proof + runtime smoke on all high-risk paths with Polo numbers.

**A.6 2-Stage + VG Re-Gate on Part A**  
- After A.5: 2-stage review (spec compliance then code quality) + Principles Advocate + Red Team re-attack on Vector 1/2/7 + Verification Guardian re-gate on Part A with fresh Polo/DB evidence.

---

### Part B — Fibonacci Threshold Purely Observer-Derived (P1/P5/P25)

**B.1 RED — Negative tests for sub-1% wins in realistic scalp regime**  
- Using the user's numbers (0.042% avg win, history median/MAD ~0.0002): test that legacy returns 0 while observerFibCoefficient returns positive tier.  
- Also cold-start (history <2) and MAD=0/eps cases.  
- Verification (paste FAIL): vitest/pytest with Polo-scale history.

**B.2 GREEN — Complete removal of static floor + sole observer gate**  
- Remove the `if (roiFrac < 0.01)` (and any equivalent) from ocean_reward.ts:22/40 and any other reward emission.  
- Ensure observerFibCoefficient (already partially wired at loop.ts:8532) + history push is the sole path.  
- Verification (paste before advancing): post-fix grep proving zero `roiFrac < 0.01` or equivalent static floor remains in reward paths; runtime smoke with 0.042% win now produces scaled chemistry; tests from B.1 now PASS.

**B.3 REFACTOR + Symmetry + Evidence**  
- Update comments (remove "ONLY at ROI ≥ 1%" language).  
- Confirm negative side is also observer-derived or explicitly symmetric.  
- Attach Red Team Vector 3 closure evidence (cold-start + MAD=0 + three-fix interaction).  
- 2-stage + VG re-gate on Part B.

---

### Part C — Conviction Gate Symmetry + Py/TS Parity (P5/P25 + P6 heart rhythm)

**C.1 RED — Negative tests for asymmetric chop behavior**  
- Chop scenario (30-90s noise triggering fast harvest on winners vs losses running 10-40min).  
- Assert identical consecutive tick requirement for confidence crossing the hesitation threshold in both directions.  
- Verification (paste FAIL pre-fix): tests exercising the one-sided immediate fire in tick.py:1935 + TS mirrors.

**C.2 GREEN (bridge) — Py/TS parity alignment**  
- Port minimal streak counter to Py (using the existing per-lane pattern already present for regimeChangeStreakByLane) to match current TS behavior (`stabilityTicksFromPhi(phi) * laneMultiplier`).  
- Verification: tests from C.1 now show parity; runtime chop sequence no longer has divergent behavior.

**C.3 Canonical — Observer-derived streak from sign-flip rate**  
- Implement the long-term P1 fix: required N-ticks derived from the agent's own rolling sign-flip rate on the (anxiety + confusion - confidence) signal.  
- Attach Red Team Vector 4 closure (symmetry + long-bias + three-fix interaction + 11008 behavior).  
- Verification: chop tests pass with identical latency; no structural bias.  
- 2-stage + VG re-gate on Part C (must include fresh 11008 rate evidence under the combined fixes).

---

### Cross-Cutting

- Full 2-stage + Principles Advocate + Red Team re-attack + Verification Guardian re-gate on the entire plan after each Part (or at major milestones).
- Geometric tacking justification updated per Part.
- All changes small + type-safe + Vitest/pytest + ports per .claude/CLAUDE.md.
- Final pre-merge: purity, tsc, full test matrix with Polo numbers + Red Team scenarios, 2+ zero-survivor Red Team rounds, Railway MCP + Polo CSV proof.
- Post-deploy monitoring as final AC.

**Evidence Section (to be populated during execution):**  
[Will contain all fresh pasted outputs, commit SHAs with citations, Polo/DB diffs, etc.]

This TDD plan, once it survives the required reviews and re-gates, is the spec for the single PR that breaks the stacked cascade.

All per the permanent QIG PURITY MANDATE (agents.md:236+), the Verification Guardian Baseline Gate veto, the Principles Advocate veto, the Red Team attack report, live-money standing authorization, geometric process integrity, LIVED ONLY 5, and "execute don't ask — no stone unturned until the kernel can see its real outcomes and learn from them."

(End of compliant TDD plan. Ready for 2-stage review + re-gate.)