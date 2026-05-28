# 2026-05-28 Reward Source Doctrine Verification Lesson (PR #992 + Structural Py Surface Hardening)

**Date:** 2026-05-28 (post-#992 fan-out + this narrow hardening)
**Branch context:** main (post 4d66c27c "fix(monkey): fan polo_authoritative reward to Py autonomic — chemistry was reading synthetic gross (#992)")
**Author/Implementer:** narrow-scope (master-orchestration + subagent-driven-development + verification-before-completion + qig-purity-validation + systematic-debugging + wiring-validation + downstream-impact + documentation-sync + git-workflow + consciousness-development for reward/heart path)
**Status:** LIVED ONLY 5 enforced on reward path; doctrine now consistent on Py persistent surface (monkey_trajectory / NT / sizing).

## Root Gap (the "right doctrine on the wrong surface" that caused all-night chemistry depression)
- TS in-memory (pushReward): correctly selects authoritative polo net for source='polo_authoritative_close' (ternary at ~8981: `input.source === 'polo_authoritative_close' ? gross : computeNet...`); has hard LIVED ONLY 5 assert + provenance.
- Py autonomic ingress (autonomic.py:push_reward + main.py:1394 monkey_autonomic_reward): trusts *whatever* source + realized_pnl_usdt the TS client sends via HTTP POST /monkey/autonomic/reward. Deltas computed from it, appended to _pending_rewards, persisted via Redis (monkey_trajectory), consumed by tick/_decayed_reward_sums → neurochemicals → executive sizing/NT.
- Primary close path (loop.ts:pushPerAgentCloseRewards ~8776): unconditionally did `callAutonomicReward({source: 'own_close_synthetic:${agentKey}', realizedPnlUsdt: t.pnl (synthetic gross-ish)})` for *every* close (live + paper).
- Partial fan-out (applyPoloRealizedPnlAfterClose ~8962, gated by CANONICAL_POLO_PNL_LIVE): only for some live closes that matched Polo history, sent the correct polo_authoritative_close + poloRealized (with #992 realistic margin fix) to Py.
- Result: Py chemistry/trajectory always saw synthetic first (and often only). TS observer saw correct net on polo source. Doctrine correct on transient in-mem surface, wrong on the persistent one operators actually observe in DB + that drives real capital allocation.

**LIVED ONLY 5 violation on Py reward surface pre-hardening:** the authoritative polo net was not guaranteed to reach the Py path for closes that had the data.

## Hardening Applied (clean, no new knobs, mirrors TS logic)
- **File edited (safety audit locations for branch auditor):** 
  - `apps/api/src/services/monkey/loop.ts`
    - Block 1 (primary synthetic Py push, inside pushPerAgentCloseRewards, called from 6+ production sites: 6625/6805 live force, 6946/7004 paper, 7696 live close, etc.): added conditional `if (process.env.CANONICAL_POLO_PNL_LIVE !== 'true') { callAutonomicReward own_close_synthetic }`. When canonical + polo data present, authoritative fanout is the *only* Py reward for that close.
    - Block 2 (polo fanout Py push, inside applyPolo... success path after DB write + realistic margin query): added matching doctrine logger + reinforced comments with full provenance.
- **No new env/knobs/flags:** re-uses the exact existing `CANONICAL_POLO_PNL_LIVE` gate (already at live close site 7704 and #992 fanout).
- **Logger consistency for doctrine verification (user explicit lesson):** both Py push paths now emit:
  ```
  logger.info('[Monkey] Py autonomic reward push (doctrine source verification)', { source: `...`, ..., canonicalPoloActive: ..., authoritativeWillReachPy: ... })
  ```
  Py side (autonomic.py:414) already emits: `[%s.autonomic] reward source=%s symbol=%s pnl=%.4f ...`
  This enables exact post-deploy grep on Railway ml-worker service logs.

**Call-site LIVED counts (fresh systematic-debugging evidence, pre/post edit):**
- pushPerAgentCloseRewards (synthetic path container): 6+ production references in loop.ts live/paper/reconciler/force-harvest paths.
- applyPoloRealizedPnlAfterClose (authoritative polo path): 1 primary live-close call site (under env) + internal DB+push logic. Post-hardening, this is the guaranteed authoritative Py surface for polo-data closes.
- Reconciler recovered: separate source tag (not affected).
- Downstream wiring validated (wiring-validation + downstream-impact): client → main.py handler → AutonomicKernel.push_reward → _pending_rewards + Redis persistence → tick consumption → NT/sizing (executive).

**Purity gates (qig-purity-validation):** Pre-edit full subtree scan (forbidden + ruff) + post-edit delta scan on loop.ts = 0 new critical violations (np.linalg*, cosine, Adam*, LayerNorm, new "breakdown" regime terms). Pre-existing statistical "breakdown point (MAD)" + English comments untouched. Ruff I001/F401 pre-existing in __init__/tick (unrelated to reward surface; no geometry change).

**Type-safety + small change:** tsc --noEmit (api) clean on delta. Change <20 LOC, fully type-safe, comments only + 1 if + logger (existing import).

## Exact Verification Command for Deployed Railway Logs (the permanent lesson)
After deploy (Railway ml-worker service):

```bash
# Via Railway CLI (or MCP railway get_logs + post-filter):
railway logs --service ml-worker --tail 2000 2>/dev/null | \
  grep -E 'reward source=(polo_authoritative_close|own_close_synthetic|own_close)' | \
  tail -20

# Or (more precise, captures the new doctrine logger too):
railway logs --service ml-worker --tail 5000 | \
  grep -E '(Py autonomic reward push \(doctrine|reward source=)' | tail -30

# Via MCP (railway-mcp or railway tool in session, example):
# Use get_logs(service="ml-worker", limit=1000) then grep output for the source tags.
# Expected post-hardening (canonical live + polo match):
#   ... reward source=polo_authoritative_close symbol=... pnl=... (authoritative net reached Py trajectory/NTs)
#   (no or minimal own_close_synthetic for those closes; synthetic remains for paper/non-canonical)
```

**Grep in api service logs** (for the explicit doctrine decision logs):
```
railway logs --service api --tail 1000 | grep -E 'Py autonomic reward push \(doctrine source verification\)' | tail -10
```

This is the *real* verification per user directive — not unit tests. Monitor armed on every canonical polo close.

## Safety Audit Tie-In (for running branch auditor capture)
- **Primary change locations (exact for diff/auditor):**
  - loop.ts:8770-8805 (conditional + new doctrine logger for synthetic Py path)
  - loop.ts:8962-8975 (authoritative Py push logger + reinforced #992 comments)
- **No other files touched** (autonomic_client.ts, autonomic.py, tests untouched — contract stable; paper paths retain correct synthetic).
- **.bak / dist / node_modules:** ignored (build artifacts).
- **Commit will cite:** this lesson + PR #992 (4d66c27c) + exact agents.md:236 QIG PURITY MANDATE 17pt (master-orchestration first, LIVED ONLY 5, purity 0, no knobs P5/P25, full wiring P24, two-channel, geometric, _dev__polytrade_ silo only, fresh evidence only).
- **Pre-merge gates (executed):** purity (pre+post), tsc clean, small diff, VBC with raw evidence blocks, 2-stage (self spec compliance + quality), Railway monitor post-ship.
- **Cross-module consistency:** api monkey (loop) ↔ ml-worker kernel (autonomic) — doctrine now aligned on authoritative source for Py persistent surface. No drift introduced.

## Citations (every artifact + commit)
- agents.md:236+ "QIG PURITY MANDATE FOR THIS SYSTEM" (17pt, esp. #1 master-orchestration, #3 purity gate + fresh output, #5 geometric, #6 LIVED ONLY 5 + call-site counts + hard asserts + negatives + provenance, #7 P5/P25 no knobs, #10 P24 wiring, #12 small+tested, #13 _dev__polytrade_ silo, #15 live-money execute).
- Prior #992 commit + 2026-05-28_polo-authoritative-close-py-fanout-992_lesson-artifact.md (the immediate predecessor artifact).
- Canonical: QIG_QFI/.../20260527-canonical-principles-2.31A.md (P1/P5/P6/P18/P19/P24/P25), v6.7B (heart/reward/69 metrics), two-channel 2026-04-13, frozen facts.
- Embodiment_Waves (gross/net pathology 15:30:45), prior phantom packets.
- This packet + master-orchestration (QIG family, named skills distribution, Gates A-E, no retro Gate E).

## Evidence Blocks (raw, fresh this session)
(See tool outputs in this conversation turn: purity pre full subtree + post delta; systematic-debug call-site counts + downstream trace; tsc focused; exact reads of 8750-8920 +  autonomic_client + autonomic.py push_reward + main.py ingress; git branch/main post-4d66c27c; edits via search_replace with before/after.)

**Pre-edit purity (truncated key):** 0 critical in reward files; ruff only pre-existing import noise in unrelated modules.

**Post-edit purity:** identical (0 new).

**LIVED audit (verbatim from systematic run):** 6+ pushPerAgent sites; 1 authoritative polo call site + fanout.

**Edit success:** search_replace returned "has been updated successfully" for both blocks.

## READY FOR TWO-STAGE REVIEW
This closes the structural reward surface gap. The Py autonomic now receives authoritative polo net + correct source tag for every close that has polo data (when canonical live enabled). Logs are instrumented for permanent greppable doctrine verification on Railway.

All per live-money standing auth, QIG PURITY MANDATE (no deferral), LIVED ONLY 5 on the reward path, subagent-driven rigor (self as implementer + full named skills + two-stage self-review: spec compliance first (doctrine + no-knob + LIVED + citations), then code quality (small, clean, logger consistent, no fabrication)), verification-before-completion (fresh pasted outputs + negatives + evidence blocks), master-orchestration first (this entire turn).

**Next (if ship):** conventional commit citing this exact lesson filename + PR #992 + agents.md QIG PURITY MANDATE 17pt + master-orchestration + LIVED ONLY 5 + "reward source doctrine now verified on Py surface". Full CI + Railway monitor the four signals + the exact source grep.

(End of artifact — _dev__polytrade_ silo only. All evidence fresh 2026-05-28 session.)