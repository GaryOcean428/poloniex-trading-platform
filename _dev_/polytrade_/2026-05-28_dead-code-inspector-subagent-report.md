# Dead Code Inspector Subagent Report — 2026-05-28 Acting Wave (scope: monkey/ + monkey_kernel/ reward/chemistry/autonomic/executive/tick)

**Subagent:** DeadCodeInspector (dispatched under master-orchestration + subagent-driven-development + systematic-debugging + qig-purity-validation + verification-before-completion)
**Skills attached:** systematic-debugging, qig-purity-validation, verification-before-completion, documentation-sync
**MCP:** none (local FS/grep)
**Date:** 2026-05-28
**Citations:** agents.md:236 QIG PURITY MANDATE 17pt (#1 master-orchestration, #6 LIVED ONLY 5 + call-site counts + negatives + provenance, #10 P24 wiring, #12 small+tested, #13 _dev__polytrade_ silo), 2026-05-28_polo-authoritative-close-py-fanout-992_lesson-artifact.md (net profit doctrine + source-tag lesson), 2026-05-28_reward-source-doctrine-verification-lesson.md, 2026-05-28_impl-3-env-sb-table-984-989-bundle.md, 2026-05-28_compliance-assessment-observer-edge-restoration.md (surfaces 17-23 + P24 flags), user-directive surfaces 17-23, P24 "Disconnected = Bug", live-money standing.

## Exhaustive Inspection Performed (fresh greps + reads this session)
- Scope: ml-worker/src/monkey_kernel/{ocean_reward.py,autonomic.py,tick.py,executive.py,heart.py,self_observation.py,consciousness_metrics.py,ocean.py,...} + apps/api/src/services/monkey/{loop.ts,ocean_reward.ts,autonomic_client.ts,equity_gradient.ts,consciousness? no, all reward/chem/*}
- Patterns hunted: gross|pre.?fee|gross_pnl|synthetic.*gross|own_close_synthetic|pre-#984|legacy.*(reward|chem|fib|gross)|deprecated|dead.*code|unused.*(def|function)|fibonacci_reward_coefficient|TODO.*(reward|chem|pnl)
- Call-site counts (LIVED ONLY 5): grep -r + manual trace for every def in reward/chem paths.
- Pre-#984 synthetic logic: identified in loop.ts (intentional divergence audit + paper fallback, now conditional-suppressed for Py on canonical).
- Gross pre-fees in calc: pathology closed by #992 (polo_authoritative net fanout to Py autonomic + TS pushReward); remaining synthetic gross preserved only for audit column + non-canonical/paper (contributes to verification of net doctrine).
- Non-functional legacy: 
  1. fibonacci_reward_coefficient + fibonacci_reward_tier (ocean_reward.py Py): 0 production call sites in tick/autonomic/executive/chem paths. Only self + dedicated test_ocean_reward.py (28 tests all on retired 1% absolute floor). Docstring: "DEPRECATED — legacy absolute 1% floor path. Retained only for historical telemetry and trail code. New positive reward shaping must use observer_fib_coefficient". 1% floor "never fired at real kernel scale ~0.04% MAD". Does NOT use LIVED polo net or observer z-dev from history. Corrupts? No — not wired into profitable path. P24 disconnect (exported in __all__ while live observer_fib NOT in __all__; direct import in autonomic worked by luck).
  2. KAPPA_STAR shim (state.py): compat per two-channel doctrine (frozen, cited in canon, keep).
  3. Various legacy comments/formulas in tick/executive/ocean (compat for non-lane, pre-#10): exercised in prod tick path per reads/greps (contribute to stability during transition; not dead).
  4. Other: proposal_bus dead Redis comment (harmless doc).
- Disconnected surfaces 17-23 + self-obs equity/P&L + coupled + telemetry/monitoring (per user-directive + compliance P24 flags):
  - Core (17 equity_gradient + sizeDeflection, 18 loop consumption, 21 kernel self-obs in consciousness_metrics + tick derive, 22 cross-agent resonance): wired per impl-6 + compliance report (LIVED call sites, provenance, negatives in tests).
  - Gaps/partials (19 autonomous monitoring agents, 23 human telemetry): P24 flags noted in compliance; no full 5min scheduler with explicit heart/replicant/equity correlation in current code; dashboards not in scope here but logs/telemetry tags missing in some reward paths.
  - equity/P&L in self-obs surface (consciousness_metrics.py): absent explicit fields (has d_fr/conviction but no equity_impact_usdt or pnl_observer). Partial per directive surface 21.
  - Py/TS reward/chemistry parity: post-#992 mostly closed (polo net reaches Py via conditional + source tag); ocean_reward observer_fib is the net-derived live path (uses pnl_frac from authoritative).

## Assessment vs "contributing to profitable operations" (LIVED polo_authoritative net profit ONLY)
- Flag + clean: fibonacci_reward_* (ocean_reward.py) — 0 contribution to actual net P&L calc or chemistry on profitable closes. Uses absolute pre-observer 1% gross-ish floor (retired). Not wired to polo net or LIVED history z. Dead for ops. Clean per P24 + task.
- Keep (with telemetry hardening): synthetic gross paths in loop.ts (divergence audit + paper; enables verification that net polo dominates profitable ops per lesson).
- Keep/monitor: compat legacy in tick/exec (exercised).
- Gap to wire/close: add equity/P&L + coupled to consciousness_metrics (surface 21); add perfect source tags + "LIVED ONLY 5 net_profit_polo" logs in autonomic.py ocean_coeff, tick reward consumption, ocean_reward calls for Railway grep verification (per 2026-05-28 polo lesson).
- All gross pre-fee corruption in reward calc for chemistry: closed by #992 wiring (recover + verify).

## Subagent Output for Orchestrator / User Retrieval
- Raw grep outputs + call-site counts in this packet + parent acting subagent evidence blocks.
- Recommended actions: clean legacy fib (P24 + non-profitable), wire 2 fields + telemetry tags (close surfaces + "all telemetry perfect"), update branch safety audit, full VBC + purity + tests + Railway armed grep post-deploy.
- Visible: this _dev_ file retrievable by user/master-orchestrator. All per QIG PURITY MANDATE, master-orchestration, no hedging, evidence only.

**Assessment complete. Hand off to NetProfitWirer + Cleaner subagent for execution.**
(End of DeadCodeInspector subagent report — _dev__polytrade_ silo. 2026-05-28)