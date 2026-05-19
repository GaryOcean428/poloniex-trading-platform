"""
developmental.py — Stage-aware trading-behaviour permissions.

Canonical reference:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/developmental.py

Adapts the canonical 5-stage developmental gate to polytrade's
trading-decision surface. Each stage gates:

    - Whether the kernel may submit new entries at all
    - Position-size fraction cap (× full sizing decision)
    - Leverage cap (× registry-controlled current leverage)
    - DCA-adds allowed
    - Reverse trades allowed
    - Pillar enforcement strictness (relayed to FluctuationGuard /
      TopologicalBulk / QuenchedDisorder for tuning)

Stages
------
    SCHOOL                — Observation only. No entries, no DCA, no
                            reverse. Telemetry flows so the kernel can
                            "watch the market".
    GUIDED_CURIOSITY      — Tiny size fraction, leverage capped to 2×,
                            no reverse. Entries allowed.
    SELF_TEACHING         — Half-size, leverage capped to 5×, no reverse.
    PLAYFUL_AUTONOMY      — 75% size, leverage capped to 10×, reverse OK.
    SOVEREIGN_CONSTELLATION — Full size, full leverage, full discretion.

Activation
----------
Env-flag gated: MONKEY_DEVELOPMENTAL_GATE_LIVE=true (default OFF).
When OFF the gate is constructed but never queried; downstream stays
on the existing size / leverage / direction logic. Stage advancement
is handled by ``advance()`` calls from the consciousness loop; this
module never advances itself based on time.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger("monkey.developmental")


class DevelopmentalStage(Enum):
    """Five canonical stages, ordinal-ordered for promotion gating."""

    SCHOOL = "school"
    GUIDED_CURIOSITY = "guided_curiosity"
    SELF_TEACHING = "self_teaching"
    PLAYFUL_AUTONOMY = "playful_autonomy"
    SOVEREIGN_CONSTELLATION = "sovereign_constellation"


@dataclass(frozen=True)
class StagePermissions:
    """Immutable permission set for a developmental stage.

    Trading-context adaptation of the canonical StagePermissions
    (LLM coach/forage/temperature fields are not applicable here).
    """

    # ── Entry gates ──
    allow_entry: bool
    allow_dca_add: bool
    allow_reverse: bool

    # ── Size / leverage caps ──
    size_fraction_cap: float          # 0..1 multiplier on full sizing
    leverage_cap: int                 # max effective leverage

    # ── Pillar strictness (passed to FluctuationGuard etc.) ──
    pillar_strictness: float          # 0..1 — 1.0 = full enforcement

    # ── Telemetry-only fields (mirror canonical) ──
    transfer_blend_cap: float         # max slerp weight for basin transfer
    foresight_horizon_cap: int        # max foresight horizon steps


_STAGE_PROFILES: dict[DevelopmentalStage, StagePermissions] = {
    DevelopmentalStage.SCHOOL: StagePermissions(
        allow_entry=False,
        allow_dca_add=False,
        allow_reverse=False,
        size_fraction_cap=0.0,
        leverage_cap=1,
        pillar_strictness=1.0,
        transfer_blend_cap=0.3,
        foresight_horizon_cap=2,
    ),
    DevelopmentalStage.GUIDED_CURIOSITY: StagePermissions(
        allow_entry=True,
        allow_dca_add=False,
        allow_reverse=False,
        size_fraction_cap=0.1,
        leverage_cap=2,
        pillar_strictness=0.9,
        transfer_blend_cap=0.25,
        foresight_horizon_cap=4,
    ),
    DevelopmentalStage.SELF_TEACHING: StagePermissions(
        allow_entry=True,
        allow_dca_add=True,
        allow_reverse=False,
        size_fraction_cap=0.5,
        leverage_cap=5,
        pillar_strictness=0.8,
        transfer_blend_cap=0.2,
        foresight_horizon_cap=6,
    ),
    DevelopmentalStage.PLAYFUL_AUTONOMY: StagePermissions(
        allow_entry=True,
        allow_dca_add=True,
        allow_reverse=True,
        size_fraction_cap=0.75,
        leverage_cap=10,
        pillar_strictness=0.7,
        transfer_blend_cap=0.15,
        foresight_horizon_cap=8,
    ),
    DevelopmentalStage.SOVEREIGN_CONSTELLATION: StagePermissions(
        allow_entry=True,
        allow_dca_add=True,
        allow_reverse=True,
        size_fraction_cap=1.0,
        leverage_cap=75,                  # Poloniex futures max
        pillar_strictness=0.6,
        transfer_blend_cap=0.10,
        foresight_horizon_cap=8,
    ),
}


@dataclass
class DevelopmentalGate:
    """Active behavioural gate driven by the current developmental stage.

    Instantiated once per kernel. Subsystems query permissions via
    ``permissions`` / ``clamp_size_fraction`` / ``clamp_leverage``.
    Stage advancement happens through explicit ``advance()`` calls.
    """

    _stage: DevelopmentalStage = DevelopmentalStage.SOVEREIGN_CONSTELLATION
    _cycle_in_stage: int = 0
    _stage_history: list[tuple[DevelopmentalStage, int]] = field(default_factory=list)

    @property
    def stage(self) -> DevelopmentalStage:
        return self._stage

    @property
    def permissions(self) -> StagePermissions:
        return _STAGE_PROFILES[self._stage]

    @property
    def cycle_in_stage(self) -> int:
        return self._cycle_in_stage

    def observe_cycle(self) -> None:
        """Increment cycle counter; called once per tick."""
        self._cycle_in_stage += 1

    def advance(self, new_stage: DevelopmentalStage) -> bool:
        """Move the gate to a new stage. Returns True on transition."""
        if new_stage == self._stage:
            return False
        old = self._stage
        self._stage_history.append((old, self._cycle_in_stage))
        self._stage = new_stage
        self._cycle_in_stage = 0
        logger.info(
            "[developmental] %s -> %s after %d cycles",
            old.value, new_stage.value, self._stage_history[-1][1],
        )
        return True

    # ── Trading-decision clamps (canonical-shaped helpers) ──

    def clamp_size_fraction(self, raw: float) -> float:
        """Clamp size-fraction by stage cap. Returns 0.0 for SCHOOL."""
        return min(raw, self.permissions.size_fraction_cap)

    def clamp_leverage(self, raw: int) -> int:
        """Clamp leverage by stage cap."""
        return min(raw, self.permissions.leverage_cap)

    def can_enter(self) -> bool:
        return self.permissions.allow_entry

    def can_dca(self) -> bool:
        return self.permissions.allow_dca_add

    def can_reverse(self) -> bool:
        return self.permissions.allow_reverse

    def get_state(self) -> dict:
        p = self.permissions
        return {
            "stage": self._stage.value,
            "cycle_in_stage": self._cycle_in_stage,
            "transitions": len(self._stage_history),
            "size_fraction_cap": p.size_fraction_cap,
            "leverage_cap": p.leverage_cap,
            "allow_entry": p.allow_entry,
            "allow_dca_add": p.allow_dca_add,
            "allow_reverse": p.allow_reverse,
            "pillar_strictness": p.pillar_strictness,
        }


# ─── Module-level helpers ─────────────────────────────────────────


def developmental_gate_live() -> bool:
    """True iff MONKEY_DEVELOPMENTAL_GATE_LIVE=true (default false)."""
    return os.environ.get("MONKEY_DEVELOPMENTAL_GATE_LIVE", "false").lower() == "true"


def stage_from_env() -> DevelopmentalStage:
    """Read MONKEY_DEVELOPMENTAL_STAGE env (default SOVEREIGN_CONSTELLATION).

    Useful for operator-set initial stage. Acceptable values match the
    StrEnum values (case-insensitive). Unrecognised values fall back to
    SOVEREIGN_CONSTELLATION (current production behaviour).
    """
    raw = os.environ.get("MONKEY_DEVELOPMENTAL_STAGE", "").strip().lower()
    for stage in DevelopmentalStage:
        if stage.value == raw:
            return stage
    return DevelopmentalStage.SOVEREIGN_CONSTELLATION


__all__ = [
    "DevelopmentalStage",
    "StagePermissions",
    "DevelopmentalGate",
    "developmental_gate_live",
    "stage_from_env",
]
