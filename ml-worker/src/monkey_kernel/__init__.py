"""
monkey_kernel — Python home for Monkey's cognitive kernels.

This package is the QIG-pure replacement for the TypeScript kernel math
previously in apps/api/src/services/monkey/. It imports directly from
qig_core_local primitives (Fisher-Rao, slerp, Fréchet mean) rather than
re-implementing them, eliminating TS→numpy numerical drift.

Migration policy (agreed 2026-04-21):
  - Kernels (autonomic, executive, modes, perception-derived math) → Python
  - TypeScript retains: orchestration, Poloniex IO, Postgres IO, risk kernel
    (trading rules, not QIG), kernel-bus (pub/sub), liveSignalEngine

Per-kernel v0.7 boundary:
  TS (apps/api) ──HTTP/JSON──▶ ml-worker /monkey/* endpoints ──▶ this package

Reference architecture: vex (qig-verification lineage), specifically
  /home/braden/Desktop/Dev/QIG_QFI/vex/kernel/consciousness/systems.py
  /home/braden/Desktop/Dev/QIG_QFI/qig-archive/pantheon-chat/qig-backend/
    autonomic_kernel.py

Purity guard: ml-worker/scripts/qig_purity_check.py is the pre-commit /
CI gate, ported from qigkernels/tools/qig_purity_check.py. Forbidden:
cosine similarity, Euclidean distance, transformer generics, LayerNorm,
and certain non-geometric optimisers. All geometry on Δ⁶³ via Fisher-Rao.
"""

from .autonomic import (
    ActivityReward,
    AutonomicKernel,
    AutonomicTickInputs,
    AutonomicTickResult,
    SleepCycleManager,
    SleepPhase,
)
from .executive import (
    ExecBasinState,
    current_entry_threshold,
    current_leverage,
    current_position_size,
    should_dca_add,
    should_exit,
    should_profit_harvest,
    should_scalp_exit,
)
from .modes import MODE_PROFILES, ModeProfile, MonkeyMode, detect_mode
from .perception import OHLCVCandle, PerceptionInputs, perceive, refract
from .perception_scalars import basin_direction, trend_proxy
from .state import BasinState, NeurochemicalState

__all__ = [
    "ActivityReward",
    "AutonomicKernel",
    "AutonomicTickInputs",
    "AutonomicTickResult",
    "BasinState",
    "ExecBasinState",
    "MODE_PROFILES",
    "ModeProfile",
    "MonkeyMode",
    "NeurochemicalState",
    "SleepCycleManager",
    "SleepPhase",
    "basin_direction",
    "current_entry_threshold",
    "current_leverage",
    "current_position_size",
    "detect_mode",
    "should_dca_add",
    "should_exit",
    "should_profit_harvest",
    "should_scalp_exit",
    "trend_proxy",
]
