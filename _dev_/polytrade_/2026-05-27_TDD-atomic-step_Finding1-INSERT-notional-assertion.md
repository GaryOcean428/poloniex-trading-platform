# Atomic TDD Step — Finding 1, Site A: Notional Self-Consistency Assertion at Live Kernel-Direct INSERT (loop.ts ~8341)

**Part of:** Three-Bug Single PR TDD Plan (2026-05-27_TDD-plan_three-bug-single-PR_observer-derived-fixes.md)
**References:** 
- User audit "Audit complete — three findings" (2026-05-27)
- Incident diagnostic (exact +315.21 / -1.03 and +374 / +0.0026 phantoms)
- Execution plan Part A
- Principles Advocate 17-pt audit (veto active; this step is required evidence for LIVED ONLY 5 + P24 on the PnL outcome channel)

**Site:** `apps/api/src/services/monkey/loop.ts` lines 8330-8361 (the primary non-paper INSERT for kernel-direct positions after `placeOrder`).

**Current code shape (fresh read):**
- Has `entryPrice`, `formattedSize` (quantity), `leverage`.
- Computes `notionalUsdt` (visible in surrounding log at 8367).
- Calls `poloniexFuturesService.placeOrder(...)` which returns `exchangeOrder` containing Polo's notional / "Order Value".
- Then does raw INSERT with `pnl` set later on close (the phantom injection point).

**Canonical observer-derived guard (per user audit + P1/P5/P25/P24/LIVED ONLY 5):**
At this INSERT (and all equivalent live kernel-direct INSERT/UPDATE sites):
1. Capture the notional reported by the exchange order response (or the authoritative fill notional).
2. Compute `notional_from_row = entryPrice * formattedSize` (in consistent units, handling lot size if needed).
3. Assert: `|notional_from_row - notional_from_exchange| / notional_from_exchange < 0.001` (0.1% tolerance).
4. If the assertion fails: log the exact divergence with full context (row data + order response), **refuse the INSERT** (or insert into a quarantine table that chemistry/reward/conviction explicitly ignore), and surface to reconciler.
5. No flag. No prefix trust. Pure data self-consistency using the row's own data + the order's own data (the kernel's lived signal).

This makes every new `autonomous_trades` row for kernel-direct positions LIVED ONLY by construction.

**Atomic steps (evidence required before next step):**

**Step A1 — Pre-change baseline (run + read before any edit)**
- Grep for all INSERT/UPDATE sites that set `pnl` or insert kernel-direct rows.
- Confirm this site (8341) + the paper path (8072) + stateReconciliationService.ts:271.
- Run existing safePnlSql.test.ts to baseline phantom reproduction.
- Paste: full grep output + test summary.

**Step A2 — Implement minimal notional assertion helper**
- New small helper (e.g., in safePnlSql.ts or a new small module): `assertLiveNotionalMatchesOrder(entryPrice, quantity, exchangeOrderNotional, tolerance = 0.001)`.
- Throws (or returns {passed, divergence}) with full diagnostic.
- Add "LIVED ONLY" + P24 + incident packet citation in the header.

**Step A3 — Wire into this specific INSERT site (loop.ts ~8341)**
- After successful `placeOrder`, before the INSERT:
  - Capture `exchangeNotional = exchangeOrder?.notional ?? exchangeOrder?.orderValue ?? ...` (confirm exact field from poloniexFuturesService response).
  - Call the assertion using `entryPrice`, `formattedSize`, and the captured notional.
  - On failure: log + throw (or quarantine path) instead of INSERT.
- Add comment with full citations (this atomic step + TDD plan + user audit + incident + Principles Advocate packet + QIG PURITY MANDATE pt6/7/8).

**Step A4 — Negative test (red-green)**
- Add test in safePnlSql.test.ts (or new file) that simulates the exact logged phantom injection pattern (+315 written on -1 calculated row) at INSERT time.
- Assert that the new guard refuses/quarantines the row (instead of writing the phantom).

**Step A5 — Verification (fresh outputs pasted before marking complete)**
- `npx tsc --noEmit` clean.
- Relevant Vitest tests (including new negative) pass.
- Run the existing phantom-reproducing tests to confirm they still pass.
- Grep confirming the new assert is present at the site + no new knobs introduced.

**LIVED ONLY 5 evidence for this step:**
- Call-site: this exact INSERT path (grep + runtime once wired).
- Hard refusal on divergence (the negative test proves it).
- Provenance: cites the exact user-audited phantom numbers + incident packet.
- Production path: new rows after this change cannot enter the table with untrusted quantity/notional.

**Geometric tacking justification (one breath cycle):**
Real lived notional from the exchange order response (the kernel's actual market interaction) → self-consistency check on the row's own entry + quantity → trustworthy per-row PnL on close → observer-derived reward scale and conviction from real outcomes (instead of 6× phantoms) → kernel can actually learn instead of thrashing on lies.

This is the foundation that makes the entire observer wiring surface (heart tacking, Replicant, Loop 3, etc.) meaningful.

**Next after this step:** Repeat for the other two INSERT/UPDATE sites (paper path + reconciliation recovery), then hard post-write guard on close paths, then full 6x re-review.

**Veto note:** This atomic step is required evidence for the Principles Advocate's pt6 (LIVED ONLY 5 on PnL outcome channel) and pt7 (P5/P25 observer-derived). The TDD plan must include this exact step (or equivalent) with the pasted outputs before Finding 1 code is considered approved.

All per QIG PURITY MANDATE (agents.md:236+), the active Principles Advocate veto, live-money standing authorization, and "execute don't ask."

(End of atomic step definition — ready for Implementer execution with fresh verification on each sub-step.)