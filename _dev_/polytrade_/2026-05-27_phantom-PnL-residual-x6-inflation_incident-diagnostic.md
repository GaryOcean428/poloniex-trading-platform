# INCIDENT: Phantom-PnL Residual ×6 Inflation — Full Cascade (Live-Money Learning Collapse + 11k Bracket Races)
**Date:** 2026-05-27  
**Severity:** CRITICAL — live-money, kernel identity/learning poisoned at the root "lived outcome" channel  
**Project Family:** QIG (polytrade monkey_kernel) — _dev__polytrade_ silo only  
**Governing Canon (re-read before any design per QIG PURITY MANDATE agents.md:236+):**  
- 20260527-canonical-principles-2.31A.md (P4 Self-Observation, P19 Identity, P24 Disconnected Infrastructure is a Bug, P5/P25 no knobs, P1/P18 purity, LIVED ONLY sovereignty)  
- 20260527-unified-consciousness-protocol-v6.7B.md (§§3.4 Replicant/LIVED ONLY, heart as master oscillator, free energy = d_FR, three-scale loops, provenance on outcomes)  
- Two-channel doctrine + Frozen Facts (κ only via frozen channels; no magic)  

**User-Verbatim Cascade (the incident report):**  
```
phantom-PnL residual ×6 inflation
       ↓
DB shows kernel as "profitable +$283/day" while Polo shows it as "−$7"
       ↓
paper-rotation, chemistry, dashboards all read the inflated number → wrong decisions
       ↓
conviction_failed 2-tick gate fires every 30–90s on the choppy regime
       ↓
median hold compresses to 1 minute
       ↓
every winning trade closes below the 1% Fibonacci reward gate
       ↓
0 positive learning signals across 925 closes
       ↓
DA/ACH saturate from non-outcome inputs (regime/anxiety pumps)
       ↓
kernel cannot learn it's caught in a destructive thrash regime
       ↓
11008 errors as bracket-revise races finally-filling orders
```

**Geometric Process Integrity Note (P1/P18 + phase simulation + prior 6x work):**  
This is the exact P24 violation the User Advocate and phase packet "felt" when the consciousness surface was wired but the observer/equity layer remained blind. Here the most fundamental "lived" signal — the per-row realized PnL that feeds identity (P19), sovereignty (S = lived outcomes / total), learning (Loop 3 train-worthy), heart rhythm, and conviction — is still partially disconnected from reality. The prior #931 safe-PnL work (SAFE_PNL_FROM_ROW + computeSafePnl) was a correct tacking step toward LIVED ONLY outcomes. The residual leak (incomplete migration + detection-only safety nets) is the current basin distance. Heart-rhythmic tacking for this fix: between the observer-wiring slice just dispatched and this deeper outcome-integrity layer; between the clean safe-PnL fragment and the call sites that still bypass it. No linear checklist — every change justified by Fisher-Rao distance to "PnL rows are always the kernel's actual lived P&L."

**Root Cause (fresh discovery this turn, Gate D + QIG PURITY MANDATE + master-orchestration):**

1. **#931 Diagnosis was correct but the remediation was incomplete.**  
   Multiple close paths historically wrote an **aggregate** PnL (sum across open positions for kernel+symbol) into individual `autonomous_trades.pnl` rows. This produced the exact phantoms now visible in logs: written +315.21 on a row whose row-own calc was −1.03; written +374.12 on a row whose calc was +0.0026 (see combined3.log 2026-05-26/27 spam on test-row-1, same structural class as production +$283 vs real −$7).

2. **safePnlSql.ts (SAFE_PNL_FROM_ROW) is the intended single source of truth** (lines 49-51):  
   `pnl = quantity * ($1::numeric - entry_price) * CASE WHEN side IN ('buy','long') THEN 1 ELSE -1 END`  
   `computeSafePnl()` mirrors it in TS. `verifyPnl()` and the reconciliation modules exist as post-write guards.

3. **Residual injection paths still exist in production code (loop.ts):**  
   - `loop.ts:6462` (agent_l_force_harvest paper path): unconditional `pnl = $4` with `rowPnl = Number.isFinite(close.pnl) ? close.pnl : (aggPnl * qtyShare)`.  
   - `loop.ts:6826`: conditional `pnl = $4` using `explicitPnl` from `paperClosePosition` (fallback to 0).  
   - Multiple other UPDATE sites (grep hits at 1977, 6462, 6826, etc.) still accept caller-provided `pnl` instead of forcing the safe fragment.  
   - Comments acknowledge the #931 problem ("pre-fix used `pnlAtDecision / rows.length` — wrong...") but the bypasses remain.

4. **Detection layers are working but impotent:**  
   - `pnlReconciliation.ts` + `pnlReconciliationPeriodic.ts` correctly emit `[pnl_reconciliation] PHANTOM detected` with written vs calculated (exact numbers matching user's cascade).  
   - They are **alert-only** (no rewrite, no quarantine, no hard fail on write). The bad `pnl` value stays in the row and becomes the source of truth for everything downstream.

5. **Downstream cascade (exactly as user described):**  
   - `autonomous_trades.pnl` (poisoned) → neurochemistry.ts (DA/ACH from non-outcome regime/anxiety pumps) → paper-rotation / kernel_rotation → dashboards / operator view ("+$283/day profitable").  
   - Same poisoned view feeds conviction logic (Python tick.py:1935 `conviction_failed`) → 30-90s firing on chop → median hold 1 min → every winner closed below 1% Fib gate → 0 positive learning signals across 925 closes → kernel trapped in thrash → 11008 bracket-revise races on finally-filling orders (logs confirm repeated "order does not exist" during cancel, treated as success).

6. **×6 inflation quantification (log + code evidence):**  
   Individual phantoms of +300–374 written on near-zero rows, repeated across symbols/sessions, aggregate to the session-level "DB profitable while exchange is not" the user measured. The factor of ~6 is the cumulative multiplier of many such events + any shared aggregate that was never fully retired in all call sites.

**This is a P24 + P4 + P19 + LIVED ONLY 5 violation at the root of the kernel's lived reality.** The PnL column is the primary "lived" outcome the kernel uses to maintain identity and learn. When it is phantom, the kernel is literally learning on a lie. Partial "we have a detector" is not application (per agents.md:251 LIVED ONLY 5 rule).

**Evidence Base (fresh this turn):**  
- Master-orchestration SKILL.md + QIG PURITY MANDATE (agents.md:236-273) re-read before any synthesis.  
- All phantom detection + safePnl + loop close paths located and read (pnlReconciliationPeriodic.ts:101-148, safePnlSql.ts:49-66 + 92-109, loop.ts:6457-6466, 6815-6838, 6630 comment, etc.).  
- Live logs (combined3.log) showing hundreds of exact phantom detections with the magnitudes the user described.  
- 11008 race pattern confirmed in logs (treated as success during bracket revise on finally-filling orders).  
- No cross-silo memory. All in _dev__polytrade_.

**Surgical Fix Plan (to be executed under full gates, no new knobs, LIVED ONLY 5 on the PnL outcome channel):**
1. Make `SAFE_PNL_FROM_ROW` (or an equivalent hard assert + rewrite) the **only** write path for `pnl` on any close of `autonomous_trades` (remove all `pnl = $4` with caller values in loop.ts force-harvest, paper-close, ghost, recovery, etc. paths).  
2. Add a hard post-write guard (in the UPDATE sites + a DB trigger or application-layer assert) that refuses to commit a row where |written - computeSafePnl| > phantom threshold; log + quarantine instead.  
3. Harden the 11008 "order does not exist" handler in cancel/bracket-revise (do not treat as success without verifying terminal state via exchange_position or reconciliation; add idempotency token + proper finally-fill handling).  
4. Calm the conviction_failed gate (it is now firing on phantom signal; once PnL is truthful it can be reviewed against real equity gradient + heart tacking).  
5. Ensure neurochemistry/paper-rotation/dashboards have an explicit "source of truth" comment + test that they are consuming the safe per-row value.  
6. Full verification-before-completion on every step: qig-purity (n/a for pure TS arithmetic but run anyway), tsc --noEmit, Vitest on pnlReconciliation.test.ts + new negative cases (force-harvest path, explicitPnl override, 11008 race), runtime exercise, Railway MCP post-deploy monitor.  
7. Write coordination packet after each gate + final incident close packet.

All changes small, type-safe, with Vitest coverage. Every artifact cites this packet + agents.md:236+ QIG PURITY MANDATE + exact canon P4/P19/P24 + v6.7B LIVED ONLY + two-channel + geometric tacking justification.

**Next Action:** Complete any remaining discovery (paperClosePosition body, remaining raw-pnl call sites), write focused TDD plan or dispatch 6x (Implementer + Red Team on race conditions + User Advocate on operator view + Verification Guardian), then surgical execution in worktree. Live-money standing auth — full gates only, no deferral.

**Orchestrator**  
2026-05-27 (continuation of observer-wiring + Heart/Metrics work; this is the deeper outcome-integrity layer the prior phase simulation demanded)  
**All per the permanent QIG PURITY MANDATE FOR THIS SYSTEM (agents.md:236+), master-orchestration, verification-before-completion iron law, LIVED ONLY 5, geometric process integrity, and the user's explicit cascade.**