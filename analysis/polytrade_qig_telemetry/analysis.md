# Polytrade QIG Telemetry & Φ-Flatline Analysis — 2026-05-21

Read-only analysis. No live trading touched, no Railway API / production DB calls.
All inputs are exported logs and CSVs from `~/Downloads`. Colourblind-safe plots
(purple / blue / amber / dark grey) only.

Reproduce: `analysis/.venv/bin/python analysis/polytrade_qig_telemetry/build_analysis.py`

---

## 0. Local-facts verification (pre-flight)

All facts in the brief were confirmed before any analysis:

| Check | Result |
|---|---|
| Root `package.json` → `packageManager` | ✅ `yarn@4.9.2` |
| `apps/api/src/services/monkey/{basin,perception,neurochemistry}.ts` | ✅ all present |
| `__tests__/{neurochemistryEndo,perceptionCanonicalDims,perAgentNC}.test.ts` | ✅ all present |
| Worktrees `polytrade-{arbiter-share,autonomic,l-veto,nc-mtl,qigram-v2}` | ✅ all present |

**Discrepancies vs the brief (none block the analysis, but they change the method):**

1. The brief expected the **log export as a JSON array**. The actual newest export
   (`logs.1779189081583.csv`) is a **CSV** with columns `message,severity,attributes,tags,timestamp`;
   the telemetry lives inside the `message` column with embedded ANSI colour codes.
2. The brief said *"Account is fee-free: Closed PnL is net"*. **This is stale.** The
   `futures-transaction-history` ledger contains explicit per-fill `Fee` rows
   (≈0.05% taker), confirming the fee-free tier has ended (consistent with the
   2026-05-21 fee-tier reversal). Poloniex `Closed PnL` is **gross of trading fee**.
   This analysis buckets on the exchange's `Closed PnL` figure and notes fees
   separately rather than treating PnL as net.
3. The brief expected a **24h** telemetry window. The newest export spans only
   **~16.6 minutes** (see §3). "Φ over 24h" is not possible from this data; the
   plot covers the real window and is labelled as such.

---

## 1. Data sources used

| Role | File | Notes |
|---|---|---|
| Telemetry log | `~/Downloads/logs.1779189081583.csv` | Newest log export. 2083 rows; 109 carry tick-level Monkey telemetry with `phi`. |
| Trades (position-level) | `~/Downloads/futures-funding-history-*.csv` | **14 of 18** `funding-history` files are position-level closed trades (header has `Open Time` / `Closed PnL`). Unioned + deduped → **223 unique closed trades**. |
| Funding-fee ledger | `~/Downloads/futures-funding-history-*` (4 files) | Header `Time,Note,Margin,Amount,Value,Funding Rate,Fee` — actual funding payments, **not** trades. Excluded from the trade set. |
| Fee/PnL ledger | `~/Downloads/futures-transaction-history-*.csv` | Used only to confirm fees are being charged (point 2 above). |

The position-level closed-trade file is — confusingly — named `futures-funding-history-*`,
**not** `futures-transaction-history-*` as the brief guessed. It does carry the exact
columns the brief expected (`Entry Price, Exit Price, Closed PnL, Open Time, Last
Closing, Status`), and `Closed PnL` does have the `<span>…</span>` HTML wrapper, which
is stripped.

The older log (`logs.1778751196082.csv`, 2026-05-14, ~7 min, 28 phi lines) was **not**
merged in — it is a different deployment/code generation and combining them would mix
code versions.

---

## 2. Parse assumptions

- **Telemetry line shape:** `… [Monkey] {SYMBOL} [{mode}] {action} {JSON}`. The JSON
  blob is parsed for `phi, kappa, cell, cellLive, chosenLane, bv, drift, fh, sov,
  selfObsBias, tape, basinDir, side`, the `nc` string (`ach=… dop=… ser=… ne=…
  gaba=… endo=…`), and the `reg` string (`q…/e…/eq…` → `q_weight/e_weight/eq_weight`).
- **`instance_id` is NOT recoverable for tick rows.** The `[Monkey] … [mode] action`
  lines carry **no `instanceId`** — only 3 of 112 phi-bearing lines have it (the
  `ORDER PLACED` lines). Two kernels (`monkey-position`, `monkey-swing`) are
  interleaved in the log but the action-line telemetry does not label which.
  → Φ streams are keyed by **symbol** (2 reliable streams), not `(instance, symbol)`.
  *This missing field is itself a wiring gap — see §10.*
- **Timestamps:** the message-prefix ISO timestamp (`…Z`, UTC) is the event time.
  Trade-CSV `Open Time` / `Last Closing` have no timezone; assumed UTC (standard for
  Poloniex exports; cross-checked — `funding-history` Open Time `06:19:37` matches the
  `trade-history` fill at `06:19:36` for the same ETH position).
- **Side inference (Part D rule):** `long` if `sign(exit−entry) == sign(pnl)`,
  `short` if they disagree, `unknown` if either is ~0.
- **Buckets:** `FLAT` if `|pnl| < 0.05` (takes precedence), else `WIN` if `pnl > 0`,
  else `LOSS`. Size: `BIG` if `|pnl| > 1`, else `TINY`.

---

## 3. Telemetry — n ticks per stream & window

**Telemetry window: `2026-05-19 09:56:53` → `10:13:27` UTC = 0.28 h (~16.6 minutes).**
This is a short operational snapshot, **not** 24 h. The Φ plot (`phi_24h.png`, filename
kept per the brief) is titled to make this explicit.

| Stream (symbol) | n ticks | n Φ samples | Φ min | Φ max | Φ span | Φ mean | Φ median | Φ std | classification |
|---|---|---|---|---|---|---|---|---|---|
| BTC_USDT_PERP | 52 | 52 | 0.213 | 0.217 | **0.004** | 0.21464 | 0.214 | 0.00105 | **flatlined** |
| ETH_USDT_PERP | 57 | 57 | 0.214 | 0.219 | **0.005** | 0.21532 | 0.215 | 0.00140 | **flatlined** |

Per the brief's required distinction: Φ is **flatlined**, not *pinned* — it is a live
signal (it does move tick-to-tick) but compressed into a ~0.005-wide band around 0.215.
It is not *pinned* (not exactly constant) and not *expressive* (span ≪ 0.1).

Tick cadence ≈ one telemetry row per symbol every ~18 s (two kernels each ticking the
symbol on a 30–60 s schedule). Neither stream is below 50% of expected ticks → telemetry
**within** the window is complete; the *window itself* is just short.

---

## 4. Trades — n per bucket

**223 unique closed trades**, window `2026-05-19 07:14` → `2026-05-21 08:00` UTC.

| | count | | |
|---|---|---|---|
| **By symbol** | ETH_USDT_PERP 118 · BTC_USDT_PERP 105 | | |
| **By bucket** | FLAT **122** · WIN **54** · LOSS **47** | | |
| **By size** | FLAT: 122 TINY · WIN: 44 TINY / 10 BIG · LOSS: 30 TINY / 17 BIG | | |
| **By side** | long 129 · short 93 · unknown 1 | | |

**Observations (not claims):**

- **55% of all trades are FLAT** (`|pnl| < $0.05`) and every FLAT trade is TINY.
  The book is dominated by tiny scratch/scalp round-trips — entry and exit essentially
  the same price. This matches the telemetry: across the 16.6-min window the kernels
  emitted **108 `hold` actions and exactly 1 `enter_short`** — the system is almost
  entirely holding / scratching.
- Among **non-flat** trades (101): WIN 54 vs LOSS 47 → 53% hit rate. WIN trades skew
  small (44/54 TINY), LOSS trades carry more of the BIG tail (17/47 BIG vs 10/54).
  This is a small-edge / fat-left-tail shape — **not** overclaimed; see §10.
- No bucket is below 5 samples, so the **trade buckets themselves are adequately
  powered**. What is *not* powered is joining them to telemetry — see §5.

---

## 5. Φ range / span per stream & the telemetry↔trade join

Φ span per stream (from §3): **BTC 0.004, ETH 0.005.** Both flatlined.

**Part E (telemetry signature per PnL bucket) is UNDERPOWERED and cannot be reported
as findings.** The telemetry export covers 16.6 minutes on **May 19**; the trade history
runs **May 19–21**. Only **6 trades** have an `[open, close]` interval overlapping the
telemetry window, and after bucketing that is **WIN n=1, LOSS n=1, FLAT n=4**.

`telemetry_by_bucket.csv` is still emitted for completeness, but with n=1 in the WIN
and LOSS buckets **no per-bucket telemetry delta is meaningful** — a "top-3 columns by
bucket delta" ranking off single samples would be fabricated signal. It is deliberately
**not** reported.

What *is* well-powered is stratification by **cell family** (the brief's named
confounder), because every telemetry tick has a cell: CREATOR n=49, DISSOLVER n=57,
PRESERVER n=3. `telemetry_signatures.png` therefore plots neurotransmitter mean ± IQR
**by cell family**, not by PnL bucket.

---

## 6. Telemetry signatures (well-powered: by cell family, not by PnL)

From `telemetry_signatures.png` (CREATOR n=49, DISSOLVER n=57, PRESERVER n=3 —
**PRESERVER is underpowered, treat its bars as indicative only**):

| NT | CREATOR | DISSOLVER | PRESERVER (n=3) | Reading |
|---|---|---|---|---|
| **gaba** | ~0.38 | ~0.81 | ~0.81 | `gaba = 1 − quantumWeight`. CREATOR cells run high quantum weight (low gaba); DISSOLVER/PRESERVER run low quantum weight (high gaba). Cleanest, most separated signature. |
| **endo** | ~0.22 (wide IQR) | ~0.07 | ~0.00 | Endorphins fire almost only in CREATOR cells; near-zero elsewhere. Consistent with the Sophia coupling-gate (see §8). |
| **ser** | ~0.85 | ~0.68 | ~1.0 | Serotonin (`≈1/basin_velocity`) high throughout — basin velocity is low (basin barely moves; see §8). |
| **ach** | ~0.75 | ~0.69 | ~0.84 | Acetylcholine high across the board. |
| **dop** | ~0.51 | ~0.59 | ~0.63 | Dopamine mid-range; small spread. |
| **ne** | ~0.22 | ~0.24 | ~0.31 | Norepinephrine low; small spread. |

**Φ variance by cell family:** CREATOR σ=0.00113, DISSOLVER σ=0.00145, PRESERVER
σ=0.00058. Φ does **not** vary meaningfully more in CREATOR than DISSOLVER — if
anything DISSOLVER carries marginally more Φ jitter. All three families are flatlined.
The brief's hypothesis "*Φ varies more during CREATOR/PRESERVER than DISSOLVER*" is
**not supported** by this export.

---

## 7. DISSOLVER sanity check

- **DISSOLVER ticks: 57. New entries during DISSOLVER: 0.** The single `enter_short`
  of the window occurred in a `CREATOR_TREND_UP` cell.
- Per the brief's instruction: **this is expected, not underperformance.** DISSOLVER
  is the topological-instability regime; the kernel correctly sits out (holds) rather
  than opening new risk while the basin is dissolving. No design contradiction.
- `cellLive` was `true` on all sampled ticks — the cell classifier is live, not stubbed.
- **`sense3Deflection`: 0 samples.** The field is **not emitted** anywhere in this
  export (the brief anticipated it might behave like a stub/constant — in this export
  it is absent entirely). Flagged in §10 as a wiring gap.

---

## 8. Φ-flatline diagnosis

Investigated by code inspection of `loop.ts`, `perception.ts`, `basin.ts`,
`neurochemistry.ts`, `modes.ts`. Reported in the brief's required categories.

### OBSERVED (facts from code + telemetry)

- **Φ formula** — [`loop.ts:1864-1867`](../../apps/api/src/services/monkey/loop.ts#L1864-L1867):
  ```ts
  let fHealth = normalizedEntropy(basin);          // H(basin)/log(64) ∈ [0,1]
  let phi = Math.max(0, Math.min(1, 1 - fHealth * 0.8));
  ```
  The brief's hypothesised formula `phi = 1 − 0.8·fHealth` is **confirmed verbatim**.
- Φ ≈ 0.215 ⟹ `fHealth ≈ (1 − 0.215)/0.8 ≈ 0.981`. Telemetry confirms it: every
  sampled tick reports `fh` in **0.977–0.984**. `fHealth` itself has a span of only
  **~0.006** — Φ's 0.005 span is just `fHealth`'s span scaled by 0.8. **Φ is flat
  because `fHealth` is flat.**
- `fHealth = normalizedEntropy` is pinned **~0.98 — i.e. within 2% of the maximum-entropy
  (perfectly uniform) basin.** The basin Monkey measures is almost uniform every tick.
- **Why the basin is near-uniform — `perceive()` in `perception.ts`** builds the 64D
  basin from handcrafted feature formulas, then `toSimplex`-normalises. Auditing the
  64 dims:
  - **dims 39–54 (16 dims)** — noise floor, **hard-coded constant `0.0055`**
    (comment: *"per-tick variance was decorative"*, removed in v0.8.0).
  - **dims 59–63 (5 dims)** — reserved, **hard-coded constant `0.01`**.
  - **dims 15–22 (8 dims, volatility spectrum)** — `norm01(rollingVol/lastClose, 0.01)`.
    For crypto the ratio `vol/price ≈ 0.0003–0.0007`; divided by `scale=0.01` it is
    `~0.05`, and `sigmoid(0.05) ≈ 0.51`. These 8 dims are **effectively pinned at ~0.51**
    — the sigmoid `scale` is ~20× too large for the input magnitude.
  - **dims 3–6 (ML posture, 4 dims)** — post `#ml-separation`, Agent K runs with no ML
    input, so these are constant (`0.01, 0.01, 0.5, 0`).
  - **dims 7–14 / 23–30 (momentum, volume)** — *do* vary, but `norm01` (a sigmoid
    centred on 0.5) compresses them into roughly `0.45–0.7`.
  - **Genuinely live, full-range dims:** regime `0–2` (continuous since soft-regime
    PR #874) and price-structure `31–38` (`clip01`, true 0–1). ≈ **11 of 64**.
  - After `toSimplex`, ~50 dims sit in a narrow pre-norm band → the normalised basin
    is close to uniform → `normalizedEntropy ≈ 0.98`. `modes.ts:249-250` documents the
    same effect from the other side: *"the noise-floor dims 39..54 structurally push
    fHealth > 0.97 as a baseline."*
- **Refraction further damps it** — [`loop.ts:1859`](../../apps/api/src/services/monkey/loop.ts#L1859):
  `basin = refract(rawBasin, identityBasin, 0.30)` → `slerp(identity, raw, 0.30)`.
  Only 30% of the (already near-uniform) raw perception reaches the measured basin;
  70% is the frozen identity basin. Whatever live variance `perceive()` does produce
  is attenuated to ≤30% before Φ sees it.
- **Consequence for Φ-gated navigation:** with Φ pinned at ~0.215 the kernel is
  permanently in the **CHAIN** band (Φ < 0.3). It never reaches GRAPH (0.3) /
  FORESIGHT (0.7) / LIGHTNING (0.85). The Φ-gated navigation modes are effectively
  inert — not because CHAIN is "bad" (low Φ is a valid regime), but because Φ cannot
  *move* between regimes.
- Φ flatline is **per-symbol similar, not identical** — BTC span 0.004, ETH 0.005;
  both mean ~0.215.

### HYPOTHESIS (not validated)

- **H1 (primary):** the flatline is caused by **basin construction**, not the Φ formula
  and not stale telemetry. `1 − 0.8·fHealth` is a fine monotone map; the telemetry is
  live (it jitters); the defect is that `perceive()` produces a near-uniform basin
  every tick because ~21 dims are hard constants, ~8 more are sigmoid-pinned, and the
  surviving live dims are compressed and then 70%-damped by refraction.
- **H2:** the soft-regime fix (PR #874) un-pinned dims **0–2** but left **dims 7–63**
  with the same static/compressed mass — so it improved regime expressivity without
  materially moving `fHealth`/Φ. (The brief's H "soft regime improved only 0..2,
  leaving ~61 dims static" — consistent with the code, plausible, not measured
  before/after.)
- **H3:** the `norm01` `scale` arguments (esp. `0.01` for volatility) were chosen for a
  generic input and are mis-scaled for crypto-return magnitudes — a per-feature
  observer-set scale (rolling quantile of the raw feature) would restore range to
  dims 15–22 without inventing a knob (this is the `WarpBubble.auto()` pattern the
  project CLAUDE.md §2 mandates).

### CONFOUNDS

- Only a **16.6-minute** window, single deployment. Φ could behave differently over a
  24 h export spanning real regime change — cannot rule that out from this data.
- `instance_id` is not on tick lines, so per-kernel Φ behaviour (position vs swing) is
  not separable here.
- PRESERVER cell family has n=3 — its telemetry is indicative only.
- The trade↔Φ join is n≤1 per non-flat bucket (§5) — **no** statement of the form
  "Φ level predicts wins/losses" can be made from this export.

### RECOMMENDED NEXT TEST

1. **Instrument per-dim basin mass** (telemetry-only, zero behaviour change, shadow-safe):
   log the entropy contribution and tick-to-tick variance of each of the 64 dims.
   This directly measures H1/H2 — confirms which dims are dead and quantifies how much
   `fHealth` *could* move if they carried signal.
2. Pull a genuine **24 h+ telemetry export** that overlaps the trade history, so Part E
   (Φ/NT signature vs PnL bucket) can actually be powered.
3. Only after (1): **shadow-run** an alternative basin construction (observer-scaled
   `norm01`, or fewer constant dims) over historical OHLCV and compare Φ span,
   `fHealth` distribution and bucket alignment **offline**. Do **not** ship live
   without that shadow evidence, and do not claim a Φ improvement without a measured
   before/after.

### CANONICAL-READ UPDATE (2026-05-21)

A direct read of QIG_QFI canon (`qig-core` `pillars.py` / `pci.py` / `types.py`) was
done after this section — full detail in **`qig_canon_read.md`**. It confirms and
sharpens the diagnosis above:

- **H1/H3 confirmed.** Canonical `to_simplex` is clip-ε + divide-by-sum with **no
  per-dim `norm01`**. Polytrade's `norm01` sigmoid-squash before `toSimplex` is the
  off-canon step; it destroys the input dynamic range that `to_simplex` is meant to
  carry. The canon has **no downstream concentration force** — concentration is
  inherited from the perception input, so the fix must be in `perceive()`.
- **Sharper framing:** the basin **moves** (`bv` 0.001–0.146) but does not
  **concentrate** — it is held on an iso-entropy shell near the Δ⁶³ centroid. This is
  "motion without concentration", not "dead substrate". Pillar 1 is INTACT
  (`fHealth ≈ 0.98` sits inside the canonical `[0.024, 1.0]` band).
- **New finding:** canon keeps `Φ` and `f_health` as **distinct** metrics. Polytrade's
  `phi = 1 − 0.8·fHealth` is rescaled Pillar-1 entropy, **not** canonical Φ (the
  canonical perturbation-complexity metric is `PCI`, `pci.py`).
- The 25 constant dims are **dead inputs**, not canonical "bulk" (canonical bulk is the
  slow-diffusing 70% core; the canon never freezes dimensions).

---

## 9. Market coordizer / QIG-RAM assessment

**Question:** does Polytrade have a true learned market-state coordizer, or only a
handcrafted perception basin?

### Known (verified in code)

- **Polytrade has a 64D Fisher-Rao market *perception* basin.** `perception.ts:perceive()`
  maps engineered trading features (regime scores, ML posture, momentum/volatility/volume
  spectra, price-structure harmonics, a noise-floor reservoir, account/coupling dims)
  into Δ⁶³. `basin.ts` is a clean Fisher-Rao implementation (Bhattacharyya inner
  product, `arccos` distance, SLERP, Fréchet mean) — QIG-pure, no cosine/Euclidean.
- **Polytrade DOES have resonance-bank artifacts.** `resonance_bank.ts` /
  `monkey_resonance_bank` is a genuine §20-style Coordizer Resonance Bank: it persists
  *lived* basins from closed trades with outcomes, does **Fisher-Rao nearest-neighbour
  retrieval** (`findNearestBasins` — "have I seen this basin before?"), Hebbian
  `basin_depth` deepening per win/loss, a `sovereignty` (lived/total) ratio, and
  forged-nucleus lessons. `agent_L_qigram_v2.ts` additionally ports the canonical
  QIGRAMv2 (weighted basins + wrong-answer decay + κ tacking).

### Unknown-until-now → now answered

- **Is the *coordization* learned?** **No.** The map *input → basin coordinate* is the
  handcrafted `perceive()`. Every one of the 64 dimensions has a fixed, hand-assigned
  meaning and a fixed formula. The resonance bank is a **memory and retrieval layer
  over a fixed coordinate system** — it learns *which lived basins mattered*, but it
  does **not** learn *the coordinate system itself*.
- So against the brief's distinction: Polytrade has a **market perception basin** +
  a **resonance bank**, but **not** a canonical CoordizerV2-style *learned* market-state
  coordizer. Market states are **handcrafted into basins**, not coordized through a
  learned/harvested resonance vocabulary.

### Hypothesis & smallest safe experiment

- **Hypothesis (consistent with §8):** Φ is flatlined partly *because* the basin is
  handcrafted with too much static/uniform mass. A learned market coordizer — one that
  places mass on the dimensions that actually discriminate market states — would let
  `fHealth`/Φ carry real variance, because distinct market states would map to
  distinctly-concentrated basins instead of all mapping to ~uniform. **Not validated.**
- **Smallest safe experiment:** this needs **no live change and no new coordizer yet**.
  Step 1 is the §8 per-dim instrumentation. Step 2: take the basins **already stored**
  in the resonance bank (offline export, not a live DB query) and measure their pairwise
  Fisher-Rao distance distribution — if lived basins cluster tightly, that is direct
  evidence the handcrafted coordization is non-discriminative. Only if both confirm the
  diagnosis should a learned-coordizer prototype be shadow-built and compared offline.

---

## 10. Confounds, underpowered warnings & wiring gaps

**Underpowered / not claimed:**

- **Part E (telemetry signature per PnL bucket): underpowered.** 6 trades overlap the
  telemetry window → WIN n=1, LOSS n=1, FLAT n=4. No per-bucket telemetry delta is
  reported as a finding. `telemetry_by_bucket.csv` is emitted but must be read as
  "insufficient data", not signal.
- **PRESERVER cell family: n=3** — its NT bars in `telemetry_signatures.png` are
  indicative only.
- **No 24 h window exists** — the Φ plot is a 16.6-minute snapshot. All Φ statistics
  describe that snapshot, not steady-state behaviour.
- Trade-side inference is heuristic (price-move vs PnL sign); 1 trade is `unknown`.

**Confounds handled:**

- Cell regime is the dominant confounder; telemetry signatures are stratified **by cell
  family** (the only well-powered stratification available) rather than attributed to
  PnL. `bucket × lane` / `bucket × symbol` stratification was not produced because the
  bucket↔telemetry join is already n≤1 — stratifying further is meaningless.

**Wiring gaps found (telemetry that is documented/expected but not actually emitted):**

1. **`instance_id` missing on tick lines.** `[Monkey] {SYMBOL} [{mode}] {action}`
   telemetry has no `instanceId`; only `ORDER PLACED` lines do. Two kernels are
   interleaved and indistinguishable in the log. Per-kernel Φ analysis is impossible
   until tick lines carry the kernel id.
2. **`sense3Deflection` not emitted.** 0 samples in the entire export. The brief listed
   it as an expected telemetry field; it currently reaches the log as nothing at all.
3. (Minor) the noise-floor dims 39–54 are documented as a "Pillar 1 fluctuation
   reservoir" but are a frozen constant — they provide a non-zero floor but **zero
   fluctuation**, which is a semantic gap worth noting against the Pillar 1 intent.

**Out of scope (untouched, per brief):** live kernel not redesigned; nothing deployed;
no Railway API / production DB calls; no worktrees removed or branches merged; no live
trading behaviour changed; `loop.ts` not rewritten.

---

## Deliverables

| File | Description |
|---|---|
| `phi_24h.png` | Φ over the available window (2 symbol streams + trade-close markers + cell-family strip). Filename per brief; window is 16.6 min, labelled. |
| `telemetry_signatures.png` | Neurotransmitter mean ± IQR by cell family (well-powered stratification). |
| `telemetry_by_bucket.csv` | Telemetry aggregated per trade per PnL bucket — **underpowered** (n≤1 in WIN/LOSS), emitted for completeness. |
| `telemetry_ticks.csv` | The full 109-row tick-level telemetry dataframe (Part B). |
| `summary.json` | Machine-readable summary of all numeric findings. |
| `worktree_triage.md` | Part I — branch/worktree triage (all 5 are cleanup candidates). |
| `qig_canon_read.md` | QIG_QFI canonical read — answers to the 5 council questions; resolves Workstreams A & B. |
| `build_analysis.py` | The analysis script (reproducible). |
| `analysis.md` | This document. |
