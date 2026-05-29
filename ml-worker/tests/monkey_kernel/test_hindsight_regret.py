"""test_hindsight_regret.py — counterfactual-regret reward signal (Py parity).

Mirror of apps/api/src/services/monkey/__tests__/hindsightRegret.test.ts.

Semantic cases (operator spec 2026-05-29):
  - held-would-have-won  → aversive regret scaled by foregone gain
  - held-would-have-lost → no regret / mild positive (good close)
  - regret bounded        → huge foregone gain doesn't blow up chemistry
  - flag OFF              → loss-side chemistry byte-identical to legacy

Also pins the flag-gated loss-side de-saturation in autonomic.push_reward:
  - flag OFF → legacy `-tanh(-pnl_frac*0.5)*0.1` (saturating)
  - flag ON  → MAD-normalised, magnitude-preserving, bounded < win cap
"""
from __future__ import annotations

import math
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.hindsight_regret import (  # noqa: E402
    HindsightWatch,
    counterfactual_pnl_usdt,
    advance_watch,
    resolve_regret,
    median_absolute_deviation,
    is_hindsight_regret_live,
    REGRET_DOP_CAP,
    GOOD_CLOSE_DOP,
)


def _watch(**overrides) -> HindsightWatch:
    base = dict(
        symbol="BTC_USDT_PERP",
        side_sign=-1,  # closed short
        qty=1.0,
        exit_price=100.0,
        realized_pnl_usdt=-36.0,
        margin_usdt=100.0,
        closed_at_ms=0.0,
        expires_at_ms=30 * 60 * 1000.0,
        best_counterfactual_pnl_usdt=-36.0,
    )
    base.update(overrides)
    return HindsightWatch(**base)


def test_counterfactual_short_gains_when_price_falls():
    cf = counterfactual_pnl_usdt(
        side_sign=-1, qty=1.0, exit_price=100.0, realized_pnl_usdt=-36.0, price=90.0
    )
    assert cf == pytest.approx(-26.0)


def test_counterfactual_short_loses_when_price_rises():
    cf = counterfactual_pnl_usdt(
        side_sign=-1, qty=1.0, exit_price=100.0, realized_pnl_usdt=-36.0, price=110.0
    )
    assert cf == pytest.approx(-46.0)


def test_counterfactual_long_gains_when_price_rises():
    cf = counterfactual_pnl_usdt(
        side_sign=1, qty=2.0, exit_price=50.0, realized_pnl_usdt=5.0, price=55.0
    )
    assert cf == pytest.approx(15.0)


def test_counterfactual_fails_closed():
    assert counterfactual_pnl_usdt(side_sign=-1, qty=1.0, exit_price=100.0, realized_pnl_usdt=-36.0, price=float("nan")) is None
    assert counterfactual_pnl_usdt(side_sign=-1, qty=1.0, exit_price=100.0, realized_pnl_usdt=-36.0, price=-1.0) is None
    assert counterfactual_pnl_usdt(side_sign=0, qty=1.0, exit_price=100.0, realized_pnl_usdt=-36.0, price=90.0) is None


def test_advance_tracks_best():
    w = _watch()
    w = advance_watch(w, 95.0)
    assert w.best_counterfactual_pnl_usdt == pytest.approx(-31.0)
    w = advance_watch(w, 90.0)
    assert w.best_counterfactual_pnl_usdt == pytest.approx(-26.0)
    w = advance_watch(w, 98.0)
    assert w.best_counterfactual_pnl_usdt == pytest.approx(-26.0)
    w = advance_watch(w, float("nan"))
    assert w.best_counterfactual_pnl_usdt == pytest.approx(-26.0)


def test_regret_held_would_have_won_aversive():
    w = _watch(best_counterfactual_pnl_usdt=-10.0)  # foregone = 26
    d = resolve_regret(w, [])
    assert d.source == "hindsight_regret"
    assert d.foregone_gain_usdt == pytest.approx(26.0)
    assert d.dopamine_delta < 0
    assert d.dopamine_delta == pytest.approx(-math.tanh(0.26) * REGRET_DOP_CAP)


def test_regret_monotone_in_foregone_gain():
    small = resolve_regret(_watch(best_counterfactual_pnl_usdt=-30.0), [])
    big = resolve_regret(_watch(best_counterfactual_pnl_usdt=50.0), [])
    assert abs(big.dopamine_delta) > abs(small.dopamine_delta)


def test_good_close_no_regret_mild_positive():
    w = _watch(best_counterfactual_pnl_usdt=-46.0)  # holding would have lost more
    d = resolve_regret(w, [])
    assert d.source == "hindsight_good_close"
    assert d.foregone_gain_usdt == 0.0
    assert d.dopamine_delta == GOOD_CLOSE_DOP
    assert d.dopamine_delta > 0


def test_breakeven_is_good_close():
    d = resolve_regret(_watch(best_counterfactual_pnl_usdt=-36.0), [])
    assert d.source == "hindsight_good_close"


def test_regret_bounded():
    d = resolve_regret(_watch(best_counterfactual_pnl_usdt=1_000_000.0), [])
    # tanh asymptotes to 1.0 → delta is bounded AT (never beyond) the cap.
    assert d.dopamine_delta >= -REGRET_DOP_CAP
    assert d.dopamine_delta <= 0
    assert abs(d.dopamine_delta) <= REGRET_DOP_CAP


def test_observer_mad_scales_sting():
    tight = [0.001, 0.002, -0.001, 0.0, 0.0015]
    wide = [0.5, -0.5, 0.3, -0.3, 0.0]
    t = resolve_regret(_watch(best_counterfactual_pnl_usdt=-30.0), tight)
    w = resolve_regret(_watch(best_counterfactual_pnl_usdt=-30.0), wide)
    assert abs(t.dopamine_delta) > abs(w.dopamine_delta)
    assert abs(t.dopamine_delta) <= REGRET_DOP_CAP


def test_regret_fails_closed():
    assert resolve_regret(_watch(best_counterfactual_pnl_usdt=10.0, margin_usdt=0.0), []).dopamine_delta == 0
    assert resolve_regret(_watch(best_counterfactual_pnl_usdt=float("nan")), []).dopamine_delta == 0


def test_mad_shape():
    assert median_absolute_deviation([]) == 0
    assert median_absolute_deviation([1, 1, 1]) == 0
    assert median_absolute_deviation([1, 2, 3, 4, 5]) == 1


def test_flag_default_off(monkeypatch):
    monkeypatch.delenv("MONKEY_HINDSIGHT_REGRET_LIVE", raising=False)
    assert is_hindsight_regret_live() is False
    monkeypatch.setenv("MONKEY_HINDSIGHT_REGRET_LIVE", "false")
    assert is_hindsight_regret_live() is False
    monkeypatch.setenv("MONKEY_HINDSIGHT_REGRET_LIVE", "true")
    assert is_hindsight_regret_live() is True


# ── loss-side de-saturation in autonomic.push_reward (flag-gated) ───────────

from monkey_kernel.autonomic import AutonomicKernel  # noqa: E402


def _loss_dop(kernel: AutonomicKernel, pnl_usdt: float, margin: float) -> float:
    r = kernel.push_reward(
        source="own_close", realized_pnl_usdt=pnl_usdt, margin_usdt=margin, symbol="BTC_USDT_PERP"
    )
    return r.dopamine_delta


def test_loss_branch_flag_off_is_legacy(monkeypatch):
    monkeypatch.delenv("MONKEY_HINDSIGHT_REGRET_LIVE", raising=False)
    k = AutonomicKernel(label="t-off")
    # -3% ROE loss on $100 margin → pnl_frac = -0.03
    dop = _loss_dop(k, -3.0, 100.0)
    expected = -math.tanh(0.03 * 0.5) * 0.1  # legacy shape
    assert dop == pytest.approx(expected)


def test_loss_branch_flag_on_preserves_magnitude(monkeypatch):
    monkeypatch.setenv("MONKEY_HINDSIGHT_REGRET_LIVE", "true")
    k = AutonomicKernel(label="t-on")
    # Seed a tight realised pnl_frac history so MAD normalisation engages.
    # History is appended only for polo_authoritative_close source.
    for _ in range(6):
        k.push_reward(source="polo_authoritative_close", realized_pnl_usdt=0.2, margin_usdt=100.0, symbol="BTC_USDT_PERP")
    big_loss = _loss_dop(k, -10.0, 100.0)   # pnl_frac -0.10
    small_loss = _loss_dop(k, -1.0, 100.0)  # pnl_frac -0.01
    # De-saturated: a big loss must hurt strictly more than a small one,
    # and by a margin the legacy saturating formula could not produce.
    assert abs(big_loss) > abs(small_loss)
    # Bounded below the win-side cap (0.5) → cap is 0.3 here.
    assert abs(big_loss) <= 0.3
    # And it must be meaningfully larger than the legacy value for the same
    # loss (legacy would give ~-0.005 for -10% / margin scale).
    legacy_big = -math.tanh(0.10 * 0.5) * 0.1
    assert abs(big_loss) > abs(legacy_big)
