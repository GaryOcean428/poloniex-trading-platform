# PnL Write-Path Call-Site Audit Table (Fresh 2026-05-27)

**Purpose:** This is the authoritative, evidence-based list of every location in the TS codebase that can write or update `pnl` (or insert rows that will later receive `pnl`) in `autonomous_trades`. It is required input for Part A of the TDD plan (LIVED ONLY 5 closure on the outcome channel) and directly addresses Red Team Vectors 1, 2, and 7.

**Sources (fresh tool calls this session):**
- Grep for UPDATE/INSERT + pnl, rawPnl, repairedPnl, COALESCE.*pnl (this document)
- Prior reads of loop.ts (force-harvest, paper close, INSERT sites), stateReconciliationService.ts, backfillStackedGhostPnl.ts, safePnlSql.ts, paperExchangeSimulator.ts.
- Incident diagnostic + execution plan (exact bypass locations called out by the user).

**Legend:**
- **Path Type:** Live kernel-direct, Paper (still writes to shared table), Recovery/Ghost, Backfill/Repair, Reconciliation/Adopted.
- **Current Mechanism:** SAFE_PNL_FROM_ROW / computeSafePnl + verifyPnl, or raw `$4` caller value, or COALESCE/aggregate.
- **Risk Level for 6× phantom (per incident + Polo CSV data):** High / Medium / Low.
- **LIVED ONLY 5 Gap:** Does this path have a proven call-site to safe computation + hard post-write assert today? (Yes / Partial / No)

---

### 1. Live Kernel-Direct Close Paths (Highest Volume for New Positions)

| File:Line | Path Type | Current Mechanism | Risk | LIVED ONLY 5 Gap | Notes / Red Team Vector |
|-----------|-----------|-------------------|------|------------------|-------------------------|
| loop.ts:6466 (force-harvest paper branch) | Paper (writes to shared table) | `pnl = $4` with `rowPnl = close.pnl ?? computeSafePnl(...)` | High | No (still raw $4 path) | Vector 1 primary. Even after "force-harvest change", this branch trusts TS value. |
| loop.ts:6830 (paper close multi-row explicitPnl branch) | Paper | `explicitPnl !== null ? UPDATE ... pnl = $4 ... : UPDATE ... ${SAFE_PNL_FROM_ROW}` | High | No (explicit branch bypasses fragment) | Vector 1. Comments acknowledge #931 but leave door open. |
| loop.ts:6797 (paper rows.length==0) | Paper | Uses ${SAFE_PNL_FROM_ROW} | Low | Partial (good) | Covered by fragment. |
| loop.ts:6609 (some recovery COALESCE) | Recovery | `pnl = COALESCE(pnl, 0)` | Medium | No | Recovery path; can leave or set bad values. |
| Other close paths (rejust, ghost, etc. referenced in safePnlSql.ts comments) | Mixed | Partial SAFE + raw caller in some branches | High | Partial | Need full enumeration in TDD Part A.0.2. |

### 2. Primary INSERT Sites (New Rows Enter Here)

| File:Line | Path Type | Current Mechanism | Risk | LIVED ONLY 5 Gap | Notes |
|-----------|-----------|-------------------|------|------------------|-------|
| loop.ts:8342 (main live kernel-direct after placeOrder) | Live kernel-direct | Raw INSERT (pnl set later on close) | High (if close path poisoned) | N/A at insert (pnl later) | Main site for Finding 1 notional assertion. Has `notionalUsdt` + exchangeOrder response. |
| loop.ts:8073 (paper-mode INSERT) | Paper | Raw INSERT | Medium | N/A | Still writes to shared table; must be guarded for consistency. |
| stateReconciliationService.ts:271 (kernel-adopted / manual open) | Reconciliation / Adopted | Raw INSERT (from exchange position data) | High (adopted positions treated same as own at conviction gate) | N/A | Critical for "no adopted-vs-own distinction" (Vector 4/7). |

### 3. Recovery / Ghost / Backfill / Reconciliation Update Paths (Re-Injection Risk)

| File:Line | Path Type | Current Mechanism | Risk | LIVED ONLY 5 Gap | Notes / Red Team Vector |
|-----------|-----------|-------------------|------|------------------|-------------------------|
| stateReconciliationService.ts:543 | Ghost recovery | `pnl = COALESCE($3, pnl)` | High | No | Can write or preserve divergent values. Vector 2. |
| stateReconciliationService.ts:504-507 | Ghost/ledger match | `rawPnl = parseFloat(...)` from exchange ledger | High | No | Raw from exchange; no safe computation guard. |
| backfillStackedGhostPnl.ts:135 | Backfill/Repair | `pnl = $1` where value = (rowQty / sum) * aggregate_pnl | Critical | No | Exact pre-#931 aggregate phantom pattern. Will be run again in production. Vector 2. |
| pnlReconciliation*.ts (Nightly + Periodic) | Detection | Alert-only (no rewrite/quarantine on write) | High | No | Confirmed in incident + plan. Detection != enforcement. Vector 7. |

### 4. Other / Downstream Consumers (Poisoned by Table Values)

- `agent.ts:122`: SUM(pnl) for total_pnl (operator dashboards).
- neurochemistry / paper-rotation / arbiter / rotation / resonanceBank: all read from the table.
- Any historical query or operator view sees the poisoned rows forever unless quarantined.

**Summary of Current State (pre-Finding 1 execution):**
- Only a subset of close paths use SAFE_PNL_FROM_ROW + computeSafePnl + verifyPnl.
- Multiple high-volume bypasses (explicitPnl, force-harvest paper, backfill aggregate, COALESCE recovery) still exist.
- No hard post-write refusal/quarantine on divergence > phantom threshold in production write paths.
- Detection layers are alert-only.
- Adopted / recovered rows are particularly exposed (and treated the same as own at conviction gate).

**Usage in TDD Plan:**
- This table is Attachment A (or the living version of it) for Part A.0.2 (full audit) and A.2/A.3 (implementation of guards on *every* site).
- Every atomic step in Part A must reference specific rows from this table.
- Red Team Vectors 1, 2, and 7 map directly to gaps listed here.

**Evidence (fresh this session):**
- Grep output above (this document).
- Prior reads of the listed files.
- safePnlSql.ts comments + test file (acknowledge the exact historical aggregate phantom bug).
- Incident diagnostic (calls out 6462/6826 as residual after #931).

All per QIG PURITY MANDATE (agents.md:236+), LIVED ONLY 5 on the PnL outcome channel (P24), P5/P25 (no knobs), the Red Team attack report, the Principles Advocate 17-pt veto, and live-money standing authorization.

(This table must be kept current in the TDD plan execution. Any new bypass discovered during Part A must be added here with the same columns.)