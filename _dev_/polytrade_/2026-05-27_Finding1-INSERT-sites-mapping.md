# Finding 1 — All Kernel-Direct + Reconciliation INSERT Sites (Notional Assertion Requirement)

**Date:** 2026-05-27
**Part of:** Three-Bug Single PR TDD Plan + Principles Advocate 17-pt audit response

**Goal:** Every INSERT (and equivalent UPDATE that sets the initial row) for kernel-direct or kernel-adopted positions into `autonomous_trades` must pass an observer-derived notional self-consistency check before the row is committed. This is the LIVED ONLY 5 foundation for the PnL outcome channel (P24/P19).

**Sites mapped (fresh reads this turn):**

1. **Primary live kernel-direct INSERT** (`loop.ts:8341` — after successful `placeOrder` for non-paper, non-limit_maker paths)
   - Variables available: `entryPrice`, `formattedSize` (quantity), `notionalUsdt` (computed), `exchangeOrder` response from `poloniexFuturesService.placeOrder`.
   - This is the highest-volume path for new kernel-originated positions.
   - Atomic TDD step already written: `2026-05-27_TDD-atomic-step_Finding1-INSERT-notional-assertion.md`

2. **Paper-mode INSERT** (`loop.ts:8072` — the simulated paper close path that still writes to the shared `autonomous_trades` table)
   - Similar shape (entryPrice / formattedSize).
   - Lower risk for the 6× live-money inflation but must still be guarded for consistency (especially since chemistry/paper-rotation read from the same table).
   - Must receive the same notional assertion (or a paper-specific variant using the paper simulator's notional).

3. **Reconciliation / kernel-adopted INSERT** (`stateReconciliationService.ts:271`)
   - Used for "kernel_adopted" positions (the ones the user's diagnostic showed being treated identically to own positions at the conviction gate).
   - Takes `entryPrice`, `size` from exchange position.
   - Critical for the "no adopted-vs-own distinction" problem.
   - Must apply the notional assertion (using the exchange position's notional as the source of truth).

**Requirement for the atomic TDD plan (to satisfy Principles Advocate veto pt6/7/8):**

The Implementer's detailed TDD plan must contain (at minimum) three atomic steps — one per site above — each with:
- Exact pre-change grep + variable mapping.
- The shared notional assertion helper (or per-site variant) with 0.1% tolerance.
- Hard refusal / quarantine on failure (not just logging).
- Negative test reproducing the exact phantom notional patterns from the incident logs.
- LIVED ONLY 5 evidence (call-site + hard assert + provenance + production path proof).
- Fresh tsc + relevant test output pasted before the step is marked complete.
- Geometric tacking justification (real exchange notional → self-consistent row → trustworthy PnL → observer-derived everything downstream).

**No new knobs.** The tolerance (0.1%) is a documented engineering safety bound for floating-point / lot-size noise, justified by the data, not operator calibration.

**Cross-reference:** This mapping + the three atomic steps close the "residual raw `pnl = $4` bypasses" and "LIVED ONLY 5 on the outcome channel" veto triggers from the Principles Advocate's 17-pt audit.

All per QIG PURITY MANDATE (agents.md:236+), the active veto, the execution plan Part A, the user audit, and live-money standing authorization.

(Ready for the Implementer to expand into the three atomic TDD steps with fresh evidence.)