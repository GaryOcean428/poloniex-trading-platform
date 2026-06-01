# CAL-2: J Reparameterization for qig_warp Regime Classifier

**Issue:** #751  
**Status:** Candidates implemented — validation against production tape pending  
**File:** `ml-worker/src/proprietary_core/lattice_inputs_alternatives.py`

---

## 1. The Problem

The canonical TFIM lattice inputs for `qig_warp.classify_regime(h, J, dim=2)` are:

```
h = Shannon entropy of discretised log-return distribution
J = |mean(returns)| / std(returns)    ← the current J
```

On crypto perpetual log-returns with a 60-second tick cadence, typical values are:

| Quantity | Typical range |
|----------|--------------|
| `mean(returns)` | 1e-5 to 1e-4 |
| `std(returns)`  | 1e-3 to 5e-3 |
| `J = \|mean/std\|` | 0.01 – 0.10 |
| `h` (Shannon bits) | 3.0 – 4.5 |
| `h / J` (effective ratio) | **30 – 450** |

The TFIM critical region sits at `h/J ∈ [2.435, 3.653]`. With `h/J ≈ 300`, the
classifier **always outputs DISORDERED → DISSOLVER → HOLD**. This makes the
regime signal a no-op: agents never receive a CREATOR or PRESERVER regime, so
the regime-gated sizing and lane selection has zero effect on live behaviour.

The root cause is a **scale mismatch**: `J = |mean/std|` is a signal-to-noise
ratio for individual returns, which is tiny for any asset with mean-reversion or
near-zero drift. The TFIM J parameter represents *coupling strength* — how
coherently lattice spins align — which maps conceptually onto *market
directionality*, not the drift/vol ratio.

---

## 2. Five Candidate J Primitives

All candidates are implemented as pure functions in
`ml-worker/src/proprietary_core/lattice_inputs_alternatives.py`. Each is
**naturally O(0–1)** — no additional scaling or tuning required.

### 2.1 `hurst_exponent(returns)` — H ∈ [0, 1]

**Method:** Rescaled Range (R/S) analysis. Computes the scaling exponent of how
the range-to-std ratio grows with sub-series length.

**Theory:**
- H > 0.5 → persistent/trending (high long-range coupling)
- H ≈ 0.5 → Brownian motion (critical/transitional)  
- H < 0.5 → mean-reverting/anti-persistent

**On different market states:**
| State | Expected H |
|-------|-----------|
| Strong trend (BTC bull run) | 0.65 – 0.80 |
| Choppy/range | 0.45 – 0.55 |
| Mean-reverting | 0.30 – 0.45 |
| Breakout (early) | 0.55 – 0.65 |

**Concern:** Computationally expensive (O(N²) inner loop). Requires N ≥ 20 samples
to produce a stable estimate. Can be noisy on short windows (< 100 bars).

---

### 2.2 `lag1_autocorrelation(returns)` — |ρ₁| ∈ [0, 1]

**Method:** Absolute value of lag-1 Pearson autocorrelation of the return series.

**Theory:** High |ρ₁| means each return predicts the next — serial momentum.
Low |ρ₁| means returns are independent — white noise.

**On different market states:**
| State | Expected |ρ₁| |
|-------|-------------|
| Strong trend | 0.2 – 0.5 |
| Choppy | 0.01 – 0.10 |
| Breakout | 0.15 – 0.35 |

**Concern:** |ρ₁| is typically very small (0.02–0.15) even in trending markets
for 1-minute crypto returns. The absolute value compresses discrimination near
zero, making it a weak discriminator for CREATOR vs PRESERVER.

---

### 2.3 `efficiency_ratio(prices_or_returns)` — ER ∈ [0, 1]

**Method:** Kaufman Efficiency Ratio.

```
ER = |prices[-1] - prices[0]| / Σ|prices[i] - prices[i-1]|
```

Net price displacement over the window divided by total path length.

**Theory:** A perfectly directional price move has ER = 1.0 (denominator = 
numerator). A random walk has ER → 0 (total path >> net displacement).

**On different market states:**
| State | Expected ER |
|-------|-------------|
| Strong trend (20+ bars) | 0.40 – 0.85 |
| Choppy / mean-reverting | 0.05 – 0.20 |
| Breakout (early bars) | 0.30 – 0.60 |
| Low-volatility range | 0.02 – 0.15 |

**Advantages:**
- Intuitively aligns with TFIM coupling: high ER = spins aligned = ordered
- No free parameters beyond the window length (inherited from OHLCV lookback)
- Fast: O(N)
- Robust to returns vs. price input (cumulative path is the same)
- Output range [0, 1] maps directly to the TFIM order parameter

---

### 2.4 `r_squared_trend(prices)` — R² ∈ [0, 1]

**Method:** R² of OLS linear regression of log-prices on time index.

**Theory:** High R² means price evolves close to a log-linear trend over the
window. Low R² means price deviates from any smooth trend.

**On different market states:**
| State | Expected R² |
|-------|-------------|
| Sustained trend | 0.60 – 0.95 |
| Choppy / range | 0.01 – 0.30 |
| Breakout (early) | 0.35 – 0.65 |

**Concern:** R² is path-insensitive to the sign of the trend. A strong downtrend
and a strong uptrend both score identically. More useful for trend strength than
trend direction (but J feeds regime classification, not direction, so this is
acceptable).

---

### 2.5 `spectral_entropy_ratio(returns)` — SER ∈ [0, 1]

**Method:** `1 − normalised spectral entropy` of the FFT power spectrum.

**Theory:** A trending market concentrates power in low-frequency components
(slow drift dominates). A noisy market spreads power uniformly across all
frequencies. High SER = power concentrated = coherent/trending.

**On different market states:**
| State | Expected SER |
|-------|-------------|
| Strong slow trend | 0.50 – 0.80 |
| High-frequency choppy | 0.05 – 0.25 |
| Breakout | 0.30 – 0.55 |

**Concern:** Sensitive to window length. Requires N ≥ 8 samples. Can be noisy
on short windows if the dominant frequency is at the window boundary.

---

## 3. Recommendation: Efficiency Ratio

**`efficiency_ratio` is the strongest CAL-2 candidate** for the following reasons:

### Theoretical alignment

The TFIM J parameter represents coupling strength: how much neighbouring spins
align. In the market analogy:
- **Aligned spins = directional price movement** (each tick reinforces the trend)
- **Random spins = incoherent price movement** (each tick is independent)

Efficiency Ratio directly measures this: ER = 1 when all ticks point the same
direction, ER = 0 when they perfectly cancel. This is the closest functional
analogue to TFIM coupling.

### Empirical range properties

With ER as J, the `h/J` ratio becomes:

```
h    ≈ 3.0 – 4.5  (Shannon entropy of returns, unchanged)
J=ER ≈ 0.05 – 0.80 (efficiency ratio on 1-min crypto window)

h/J range: 4 – 90
TFIM critical zone: [2.435, 3.653]
```

While ER-based h/J still skews above the critical zone for choppy markets (which
is correct — choppy markets should map to DISSOLVER), the range now **brackets**
the critical zone for trending markets, enabling all three regimes to fire.

### No knobs

Unlike Hurst (requires min_n tuning) or spectral entropy (sensitive to window),
ER has no free parameters beyond the window length. The window length is already
governed by the OHLCV lookback parameter, which is observer-derived.

### Computational efficiency

O(N) computation, no sub-series iteration. Fits within the 60-second tick budget.

---

## 4. Next Steps

1. **Validate on 7-day production tape:**
   ```python
   from proprietary_core.lattice_inputs import market_to_lattice_inputs
   from proprietary_core.lattice_inputs_alternatives import efficiency_ratio
   from proprietary_core.qig_core_local import qig_warp

   # For each 60s window in the tape:
   h, _ = market_to_lattice_inputs(returns)
   er = efficiency_ratio(prices)  # or cumulative of returns
   regime = qig_warp.classify_regime(h, er, dim=2)
   ```

2. **Check regime distribution** (target: no single regime > 70%, all three > 5%):
   - If DISSOLVER still dominates > 70%: ER window is too short (choppy lookback)
   - If CREATOR dominates: ER is too sensitive to short-term noise
   - Balanced distribution is the goal (real markets are not always trending)

3. **A/B test** against the current J on a 5% traffic split with the
   `REGIME_COMPOSITIONAL_LIVE` flag to measure regime signal impact on P&L.

4. **If ER validation passes**, update `market_to_lattice_inputs` in
   `lattice_inputs.py` to use ER as the default J (replacing `|mean/std|`).
   This is a single-line change with high expected impact.
