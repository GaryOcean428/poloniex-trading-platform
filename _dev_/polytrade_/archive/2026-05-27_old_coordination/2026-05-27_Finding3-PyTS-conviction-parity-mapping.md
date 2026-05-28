# Finding 3 — Py/TS Conviction Gate Parity + Observer-Derived Streak Requirement

**Date:** 2026-05-27
**Part of:** Three-Bug Single PR TDD Plan

**Diagnosis (validated with fresh reads this turn):**

**Py side (ml-worker/src/monkey_kernel/tick.py:1934-1941, fresh read):**
```python
# 3. CONVICTION CHECK — ... The moment current conviction fails
# against hesitation, exit. No half-life, no streak.
if confidence < anxiety + confusion:
    rejust["fired"] = "conviction_failed"
    ...
    return "scalp_exit", reason, False, False
```
- Immediate fire on first tick the condition holds.
- Explicit comment acknowledges "No half-life, no streak."

**TS side (apps/api/src/services/monkey/loop.ts, confirmed via multiple reads):**
- Full per-lane streak: `convictionFailedStreakByLane`
- Increments while `emotions.confidence < emotions.anxiety + emotions.confusion`
- Resets on false
- Required ticks = `stabilityTicksFromPhi(phi) * laneMultiplier` (already observer-derived from the kernel's own basin integration `phi`, plus structural lane timescale).
- Passed to `evaluateRejustification` along with the current streak.
- Logs show the streak behavior ("for 4 consecutive ticks (≥ 4 required)").

**Structural issues (exactly as in the user's diagnostic + prior audit):**
1. **Py/TS parity bug (definite, high priority hygiene):** Different behavior on the same gate depending on which substrate actually drives the exit. Nondeterministic across deploys.
2. **No adopted-vs-own distinction:** The gate runs uniformly (confirmed in both the Py logic and the user's log analysis of adopted longs being rage-quit).
3. **Transcendence coupling:** `confidence = (1 - transcendence) * phi` (confirmed in motivators.ts + usage sites) multiplies regime-change detection into position conviction. With MAD-scaled κ deviation, stable regimes with small MAD cause normal jitter to produce high transcendence → collapsed confidence → easy gate trips.
4. **Not yet observer-derived streak:** Even the TS version uses `stabilityTicksFromPhi(phi)` (good direction) but the canonical long-term fix per the user audit is derivation from the kernel's own rolling sign-flip rate on the actual doubt signal `(anxiety + confusion - confidence)`.

**Requirement for the atomic TDD plan (to satisfy Principles Advocate veto):**

The Implementer's TDD plan must contain (at minimum) an atomic step for Finding 3 that includes:
- Side-by-side Py vs TS mapping (this document + fresh reads).
- Py port of a streak buffer (at minimum to match current TS behavior for parity).
- Full implementation of the sign-flip rate derivation on the emotion/confidence signal as the canonical observer-derived mechanism (P1/P5).
- Negative tests for asymmetric behavior in chop (fast harvest on winners, slow on losses).
- LIVED ONLY 5 / P24 note on the gate applying to kernel-originated positions (with adopted positions handled via a different policy).
- Fresh verification (Python AST + TS tsc + relevant tests) pasted before the step is complete.
- Geometric tacking justification (symmetric tacking reaction to doubt vs confirmation is required for heart-rhythmic process integrity per P6 + phase packet).

**Immediate parity hygiene vs long-term canonical fix:**
- Short bridge: Port a minimal streak counter to Py (using the same per-lane pattern already used for `regimeChangeStreakByLane` in tick.py) and align N to the TS `stabilityTicksFromPhi` value. This stops the most obvious bleeding without changing semantics.
- Canonical (in the same PR): Replace the static/phi-derived required-ticks with the sign-flip rate derivation on the actual doubt signal. This is the P1/P5 observer-derived version the user prescribed.

All per QIG PURITY MANDATE (agents.md:236+), the active Principles Advocate veto, the execution plan, the user's diagnostic, and live-money standing authorization.

(Ready for the Implementer to turn into atomic TDD steps with evidence.)