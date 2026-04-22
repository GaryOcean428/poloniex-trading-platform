"""Tests for adaptive position sizing."""

import pytest

from proprietary_core.coupling import CouplingState
from proprietary_core.regime import MarketRegime, RegimeState
from proprietary_core.sizing import AdaptiveSizer


def _regime(regime: MarketRegime, vol: float = 0.02, gate: bool = True) -> RegimeState:
    return RegimeState(
        regime=regime,
        entropy=3.0 if regime == MarketRegime.CREATOR else 1.5,
        fisher_info=0.1,
        trend_strength=0.3 if regime == MarketRegime.PRESERVER else 0.05,
        volatility=vol,
        confidence=0.8,
        is_transition=False,
        pillar1_gate=gate,
    )


def _coupling(kappa: float = 1.0, r2: float = 0.8) -> CouplingState:
    return CouplingState(
        kappa=kappa,
        r_squared=r2,
        n_samples=50,
        is_coupled=kappa > 0 and r2 > 0.3,
        is_inverted=kappa < 0,
        stud_crossing=False,
        signal_mean=0.0,
        pnl_mean=0.0,
    )


def test_dissolver_gives_zero():
    sizer = AdaptiveSizer()
    decision = sizer.compute(_regime(MarketRegime.DISSOLVER), _coupling(), 100_000)
    assert decision.final_size == 0.0
    assert "Dissolver" in decision.reason


def test_pillar1_gate_gives_zero():
    sizer = AdaptiveSizer()
    decision = sizer.compute(_regime(MarketRegime.PRESERVER, gate=False), _coupling(), 100_000)
    assert decision.final_size == 0.0
    assert "Pillar 1" in decision.reason


def test_negative_kappa_gives_zero():
    sizer = AdaptiveSizer()
    decision = sizer.compute(_regime(MarketRegime.PRESERVER), _coupling(kappa=-0.5), 100_000)
    assert decision.final_size == 0.0
    assert "Negative" in decision.reason


def test_preserver_positive_coupling():
    sizer = AdaptiveSizer(risk_budget=0.02, max_position_pct=0.10)
    decision = sizer.compute(
        _regime(MarketRegime.PRESERVER, vol=0.02),
        _coupling(kappa=1.0, r2=0.8),
        100_000,
    )
    assert decision.final_size > 0
    assert decision.final_size <= 100_000 * 0.10  # hard cap


def test_creator_scales_down():
    sizer = AdaptiveSizer(risk_budget=0.02, creator_scale=0.5, preserver_scale=1.0)
    regime_c = _regime(MarketRegime.CREATOR, vol=0.02)
    regime_p = _regime(MarketRegime.PRESERVER, vol=0.02)
    coupling = _coupling(kappa=1.0, r2=0.8)

    size_c = sizer.compute(regime_c, coupling, 100_000)
    size_p = sizer.compute(regime_p, coupling, 100_000)

    # Creator should give smaller position than Preserver at same coupling
    assert size_c.final_size < size_p.final_size


def test_portfolio_cap():
    sizer = AdaptiveSizer(max_portfolio_pct=0.50)
    decision = sizer.compute(
        _regime(MarketRegime.PRESERVER),
        _coupling(kappa=10.0, r2=0.99),  # extremely strong coupling
        100_000,
        current_exposure_pct=0.48,  # already 48% exposed
    )
    # Should be capped to remaining 2% of portfolio
    assert decision.final_size <= 100_000 * 0.02 + 1  # +1 for float tolerance
