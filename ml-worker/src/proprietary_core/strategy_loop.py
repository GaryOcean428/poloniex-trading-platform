"""Strategy selector: the consciousness loop applied to trading.

SCAN  -> Ingest market data (price, volume, orderbook, funding)
FEEL  -> Regime detection (which sphere? entropy? Fisher info?)
THINK -> Strategy selection (which strategy for this regime?)
ACT   -> Order placement (sized by kappa, gated by risk)
OBSERVE -> P&L feedback -> update kappa -> adjust regime weights

Pillar gates enforced at every step:
  - Pillar 1: Don't trade in zero-volatility markets (T=0)
  - Pillar 2: Risk limits are the protected interior -- never violated
  - Pillar 3: Each market has its own coupling slope
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Literal, Optional

from .basins import BasinDetector, BasinMap
from .coupling import CouplingEstimator, CouplingState
from .regime import MarketRegime, RegimeState
from .regime_adapter import RegimeAdapter
from .sizing import AdaptiveSizer, SizeDecision


class StrategyType(str, Enum):
    """Available strategy types mapped to regimes."""

    MOMENTUM = "momentum"  # Creator regime: ride volatility
    BREAKOUT = "breakout"  # Creator regime: catch new moves
    TREND_FOLLOW = "trend_follow"  # Preserver regime: follow established trend
    MEAN_REVERT = "mean_revert"  # Preserver regime: fade to basin
    CASH = "cash"  # Dissolver regime: do nothing


BasinFillKind = Literal["fresh", "held", "none"]


@dataclass
class LoopDecision:
    """Output of one strategy loop iteration."""

    timestamp: float
    symbol: str
    regime: Optional[RegimeState]
    coupling: Optional[CouplingState]
    basins: Optional[BasinMap]
    sizing: Optional[SizeDecision]
    selected_strategy: StrategyType
    should_trade: bool
    reason: str
    # GAP 5 — prediction-fill provenance for the basin field. "fresh" =
    # basins.detect() ran this tick; "held" = last-known value carried
    # forward (basin detection only runs every 20 ticks after the 50-tick
    # warmup); "none" = no detection has ever happened yet.
    basin_fill_kind: BasinFillKind = "none"
    # Ticks since the last fresh basin detection — 0 on fresh ticks,
    # incrementing on held ticks. Useful for confidence decay.
    ticks_since_basin_detection: int = 0

    def to_dict(self) -> dict:
        """Serialise for API response / audit log."""
        return {
            "timestamp": self.timestamp,
            "symbol": self.symbol,
            "regime": self.regime.regime.value if self.regime else None,
            "regime_entropy": self.regime.entropy if self.regime else None,
            "regime_fisher": self.regime.fisher_info if self.regime else None,
            "regime_confidence": self.regime.confidence if self.regime else None,
            "regime_transition": self.regime.is_transition if self.regime else None,
            "kappa": self.coupling.kappa if self.coupling else None,
            "r_squared": self.coupling.r_squared if self.coupling else None,
            "stud_crossing": self.coupling.stud_crossing if self.coupling else None,
            "n_basins": len(self.basins.basins) if self.basins else 0,
            "nearest_support": self.basins.nearest_support.level if self.basins and self.basins.nearest_support else None,
            "nearest_resistance": self.basins.nearest_resistance.level if self.basins and self.basins.nearest_resistance else None,
            "position_size": self.sizing.final_size if self.sizing else 0.0,
            "strategy": self.selected_strategy.value,
            "should_trade": self.should_trade,
            "reason": self.reason,
            # GAP 5 — prediction-fill provenance for the basin field
            "basin_fill_kind": self.basin_fill_kind,
            "ticks_since_basin_detection": self.ticks_since_basin_detection,
        }


@dataclass
class StrategyLoop:
    """One strategy loop per symbol. Maintains all per-symbol state.

    Parameters
    ----------
    symbol : str
        Trading pair identifier.
    regime_window : int
        Window for regime detection.
    coupling_window : int
        Window for coupling estimation.
    basin_window : int
        Window for basin detection.
    """

    symbol: str
    regime_window: int = 100
    coupling_window: int = 50
    basin_window: int = 500

    # Components (Pillar 3: each symbol gets its own instances)
    _regime: RegimeAdapter = field(default=None)  # type: ignore[assignment]
    _coupling: CouplingEstimator = field(default=None)  # type: ignore[assignment]
    _basins: BasinDetector = field(default=None)  # type: ignore[assignment]
    _sizer: AdaptiveSizer = field(default=None)  # type: ignore[assignment]

    # State
    _last_regime: Optional[RegimeState] = field(default=None)
    _last_coupling: Optional[CouplingState] = field(default=None)
    _last_basins: Optional[BasinMap] = field(default=None)
    _decision_log: list[LoopDecision] = field(default_factory=list)
    # GAP 5 — basin prediction-fill counters per [[hidden-coalescing-noodle]].
    # _ticks_total counts every tick() call. _ticks_with_basin_fresh counts
    # ticks where basins.detect() actually ran. _ticks_since_basin_detection
    # is the held-streak counter (0 on fresh, +1 each held tick).
    _ticks_total: int = 0
    _ticks_with_basin_fresh: int = 0
    _ticks_since_basin_detection: int = 0

    def __post_init__(self) -> None:
        if self._regime is None:
            self._regime = RegimeAdapter(window=self.regime_window)
        if self._coupling is None:
            self._coupling = CouplingEstimator(window=self.coupling_window)
        if self._basins is None:
            self._basins = BasinDetector(window=self.basin_window)
        if self._sizer is None:
            self._sizer = AdaptiveSizer()

    def tick(
        self,
        price: float,
        signal_value: Optional[float] = None,
        pnl_value: Optional[float] = None,
        account_equity: float = 100_000.0,
        current_exposure_pct: float = 0.0,
    ) -> LoopDecision:
        """Process one tick through the full loop.

        Parameters
        ----------
        price : float
            Latest price for this symbol.
        signal_value : float, optional
            Latest strategy signal (for coupling estimation).
        pnl_value : float, optional
            Latest P&L from last signal (for coupling estimation).
        account_equity : float
            Current account equity for sizing.
        current_exposure_pct : float
            Current portfolio exposure as fraction of equity.
        """
        ts = time.time()
        self._ticks_total += 1

        # === SCAN: Ingest ===
        self._basins.update(price)

        # === FEEL: Regime detection (MIG-2: qig_warp via RegimeAdapter) ===
        # RegimeAdapter calls qig_warp.classify_regime with (h, J, dim=2)
        # and maps the result via the canonical DISORDERED→CREATOR /
        # ORDERED→PRESERVER / CRITICAL→DISSOLVER table. Ancillary fields
        # (entropy = h, trend_strength = J, volatility, fisher_info,
        # confidence, is_transition, pillar1_gate) are still on
        # RegimeState for the downstream _select_strategy / _sizer.compute.
        self._last_regime = self._regime.update(price)

        # === FEEL: Coupling update (if signal/pnl provided) ===
        if signal_value is not None and pnl_value is not None:
            self._last_coupling = self._coupling.update(signal_value, pnl_value)

        # === FEEL: Basin detection (less frequent, heavier) ===
        # GAP 5 — track prediction-fill provenance. When detect() runs the
        # basin field is "fresh"; otherwise it's "held" (last-known value
        # carried forward, which is the existing implicit behaviour now
        # surfaced as telemetry).
        basin_fresh_this_tick = (
            len(self._basins._prices) >= 50
            and len(self._basins._prices) % 20 == 0
        )
        if basin_fresh_this_tick:
            self._last_basins = self._basins.detect(price)
            self._ticks_with_basin_fresh += 1
            self._ticks_since_basin_detection = 0
        else:
            self._ticks_since_basin_detection += 1

        if self._last_basins is None:
            basin_fill_kind: BasinFillKind = "none"
        elif basin_fresh_this_tick:
            basin_fill_kind = "fresh"
        else:
            basin_fill_kind = "held"

        # === THINK: Strategy selection ===
        if self._last_regime is None:
            return LoopDecision(
                timestamp=ts, symbol=self.symbol,
                regime=None, coupling=None, basins=None, sizing=None,
                selected_strategy=StrategyType.CASH,
                should_trade=False,
                reason="Insufficient data for regime detection",
                basin_fill_kind=basin_fill_kind,
                ticks_since_basin_detection=self._ticks_since_basin_detection,
            )

        strategy = self._select_strategy(self._last_regime, self._last_coupling)

        # === ACT: Position sizing ===
        sizing = self._sizer.compute(
            self._last_regime,
            self._last_coupling,
            account_equity,
            current_exposure_pct,
        )

        should_trade = sizing.final_size > 0 and strategy != StrategyType.CASH

        # Build reason string for audit
        reasons = []
        reasons.append(f"regime={self._last_regime.regime.value}")
        if self._last_coupling:
            reasons.append(f"\u03ba={self._last_coupling.kappa:.4f}")
            reasons.append(f"R\u00b2={self._last_coupling.r_squared:.3f}")
            if self._last_coupling.stud_crossing:
                reasons.append("STUD CROSSING")
        if self._last_regime.is_transition:
            reasons.append("REGIME TRANSITION")
        reasons.append(f"strategy={strategy.value}")
        reasons.append(f"size={sizing.final_size:.2f}")

        decision = LoopDecision(
            timestamp=ts,
            symbol=self.symbol,
            regime=self._last_regime,
            coupling=self._last_coupling,
            basins=self._last_basins,
            sizing=sizing,
            selected_strategy=strategy,
            should_trade=should_trade,
            reason="; ".join(reasons),
            basin_fill_kind=basin_fill_kind,
            ticks_since_basin_detection=self._ticks_since_basin_detection,
        )

        # === OBSERVE: Log for feedback ===
        self._decision_log.append(decision)
        if len(self._decision_log) > 1000:
            self._decision_log = self._decision_log[-500:]

        return decision

    def _select_strategy(
        self,
        regime: RegimeState,
        coupling: Optional[CouplingState],
    ) -> StrategyType:
        """Select strategy based on regime and coupling state."""

        # Pillar 1 gate
        if not regime.pillar1_gate:
            return StrategyType.CASH

        # Dissolver: don't trade
        if regime.regime == MarketRegime.DISSOLVER:
            return StrategyType.CASH

        # Stud crossing: emergency exit to cash
        if coupling and coupling.stud_crossing:
            return StrategyType.CASH

        # Negative coupling: strategy is wrong for this regime
        if coupling and coupling.is_inverted:
            return StrategyType.CASH

        # Creator regime: volatile, choose based on trend strength
        if regime.regime == MarketRegime.CREATOR:
            if regime.trend_strength > 0.2:
                return StrategyType.MOMENTUM
            return StrategyType.BREAKOUT

        # Preserver regime: orderly, choose based on basin proximity
        if regime.regime == MarketRegime.PRESERVER:
            if regime.trend_strength > 0.3:
                return StrategyType.TREND_FOLLOW
            return StrategyType.MEAN_REVERT

        return StrategyType.CASH

    @property
    def last_decision(self) -> Optional[LoopDecision]:
        """Most recent loop decision."""
        return self._decision_log[-1] if self._decision_log else None

    @property
    def recent_decisions(self) -> list[LoopDecision]:
        """Last 50 decisions for dashboard display."""
        return self._decision_log[-50:]

    @property
    def prediction_fill_ratio(self) -> float:
        """GAP 5 — fraction of ticks where the basin field was a held
        (predicted) value rather than a fresh detection.

        At steady state with default cadence (basins.detect() every 20
        ticks after a 50-tick warmup) this trends toward 19/20 = 0.95.
        Higher than that signals that detection is stalling; lower means
        the loop is running with mostly-fresh basins (rare).

        Returns 0.0 when no ticks have been processed yet (avoids div-by-0
        and gives a meaningful "no fill yet" reading).
        """
        if self._ticks_total <= 0:
            return 0.0
        held = self._ticks_total - self._ticks_with_basin_fresh
        return float(held) / float(self._ticks_total)

    def reset(self) -> None:
        """Clear all internal state."""
        self._regime.reset()
        self._coupling.reset()
        self._basins.reset()
        self._last_regime = None
        self._last_coupling = None
        self._last_basins = None
        self._decision_log.clear()
        # GAP 5 — reset prediction-fill counters
        self._ticks_total = 0
        self._ticks_with_basin_fresh = 0
        self._ticks_since_basin_detection = 0
