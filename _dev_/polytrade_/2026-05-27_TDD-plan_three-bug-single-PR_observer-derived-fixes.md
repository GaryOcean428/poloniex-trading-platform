# TDD Plan — Single PR: Three Observer-Derived Fixes (User Audit 2026-05-27)
**PR Title (proposed):** "Fix residual 6× PnL inflation, rewire to observerFibCoefficient, derive conviction streak from sign-flip rate (P1/P5/P24/P25)"

**Derived from:**
- User deep analysis + "Audit complete — three findings" message (2026-05-27)
- 2026-05-27_phantom-PnL-residual-x6-inflation_incident-diagnostic.md
- 2026-05-27_single-PR-three-bug-fix_execution-plan.md
- 2026-05-27_cross-workstream-coordination_ObserverWiring-Reviews_ThreeBugPR.md
- User Advocate 9 demands (incorporated into Finding 1)
- Protocol/Principles Advocate 17-pt checklist (survival bar for this TDD plan)

**Governing Canon (re-read before every step):** 2.31A P1 (observer sets all params), P5/P25 (no knobs — thresholds from rolling stats / own signal volatility), P24 (PnL rows as primary lived outcome channel — LIVED ONLY 5), P4/P19 (self-observation + identity from real outcomes). v6.7B LIVED ONLY on realized PnL.

**Geometric Process Integrity:** Heart-rhythmic tacking between (a) the observer-wiring "kernel conscious but operator blind" reviews, (b) the three stacked bugs causing 0 learning signals and 11k races, and (c) the canonical observer-derived fixes the user audited. Every change justified as reducing Fisher-Rao distance to "the kernel sees its actual lived P&L and derives its own thresholds from that signal."

**Overall Constraints (non-negotiable):**
- Single PR, ~120 lines total.
- 0 new env vars / operator knobs.
- 1 deletion (deprecated function).
- All thresholds observer-derived.
- Full pre/post tsc + targeted Vitest + runtime smoke before every commit in the plan.
- LIVED ONLY 5 evidence for Finding 1 (PnL outcome channel).
- Fresh verification output pasted in every step's evidence section.
- Citations in every changed file + this plan + commit: this packet + incident packet + user audit message + agents.md:236+ + exact P1/P5/P24/P25 + v6.7B LIVED ONLY.

**Order of Work (lowest risk → highest impact on cascade first):**
1. Finding 2 (immediate unblocks reward starvation — dead code removal + one-line rewire).
2. Finding 1 (core LIVED ONLY integrity for PnL — the root that makes everything else lie).
3. Finding 3 (symmetry — prevents the asymmetric harvest that amplifies the bad signal).

---

### Step 1: Finding 2 — Rewire to observerFibCoefficient + Delete Deprecated Function (TDD-1)

**Goal:** Make the already-correct, already-tested observer-derived reward the only active path. Delete the source of the 1% floor that is starving chemistry.

**Sub-steps:**

**1.1 Audit all call sites (pre-change verification)**
- Command: `grep -r "fibonacciRewardCoefficient" --include="*.ts" --include="*.tsx" apps/api/src/ ml-worker/`
- Expected: Only the deprecated definition + per_agent_state.ts:179 + tests that assert the old 1% behavior.
- Evidence: Paste full grep output here before proceeding.
- Also run the existing oceanReward.test.ts to baseline.

**1.2 Update the single production call site**
- File: `apps/api/src/services/monkey/per_agent_state.ts`
- Change: Replace the import and the conditional with `observerFibCoefficient(outcome.roiFrac, ownPnlFracHistory)` (history already available via the agent's state).
- Add comment citing this TDD plan + user audit + P1/P5/P25 + "replaces the external hardcoded 1% floor".
- Verification: `npx tsc --noEmit` (clean), run the affected test file.

**1.3 Delete the deprecated functions + update comments**
- File: `apps/api/src/services/monkey/ocean_reward.ts`
- Delete `fibonacciRewardCoefficient` and `fibonacciRewardTier` (or mark them so they cannot be imported for new code; deletion preferred per "1 deletion").
- Update the header comment to say the legacy 1% path has been retired.
- Update any tests that were asserting the old behavior to test the observer path instead (or delete the now-irrelevant 1% floor tests).
- Verification: Full relevant test suite passes, tsc clean.

**1.4 Update any documentation / comments referencing the old 1% floor**
- In loop.ts reward emission area and per_agent_state.ts.

**1.5 Negative test (proves the bug is dead)**
- Add or update a test: with a history of small wins (0.01%–0.08% as in the audit), a 0.042% win now produces non-zero oceanCoeff (instead of 0).
- Evidence: Test output before/after.

**Acceptance for Step 1:** All call sites to the deprecated functions removed from production code. observerFibCoefficient is the only path for positive reward shaping. tsc + tests green with pasted output. ~15-25 lines net change.

---

### Step 2: Finding 1 — Notional Assertion at INSERT Time (LIVED ONLY 5 for PnL Outcome Channel)

**Goal:** At every INSERT into autonomous_trades for kernel-direct rows, assert that the computed notional (entry_price * quantity) matches the notional reported by the originating order within 0.1%. Refuse to write if it does not. This makes the PnL rows trustworthy (LIVED ONLY) without any operator-set flag or trust-by-prefix scheme.

**Sub-steps:**

**2.1 Locate all INSERT paths for autonomous_trades from the kernel (pre-change)**
- Grep for INSERT INTO autonomous_trades or pool.query with "autonomous_trades" + "INSERT".
- Focus on kernel-direct paths (reason like 'monkey|%').
- Evidence: List of exact locations + the current INSERT shape.

**2.2 Design the assertion (observer-derived)**
- At INSERT time (or immediately before), for rows where the engine is monkey/kernel-direct:
  - notional_computed = entry_price * quantity (in consistent units)
  - notional_from_order = the "Order Value" / notional field returned by Polo for the originating order (or the fill notional).
  - Assert |notional_computed - notional_from_order| / notional_from_order < 0.001 (0.1%).
- If assertion fails: throw / log with full context + refuse the INSERT (or mark the row in a quarantine state that chemistry ignores).
- No flag. No prefix trust. Pure data self-consistency check.

**2.3 Implement the guard in the primary INSERT sites**
- Start with the main close/settle paths in loop.ts and executive.ts.
- Make the check a small helper (e.g., `assertNotionalMatchesOrder(...)`).
- Add the check inside the transaction or right before the INSERT that sets pnl.

**2.4 Handle backfilled / legacy rows**
- Existing rows with the old flag can stay (or a one-time migration can be noted, but not required for this PR).
- New rows after this change must pass the assertion or be rejected.

**2.5 LIVED ONLY 5 evidence**
- Grep + runtime confirmation that every new kernel-direct close path now goes through the notional assertion before writing pnl.
- Negative test: craft a row where computed notional diverges >0.1% from order notional → INSERT is refused (or row is quarantined).

**2.6 Verification**
- tsc clean.
- Existing pnlReconciliation tests + any new notional assertion tests pass.
- Runtime smoke: simulate a close with mismatched notional → confirm rejection logged.

**Acceptance for Step 2:** No new kernel-direct row can be written with a quantity that would produce a phantom notional. The 928 "unknown" rows since the migration are the last of their kind. ~40-60 lines.

---

### Step 3: Finding 3 — Derive convictionFailedTicksRequired from Rolling Sign-Flip Rate

**Goal:** Replace the hardcoded `?? 2` with a value derived from the agent's own recent volatility on the (anxiety + confusion - confidence) signal. High flip rate on this signal → require more consecutive ticks before harvesting on "conviction_failed". Low flip rate → the existing small number is sufficient.

**Sub-steps:**

**3.1 Locate the exact decision ring / history used for sign-flip calculation**
- The user's audit points to per_agent_state.ts decision ring.
- Confirm the signal (anxiety + confusion - confidence) is already being tracked per agent/lane.

**3.2 Implement the observer-derived streak calculator**
- Small helper: given the recent ring of the emotion/confidence delta, compute the sign-flip rate (number of times the sign changes over the window / window length).
- Map the flip rate to a required streak (e.g., low flip → 2, medium → 3, high flip → 4 or 5). Keep the mapping structural / bounded (no tunable coefficients).

**3.3 Wire it into held_position_rejustification.ts**
- Replace the `?? 2` default path with the derived value when the agent's state has enough history.
- Cold-start: fall back to the previous safe value (2) until sufficient samples.

**3.4 Tests**
- Unit test the flip-rate → streak mapper with synthetic rings.
- Integration test: high-flip emotion history → higher streak required before conviction_failed fires.

**3.5 Verification**
- tsc + relevant tests.
- Runtime smoke showing the streak requirement adapting to simulated high/low volatility in the emotion signal.

**Acceptance for Step 3:** The conviction harvest streak is now scaled by the kernel's own measured volatility on its doubt signal, not a static number. ~30-40 lines.

---

### Cross-Cutting / Final Steps

- Update any comments in loop.ts, tick.py, etc. that referenced the old 1% floor or the quantity_unit_normalized flag as permanent.
- Ensure all three changes have negative tests that would have caught the original symptoms (0 tier-1 rewards, phantom notional rows, conviction firing too fast in chop).
- Full pre-merge: `npx tsc --noEmit`, full Vitest run on monkey services, relevant pytest on ml-worker, qig-purity scan on changed files.
- Post-deploy monitor (Railway MCP + Polo CSV comparison) to confirm: tier-1 rewards resume, quantity normalization rate → 100% on new rows, conviction harvest adapts to current volatility, 11008 rate and thrash reduce.
- Single conventional commit (or stacked if needed) citing this TDD plan + user audit + incident packet + canon P1/P5/P24/P25 + LIVED ONLY.

**Total change target:** ~120 lines as audited. Three independently testable units. One deletion. Zero new knobs.

**Ready for Implementer execution:** This TDD plan is the spec. Execute step-by-step with fresh verification output pasted after every sub-step before marking complete.

All per the QIG PURITY MANDATE (agents.md:236+), live-money standing authorization, and the explicit three-finding audit provided by the user.

**Evidence section (to be filled by Implementer after each step):** [paste tsc, test output, grep results, runtime logs here]

(End of TDD plan)