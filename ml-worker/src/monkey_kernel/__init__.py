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
from .state import BasinState, NeurochemicalState

__all__ = [
    "ActivityReward",
    "AutonomicKernel",
    "AutonomicTickInputs",
    "AutonomicTickResult",
    "BasinState",
    "NeurochemicalState",
    "SleepCycleManager",
    "SleepPhase",
]
