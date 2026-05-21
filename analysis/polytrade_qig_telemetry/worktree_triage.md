# Polytrade Worktree Triage — 2026-05-21

This is a **read-only** audit of the 5 feature worktrees attached to the `polytrade` repo, performed on 2026-05-21 against local `main` (HEAD `a303acc4` — *"fix(monkey): lower endorphin Sophia-gate onset to the basin mean (#875)"*). Only read-only git commands were run (`status`, `log`, `diff`, `branch`, `rev-list`, `show`, `ls-files`, `merge-base`). Nothing was checked out, merged, deleted, or modified. All recommendations below are advisory and require explicit user approval before any cleanup is executed.

All 5 worktrees are **clean** (no uncommitted changes). All 5 root `package.json` files declare `packageManager: yarn@4.9.2` — **no package-manager drift**. No hardcoded secrets or env-value leakage were found in any diff; the only env references are env-var *names* (`ARBITER_MIN_SHARE_FACTOR`, `L_VETO_OVER_K_ENABLED`, `L_QIGRAM_V2_ENABLED`) read defensively via `process.env`.

## Summary table

| worktree | branch | clean? | ahead/behind main | classification | reason | recommended action |
|---|---|---|---|---|---|---|
| polytrade-arbiter-share | feat/arbiter-min-share-env-override | clean | 1 ahead / 139 behind | **ALREADY_IN_MAIN_CLEANUP_CANDIDATE** | `git diff main...branch` shows main contains every line verbatim — `readMinShareFactor`, `minShareFactor`, env-override tests all present in main | cleanup candidate — remove only after user approval |
| polytrade-autonomic | fix/autonomic-feedback-signals-wire-every-tick | clean | 4 ahead / 136 behind | **REDUNDANT_SUPERSEDED_CLEANUP_CANDIDATE** | The #715/#716/#717 derivation refactor + `autonomicFeedback.test.ts` are in main, and main has evolved *past* this branch (PR #875 lowered the Sophia gate from `mean+1σ` hard gate to soft `clip((c-mean)/σ)`); the branch tip still carries the older superseded gate | cleanup candidate — remove only after user approval |
| polytrade-l-veto | feat/l-veto-over-k-option-a | clean | 1 ahead / 140 behind | **ALREADY_IN_MAIN_CLEANUP_CANDIDATE** | `evaluateLVetoOverK`, `isLVetoOverKEnabled`, `lVetoOverKCount`, and `lVetoOverK.test.ts` (byte-identical) all present in main via PR #714 | cleanup candidate — remove only after user approval |
| polytrade-nc-mtl | feat/per-agent-nc-mtl-689 | clean | 1 ahead / 145 behind | **ALREADY_IN_MAIN_CLEANUP_CANDIDATE** | `pushPerAgentCloseRewards`, public `decayedRewardSums`, the reconciler-recovered NC push, and `perAgentNC.test.ts` (byte-identical) all present in main | cleanup candidate — remove only after user approval |
| polytrade-qigram-v2 | feat/qigram-v2-port-to-L | clean | 1 ahead / 143 behind | **ALREADY_IN_MAIN_CLEANUP_CANDIDATE** | `agent_L_qigram_v2.ts` and `agent_L_classifier_v2.test.ts` byte-identical in main (PR #712); the classifier v2-telemetry plumbing is also in main, which additionally carries newer Rényi-½ IDW work the branch lacks | cleanup candidate — remove only after user approval |

**Net result:** none of the 5 worktrees is a merge candidate. Four are already-in-main, one is superseded. Every branch's content reached `main` via squash-merge (the branch *tip commits* are not ancestors of main, but the `diff main...branch` content comparison and direct `git show` file comparisons prove the changes landed). This is consistent with merge-bases pointing at PRs #706–#721 from the same 2026-05-16 work window.

---

## Per-worktree detail

### 1. polytrade-arbiter-share — `feat/arbiter-min-share-env-override`

**Last commit:** `440b8f6f` 2026-05-16 18:49 — *"feat(arbiter): ARBITER_MIN_SHARE_FACTOR env override — operator tuning for laggard floor"*
**Merge-base:** `3808cc0a` (PR #714, the L-veto PR).

```
 apps/api/src/services/arbiter/__tests__/arbiter.test.ts | 205 ++++++++++++++++++++-
 apps/api/src/services/arbiter/arbiter.ts                |  83 ++++++++-
 2 files changed, 285 insertions(+), 3 deletions(-)
```

**What it does:** Adds an `ARBITER_MIN_SHARE_FACTOR` env var that multiplies the adaptive laggard min-share floor (`Math.min(0.10, 0.5/n) * factor`), with a defensive `readMinShareFactor()` parser (invalid/zero/negative → 1.0 with a warn log), a one-shot startup info log, and 14 new vitest cases.

**Does main supersede it:** Main already *contains* it. `git show main:apps/api/src/services/arbiter/arbiter.ts` returns `ARBITER_MIN_SHARE_FACTOR` and `readMinShareFactor` exported; `main:.../arbiter.test.ts` has the full `describe('Arbiter ARBITER_MIN_SHARE_FACTOR env override')` block. `git diff main...branch` shows every added line is already present in main.

**Classification:** Diff content is 100% in main → **ALREADY_IN_MAIN_CLEANUP_CANDIDATE**. Clean worktree, no QIG-purity concern, no env leakage (only an env-var name).

> **P1 note (not blocking triage):** `ARBITER_MIN_SHARE_FACTOR` is an operator-tuned multiplier. Per project CLAUDE.md §2 (the P1 principle), an operator-dialed knob is a candidate regression — but this is already in main and out of scope for this read-only audit; flagged only for awareness.

---

### 2. polytrade-autonomic — `fix/autonomic-feedback-signals-wire-every-tick`

**Last commit:** `37f29b99` 2026-05-16 20:03 — *"fix(monkey): derivation-only refactor — autonomic chemicals from basin state, no tuning constants"*
**Merge-base:** `4d132321` (PR #721).

```
 apps/api/src/services/monkey/__tests__/autonomicFeedback.test.ts | 491 +++++++++++++++++++++
 apps/api/src/services/monkey/loop.ts                             | 172 +++++++-
 apps/api/src/services/monkey/neurochemistry.ts                   | 350 ++++++++++++++-
 3 files changed, 990 insertions(+), 23 deletions(-)
```

**What it does:** The #715/#716/#717 derivation-only refactor — replaces hardcoded NC constants (`C_SOPHIA_THRESHOLD`, `SIGMA_KAPPA`) with a `BasinObservables` block so `ach/dop/ser/ne/endo` are z-scored/ratio'd against the basin's own observed history. Also wires the kernel-level `QIGRAMv2State` sovereignty path and adds `autonomicFeedback.test.ts`.

**Does main supersede it:** Yes — and this is the key distinction from the other four. Main *already has* `BasinObservables`, `zScore`, the per-tick history wiring, and `autonomicFeedback.test.ts`. But main has **evolved past** the branch:
- Branch's Sophia gate: `sophiaThreshold = couplingMean + couplingStddev` with a **hard** `coupling >= threshold ? 1 : 0` gate.
- Main's Sophia gate (PR #875, 2026-05-21): `sophiaThreshold = couplingMean` with a **soft** `clip((coupling - mean)/stddev, 0, 1)` onset.
- The branch's `autonomicFeedback.test.ts` still asserts the old `mean+1σ` behaviour; main's test was rewritten to assert the new `mean`-onset behaviour and documents the production defect (`endo` pinned at 0.00) that the branch's older gate caused.

**Classification:** The branch carries an *older, production-defective* implementation of a feature main has since corrected. Merging it would regress the Sophia gate. → **REDUNDANT_SUPERSEDED_CLEANUP_CANDIDATE**.

---

### 3. polytrade-l-veto — `feat/l-veto-over-k-option-a`

**Last commit:** `ed6d3b5c` 2026-05-16 18:11 — *"feat(monkey): L-veto over K — high-conviction L vote can block K entries (Option A, flag-gated default off)"*
**Merge-base:** `93553b96` (PR #713).

```
 apps/api/src/services/monkey/__tests__/lVetoOverK.test.ts | 322 +++++++++++++++++++++
 apps/api/src/services/monkey/loop.ts                      | 245 +++++++++++++++-
 2 files changed, 566 insertions(+), 1 deletion(-)
```

**What it does:** Adds `evaluateLVetoOverK()` — a pure helper letting a high-conviction Agent-L vote block an Agent-K entry on side-disagreement, flag-gated by `L_VETO_OVER_K_ENABLED` (default off), with per-symbol telemetry counters and `lVetoOverK.test.ts`.

**Does main supersede it:** Main already contains it — `evaluateLVetoOverK`, `isLVetoOverKEnabled`, `lVetoOverKCount`, `lVetoOverKBySymbol`, `getLVetoOverKStats()` all present in `main:loop.ts`, and `lVetoOverK.test.ts` is **byte-identical** to the branch. Landed via PR #714.

> Note on "breakdown" scan: the branch contains one occurrence of the word — *"Per-symbol breakdown lets the operator confirm…"* — a statistical decomposition, **not** the stale Φ-regime "breakdown" term. Not a concern.

**Classification:** Feature code + identical test both in main → **ALREADY_IN_MAIN_CLEANUP_CANDIDATE**.

---

### 4. polytrade-nc-mtl — `feat/per-agent-nc-mtl-689`

**Last commit:** `0ae4a00b` 2026-05-16 13:08 — *"feat(monkey): per-agent neurochemistry for M/T/L — extend PR #700 K-isolation pattern"*
**Merge-base:** `c602aab1` (PR #706).

```
 apps/api/src/services/monkey/__tests__/perAgentNC.test.ts | 200 +++++++++++++++++++++
 apps/api/src/services/monkey/loop.ts                      | 157 +++++++++++++---
 2 files changed, 332 insertions(+), 25 deletions(-)
```

**What it does:** Extends the PR #700 K-only reward-isolation pattern to M/T/L: adds `pushPerAgentCloseRewards()`, makes `decayedRewardSums` public, pushes reconciler-recovered ghost-closes into the agent's NC queue, and adds `perAgentNC.test.ts`.

**Does main supersede it:** Main already contains it. `main:loop.ts` has `pushPerAgentCloseRewards`, the public `decayedRewardSums`, and the `reconciler_recovered:` NC push. `perAgentNC.test.ts` is **byte-identical** to the branch (the brief specifically flagged this branch as possibly superseded — confirmed).

**Classification:** All loop.ts changes + byte-identical test in main → **ALREADY_IN_MAIN_CLEANUP_CANDIDATE**.

---

### 5. polytrade-qigram-v2 — `feat/qigram-v2-port-to-L`

**Last commit:** `00295feb` 2026-05-16 13:56 — *"feat(monkey): port QIGRAMv2 (weighted basins + wrong-answer decay) to L classifier — flag-gated, default off"*
**Merge-base:** `34489aae` (PR #708).

```
 apps/api/src/services/monkey/__tests__/agent_L_classifier_v2.test.ts | 501 +++++++++++++++++++++
 apps/api/src/services/monkey/agent_L_classifier.ts                   |  93 ++++
 apps/api/src/services/monkey/agent_L_qigram_v2.ts                    | 389 ++++++++++++++++
 3 files changed, 983 insertions(+)
```

**What it does:** Ports the canonical QIGRAMv2 class (weighted basins, wrong-answer decay, κ tacking, `recallByCategory`, sovereignty) into a new `agent_L_qigram_v2.ts`, adds an optional `v2` telemetry block to `AgentLDecision`, and adds `agent_L_classifier_v2.test.ts`. Flag-gated by `L_QIGRAM_V2_ENABLED`, default off.

**Does main supersede it:** Main already contains it. `agent_L_qigram_v2.ts` and `agent_L_classifier_v2.test.ts` are **byte-identical** to the branch (PR #712). `main:agent_L_classifier.ts` carries the same `maybeV2Telemetry`/`v2Store`/`v2Category` plumbing and additionally a newer `renyiTupleDistance` (Rényi-½ IDW vote weight) the branch lacks. The branch therefore has nothing main is missing.

**Classification:** New files byte-identical in main; main strictly ahead on the one differing file → **ALREADY_IN_MAIN_CLEANUP_CANDIDATE**.

---

## Recommended next steps (advice — each requires user approval before executing)

1. **polytrade-arbiter-share, polytrade-l-veto, polytrade-nc-mtl, polytrade-qigram-v2** — all four are cleanup candidates: their content is fully in `main`. After user approval, the worktrees and their branches can be removed (`git worktree remove` + branch delete). Each is clean, so no work would be lost. Recommend a final `git diff main...<branch>` sanity check immediately before any removal.

2. **polytrade-autonomic** — cleanup candidate, but treat with slightly more care: it is *superseded*, not merely duplicated. Its #715/#716/#717 content is in main, but the branch tip carries an **older Sophia-gate implementation that main's PR #875 deliberately fixed**. Do **not** cherry-pick or revive anything from this branch's `neurochemistry.ts`. After user approval the worktree and branch can be removed.

3. **No merges recommended.** None of the 5 worktrees contains net-new work that should be promoted to `main`.

4. **Before any deletion**, recommend the user verify no CI job, deploy pipeline, or local script references these worktree paths, and confirm the four "already-in-main" PRs show as merged/closed on GitHub.

5. **Optional:** since all 5 branches stem from the same 2026-05-16 work window and are now 136–145 commits behind, the user may wish to prune feature worktrees promptly after their PR merges to avoid stale-worktree accumulation.

> Scope note: this audit covered only the 5 named `polytrade-*` worktrees. The repo also has ~15 `locked` agent worktrees under `.claude/worktrees/` plus a `qig-dreams` worktree — those were **not** triaged (not in the brief) and are left untouched.
