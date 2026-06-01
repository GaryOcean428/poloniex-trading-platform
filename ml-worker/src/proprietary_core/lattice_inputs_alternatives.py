"""
lattice_inputs_alternatives.py — CAL-2: J primitive candidates for qig_warp.

Context: The standard J = |mean/std| is O(0.01–0.1) on crypto log-returns,
giving h/J ≈ 300 >> DISORDERED threshold 3.65 → 100% DISORDERED → always HOLD.

Goal: J primitive natively O(1) on returns, discriminating across market states
(CREATOR = trending/coherent, PRESERVER = critical/transitional,
DISSOLVER = noise/random-walk).

All functions:
  - Take ``returns: np.ndarray`` (1D log-return array, length N >= 2)
  - Return float in a natural range that brackets the TFIM critical ratio
    [2.435, 3.653] when paired with Shannon entropy h of the same returns.
  - Are pure (no side effects, no state).
  - Handle edge cases (empty, all-zero, NaN).
"""

from __future__ import annotations

import numpy as np


def hurst_exponent(returns: np.ndarray, min_n: int = 20) -> float:
    """Hurst exponent via Rescaled Range (R/S) analysis.

    H in [0, 1]:
      H > 0.5 → persistent / trending (high coupling, CREATOR-like)
      H ≈ 0.5 → random walk (Brownian motion, PRESERVER-like)
      H < 0.5 → mean-reverting / anti-persistent (DISSOLVER-like)

    Returns 0.5 (neutral / random walk) when insufficient data or degenerate
    input (all-zero, NaN). min_n is a SAFETY_BOUND — P25 compliant minimum
    sample threshold.

    The R/S method computes the ratio of (max cumulative deviation − min
    cumulative deviation) to the standard deviation over multiple sub-series
    lengths, then fits the scaling exponent via OLS on log-log space.
    """
    n = len(returns)
    if n < min_n:
        return 0.5
    clean = returns[np.isfinite(returns)]
    if len(clean) < min_n:
        return 0.5
    std_total = float(np.std(clean))
    if std_total < 1e-15:
        return 0.5

    # Compute R/S for each sub-series length from 4 to n//2.
    lags = []
    rs_values = []
    for lag in range(4, max(5, len(clean) // 2 + 1)):
        n_chunks = len(clean) // lag
        if n_chunks < 1:
            continue
        rs_per_chunk = []
        for i in range(n_chunks):
            chunk = clean[i * lag:(i + 1) * lag]
            if len(chunk) < 2:
                continue
            mean_c = float(np.mean(chunk))
            dev = np.cumsum(chunk - mean_c)
            r = float(np.max(dev) - np.min(dev))
            s = float(np.std(chunk))
            if s > 1e-15:
                rs_per_chunk.append(r / s)
        if rs_per_chunk:
            lags.append(float(lag))
            rs_values.append(float(np.mean(rs_per_chunk)))

    if len(lags) < 4:
        return 0.5

    log_lags = np.log(lags)
    log_rs = np.log([max(1e-15, v) for v in rs_values])
    # OLS slope = Hurst exponent.
    try:
        coeffs = np.polyfit(log_lags, log_rs, 1)
        h = float(np.clip(coeffs[0], 0.0, 1.0))
    except Exception:
        return 0.5
    return h


def lag1_autocorrelation(returns: np.ndarray) -> float:
    """Absolute lag-1 autocorrelation of returns.

    |ρ₁| in [0, 1]:
      High → short-horizon serial coherence (trending / momentum, CREATOR-like)
      Low → each return is independent of the last (noise, DISSOLVER-like)

    Returns 0.0 (no autocorrelation) when insufficient data or degenerate input.
    Minimum N=3 is a SAFETY_BOUND (P25 compliant).
    """
    n = len(returns)
    if n < 3:
        return 0.0
    clean = returns[np.isfinite(returns)]
    if len(clean) < 3:
        return 0.0
    x = clean[:-1]
    y = clean[1:]
    x_std = float(np.std(x))
    y_std = float(np.std(y))
    if x_std < 1e-15 or y_std < 1e-15:
        return 0.0
    rho = float(np.mean((x - np.mean(x)) * (y - np.mean(y))) / (x_std * y_std))
    return float(min(1.0, abs(rho)))


def efficiency_ratio(prices_or_returns: np.ndarray) -> float:
    """Kaufman Efficiency Ratio (ER): directional efficiency of the price path.

    ER = |net change| / Σ|step changes| in [0, 1]:
      ER → 1.0  perfectly directional (trending, CREATOR-like)
      ER → 0.0  random walk / choppy (noisy, DISSOLVER-like)
      ER ≈ 0.3–0.7  transitional (PRESERVER-like)

    Input can be either prices (N >= 2) or returns (converted to a cumulative
    price series starting at 1.0). Handles edge cases by returning 0.0.
    Minimum N=2 is a SAFETY_BOUND (P25 compliant).

    This is the **recommended J candidate** (see docs/cal-2-j-reparameterization-
    results.md): naturally O(0–1), interpretable, no free parameters, aligns
    with TFIM order parameter interpretation (high coupling = directional),
    and discriminates CREATOR / PRESERVER / DISSOLVER without additional tuning.
    """
    n = len(prices_or_returns)
    if n < 2:
        return 0.0
    clean = prices_or_returns[np.isfinite(prices_or_returns)]
    if len(clean) < 2:
        return 0.0
    # Treat input as prices (could be log-prices or cumulative returns).
    net_change = abs(float(clean[-1]) - float(clean[0]))
    step_changes = float(np.sum(np.abs(np.diff(clean))))
    if step_changes < 1e-15:
        return 0.0
    return float(min(1.0, net_change / step_changes))


def r_squared_trend(prices: np.ndarray) -> float:
    """R² of OLS linear fit of log-prices over time.

    R² in [0, 1]:
      R² → 1.0  price evolves close to a linear trend in log-space (CREATOR-like)
      R² → 0.0  price deviates wildly from any trend (DISSOLVER-like)

    Input should be raw prices (not log-returns). Returns 0.0 on insufficient
    data or degenerate input. Minimum N=3 is a SAFETY_BOUND (P25 compliant).
    """
    n = len(prices)
    if n < 3:
        return 0.0
    clean = prices[np.isfinite(prices) & (prices > 0)]
    if len(clean) < 3:
        return 0.0
    log_prices = np.log(clean.astype(float))
    t = np.arange(len(log_prices), dtype=float)
    # OLS fit of log_prices ~ t
    t_mean = float(np.mean(t))
    lp_mean = float(np.mean(log_prices))
    ss_tot = float(np.sum((log_prices - lp_mean) ** 2))
    if ss_tot < 1e-15:
        return 0.0
    ss_res = float(np.sum(
        (log_prices - (lp_mean + np.polyfit(t, log_prices, 1)[0] * (t - t_mean))) ** 2
    ))
    # Equivalent cleaner form:
    try:
        slope, intercept = np.polyfit(t, log_prices, 1)
        fitted = slope * t + intercept
        ss_res_clean = float(np.sum((log_prices - fitted) ** 2))
        r2 = float(max(0.0, 1.0 - ss_res_clean / ss_tot))
    except Exception:
        r2 = 0.0
    return float(min(1.0, r2))


def spectral_entropy_ratio(returns: np.ndarray) -> float:
    """1 − normalised spectral entropy of the return power spectrum.

    Result in [0, 1]:
      High (→ 1.0) → power concentrated in few frequencies (trending, CREATOR-like)
      Low  (→ 0.0) → power spread uniformly across all frequencies (noise, DISSOLVER-like)

    Uses Welch's method (periodogram fallback when N < 256). Returns 0.0 on
    insufficient data. Minimum N=8 is a SAFETY_BOUND (P25 compliant).
    """
    n = len(returns)
    if n < 8:
        return 0.0
    clean = returns[np.isfinite(returns)]
    if len(clean) < 8:
        return 0.0
    # Periodogram via FFT.
    fft_vals = np.fft.rfft(clean - float(np.mean(clean)))
    psd = np.abs(fft_vals) ** 2
    psd_sum = float(np.sum(psd))
    if psd_sum < 1e-15:
        return 0.0
    probs = psd / psd_sum
    probs = probs[probs > 0]
    spectral_entropy = float(-np.sum(probs * np.log(probs)))
    # Normalise by maximum possible entropy (uniform over all bins).
    max_entropy = float(np.log(len(psd)))
    if max_entropy < 1e-15:
        return 0.0
    normalised = float(np.clip(spectral_entropy / max_entropy, 0.0, 1.0))
    # Invert: 1 = concentrated (high coupling), 0 = diffuse (noise).
    return float(1.0 - normalised)
