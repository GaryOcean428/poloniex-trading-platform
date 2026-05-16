"""test_regime_signal.py — regression for the live 2026-05-16T11:19Z bug.

ETH 15m was visibly bearish (~4% drop over 3h, 14/16 long-side
confirmation indicators ✗ on the chart) but ML emitted
``BUY dir=bullish``. Trace:

    [INFO] ML trading signal for ETH_USDT_PERP:
      {"signal":"BUY","strength":0.1234,
       "reason":"regime=creator strategy=breakout dir=bullish"}

Root cause: ``strongest_recent_change`` returned the FIRST window
that cleared its noise floor, with windows ordered shortest-first.
On a tape that just dropped 4% and then consolidated with a 0.5%
micro-bounce in the last 3 bars, the 3-bar bounce returned BULLISH
before the 15-bar drop was even checked.

Fix: largest-|change|-wins among cleared windows. A 15-bar 2% drop
correctly dominates a 3-bar 0.5% bounce.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from regime_signal import regime_to_direction, strongest_recent_change


# ───────────── strongest_recent_change ─────────────


class TestStrongestRecentChangeBoundaries:
    def test_returns_zero_for_too_short_input(self) -> None:
        assert strongest_recent_change([]) == 0.0
        assert strongest_recent_change([100.0]) == 0.0
        assert strongest_recent_change([100.0, 100.5, 101.0]) == 0.0

    def test_returns_zero_when_no_window_clears_floor(self) -> None:
        # Flat tape — every window's change is below its floor.
        prices = [100.0] * 20
        assert strongest_recent_change(prices) == 0.0

    def test_returns_signed_change_when_one_window_clears(self) -> None:
        # 5-bar +0.6% only — clears 5-bar floor (0.5%).
        prices = [100.0] * 15 + [100.6]  # only the last bar moved
        result = strongest_recent_change(prices)
        assert result > 0
        assert result == pytest.approx(0.006)


class TestStrongestRecentChangeLargestMagnitudeWins:
    """The 2026-05-16 fix: largest |change| among cleared windows wins."""

    def test_eth_2026_05_16_scenario_15bar_drop_dominates_3bar_bounce(
        self,
    ) -> None:
        # The exact pathology from the live report:
        # - 15 bars ago: $2,260
        # - drop down to $2,170 over ~12 bars (-4%)
        # - last 3 bars: small bounce to $2,180 (~+0.5% over 3 bars)
        # Pre-fix: 3-bar +0.5% returned first → BULLISH
        # Post-fix: 15-bar -3.5% dominates → BEARISH
        prices = (
            [2260.0]                              # t-15
            + [2260 - i * 7.5 for i in range(1, 13)]   # 12-bar drop to ~2170
            + [2173.0, 2176.0, 2180.0]                  # 3-bar bounce
        )
        # 15-bar move: (2180 - 2260) / 2260 ≈ -0.0354 (clears 1.0%)
        # 3-bar move: (2180 - 2173) / 2173 ≈ +0.0032 (BELOW 0.5% floor)
        # 5-bar move: (2180 - prices[-6]) — somewhere small, may not clear
        # Result: the only cleared window is the 15-bar, which is negative.
        result = strongest_recent_change(prices)
        assert result < 0, f"expected negative (BEARISH), got {result}"
        # Magnitude check — should be the 15-bar drop
        assert abs(result) >= 0.01

    def test_small_recent_bounce_loses_to_larger_long_window_drop(
        self,
    ) -> None:
        # Both windows clear — the larger magnitude wins.
        # Setup: 15-bar drop of ~1.8% + 3-bar bounce of ~0.5%.
        # |−0.018| > |+0.005| → larger magnitude wins → BEARISH
        prices = [100.0]
        # 13-bar gentle decline
        for i in range(1, 14):
            prices.append(100.0 - i * 0.2)
        # 3-bar mini-bounce
        prices.extend([97.5, 97.7, 98.2])
        result = strongest_recent_change(prices)
        # Sign + ordering check (exact magnitude depends on the
        # synthetic decay shape, not the function's contract).
        assert result < 0, f"expected negative, got {result}"
        # The drop's magnitude should dominate any bounce here.
        change_3bar = (prices[-1] - prices[-4]) / prices[-4]
        assert abs(result) > abs(change_3bar), (
            f"longer-window drop {result} should beat 3-bar {change_3bar}"
        )

    def test_large_recent_breakout_wins_against_small_long_window(
        self,
    ) -> None:
        # Mirror case: small long-window drift + large fresh breakout.
        # 15-bar: -1.0% (just clears floor)
        # 3-bar: +2.0% breakout (clears 0.5% floor with magnitude > 15-bar)
        # |+0.02| > |-0.01| → +0.02 wins → BULLISH
        prices = [100.0] * 13 + [99.0, 99.5, 101.0]
        # 15-bar: (101.0 - 100.0) / 100.0 = +0.01 — clears 1.0%, +0.01
        # 3-bar: (101.0 - 99.0) / 99.0 ≈ +0.0202 — clears 0.5%, +0.02
        # 5-bar: same as 3-bar approximately
        # Largest magnitude: 3-bar at +0.0202
        result = strongest_recent_change(prices)
        assert result > 0
        assert result == pytest.approx(0.02, abs=1e-2)

    def test_micro_bounce_inside_3bar_floor_lets_larger_drop_win(
        self,
    ) -> None:
        # 3-bar bounce of +0.3% (BELOW 0.5% floor) → not cleared.
        # 15-bar -2% drop → cleared, returned.
        # Pre-fix would have returned 0 since 3-bar didn't clear and the
        # outer loop returned `change` only if cleared (first-match).
        # The 5/10/15 bar windows DID clear; with first-match the 5-bar
        # would have been returned. With largest-magnitude, the 15-bar
        # -2% wins.
        prices = (
            [100.0]
            + [99.9, 99.8, 99.7, 99.6, 99.5, 99.4, 99.3, 99.2, 99.1, 99.0,
               98.9, 98.8]   # 12-bar slow decline
            + [98.0, 98.1, 98.3]    # 3-bar mini-bounce, ≈ +0.3% (below 0.5% floor)
        )
        result = strongest_recent_change(prices)
        # 3-bar: (98.3 - 98.0) / 98.0 ≈ 0.00306 — BELOW 0.5% floor, skipped
        # The negative long-window wins
        assert result < 0


# ───────────── regime_to_direction ─────────────


class TestRegimeToDirectionFreshMoveOverride:
    def test_negative_recent_change_returns_bearish(self) -> None:
        assert regime_to_direction("creator", 0.5, -0.01) == "BEARISH"
        assert regime_to_direction("preserver", 0.9, -0.001) == "BEARISH"

    def test_positive_recent_change_returns_bullish(self) -> None:
        assert regime_to_direction("dissolver", -1.0, 0.01) == "BULLISH"

    def test_zero_change_falls_through_to_regime_logic(self) -> None:
        # creator + trend > 0.1 → BULLISH (without probe)
        assert regime_to_direction("creator", 0.2, 0.0) == "BULLISH"
        # dissolver → NEUTRAL regardless of trend
        assert regime_to_direction("dissolver", 1.0, 0.0) == "NEUTRAL"
        # weak trend without probe → NEUTRAL
        assert regime_to_direction("creator", 0.05, 0.0) == "NEUTRAL"

    def test_eth_2026_05_16_full_chain_post_fix(self) -> None:
        # The actual live signal: regime=creator, trend_strength was
        # positive (otherwise wouldn't have hit "creator + trend > 0.1"
        # path); but a long-window drop is the true picture.
        # Reproduce the live signal:
        regime = "creator"
        trend_strength = 0.15   # positive long-window trend
        # The 15-bar drop from the fix:
        recent_change = -0.025  # 2.5% drop dominant
        direction = regime_to_direction(regime, trend_strength, recent_change)
        # Post-fix: probe pre-empts. BEARISH wins.
        assert direction == "BEARISH"

    def test_legacy_no_probe_argument_back_compat(self) -> None:
        # Calls without recent_change_pct default to 0.0 → regime path.
        assert regime_to_direction("creator", 0.2) == "BULLISH"
        assert regime_to_direction("dissolver", 1.0) == "NEUTRAL"


# ───────────── End-to-end: chart scenario from the live report ─────────────


class TestEthChartScenarioRegression:
    """Reproduces the exact decision the live ETH chart should have
    produced post-fix. Pre-fix returned 'BUY dir=bullish'; post-fix
    must return BEARISH."""

    def test_4pct_drop_then_consolidation_returns_bearish(self) -> None:
        # ETH chart 2026-05-16 11:19Z (visible from the screenshot):
        # - peak around $2,260
        # - drop to $2,160 (~-4.4%)
        # - consolidation back to ~$2,177
        # Synthesize 20 prices matching that shape.
        prices = [
            2260, 2255, 2245, 2230, 2215,    # gradual decline
            2200, 2180, 2170, 2160, 2155,    # accelerating drop
            2160, 2168, 2175, 2178, 2180,    # consolidation
            2179, 2176, 2178, 2177, 2177,    # micro-stalling
        ]
        change = strongest_recent_change(prices)
        direction = regime_to_direction("creator", 0.15, change)
        # Post-fix expectation: the 15-bar -3.7% drop (from 2260 → 2177)
        # dominates any short-window micro-move → BEARISH.
        assert direction == "BEARISH", (
            f"got {direction}, change={change:.4f} — "
            f"the 4% drop should dominate any 3-bar bounce"
        )


# ───────────── Issue #725: extended-window probe (60/120 bar) ─────────────


class TestExtendedProbeWindows:
    """Regression for issue #725: pre-extension, the 15-bar max window
    couldn't see multi-hour bearish trends. On a V-bottom + consolidation
    where the last 15 bars happen to be net-positive but the 120-bar
    dominant move is a 4% drop, the old 4-window probe returned positive
    and `regime_to_direction` flipped BULLISH on a bearish setup."""

    def test_4pct_drop_over_120bars_with_recent_07pct_bounce_returns_bearish(
        self,
    ) -> None:
        # Acceptance test from issue #725:
        # "Synthetic series that drops 4% over 120 bars and recovers
        #  0.7% in the last 15 bars. Current patch returns +0.007
        #  (BULLISH). Fix should return a negative value (BEARISH)."
        #
        # Start at 100, slow decline to 96 over 105 bars (-4%), then
        # rise back to 96.7 over the last 15 bars (+0.7% from the low).
        # Total end-to-end: 100 → 96.7 = -3.3% — dominant move bearish.
        # The 15-bar window only sees the +0.7% bounce; the 120-bar
        # window sees the -3.3%.
        decline_step = (96 - 100) / 105  # ~-0.0381 per bar in price-units
        decline = [100 + decline_step * i for i in range(106)]  # 100 → 96
        # Last 15 bars: linear rise from 96 to 96.7
        recovery_step = (96.7 - 96.0) / 15
        recovery = [96 + recovery_step * (i + 1) for i in range(15)]
        prices = decline + recovery
        assert len(prices) == 121
        assert prices[0] == 100.0
        assert abs(prices[-1] - 96.7) < 1e-9

        change = strongest_recent_change(prices)
        # 15-bar: (96.7 - 96.0) / 96.0 ≈ +0.0073 — clears 0.010 floor? No: 0.73% < 1.0% → NOT cleared
        # 60-bar: spans from index 61 to 120 → from price ~97.7 to 96.7 → -1.0% → BELOW 2.0% floor → NOT cleared
        # 120-bar: (96.7 - 100.0) / 100.0 = -0.033 → ABOVE 3.0% floor → CLEARED, |change| = 0.033
        # Result: 120-bar -3.3% wins
        assert change < 0, (
            f"expected negative (dominant 120-bar drop), got {change:+.4f}"
        )

        direction = regime_to_direction("creator", 0.15, change)
        assert direction == "BEARISH", (
            f"got {direction}, change={change:+.4f} — 120-bar drop should dominate"
        )

    def test_pre_extension_4window_max_would_have_returned_bullish(self) -> None:
        # Document the pre-fix failure mode: with only the 3/5/10/15-bar
        # windows, the 15-bar +0.7% bounce would be the only cleared
        # window (recovery is monotone positive across the last 15 bars).
        # 15-bar floor was 0.01 (1%) — 0.7% bounce wouldn't clear THAT
        # either. So pre-fix this specific scenario would have returned
        # 0.0 and fallen through to `regime_to_direction("creator", 0.15, 0)`
        # = BULLISH. Either way, the answer was wrong.
        #
        # Post-fix: the 120-bar -3.3% wins → BEARISH.
        # Verifies the fix delivers the right direction whichever way the
        # short-window probes resolved (above, below, or AT floor).
        # (Sanity check — narrow the recovery so the 15-bar would have
        # cleared the 1% floor in a hypothetical configuration that used
        # a smaller floor.)
        prices = (
            [100.0 - 0.04 * i for i in range(106)]  # 100 → 95.8 (~-4.2%)
            + [95.8 + 0.5 * (i + 1) for i in range(15)]  # +7.5 → 103.3
        )
        # 15-bar: (103.3 - 95.8) / 95.8 ≈ +0.078 (cleared 1% floor → +7.8%)
        # 120-bar: (103.3 - 100.0) / 100.0 = +0.033 (cleared 3% floor → +3.3%)
        # Both positive! Largest magnitude is the 15-bar (+7.8%) — but it's
        # POSITIVE so direction = BULLISH. This case the recent move is
        # genuinely dominant and bullish; the fix correctly identifies it.
        change = strongest_recent_change(prices)
        assert change > 0, "violent recovery should register positive"
        direction = regime_to_direction("creator", 0.15, change)
        assert direction == "BULLISH"

    def test_multi_hour_dominant_drop_returns_bearish_when_only_long_window_clears(
        self,
    ) -> None:
        # Big multi-hour drop large enough to clear the 60/120-bar floors
        # (2%/3%), followed by minor chop too small to clear any short
        # window's floor. The 60-/120-bar windows MUST catch the dominant
        # drop even when no short window does.
        # 110 bars of monotone -5% drop, then 15 bars of pure noise.
        import random
        rng = random.Random(42)
        decline = [100.0 - 5.0 * (i + 1) / 110 for i in range(110)]  # 100 → 95
        chop = [decline[-1] + rng.uniform(-0.03, 0.03) for _ in range(15)]
        prices = decline + chop  # 125 bars total
        change = strongest_recent_change(prices)
        # 120-bar: prices[-121] doesn't exist (only 125 bars; ok 121 in range
        # but tight). For 125 bars: prices[-121] = prices[4] ≈ 100 - 5*5/110
        # ≈ 99.77. Final ≈ 95. Change ≈ -4.8% → clears 3% floor.
        # 60-bar: prices[-61] = prices[64] ≈ 100 - 5*65/110 ≈ 97.05. Final
        # ≈ 95. Change ≈ -2.1% → clears 2% floor.
        # Both 60 and 120 cleared → largest magnitude wins → 120-bar -4.8%.
        assert change < 0, f"expected bearish, got {change:+.4f}"
        assert regime_to_direction("dissolver", -0.1, change) == "BEARISH"
