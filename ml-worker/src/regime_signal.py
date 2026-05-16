"""regime_signal.py — pure tiebreaker + regime→direction mapper.

Extracted from main.py 2026-05-16 so the pure functions can be unit-
tested without dragging the full ml-worker import chain (pandas,
FastAPI, sklearn, TF, etc.).

These two functions decide the BULLISH / BEARISH / NEUTRAL signal
direction for the v0.8 StrategyLoop path. Live bug 2026-05-16T11:19Z:
ETH was visibly bearish on 15m (4% drop over ~3h, 14/16 long-side
confirmation indicators ✗) but ML emitted ``BUY dir=bullish`` because
the prior ``strongest_recent_change`` returned the FIRST window that
cleared its noise floor, not the LARGEST-magnitude move. On a tape
that just dropped 4% and then consolidated with a 0.5% micro-bounce
in the last 3 bars, the 3-bar bounce won over the 15-bar drop.

Post-fix: ``strongest_recent_change`` returns the SIGNED change of
the cleared window with the LARGEST |change|. A 15-bar -2% drop now
correctly dominates a 3-bar +0.5% bounce. Sustained moves > micro
bounces. Direction-blindness on consolidation-after-trend resolved.
"""

from __future__ import annotations


# (window_bars, noise_floor) — per-window minimum |change| to count.
# Floors calibrated so each window has roughly the same probability
# of false-firing on quiet data. Order is informational only now
# (was load-bearing pre-fix when "first match" semantics applied).
_PROBE_WINDOWS: tuple[tuple[int, float], ...] = (
    (3, 0.005),   # fast — 3 bars at 15m = 45min
    (5, 0.005),   # slightly slower acute moves
    (10, 0.007),  # medium drift
    (15, 0.01),   # sustained drift
)


def strongest_recent_change(prices: list[float]) -> float:
    """Multi-window recent-action probe for the regime tiebreaker.

    Patched 2026-05-15T06:50Z: multi-window probe replacing the
    single 10-bar/±1%.

    Re-patched 2026-05-16 (issue trace): switched from "first cleared
    window wins" to "largest |change| wins" among cleared windows.

    Why the change: "first match" with the windows ordered shortest-
    first meant a tiny fresh bounce always beat a sustained move. On
    a 4% drop followed by 3 bars of 0.5% consolidation, the 3-bar
    +0.005 bounce returned as the "fresh decisive change" — when the
    15-bar -0.02 drop was the actual dominant signal. Largest-
    magnitude correctly identifies the dominant move: if the 15-bar
    -2% drop is bigger than any cleared shorter window's bounce, the
    drop is the answer.

    Returns 0.0 when no window clears its floor → tiebreaker is a
    no-op and ``regime_to_direction`` falls through to the regime-
    class verdict.
    """
    if len(prices) < 4:
        return 0.0
    best_signed_change = 0.0
    best_magnitude = 0.0
    for n, floor in _PROBE_WINDOWS:
        if len(prices) <= n:
            continue
        start = prices[-(n + 1)]
        if start <= 0:
            continue
        change = (prices[-1] - start) / start
        mag = abs(change)
        if mag >= floor and mag > best_magnitude:
            best_magnitude = mag
            best_signed_change = change
    return best_signed_change


def regime_to_direction(
    regime: str, trend_strength: float, recent_change_pct: float = 0.0,
) -> str:
    """Map (regime, trend_strength[, recent_change_pct]) → BULLISH /
    BEARISH / NEUTRAL.

    See docstring history in main.py — same logic, extracted module.

    The fresh-move override runs BEFORE the regime-class early-returns
    so a creator/preserver regime with a positive ``trend_strength``
    cannot short-circuit BULLISH on a tape that's actively breaking
    down (caa3a9d / 2026-05-15T07:45Z fix preserved).
    """
    regime_l = (regime or "").lower()

    # FRESH-MOVE OVERRIDE — probe is noise-floor-filtered upstream by
    # strongest_recent_change AND now returns the largest-magnitude
    # cleared window's signed change. A non-zero value is the dominant
    # recent move; it overrides the stale long-window verdict.
    if recent_change_pct < 0:
        return "BEARISH"
    if recent_change_pct > 0:
        return "BULLISH"

    # Long-window regime + trend classification — consulted only when
    # the probe was silent (true dead-zone — no window cleared its floor).
    if regime_l == "creator" and trend_strength > 0.1:
        return "BULLISH"
    if regime_l == "preserver" and trend_strength > 0.15:
        return "BULLISH"
    if regime_l in ("dissolver",):
        return "NEUTRAL"
    if trend_strength < -0.05:
        return "BEARISH"

    return "NEUTRAL"
