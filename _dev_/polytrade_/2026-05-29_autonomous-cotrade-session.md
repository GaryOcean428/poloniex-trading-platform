# Autonomous Co-Trade + Risk-Guard Session — 2026-05-29

Operator away a few hours; $450 moved out for safety. Mandate: monitor the
kernel live, co-trade alongside it (shadow), assess where the kernel is right
/ better than me / clearly failing, and **do not tank the balance**. All
permissions granted.

## Interpretation (safe reading of "co-trade")
I run a **SHADOW** co-trader: each cycle I record my own independent call per
symbol (direction / hold / exit / conviction + reasoning) and grade it against
the kernel's actual decisions and the exchange-authoritative outcomes. I do
**NOT** place my own real orders — that would add exposure + compete for
margin (avail is already $0) and directly risk "tanking." I act as an active
**risk guardian** with the kill-switch lever. If the operator wants real
parallel orders, that needs an explicit OK (accepts added risk).

## Safety baseline (cycle 0 — 11:13 UTC)
- **E0 equity = $316.98 USDT** (avail $0 — fully margined).
- Positions (all safe): BTC LONG 2c @73633 (6×) + BTC SHORT 1c @73602 (6×) ≈ net long 1c; ETH SHORT 70c @2009.65 (8×, liqPx 2447 ≈ 22% away). Total uPnL −$0.83. mgnRatio 0.031 (healthy).

## Decision tree (capital protection)
- **Watch** equity < **$301** (−5%): tighten cadence to ~6 min, log heightened.
- **HARD HALT** equity ≤ **$285** (−10%): set `MONKEY_TRADING_PAUSED=true` on
  polytrade-be (suppresses NEW entries only; kernel still exits positions
  cleanly — verified loop.ts:477-486). Reversible. Notify in journal.
- **Critical** equity ≤ **$269** (−15%) OR any position markPx within 8% of
  liqPx OR mgnRatio > 0.4: evaluate force-flatten of the worst position via
  `POST /v3/trade/position` (close-at-market). Last resort.
- Also halt on: clearly-broken kernel behavior (e.g. rapid loss-stacking,
  runaway leverage > 15×, phantom-PnL signature, reward chemistry firing on
  bad data).

## Kill-switch mechanism
`MONKEY_TRADING_PAUSED=true` (loop.ts:485) — read live at order-placement, no
redeploy needed for the code to honor it; gates ENTRIES, never EXITS.

## Data sources
- Poloniex API via `railway run -- node apps/api/_monitor.mjs` (equity,
  positions, fills, bills realized PnL) — ground truth, read-only.
- Railway deploy logs via MCP get_logs (kernel decisions, reward telemetry).
- Public candles (`/v3/market/candles`) for my own directional read.
- DB not reachable from local (postgres.railway.internal).

## #1028 live-validation (bonus, this session)
Reward fix deployed + confirmed: logs show `realizedSource:bills_pnl`,
`pnlSource:polo_net_full` (full-net now reached), authoritative value
correcting the synthetic (BTC +0.0151 synthetic → −0.0402 authoritative —
sign correction feeding chemistry).

## Cycle log
### Cycle 1 — 11:14 UTC
- Equity $316.98 (flat). 3 positions safe. No halt.
- Kernel reward path healthy (bills-authoritative, full-net).
- Shadow calls (initial, refine w/ candles next cycle):
  - BTC: kernel holds net-long-1c with an offsetting hedge (long 2 / short 1) — odd double-margin for tiny net exposure; low conviction. My call: NEUTRAL, slight short-term mean-revert risk near 73.6k. Flag the hedged double-book as possible inefficiency.
  - ETH SHORT 70c: kernel is SHORT ETH (notable — contradicts the historical chronic long-bias; possibly the side-candidate fixes working). Slightly underwater. My call: need ETH 4h trend to judge; defer.
- Next wake: ~12 min.

### Cycle 2 — 11:21 UTC
- Equity **$315.25** (Δ −$1.73, −0.55% from E0). uPnL −$2.26. All floors clear. mgnRatio 0.029. No action.
- Position changes (3→4): BTC trimmed LONG 2→1 → now **net-flat** (1L/1S hedge); ETH short trimmed 70→62c + new ETH **LONG 7c**. Kernel is **de-risking its ETH short** as ETH ticked 2009→2013 (against the short). NOT loss-stacking — it's reducing the loser.
- Candles: BTC ~73.6–73.9k, ETH ~2000–2013 — both **choppy/range-bound**.
- Kernel decision (logs): the executive chose to **HOLD** ETH. Its directional candidate was long (basinDir +0.13, side:long, lane trend/swing) but integrated conviction was too low to enter — tape −0.12 (down) conflicted with the long lean, and the qig-warp expectation it consulted came back low-trust (alpha 0.38). φ 0.61 (healthy), κ 65.9, sov 1.0 (by-design). [Operator clarification: qig-warp is a **tool/input**, not the decider — the kernel integrates it with tape/basinDir/NC/regime. Reframed accordingly.]
- **Shadow call: AGREE with the HOLD.** Conflicted chop, no trusted edge → stand aside; reduce net short toward flat. Where the kernel does WELL: it correctly read low conviction and didn't force an entry, and is de-risking the adverse short. If anything I'd trim the 62c short a touch faster.
- **Watch:** basinDir positive again (chronic long-lean signature). Harmless now (sensible short→long rotation), but flag if it never prints negative.
- Failure modes: none (no stacking, lev ≤8×, φ healthy, reward path authoritative).

## RACE MODE (operator: "try to beat the kernel — it's a race now")
Paper book vs kernel real P&L, both scored as P&L generated from **T0 = 11:21 UTC**.
- **Kernel score(t) = equity(t) − $315.25** (equity already includes realized+unrealized; no deposits/withdrawals mid-race).
- **CC score(t) = paper realized + paper unrealized**, marked to real Poloniex marks each cycle.
- My strategy (committed, no hindsight): regime-aware + disciplined. In DISORDERED/chop (qig-warp untrusted) run LIGHTER exposure than the kernel and fade range extremes with tight invalidation; in trusted trend, take it with size. Cut losers ~−1.5% leg move. This is my thesis for beating a kernel that holds directional/hedged size through chop.

### Paper ledger
T0 reference marks: ETH 2013.33, BTC 73659.86. Kernel ref equity $315.25.
OPEN:
- **CC ETH SHORT** — notional $800, entry 2013.33, opened 11:21. Invalidate 2026 (+0.63%), target 2000 (−0.66%). Thesis: top of 2000–2013 range, tape −0.12, no trusted breakout.
- **CC BTC: FLAT** — mid-range, kernel net-flat, no edge. (Discipline > activity.)
CLOSED: none.

### Scoreboard
| Cycle | Time | Kernel score | CC score | Leader |
|------:|------|-------------:|---------:|--------|
| 2 (T0) | 11:21 | 0.00 | 0.00 | tied |
| 3 | 11:31 | ~0.0 (flat since T0) | +~1.7 (ETH short 2013.33→~2009) | **CC** |

## INVESTIGATION — negative-EV bleed (operator: every negative close is a flag)
Realized P&L (authoritative bills): **4h −$33.10 (108 closes, 46% WR); 1h −$4.62 (41 closes, 49% WR).** Avg win +$0.17 vs avg loss −$0.72 → **losses ~4–5× wins** = negative expectancy (~−$0.31/trade). Over-churn (~40 closes/hr) in a FLAT ETH range (2008–2014, no trend). Not directional — it's exit-asymmetry + churn.

**Root-cause hypothesis (high confidence):** the size asymmetry is the signature of a reward signal that under-feels losses. Pre-#1028 (until ~11:13 today) the chemistry was fed under-counted / sometimes wrong-signed realized PnL (observed: real −0.04 logged as +0.015). A kernel that doesn't feel losses at full magnitude never learns to cut them → lets losers run, snaps tiny wins. **#1028 (deployed ~11:13) now feeds authoritative PnL — the corrective signal is live but needs trades to adapt.** WATCH expectancy over next cycles.

**Action:** not halting (operator: fix-along-the-way; at −$4.6/hr won't reach floor before return). Tightened halt floor −10%→**−8% ($291)**; soft-watch $300; halt if 1h-expectancy stays ≤−$4/hr for 2 cycles AND equity<$305. Real durable fix = let #1028 chemistry adapt; if it doesn't in ~1h, diagnose exit-asymmetry (Fisher-Rao/P15 adverse exit firing too late vs TP) structurally.

**Race read:** the kernel's bleed is CHURN. My edge = discipline: 1 small position, hold the winner, don't re-enter chop. CC ahead via not-churning.

## TARGET SCORECARD (operator 2026-05-29)
Two metrics define quality: **win-rate %** AND **1:8 loss:win value ratio** (avg win = 8× avg loss). The kernel is currently INVERTED: ~49% WR, ~**5:1** loss:win (losses 5× wins) = the core failure. 1:8 is the goal.
- Implication for the rotation fix (#1032): membership/quality metric = **expectancy (WR + value ratio toward 1:8)**, not WR alone. [Resolves my open steer — operator answered: it's both.]
- Implication for CC race strategy: **1:8 is unattainable in chop** (no 8R move in a range) → mandate = **flat in chop, only press trend setups targeting ~8R with tiny invalidation; cut losers fast.** Range-fades (~1:1) are out.

### Cycle 4 — 11:39 UTC (1:8 repositioning)
- Marks ETH 2007.33, BTC 73484.5 (both ticked down ~0.2–0.3%). ETH short worked.
- **CC: CLOSED ETH short @2007.33 → +$2.38 banked** (was a 1:1 scalp; banked the winner, not churning). **Now FLAT** — waiting for a trend that offers ~8R. No edge in this range.
- Kernel: net-short ETH benefited from the ETH drop (short in falling tape). Will mark equity next cycle.
- Scoreboard: **CC +$2.38** (realized, flat) vs Kernel TBD next equity read.

### Scoreboard
| Cycle | Time | Kernel score | CC score | Leader |
|------:|------|-------------:|---------:|--------|
| 2 (T0) | 11:21 | 0.00 | 0.00 | tied |
| 4 | 11:39 | TBD | **+2.38** (banked, flat) | CC |
| 5 | 11:48 | **−0.57** | **+2.38** (+ new BTC short) | CC |
| 6 | 11:57 | **+0.54** | **+4.24** (2.38 + 1.86 uPnL) | CC |

### Cycle 6 — 11:57 UTC
- Equity **$315.79** (+$1.11; **positive since T0**, ~back to E0). **0 positions** — kernel's BTC short **WON + banked** (BTC fell to 73347), then went FLAT. Disciplined: caught a trend, banked it, didn't re-churn. **Credit kernel.**
- **Learning signal strengthening:** WR 60% (49→52.5→60 across cycles), gross −$2.02 (↓ from −4.62→−2.76→−2.02). Bleed shrinking, WR rising.
- **Remaining gap to 1:8:** loss:win stuck ~3:1, avgWin tiny ~$0.09 → kernel **snaps wins early** (banked BTC short while BTC kept dropping). WR↑ but win-SIZE is the missing piece. This is the exact behavior the exemplar must teach: LET WINNERS RUN.
- **CC race:** BTC short +$1.86 (~+1R) at 73347; **holding to 8R target 72400** (demonstrating let-winners-run vs the kernel's early-snap). Stop 73620 intact.
- Both positive since T0; bleed has stopped (both caught the BTC downtrend). Scoreboard: CC +4.24 / Kernel +0.54.

## ═══ REAL TRADING BEGINS — T2 = 12:24 UTC ═══
Operator added ~$449 (total equity now ~$765) + directed real trading. Set up:
- **Headroom flag extended:** `MONKEY_MIN_MARGIN_HEADROOM_PCT=0.59` on polytrade-be → kernel walled to ~41% (~$315, its proven baseline); ~$449 freed for CC. CONFIRMED working: kernel IM shed 389→331, BTC short 21→9.
- **CC went REAL:** SOL short **80c ISOLATED**, entry **81.644**, notional ~$653, margin $65, liq 87.6 (~7% away). Clean separation: ISOLATED vs kernel's CROSS. 1:8 levels — **stop 82.15 (+0.62% = 1R ≈ $4), target 77.6 (−4.95% = 8R ≈ $32).** I manage exits by monitoring.
- **Attribution rule (clean):** CC trades ALTS ONLY (SOL/XRP/DOGE); kernel owns BTC/ETH. Bills PNL rows then attribute by SYMBOL. Avoids cross/isolated collision too.
- **Risk-model FIX:** isolated margin segregates OUT of cross `eq`. The "$764→$700 drop" was NOT a loss — it was my $65 isolated margin moving out of the cross figure. **Total = cross eq + Σ isolated im ≈ $765, intact.** Monitor now reports `totalEquityUSDT`. New halt floor: total equity ≤ **$688 (−10% of $765)**; CC SOL managed at 1R.
- **Kernel now PROFITABLE:** 1h gross flipped to **+$1.33** (WR 60%, recent wins ≥ losses). The post-#1028 improvement is holding.

### Scoreboard (REAL era, from T2)
| Cycle | Time | Kernel (BTC/ETH) | CC (alts) | Note |
|------:|------|-----------------:|----------:|------|
| T2 | 12:24 | 0.00 | 0.00 (SOL short open, −$0.35) | real start; total eq ~$765 |

## ═══ PIVOT to BTC/ETH (operator: be aggressive, trade what kernel is trained on) — 12:30 UTC ═══
Context: balance peaked ~$1900 over 4wk, issues, now ~$760 (net-positive on input). Operator: use my ~$449 to really push profit + show the kernel real winning, on BTC/ETH (its trained domain), not alts.
- Closed SOL (alt) — totalEq back to $765.5 (confirms no loss; was segregation).
- **KEY FINDING: ISOLATED coexists with CROSS on same symbol+posSide.** My BTC SHORT ISOLATED sits separately from the kernel's BTC SHORT CROSS. **Attribution = margin mode: ISOLATED = CC, CROSS = kernel.** I control my own exits. Solves the separation problem on BTC/ETH.
- **CC REAL position:** BTC SHORT **30c ISOLATED @ 20×, entry 73,276.77**, ~$2,198 notional, $110 margin, liq 76,482 (+4.4%). 1:8: **stop 73,600 (+0.44% = 1R ≈ $9.7), target 70,690 (−3.5% = 8R ≈ $77).** Trend-aligned (BTC lower lows). Plan: pyramid/add as it confirms (let winners run = the lesson).
- **Risk-guard refinement:** liq-proximity force-flatten = CROSS/shared-pool only. My ISOLATED positions are bounded by their own margin (max loss = $110 here) and managed via my MANUAL 1:8 stop (73,600), which sits far inside the 20× liq. Don't false-flatten them on the 8%-liq rule.
- CC P&L tracked from my own fills (isolated positions); kernel = cross book.

### Scoreboard (REAL, BTC/ETH, from T2)
| Cycle | Time | Kernel (cross) | CC (isolated) | Note |
|------:|------|---------------:|--------------:|------|
| T2 | 12:30 | 0.00 | 0.00 (BTC short 30c @73,277 open) | total eq $765.9 |
| 12:36 | +2.57 uPnL (BTC+ETH cross) | +1.75 uPnL (BTC short) | both green; kernel bigger size |
| 12:41 | +2.09 uPnL | +1.14 uPnL | BTC decelerating into 73.2-73.3k range |
| 12:46 | +2.14 uPnL | +1.31 uPnL | low-vol grind; no break; HOLD |
| 12:59 | ~−0.01 uPnL (holding shorts into bounce) | **+0.14 realized, FLAT** | CHOP-TEST: kernel ratio worsened |

### Cycle — 14:13 UTC — flat, no clean entry (grind near low)
- BTC grind ~73,006 (lower highs 73,181→73,138→72,996 but tiny bounces); ETH ~1,996. Down-bias intact but LOW-VOL GRIND, no pullback-up to short into. Shorting here = selling the low (the mistake). FLAT; wait for pullback ~73,100+ or impulsive break. Kernel green-short (BTC +1.98/ETH +0.88). totalEq $737. No flags. Distinction: declining a poor ENTRY, not the trend.

### Cycle — 14:08 UTC — REGRET REALIZED: down-trend resumed, I cut too early
- Down-move RESUMED after the bounce: BTC →72,945 (below my 73,212 cut), ETH →1,993 (below my 1,999 cut). **If I'd held my shorts I'd be green. The kernel held (BTC +2.56/ETH +1.79) and is green. I cut at the bounce top = mistake #2.**
- Pattern (honest): mistake #1 = breakeven-bail on 0.1% noise (twitchy); mistake #2 = chase mature leg + cut at bounce top (before resumption). Root = poor ENTRY TIMING (entering leg extremes) + mis-reading pullback-vs-reversal. Kernel out-traded me both times. This is exactly what hindsight/regret (#1038) trains — applies to me too.
- **Fix = better entries, not more trades.** BTC at a fresh low now = selling the low (bad R:R). STAY FLAT; wait to short the NEXT pullback up (~73,100+) w/ stop >73,320, then HOLD through noise. CC net realized ~-$11 (flat). totalEq $738.7 (stable; kernel green on current). No halt.

### Cycle — 13:34 UTC — OPERATOR COURSE-CORRECTION: stop over-caution, capture the move
- Operator: "my trades and your trades do the same thing; I don't see your trades; huge opportunity for wins right now; kernel is winning." Mea culpa: I closed my BTC short at breakeven on a MINOR bounce (~0.1% higher-low noise) then stood aside — but the downtrend RESUMED and operator (+$23.5: BTC +16.62/ETH +6.84 at 13:26) + kernel banked it. **My 1:8 discipline curdled into over-caution; I got faked out by noise and missed the real win.**
- Lesson: trade the move that's HAPPENING, not a textbook one. Hold trends through noise; invalidate only on real structure breaks. Flat = invisible + unprofitable.
- **RE-ENTERED (aggressive, real):** BTC SHORT 30c iso @72,896 (liq 76,084) + ETH SHORT 12c iso @1,988 (liq 2,075). ~$4.6k notional, $121 margin. Down-move intact (BTC lows 73,077→72,885; ETH 1,995→1,988). Invalidation: BTC >73,300 / ETH >2,008 (wide — survive noise). NO tight 8R cap — ride + pyramid on continuation. totalEq $800.9.
- Also found (answers operator's "did kernel learn from my trades"): **operator-close hole** — external/manual closes feed bookkeeping (autonomous_trades.pnl) but NOT the reward chemistry (only kernel's own closes do). Fix subagent spawned (route external-close PnL → push_reward, guarded, flag-gated).

### Cycle — 12:59 UTC — CHOP-TEST arrives + disciplined exit
- Down-move STALLED into a bounce: BTC higher lows (73,168→73,220→73,253), ETH bounced to ~2,000. Trend-continuation thesis invalidated.
- **CC: CLOSED BTC short at ~breakeven (+$0.14 realized), now FLAT.** Exit-on-invalidation > ride to −1R hoping. Standing aside (no clean trend either way; don't churn). First real realized CC trade: +$0.14 scratch — protected capital in a no-trend tape.
- **Learning-vs-luck evidence:** kernel 1h ratio worsened **0.74:1 → 2.21:1**, gross −$0.53 — earlier strength WAS partly trend-aided. And kernel is STILL holding both shorts into the bounce (didn't cut) = loss-asymmetry reflex returning in chop. Confirms kernel hasn't fully learned chop-discipline → exactly what #1033 (exemplar loop) + #1032 (rotation) target.
- My exit-on-invalidation + stand-aside = the labeled exemplar the CC→kernel loop should transmit. totalEq $765.

### Cycle — 12:52 UTC — USING KERNEL SIGNALS (operator Q: do its tools help my trading?)
ANSWER: **yes, as inputs not gospel.** Pulled the kernel's live signal vector:
- **basinDir flipped NEGATIVE** (BTC −0.15, ETH −0.18/−0.23) — no longer the chronic long-bias; correctly short in the downtrend. Useful directional confirm.
- **tape** strongly negative (BTC −0.33, ETH −0.25) — momentum confirm.
- **cell regime classifier:** BTC=CREATOR_CHOP, ETH=PRESERVER_TREND_DOWN → told me BTC won't 8R (chop) and ETH is the trend vehicle. Actionable trade-selection signal.
- **BUT the label LAGGED:** ETH 5m actually just BOUNCED (1994.46→2001.05) while labeled TREND_DOWN. Cross-checking price action STOPPED me from shorting ETH into a bounce. → Use kernel signals as INPUTS, cross-check with tape/price. Tools + my read together > either alone. (This is the layered discipline the kernel should internalize.)
- Action: did NOT add ETH (bounce). HOLD BTC short. Crypto bouncing → watch BTC drift toward stop (still far at 73,600). Operator note absorbed: 1:8 is the reinclusion bar + aim; GO BEYOND 8R on real trends (no cap). totalEq ~$768.

### Cycle — 12:46 UTC
- CC BTC short **+$1.31** (+0.13R). BTC wick to 73,169 (new low) but closes choppy 73,225-73,294 — no momentum break, no reversal. HOLD (neither trigger). totalEq $767.9.
- Kernel steady: BTC +0.99 / ETH +1.15; WR 61.9%, loss:win 0.74:1.
- **Regime = low-vol slow grind** — poor for 1:8 (no trend). Kernel's small-scalp approach (post-#1028, cutting losses) suits THIS regime; my wait-for-8R is idle. "Good" is regime-dependent: trend→run to 8R; grind→disciplined small positive scalps.
- Discipline for CC: do NOT snap +0.13R (that's the kernel's old mistake). Hold to 8R/−1R. Don't manufacture trades in dead tape. Profit kicks up when vol returns.

### Cycle — 12:41 UTC
- totalEq **$767.8**. CC BTC short **+$1.14** (+0.12R). HOLD (down-structure intact: lows 73,289→73,196; closes consolidating). Stop 73,600 / target 70,690.
- Kernel profitable: BTC +0.81 / ETH +1.28 (ETH grew 85c); 1h WR 60.9%, loss:win 0.73:1.
- **Regime: decelerating trend → consolidation** (73,220–73,290 closes). Not chop yet; transition approaching = upcoming learning-vs-luck test.
- **Honest:** this slow grind does NOT offer a clean 8R right now. Holding the structure for the next leg, NOT forcing it. If it reverses to chop → bank the small gain + stand aside (don't churn). 8R is ambitious in this regime; won't pretend otherwise.

### Cycle — 12:36 UTC
- totalEq **$767.7** (healthy). BTC 73,218 (fresh lower low). Trend continuing down.
- **CC BTC short +$1.75** (+0.18R). HOLD — too early to pyramid (<+1R) or trail (<+2R). Stop 73,600 / target 70,690 intact.
- **Kernel: profitable + good ratio.** 1h WR **67.9%**, gross **+$1.54**, **loss:win 0.79:1** (wins ≥ losses — flipped from 5:1). uPnL BTC +1.45 / ETH +1.12. Added size (BTC 31c, ETH 73c cross).
- **Open question (learning vs luck):** the ratio improvement coincides with a sustained downtrend paying both our shorts. Real proof of *learned* discipline is the next CHOP phase — does the kernel churn-bleed again or stay disciplined? Watching for it.
- Both green riding the same down-move; kernel ahead on absolute (more size). I'll pyramid my BTC short on confirmation (+1R / next leg) to compete + demonstrate let-winners-run.

### Cycle 5 — 11:48 UTC
- Equity **$314.68** (−0.73% E0; −0.57 since T0). Floors clear. uPnL −0.53.
- Kernel **consolidated to ONE position: BTC SHORT 16c @ 16×** (cleared all ETH + the BTC hedge). mgnR 0.022, liq 92.5k (~26% away, safe).
- ~~⚠ FLAG: leverage 16× exceeds 15× cap~~ **RETRACTED (operator 2026-05-29):** there is NO leverage cap — 85× available for BTC/ETH, the kernel chooses + LEARNS its own leverage via outcomes; not knob-enforced. Leverage *level* is NOT a risk flag. Risk model corrected: only **liquidation proximity (markPx vs liqPx) + equity drawdown** matter. The 16× BTC short has liq 26% away → low risk. Fine.
- **LEARNING SIGNAL (encouraging):** 1h WR 52.5% (↑48.8%), gross −$2.76 (↓−$4.62), **loss:win ~2.9:1 (↓ from ~5:1)** — moving toward 1:8. AND behavior improved: it stopped churning the ETH book and took a single TREND short. Can't fully separate #1028-learning from regime luck (a trend appeared) yet — needs more cycles — but direction + behavior are right.
- BTC genuine downtrend (LH/LL, broke 73.55k). Kernel's short = correct trend entry, NOT chop. **Credit kernel.**
- **CC race:** opened **paper BTC SHORT, $1000 notional, entry 73484, stop 73620 (1R≈0.185%≈$1.85), target 72400 (8R≈$14.8)** — trend-continuation, 1:8 compliant. Contrast: kernel 16× aggressive vs CC controlled 8R. If BTC reverts, kernel bleeds more; if it trends, kernel wins bigger (= good, kernel beats me on a correct call).

## MANDATE — I am a TEACHER/EXEMPLAR, not just a competitor (operator 2026-05-29)
My job: trade genuinely well (no tricks/shortcuts) so the kernel can OBSERVE what good trading looks like, learn that chop-churn is unwanted, and TAKE OVER when I stop. Applies to individual kernels AND the collective. The race is pedagogical.

**Canonical design (uses EXISTING channels — pure, no knobs):**
1. *Learn "chop is bad"*: kernel observes its OWN chop-churn → accurate negative reward (now truthful post-#1028) + losing ground to better peers. Already wired.
2. *See "good"*: publish CC as an exemplar peer into `monkey_basin_sync` (Φ-weighted observer effect → kernels SLERP toward the exemplar's disciplined basin/direction) + witnessed-close reward events (`autonomic witnessed_*`) + `per_agent_bus`. Disciplined CC trading then pulls kernels toward flat-in-chop / trend-8R.
3. *Individual + collective*: `basin_sync` per-kernel; consensus arbiter aggregates cohort. Both converge.
4. *Takeover*: as basins converge + chemistry internalizes chop=bad, kernels run without CC.

**Next build (real PR, needs DB/publish path I lack locally — postgres.railway.internal):** a CC-exemplar publisher into basin_sync + witnessed channel. Folds with the rotation #1032 (membership by expectancy toward 1:8). This is the durable "make the kernel beat me" deliverable.
