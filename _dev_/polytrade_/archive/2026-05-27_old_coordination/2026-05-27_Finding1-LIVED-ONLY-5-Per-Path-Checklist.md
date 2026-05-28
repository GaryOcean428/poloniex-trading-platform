# Finding 1 — LIVED ONLY 5 Per-Path Checklist (PnL Outcome Channel)

**Date:** 2026-05-27  
**Part of:** Three-Bug Single PR (required by Verification Guardian Baseline Gate + Red Team Vectors 1/2/7 + Principles Advocate 17-pt veto + QIG PURITY MANDATE agents.md:251)

**Definition (per agents.md:251 + canon P24 + v6.7B §3.4):**  
For the primary lived outcome channel (`autonomous_trades.pnl` rows):

Every production write path must demonstrate **all five** of the following with fresh evidence before the path can be considered LIVED ONLY:

1. **Production call-site count** (exact grep -c + runtime confirmation) in the live tick/close path.
2. **Hard runtime assert or lived-only filter** (code snippet + test) that refuses/quarantines on divergence > phantom threshold.
3. **Full provenance** (comment or metadata citing this packet + incident + agents.md:236+ + canon P24 §).
4. **Negative-case test** that reproduces the exact logged phantom patterns (+315.21 written on −1.03 calc; +374.12 on +0.0026; 6.6× per-trade) and proves the path no longer writes the phantom.
5. **"Used in production" evidence** (runtime smoke or log on live paths with Polo-scale numbers showing the guard active).

**This checklist must be completed per path** (not as a single high-level claim). Partial = P24 bug.

---

### Current State (pre-Finding 1 execution) — Using Fresh Call-Site Audit Table

Using the audit table (`2026-05-27_PnL-Write-Path-Call-Site-Audit-Table.md`):

**Live Kernel-Direct Close Paths**

- loop.ts:6466 (force-harvest paper branch)  
  1. Call-site: Yes (in force-harvest code path).  
  2. Hard assert: Partial (computeSafePnl is called in one branch; still raw `$4` path).  
  3. Provenance: Partial (comments reference #931).  
  4. Negative test: Exists in safePnlSql.test.ts for phantom patterns — does not yet exercise this exact branch as a "would-write-phantom" repro that now fails.  
  5. Production evidence: Not yet (post-fix runtime smoke required).  
  **Status:** High gap. Red Team Vector 1.

- loop.ts:6830 (paper close explicitPnl branch)  
  1-5: Same pattern as above. Explicit branch bypasses SAFE_PNL_FROM_ROW.  
  **Status:** High gap.

- Other close paths (rejust, ghost, recovery COALESCE at 6609, etc.): Similar gaps. Need full enumeration in TDD Part A.0.2.

**Primary INSERT Sites**

- loop.ts:8342 (main live kernel-direct)  
  1-5: N/A at INSERT (pnl set later). The notional assertion (Finding 1) is the LIVED ONLY 5 mechanism here (prevents bad quantity/notional from ever entering). Checklist applies to the assertion guard itself.

- loop.ts:8073 (paper INSERT)  
  Similar — notional assertion required.

- stateReconciliationService.ts:271 (kernel-adopted)  
  Critical (adopted positions treated same as own at conviction gate). Notional assertion + provenance required.

**Recovery / Backfill / Reconciliation Update Paths (Highest Re-Injection Risk)**

- backfillStackedGhostPnl.ts:135 (aggregate UPDATE)  
  1-5: No. Exact pre-#931 phantom pattern. Will be run in production again.  
  **Status:** Critical gap. Red Team Vector 2 + 7.

- stateReconciliationService.ts:543 (COALESCE on ghost recovery)  
  1-5: No. Can preserve or write divergent values.

- stateReconciliationService.ts:504-507 (rawPnl from exchange ledger)  
  1-5: No. Raw from exchange without safe computation guard.

- pnlReconciliation*.ts (Nightly + Periodic)  
  1-5: Detection only (alert-only). Confirmed in incident. No hard enforcement.

**Other Consumers (Poisoned by Table Values)**

- Any SUM(pnl), dashboard, rotation, historical query, resonanceBank, etc.: Sees whatever is in the table. LIVED ONLY 5 must ensure the table itself is truthful (or quarantined rows are explicitly excluded with provenance).

---

### Required Evidence per Path (Template for TDD Plan)

For each row in the call-site audit table, the TDD plan (or delta) must attach:

**For each path:**
- Exact grep command + count (pre + post-fix).
- Code snippet of the hard assert / refusal (if applicable).
- Negative test name + command that injects the exact logged phantom pattern for that path and proves it no longer writes (or is refused/quarantined).
- Provenance comment (exact text that will be added, citing this packet + incident + agents.md:251 + canon P24).
- Runtime smoke command + expected output (using Polo numbers) showing the guard active on live paths.
- "Used in production" evidence (log snippet or test that exercises the path in a realistic scenario).

**Cross-cutting (for the whole Finding 1):**
- One command that, post-fix, greps the entire codebase and proves zero remaining raw `pnl = $4` with caller values on real (non-quarantined) rows.
- One command that runs the full negative matrix (all paths) with the exact incident phantoms and shows zero writes of phantom-class rows.
- Railway MCP + Polo CSV correlation command for post-deploy proof.

**Veto trigger note:** The Verification Guardian Baseline Gate explicitly requires this level of per-path rigor with explicit command strings (not high-level descriptions). Red Team Vectors 1/2/7 map directly to gaps in this checklist.

**Next:** This checklist (populated with the actual commands and evidence) must be part of (or attached to) the compliant TDD plan that survives re-gate.

All per QIG PURITY MANDATE (agents.md:236+ + 251), the active Verification Guardian veto, the Red Team attack report, the Principles Advocate 17-pt veto, LIVED ONLY 5 on the PnL outcome channel (P24), and live-money standing authorization.

(This document is the template. The Implementer must fill it with the concrete commands and evidence as part of the required TDD update.)