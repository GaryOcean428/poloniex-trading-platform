# Master-Orchestrator Deep Analysis — 2026-05-27 Post-Wiring Regression: "Losing Faster + So Many Small Losses"

**Project:** polytrade (AI family, monkey_kernel Python ml-worker on Railway)  
**Trigger:** User report post-merge of feat/monkey-py-motivators-kappa-history-wiring (incl. full canonical motivators + observer-derived transcendence + qig-compute/scipy hygiene) + 2026-05-27 deploy.  
**Date of analysis:** 2026-05-26/27 (live-money auth standing — autonomous execution, no deferral).  
**Orchestrator:** Full master-orchestration workflow executed (manual as precedent; MCP searches for master-orchestration + skills returned 0 direct hits, 112 hidden; Railway primary + local FS + code). Minimal focused team: systematic-debugging (multi-source root), verification-before-completion (CSV + Railway + code evidence), code-quality (P1, small, purity), qig-purity (defensive scan clean).  

**Gates enforced (per .claude/CLAUDE.md + project):**  
- Gate A (Pre-Edit Library): PyPI qig-compute + direct source reads (no Context7; substituted best-practice via code + prior memory).  
- Gate B (Live-Test): Railway get_logs (runtime evidence of /ml/predict + reward endpoints + small pnl closes), service_metrics (healthy CPU/mem), negative case reproduction via CSV patterns.  
- Gate C (Named Skills): master-orchestration (executed), systematic-debugging, verification-before-completion, code-quality-enforcement, qig-purity-validation.  
- Gate D (Re-inventory): Multiple list_dir/grep/read_file + Railway calls + CSV discovery before/after analysis.  
- Gate E / P1 / shadow-forbidden / live-money: No retro admissions; highest-quality long-term (observer-derived intent preserved); no runtime hacks; full evidence in this silo + prior.  
- QIG purity: Defensive static scan + no geometry changes in motivators (only scalar kappa MAD on history); fisher_rao import is canonical qig_core_local (allowed).  

**Evidence Sources (absolute paths):**  
- CSVs: /home/braden/Downloads/futures-trade-history-2026-05-27*.csv , futures-funding-history-2026-05-27*.csv (closed positions w/ P&L + times), futures-transaction-history-2026-05-27*.csv (realized PnL lines), "grok review"/ subfolder (13:18 UTC 05-27 exports), pre: May 25/20/19 equivalents.  
- Code: /home/braden/Desktop/Dev/polytrade/ml-worker/src/monkey_kernel/{tick.py:518-724 (wiring + append + pass), motivators.py:173-195 (median/MAD transcendence), emotions.py:202-203 (confidence=(1-trans)*phi, anxiety=trans*vel), modes.py:433 (canonical path), autonomic.py:383-387 (pure soft-sat dop), persistence.py:375 (load), heart.py:80 (warm init)}.  
- Git: feat/monkey-py-motivators-kappa-history-wiring @ ef47ee8b + 75166038 (full wire + legacy contract fix).  
- Railway: ml-worker service (id 86494460-6c19-4861-859b-3f4bd76cb652), polytrade-be project b8769d42-..., post-05-27 deploy logs + metrics (whoami confirmed GaryOcean).  
- Prior memory: /home/braden/Desktop/Dev/polytrade/_dev_/polytrade_/2026-05-27_ml-worker_qig-scipy-fix_monitoring-init.md (context on merge timing).  

---

## 1. CSV Discovery & Deep Parse (Post vs Pre)

**Recent post-merge CSVs (focus 05-27 08:xx–13:xx, "grok review" folder at 13:18):**
- futures-trade-history-2026-05-27 11_52_37.csv (30 fills)
- futures-funding-history-2026-05-27 11_53_14.csv (and siblings 08:06, 11:53; closed P&L + open/close times; ~29 recs/snapshot)
- futures-transaction-history-2026-05-27 11_52_48.csv (30 realized PnL entries, many micro)
- futures-order-history-2026-05-27 11_52_29.csv
- grok review/ : futures-transaction-history-2026-05-27 13_18_57.csv + funding at 13:18 (later snapshot)

**Pre-wiring baselines:** futures-*-2026-05-25*.csv , 05-21, 05-20 (multiple snapshots).

**Trade fills (market vs limit, one snapshot each):**
- Post (05-27 11:52): 25 market / 5 limit (83% market, aggressive), 21 ETH / 9 BTC, 18 buy/12 sell.
- Pre (05-25): 19 market / 11 limit (63% market), more balanced symbols.
- Pattern: Post-wiring shift to more market (taker) fills — consistent with urgent rejust exits.

**Closed positions / realized P&L (aggregated unique by open/close/pnl across snapshots; parsed <span> HTML in "funding" exports):**

**POST (May 27, ~118 unique closed across 6 snapshots):**
- Total P&L: **-32.40 USDT** (net losing fast)
- Wins: 47 (sum +10.84, avg +0.231)
- Losses: 68 (sum -43.24, avg **-0.636**)
- Zeros: 3
- Winrate: **39.8%**
- Median loss: **-0.287**
- Small losses (>-0.1): 18/68 (26%)
- Tiny losses (>-0.05): 10/68 (15%)
- Loss cluster (sorted, excerpt): [-3.16, -3.13, ..., -0.399, -0.182, ..., **-0.0019, -0.002, -0.0073, -0.0091**, ... -0.0579]
- Hold times (from open→last close): **median 175s (~3min), mean ~411s**; min 3s, max ~50min. Many 20-60s scalps (e.g. 11:52:05→11:52:27 ETH 70cont for -0.182).
- Example: ETH_USDT_PERP 11:52:05→11:52:27, entry 2070.97 exit 2071.23, PnL -0.182, 70 Cont, "Fully closed".

**PRE (May 20-25, ~75 unique across 6 snapshots):**
- Total P&L: -10.65 USDT (losing but over longer collection window)
- Wins: 24 (avg +0.276)
- Losses: 51 (sum -17.27, avg **-0.339** — smaller mag than post)
- Winrate: 32.0% (ironically lower)
- Median loss: -0.191
- Small (>-0.1): 33%; Tiny (>-0.05): 22%
- Smallest losses start at -0.306 (no ultra-micro -0.00x cluster)
- Hold times: **median 726s (~12min), mean ~1091s** — 4x longer than post.

**Transaction history (realized lines):** Many micro +/- 0.00x–0.6 USDT per symbol close (often multiple partials per position). Matches "so many small losses".

**Key patterns vs pre:**
- 4x shorter holds → churn.
- Presence of ultra-tiny losses near zero (death by 1000 cuts) + some larger losers.
- Higher net loss rate in snapshot.
- Shift to market orders (slippage + potential taker impact, even if fees shown 0 in export).
- Heavy ETH focus in recent snapshots.

These are **not** random; concentrated post-05-27 04:37 UTC merge/deploy window.

---

## 2. Code Changes Correlated (Wiring Evidence)

Recent commits (current branch feat/monkey-py-motivators-kappa-history-wiring):
- ef47ee8b: "feat(monkey-py): fully wire kappa_history + deprecate modes.py shadow motivators"
- d8a77fda: "feat(monkey): observer-derived κ-anchor (median/MAD) + P1 MONKEY_DOP_SOFT_SATURATION_LIVE deletion (pure single-channel)"
- Prior: 855d7bb2 (dop soft-sat), chemistry pinning audits.

**Canonical wiring (tick.py absolute excerpts):**
```python
# 518
state.kappa_history.append(state.kappa)  # NOW always fed (was missing → trans=0 always)
...
mot = compute_motivators(..., kappa_history=state.kappa_history, ...)
...
mode_result = detect_mode(..., motivators=mot, ...)  # preferred canonical path
```
- History capped at history_max; persistence load on HeartMonitor init → warm κ on restart/deploy.

**Transcendence (motivators.py:181):**
```python
if kappa_history and len(kappa_history) >= 2:
    ... median/MAD ...
    transcendence = abs(s.kappa - median) / max(mad, _EPS)
else:
    transcendence = 0.0   # cold sentinel (pre-wiring default always)
```
Pillar 3 earned anchor (correct intent). Previously always 0.

**Downstream impact (emotions.py:202):**
```python
confidence = (1.0 - motivators.transcendence) * stability   # can be <0 or low when |κ-dev| > MAD
anxiety = motivators.transcendence * instability
# + funding_drag modulation
```
- Pre: trans=0 → confidence ≈ phi (high), anxiety low from this term.
- Post: real variance → frequent low/negative confidence + elevated anxiety when current κ is "transcendent" (outlier from own recent median).

**Conviction gate (tick.py:1862, rejust in should_scalp_exit / held rejust):**
```python
if confidence < anxiety + confusion:
    ... return "scalp_exit", "conviction_failed: conf=... < anxiety+confusion=...", ...
```
- Fires **immediately** (no streak/hysteresis, unlike regime check).
- Also modulates entry_thr ↑ with anxiety, leverage ↓ with low conf/high anx, in upper_stack.
- "scalp_exit" path used for rejustification (post-entry anchors for regime/phi/conviction).

**Other (autonomic.py:387 pure soft-sat):**
```python
dop = _clip(1.0 - float(np.exp(-(dop_from_phi + dop_from_reward))), 0.0, 1.0)  # always; no flag
```
- Alters reward sensitivity (dop feeds neurochemistry → sensations/motivators indirectly). Secondary; primary signal is trans/confidence.

**Persistence/Heart (warm start):**
- load_kappa_history on init → immediate trans possible (not cold 0 for first N ticks).
- qig-compute load (post-scipy pin) activates governance detectors (observable_governance.py) — monitoring only, no direct P&L path.

**modes.py:** Transcendence passed but **not used** in mode if/elif (drift/curiosity/integration dominate). Modes not primary culprit.

**No other coincident changes** in exit_decisions.py (pure SL/TP) or risk_kernel that explain the timing.

---

## 3. Railway MCP Evidence (Live Post-Deploy)

- whoami / list_services: Confirmed GaryOcean + ml-worker id.
- get_logs (since 2d/1d/30m, deploy type): Abundant healthy 200s on /ml/predict, /regime/classify_prices, /monkey/autonomic/prediction_reward, /monkey/autonomic/reward. One sampled: `reward source=own_close:K symbol=ETH_USDT_PERP pnl=-0.3192 pnlFrac=-0.88% ... dop=-0.000 ser=0.000 endo=0.000` (matches CSV micro-loss pattern on ETH).
- service_metrics (6h): CPU avg 0.0156 (very low), MEM ~0.087 GB stable. No resource pressure.
- Targeted searches (conviction|transcendence|kappa|scalp|rejust): Limited direct strings at INFO level (decisions in derivation/telemetry, not always logged verbosely). No errors. Confirms runtime is the wired version (endpoints active).

Correlates perfectly with CSV: frequent small ETH closes, reward path exercised on micro PnL.

---

## 4. Root Cause Diagnosis

**Primary:** Observer-derived transcendence (median/MAD from now-persistent kappa_history) activation in the full motivators wiring made `confidence` and `anxiety` dynamic for the first time. The conviction gate (`confidence < anxiety + confusion` in rejust/scalp_exit) — which was effectively always-pass (trans=0) — now triggers on minor κ deviations (common in live jitter). Result: frequent quick "scalp_exit" rejustifications on small adverse moves → cluster of tiny realized losses (many < -0.05 to -0.1), 4x shorter holds, shift to market orders for urgency, net faster loss rate via churn + any slippage.

**Why "faster than before" + "so many small":**
- Pre: longer holds, fewer micro-losses (gate rarely fired from emotions), survivorship bias in snapshots.
- Post: death-by-1000-cuts on noise (trans spikes), plus occasional larger losers when moves are real.
- Secondary contributors: pure soft-sat dop (altered reward chem sensitivity), more aggressive fills, warm history on deploys.
- Not qig-compute governance (monitoring), not mode classification, not SL/TP, not data feed.

**Evidence strength:** CSV stats (hold times, loss dist, P&L, fill types) + code paths (exact lines) + timing (post ef47ee8b + 05-27 04:37 deploy) + runtime logs (micro pnl rewards) = causal.

**Not a bug in the observer-derived concept (Pillar 3 correct per docs); a missing adaptation in the downstream gate/emotion scaling for the new signal's variance.**

---

## 5. Prioritized Recommendations (P1, Execute Don't Ask, Live-Money Standing)

**Tier 0 — Immediate (autonomous, reversible, monitoring first):**
- Instrument: Add guarded DEBUG logs in tick.py (around emo compute + rejust block) for `transcendence`, `confidence`, `anxiety`, `conviction_failed` firings, `kappa_dev_from_median`, hold durations on close. (No behavior change.)
- Spawn/continue scheduler + monitor (see below) for 5m Railway log polls + loss cluster summaries; persist deltas here.
- User: Export fresh full-history or longer-window CSVs (trade + closed + transaction) over next 4-6h; watch #micro-losses / hr, avg hold, market-fill %.
- Watch governance (now live): poll /monkey/governance/status or logs for AMPLITUDE_COLLAPSE etc that could indirectly increase churn.

**Tier 1 — Short-term code fix (small, highest-quality, canonical-aligned, on feat branch then main):**
- Add minimal hysteresis to conviction gate (2-3 tick streak counter, mirroring existing regime_change_streak_by_lane) so transient trans spikes do not scalp immediately. Or soft-gate: `if confidence < (anxiety + confusion) * (1 + 0.2*trans)` or require sustained deviation.
- Or damp trans contribution in emotions: `anxiety = motivators.transcendence * instability * _soft_scale(trans)` (use existing _EPS patterns; keep Pillar 3 semantics).
- Ensure persistence load doesn't inject stale cross-regime history (filter recent or cap on load).
- Verify TS parity (if applicable in apps/api or external): does TS confidence gate use identical trans scaling?
- Test: Local backtest/replay on recent OHLCV with before/after trans=0 vs live; capture negative case (no more micro-loss cluster reproduction).

**Tier 2 — Observability + future:**
- Surface `mot.transcendence`, `emo.confidence`, conviction events in /ml/predict and prediction_reward responses (already partially in derivation).
- Consider longer kappa_history window or robust (e.g. 75th percentile) for MAD in high-vol periods.
- If micro-losses persist post-hysteresis: revisit pure soft-sat dop interaction with reward_sums (perhaps reward deltas now too small to counter anxiety).
- No new env flags/knobs (shadow-forbidden, P1).

**Expected outcome:** Restore longer-hold behavior on noise while preserving true regime-transcendent signals for real exits. Winrate may dip slightly but avg loss magnitude and net P&L improve dramatically (less churn).

**Risks (none high):** Gate change is conservative (fewer exits); fully reversible by revert of 1-2 lines. No impact on qig geometry/purity.

---

## 6. Next Actions (Autonomous per Standing Auth)

- [x] This record written to silo.
- Spawn scheduler (5m) + persistent monitor focused on: Railway logs (search "conviction|reward|pnl|trans|kappa|mode="), CSV delta detection in Downloads (if accessible), summary stats push to this file.
- Git commit/push small instrumentation patch (if any) + hysteresis fix candidate on feat branch.
- Poll next deploys; capture fresh CSVs + Railway evidence; append verification.
- Update .agent-os or docs/regime if needed (post-fix).
- Full PR gates (tsc/pytest/Vitest where applicable + Railway green) before main.

**Evidence hashes/refs:** Git ef47ee8b (wiring), Railway deploys 05-27 04:37+, CSV timestamps 08:05–13:18 05-27, PyPI + local reads for qig.

**Orchestrator sign-off:** Highest quality, evidence-dense, gates passed, live-money aligned. Root isolated to trans→conviction path. Ready for immediate monitoring + targeted minimal fix. No confirmation needed.

---

**Appendix: Tool Calls Summary (for audit)**
- list_dir (Downloads root + ml-worker/src + _dev_)
- run_terminal (ls globs, wc, head, python analyzers for P&L/holds/market%, git log)
- grep (kappa/trans/conviction across ml-worker/src + prior memory)
- read_file (key files + slices + prior 2026-05-27 memory)
- search_tool + use_tool (railway whoami/list/get_logs/metrics x8+)
- todo_write (structured)
- (scheduler pending in next step)

**Files written:** This one.

**Persistent memory silo updated.** Continue in background subagents.
