# STALE_BLEED Time-Stop Calibration Analysis

**Date:** 2026-05-15
**Author:** read-only data analysis (no code changes, no DB writes — SELECT only)
**Subject:** Is the Monkey kernel's fixed −1% ROI / 30-min held-position time-stop well-calibrated across chop-reversion and cascade regimes?

---

## Step 0 — Exact reason string(s)

There are **two distinct, independently-wired "stale bleed" mechanisms** in the Monkey kernel. The task brief describes the first one, but the second shares the name and must not be confused with it.

### Mechanism 1 — `held_position_rejustification.ts` STALE_BLEED gate (the one in scope)

- Source: `apps/api/src/services/monkey/held_position_rejustification.ts:218-236`.
- Fires when `heldDurationS >= STALE_BLEED_MIN_DURATION_S` (1800 s = 30 min) **AND** `currentRoi <= STALE_BLEED_ROI_THRESHOLD` (−0.01 = −1% on margin). This is the **−1% / 30 min** gate.
- Returns `fired: 'stale_bleed'`, `reason` string of the form:
  `stale_bleed: held <N>s ≥ 1800s at ROI <x>% ≤ -1.00%`
- Wired in `loop.ts:1174-1189`: on fire it sets `action='scalp_exit'`, `derivation.scalp.exitTypeBit = 5` ("rejustification").
- **Critical wiring detail:** the closer in `loop.ts:1539-1545` maps `exitTypeBit` → `exitType`, but **has no case for bit 5**. Bit 5 therefore falls through to the default `'scalp_exit'`. `closeHeldPosition` (`loop_execution.ts:792-794`) writes that value verbatim into `autonomous_trades.exit_reason`.
  **Consequence: rejustification-STALE_BLEED closes land in `autonomous_trades` as `exit_reason = 'scalp_exit'` — indistinguishable from ordinary scalp exits.** The descriptive `stale_bleed: held …` text is NOT persisted to `autonomous_trades` at all (the `reason` column on closed monkey rows is overwritten with the open-side decision text).

### Mechanism 2 — `staleBleedStop.ts` (NOT in scope; different trigger)

- Source: `apps/api/src/services/monkey/staleBleedStop.ts`. Fires on **stagnant** positions (held past a per-lane threshold AND price move inside ±0.3% of notional) **regardless of P&L sign**. `exitTypeBit = 6` → `loop.ts:1544` maps bit 6 → `exit_reason = 'stale_bleed_stop'`.
- This mechanism has **never fired in production**: `derivation->'staleBleed'->>'fire' = 'true'` returns **0 rows** across all 176,005 `monkey_decisions` rows.

### Strings matched on in this analysis

Because `autonomous_trades.exit_reason` does **not** carry a stale-bleed tag for Mechanism 1, the authoritative source is the **`monkey_decisions` table**, matched on:

```
derivation -> 'rejustification' ->> 'fired' = 'stale_bleed'      -- gate evaluated true
AND executed = true                                              -- AND it became a real close
```

`autonomous_trades` was also searched for `exit_reason ILIKE '%stale%'`/`'%bleed%'` and `reason ILIKE '%stale_bleed%'` — **0 rows all-time**, confirming the persistence gap above.

---

## Data scope & quality caveats

- **The production DB has no data on or after 2026-05-15.** `SELECT now()` inside the container returned **2026-05-14T23:36 UTC**; the newest `autonomous_trades` row is `2026-05-14T23:16:13` and the newest `monkey_decisions` row is `2026-05-14T23:36:54`. **The specific 91-contract ETH trade in the brief (opened 2026-05-15 02:18, force-closed 04:39) does not exist in the queryable data — it is in the future relative to the DB snapshot.** All analysis below uses the full available history instead.
  - Closest analogue present: `autonomous_trades` id `1aa27ce5…` — ETH long, qty 0.91 (= 91 contracts × 0.01 ETH), entry 2312.50, but entered 2026-05-14 18:18 / exited 20:40 at 2287.72, `exit_reason = vanished_before_close` (not STALE_BLEED). The brief's trade is a later repeat of the same setup, not yet persisted.
- `engine_version` is a **bare git hash** (no `monkey|` / `live_signal|` prefix as prior notes suggested). Engine/agent identity lives in the `agent` column (`K`, `T`, `L`, `USER`) for `autonomous_trades`, and in `derivation->>'agent'` for `monkey_decisions`.
- `autonomous_trades.quantity` coin/contract ambiguity confirmed: monkey rows store **coin amount** (e.g. ETH `0.91`, BTC `0.016`); manual `USER` rows store **contract counts** (e.g. ETH `87`, BTC `54`). This analysis derives position size from `monkey_decisions` derivation math instead of trusting `quantity`, so the ambiguity does not affect the numbers below.
- Counterfactual prices come from Poloniex public v3 candles (`/v3/market/candles`, `interval=MINUTE_15`). **The historical-window params are `sTime`/`eTime`** — `startTime`/`endTime`/`from`/`to`/`start`/`end` are all silently ignored and return the latest 100 candles instead. The first counterfactual pass used the wrong params and was discarded; all Section 2 numbers use the verified `sTime`/`eTime` form.
- Position size back-out (validated against derivation `unrealizedPnl`): for a long, `entry = closePx / (1 + roi/lev)`, `coinSize = realisedPnl / (closePx − entry)`. All 61 in-scope closes are `long`.

---

## Section 1 — Provenance of STALE_BLEED-closed rows

Window: all history (the brief's "since 2026-05-14" yields too few rows — only 142 `autonomous_trades` rows exist after 2026-05-14 00:00, and **zero** are stale-bleed closes). Reported on the full record instead.

### Counts

- `rejustification.fired = 'stale_bleed'` appears in **3,070** `monkey_decisions` rows all-time (it is re-stamped every tick a losing position is held past 30 min, so this is *tick-count*, not *position-count*).
- Of those, **`executed = true` on 61 rows** — i.e. **61 actual force-closes** all-time, the earliest 2026-05-01 16:20, the latest 2026-05-13 11:15. No same-minute/same-symbol duplicates → 61 distinct closes.
- Since 2026-05-13: 116 fired, 5 executed.

### Per-symbol / per-engine / per-lane

| Symbol | Agent | Lane | n | ROI@close min / median / avg / max | Hold min / avg / max |
|---|---|---|---|---|---|
| ETH_USDT_PERP | K | swing | 43 | −14.16 / −2.90 / −3.78 / −1.00 % | 30.1 / 44.7 / 464.1 min |
| BTC_USDT_PERP | K | swing | 18 | −12.14 / −1.43 / −3.21 / −1.01 % | 30.2 / 55.0 / 291.8 min |
| **All** | **K** | **swing** | **61** | **−14.16 / −2.46 / −3.61 / −1.00 %** | **30.1 / 47.8 / 464.1 min** |

Every executed STALE_BLEED close was **agent K, `swing` lane, `long` side.** Agents T and L never produced one. There is no `lane` column on `monkey_decisions`; lane comes from `derivation->>'heldLane'` and was `swing` for all 61.

### Distribution of ROI-at-close

| Band | n | share |
|---|---|---|
| A: −1.00 to −1.25 % | 13 | 21 % |
| B: −1.25 to −1.50 % | 7 | 11 % |
| C: −1.50 to −2.00 % | 8 | 13 % |
| D: −2.00 to −3.00 % | 7 | 11 % |
| E: −3.00 to −5.00 % | 10 | 16 % |
| **F: worse than −5.00 %** | **16** | **26 %** |

Only **33 % (bands A+B)** fire within 0.5 pp of the −1% threshold. **26 % fire at worse than −5% ROI**, and the worst was **−14.16%** — fourteen times past the trigger level.

### Distribution of hold-time-at-close

| Band | n |
|---|---|
| 30.0–31.0 min | 28 |
| 31.0–33.0 min | 9 |
| 33–40 min | 8 |
| 40–60 min | 11 |
| > 60 min | 5 |

The **time** half of the gate is well-behaved: 46 % fire in the first minute past 30 min, 61 % within 3 min. The long tail (max 464 min) is positions that were green or shallow at the 30-min mark and only crossed −1% much later — that is correct behaviour for the *time* condition.

### Verdict — the gate does NOT fire at the threshold

The ROI condition is **badly under-sampled**. If the gate checked ROI on every tick it would catch positions at −1.0% to −1.5% almost every time; instead two-thirds of closes happen well past −1%, a quarter past −5%. Root cause is structural, visible in the code path: the rejustification evaluator only runs when **no earlier exit check (scalp SL/TP, regime, phi, conviction) and no `exitFired` flag has already fired this tick**, and the Monkey loop tick is ~60 s — so on a fast adverse move the position blows through −1%, −3%, −5% between two evaluations. The `−1%` is a *floor that has been crossed*, not a *level the stop acts at*.

**This is a separate, real bug** distinct from the calibration question: the time-stop is mis-named — it behaves as "close once you *notice* ROI ≤ −1%", not "close *at* −1%". It should be flagged for a fix independent of any threshold re-tuning (e.g. evaluate the ROI leg unconditionally each tick, before the early-exit short-circuits, or run it on the mark-price stream rather than the decision tick).

---

## Section 2 — Counterfactual continuation

(Inferred intent, since the brief was truncated.) For each of the 61 executed STALE_BLEED closes, Poloniex MINUTE_15 candles for the 5 h **after** the close were pulled, and the position's P&L was re-simulated as if it had been **held +1 h, +2 h, +4 h** instead of force-closed. Counterfactual P&L = `realisedPnl + coinSize × (futurePrice − closePx)` (long). `worst-DD` = P&L at the lowest low reached within the +4 h window (the max pain a holder would have sat through).

### Aggregate — all 61 closes

| Scenario | Total P&L | Δ vs realised |
|---|---|---|
| **Realised (force-closed)** | **−196.47** | — |
| Held +1 h | −185.70 | **+10.77** (holding would have been *slightly better*) |
| Held +2 h | −222.56 | −26.09 |
| Held +4 h | −491.10 | −294.63 |
| Held to worst intra-4h drawdown | −1034.16 | −837.69 |

Per-case verdict (judged at +1 h): **stop SAVED money in 29 cases (total +138.73 averted), COST money in 32 cases (total −149.50 forgone)** — almost a coin-flip, net −10.77 (the stop was marginally *harmful* at the +1 h horizon, marginally *helpful* by +2 h, strongly *helpful* by +4 h).

### Split by symbol

| | n | realised | +1 h | +2 h | +4 h | SAVED / COST cases |
|---|---|---|---|---|---|---|
| **ETH** | 43 | −119.00 | −106.99 (**+12.01**) | −110.47 (+8.53) | −329.35 (−210.35) | 21 / 22 |
| **BTC** | 18 | −77.47 | −78.72 (−1.24) | −112.09 (−34.61) | −161.76 (−84.28) | 8 / 10 |

ETH closes were dominated by **chop reversion** — holding +1 h would have recovered +12.01 net (the brief's "close one bar before the bottom" scenario). BTC closes leaned the other way — holding *any* horizon was worse, confirming the BTC-cascade hypothesis: the stop is doing its job on BTC.

### Split by regime-at-close (`derivation.rejustification.regimeNow`)

| Regime | n | realised | +1 h | +2 h | +4 h |
|---|---|---|---|---|---|
| **integration** | 36 | −106.81 | −64.27 (**+42.54**) | −68.36 (+38.45) | −109.87 (−3.06) |
| **investigation** | 25 | −89.66 | −121.44 (**−31.78**) | −154.19 (−64.54) | −381.23 (−291.57) |

**This is the cleanest signal in the dataset.** When the kernel classified the regime as `integration` (stable / mean-reverting), force-closing **cost +42.54** over the next hour — the position would have reverted. When it classified `investigation` (unstable / trending-adverse), force-closing **saved 31.78** — holding would have bled further. The fixed threshold is blind to this and pays for it in `integration`.

### Split by how late the gate fired

| | n | realised | +1 h | SAVED / COST |
|---|---|---|---|---|
| Near threshold (ROI −1.0…−2.0 %) | 28 | −47.85 | −5.29 (**+42.56**) | 12 / 16 |
| Fired late (ROI ≤ −5 %) | 16 | −113.38 | −139.87 (**−26.49**) | 12 / 4 |

When the gate fires *near* the threshold, holding +1h would have recovered +42.56 (these are the chop-reversion false-positives — close one bar early). When it fires *late* (≥ −5%, the under-sampling bug), holding was correctly worse — but by then the position has already lost most of what the stop was supposed to protect.

### Continuation vs reversion

Post-close direction at +1 h: **29 continuations** (price kept falling) vs **32 reversions** (price recovered) — essentially even. The realised aggregate is only mildly negative-EV at +1h *because* the dataset is a near-even mix and the stop fires indiscriminately across both.

---

## Section 3 — Calibration recommendation

### Is fixed −1% / 30 min well-calibrated?

**No — and it under-performs specifically in the chop-reversion regime, exactly as the brief suspected.** Three independent findings converge:

1. **The threshold is a coin-flip on its own merits.** Across 61 real closes, force-closing vs holding +1 h is 29-saved / 32-cost, net −10.77. A stop that is wrong as often as it is right is not earning its keep.
2. **It is regime-blind, and the regime signal is strong and already computed.** In `integration` the stop costs +42.54/+1h; in `investigation` it saves −31.78/+1h. The kernel *already classifies the regime* at the moment the gate evaluates (`derivation.rejustification.regimeNow`) — the information needed to condition the threshold is sitting unused in the same struct.
3. **It is symbol-blind.** ETH closes are reversion-heavy (holding helps); BTC closes are cascade-heavy (holding hurts). One global number cannot serve both.

It is *not* defensible to simply loosen or tighten the global threshold: loosening helps ETH/integration but removes the BTC/investigation protection that is the stop's whole reason for existing; tightening does the reverse.

### Recommended change (written recommendation only — NO code change)

**Adopt a regime-conditional ROI threshold, gated on the `regimeNow` value the rejustification evaluator already has in hand:**

- **`investigation` (unstable / trending-adverse):** keep it **tight** — `−1%` or even `−0.75%`. This is where holding bleeds; the data shows the stop saving money here. Fire early.
- **`integration` (stable / mean-reverting):** **loosen to ≈ −2.5% to −3%**, *and* add a recovery-aware escape — e.g. do not fire if price has ticked back toward entry over the last N ticks. The +1h counterfactual (+42.54 over 36 closes) says the integration-regime closes are mostly premature; a −2.5% floor would have let the median integration close (median ROI −2.46%) ride to recovery while still catching genuine −5%+ breakdowns.

Estimated effect on the 61-close sample: keeping `investigation` closes as-is (−89.66 realised, already near-optimal vs the −121.44 hold alternative) and letting `integration` closes ride one extra hour (−64.27 instead of −106.81) nets roughly **+42 P&L** over the sample with **no loss of cascade protection** — the `investigation`/BTC-cascade closes are untouched.

**Optionally** also condition on symbol (BTC tighter than ETH) — but regime already captures most of that variance, so regime-conditioning alone is the high-value, low-complexity change. A per-lane threshold is unnecessary: all 61 closes are `swing` lane, so there is no cross-lane evidence to calibrate against.

### Prerequisite bug fix (must land first or in parallel)

The **Section 1 under-sampling bug must be fixed regardless of threshold choice.** A regime-conditional `−1% / −2.5%` is meaningless if the gate still only checks ROI once every ~60 s and routinely first observes the position at −5% to −14%. The threshold and the check-frequency are orthogonal problems; re-tuning the number without fixing the sampling just changes *which* late level the stop reacts at. Recommended: evaluate the ROI leg of STALE_BLEED unconditionally every tick (before the earlier-exit short-circuits), or drive it off the mark-price stream rather than the decision tick.

### Secondary finding worth a ticket

Mechanism-1 STALE_BLEED closes are **unobservable in `autonomous_trades`** — they persist as `exit_reason = 'scalp_exit'` because `loop.ts` has no `exitTypeBit === 5` case. This blocks any future post-hoc P&L attribution of the time-stop from the trades table alone (this analysis had to reconstruct everything from `monkey_decisions`). Adding a bit-5 → `'stale_bleed_rejust'` mapping (mirroring the bit-6 → `'stale_bleed_stop'` line directly above it) would make the mechanism auditable.

---

## Appendix — query provenance

All figures from read-only `SELECT` queries run inside the `polytrade-be` Railway container against production Postgres, plus public unauthenticated Poloniex v3 candle reads. No writes. Key sources:

- Reason strings & wiring: `held_position_rejustification.ts:132-236`, `loop.ts:1131-1252`, `loop.ts:1535-1588`, `loop_execution.ts:567-836`, `staleBleedStop.ts`.
- Provenance: `monkey_decisions` filtered on `derivation->'rejustification'->>'fired'='stale_bleed' AND executed=true` (61 rows).
- Counterfactual: Poloniex `GET /v3/market/candles?symbol=…&interval=MINUTE_15&sTime=…&eTime=…`, candle field order `[low,high,open,close,amount,qty,tradeCount,startMs,closeMs]` (confirmed against `poloniexFuturesService.js:1071-1076`).
