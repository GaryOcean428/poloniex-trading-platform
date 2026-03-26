"""Adaptive position sizing based on regime and coupling.

Position size is proportional to coupling quality and inversely
proportional to volatility, with hard caps from risk limits (Pillar 2).

Core formula:
    raw_size = (κ × R² × risk_budget) / volatility
    final_size = min(raw_size, max_position_size)

Pillar gates:
    - Pillar 1 (Fluctuations): size = 0 if regime is Dissolver or vol = 0
    - Pillar 2 (Bulk): hard caps never exceeded, regardless of signal strength
    - Pillar 3 (Disorder): each market has its own κ — don't share params
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .coupling import CouplingState
from .regime import MarketRegime, RegimeState


@dataclass
class SizeDecision:
    """Position sizing output."""

    raw_size: float  # before caps
    final_size: float  # after caps and gates
    regime: MarketRegime
    kappa: float
    r_squared: float
    volatility: float
    reason: str  # human-readable explanation for audit


@dataclass
class AdaptiveSizer:
    """Computes position size from regime + coupling + risk limits.

    Parameters
    ----------
    risk_budget : float
        Fraction of account equity to risk per position (e.g. 0.02 = 2%).
    max_position_pct : float
        Maximum position as fraction of equity (hard cap, Pillar 2).
    max_portfolio_pct : float
        Maximum total exposure as fraction of equity.
    creator_scale : float
        Scaling factor for Creator regime (volatile = smaller positions).
    preserver_scale : float
        Scaling factor for Preserver regime (trending = normal positions).
    min_coupling_r2 : float
        Minimum R² to allow any position at all.
    """

    risk_budget: float = 0.02
    max_position_pct: float = 0.10
    max_portfolio_pct: float = 0.50
    creator_scale: float = 0.5
    preserver_scale: float = 1.0
    min_coupling_r2: float = 0.2

    def compute(
        self,
        regime_state: RegimeState,
        coupling_state: Optional[CouplingState],
        account_equity: float,
        current_exposure_pct: float = 0.0,
    ) -> SizeDecision:
        """Compute position size given current regime and coupling."""

        # Gate 1: Pillar 1 — no fluctuations, no trade
        if not regime_state.pillar1_gate:
            return SizeDecision(
                raw_size=0.0,
                final_size=0.0,
                regime=regime_state.regime,
                kappa=0.0,
                r_squared=0.0,
                volatility=regime_state.volatility,
                reason="Pillar 1 gate: zero volatility, no geometry",
            )

        # Gate 2: Dissolver regime — don't trade
        if regime_state.regime == MarketRegime.DISSOLVER:
            return SizeDecision(
                raw_size=0.0,
                final_size=0.0,
                regime=regime_state.regime,
                kappa=coupling_state.kappa if coupling_state else 0.0,
                r_squared=coupling_state.r_squared if coupling_state else 0.0,
                volatility=regime_state.volatility,
                reason="Dissolver regime: market dead, no edge",
            )

        # Gate 3: No coupling data yet — minimum size only
        if coupling_state is None:
            return SizeDecision(
                raw_size=0.0,
                final_size=0.0,
                regime=regime_state.regime,
                kappa=0.0,
                r_squared=0.0,
                volatility=regime_state.volatility,
                reason="No coupling data yet",
            )

        # Gate 4: Coupling too weak or inverted
        kappa = coupling_state.kappa
        r2 = coupling_state.r_squared

        if r2 < self.min_coupling_r2:
            return SizeDecision(
                raw_size=0.0,
                final_size=0.0,
                regime=regime_state.regime,
                kappa=kappa,
                r_squared=r2,
                volatility=regime_state.volatility,
                reason=f"Coupling too weak: R²={r2:.3f} < {self.min_coupling_r2}",
            )

        if kappa <= 0:
            return SizeDecision(
                raw_size=0.0,
                final_size=0.0,
                regime=regime_state.regime,
                kappa=kappa,
                r_squared=r2,
                volatility=regime_state.volatility,
                reason=f"Negative coupling κ={kappa:.4f}: strategy wrong for regime",
            )

        # Core sizing formula
        vol = max(regime_state.volatility, 1e-12)
        regime_scale = (
            self.creator_scale
            if regime_state.regime == MarketRegime.CREATOR
            else self.preserver_scale
        )

        # raw_size as fraction of equity
        raw_size_pct = (kappa * r2 * self.risk_budget * regime_scale) / vol

        # Pillar 2: hard caps
        capped = min(raw_size_pct, self.max_position_pct)

        # Portfolio-level cap
        remaining_budget = max(0.0, self.max_portfolio_pct - current_exposure_pct)
        capped = min(capped, remaining_budget)

        # Convert to absolute size
        final_size = max(0.0, capped * account_equity)
        raw_size = raw_size_pct * account_equity

        reason_parts = []
        if capped < raw_size_pct:
            reason_parts.append("capped by risk limits")
        reason_parts.append(
            f"regime={regime_state.regime.value} κ={kappa:.4f} R²={r2:.3f} vol={vol:.6f}"
        )

        return SizeDecision(
            raw_size=raw_size,
            final_size=final_size,
            regime=regime_state.regime,
            kappa=kappa,
            r_squared=r2,
            volatility=vol,
            reason="; ".join(reason_parts),
        )
