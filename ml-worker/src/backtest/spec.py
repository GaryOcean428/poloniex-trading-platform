"""Strategy parameter spec for v0.9.0 Phase B sweeps.

Maps directly to the knobs that the live Monkey kernel reads from
MODE_PROFILES + executive.py. Every field is a SAFETY_BOUND or a
to-be-derived parameter (P25). The sweep produces evidence for what
values would produce profitable trading on historical replays.

Promotion of swept results to live MODE_PROFILES is Phase C (P14
parameter registry with governance / rollback). This module only
discovers candidate values.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace as _replace
from typing import Literal


@dataclass(frozen=True)
class StrategySpec:
    """A single strategy candidate. All values float (qig_warp param space).

    Aligned with MODE_PROFILES.INVESTIGATION anchor as the baseline:
      tp_base_frac=0.008  — TP threshold as fraction of notional
      sl_ratio=0.5        — SL as fraction of TP (asymmetric R:R)
      trailing_giveback=0.30 — % of peak profit to give back before exit
      entry_threshold_scale=1.0 — multiplier on dynamic entry threshold
      dca_better_price=0.01 — fraction price must move favourably for DCA
      dca_max_adds=1      — hard cap on DCA additions per position
    """
    tp_base_frac: float = 0.008
    sl_ratio: float = 0.5
    trailing_giveback: float = 0.30
    entry_threshold_scale: float = 1.0
    dca_better_price: float = 0.01
    dca_max_adds: int = 1
    # Fee assumption — Poloniex VIP0 taker. Round-trip = 2 × this.
    taker_fee_frac: float = 0.00075

    @property
    def sl_frac(self) -> float:
        """Stop-loss as fraction of notional (derived from tp × sl_ratio)."""
        return self.tp_base_frac * self.sl_ratio

    def with_(self, **kwargs) -> "StrategySpec":
        """Functional update — returns a new spec with overrides."""
        return _replace(self, **kwargs)


def default_spec() -> StrategySpec:
    """Default spec matching MODE_PROFILES.INVESTIGATION anchors."""
    return StrategySpec()


# Axis names the sweep CLI knows how to sweep. Each maps to a
# StrategySpec field; the sweep replaces just that field while holding
# the others at the base spec's values.
SWEEPABLE_AXES = (
    "tp_base_frac",
    "sl_ratio",
    "trailing_giveback",
    "entry_threshold_scale",
    "dca_better_price",
)

AxisName = Literal[
    "tp_base_frac",
    "sl_ratio",
    "trailing_giveback",
    "entry_threshold_scale",
    "dca_better_price",
]
