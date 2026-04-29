"""kernel_direction — geometry-only side read with emotion conviction gate.

Replaces the ML-driven `side_candidate = ml_side` path. Direction
derives from basin_dir + 0.5 * tape_trend; emotions.confidence < anxiety
short-circuits to flat.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.executive import kernel_direction  # noqa: E402
from monkey_kernel.emotions import EmotionState  # noqa: E402


def _emotions(confidence: float = 0.5, anxiety: float = 0.1, **k) -> EmotionState:
    return EmotionState(
        wonder=k.get("wonder", 0.3),
        frustration=k.get("frustration", 0.1),
        satisfaction=k.get("satisfaction", 0.5),
        confusion=k.get("confusion", 0.1),
        clarity=k.get("clarity", 0.5),
        anxiety=anxiety,
        confidence=confidence,
        boredom=k.get("boredom", 0.1),
        flow=k.get("flow", 0.0),
    )


def test_long_when_basin_and_tape_positive():
    # geometric_signal = 0.4 + 0.5*0.4 = 0.6 > 0 → long
    assert kernel_direction(basin_dir=0.4, tape_trend=0.4, emotions=_emotions()) == "long"


def test_short_when_basin_and_tape_negative():
    # geometric_signal = -0.4 + 0.5*-0.4 = -0.6 < 0 → short
    assert kernel_direction(basin_dir=-0.4, tape_trend=-0.4, emotions=_emotions()) == "short"


def test_flat_when_signal_zero():
    # 0.2 + 0.5*-0.4 = 0.0 → flat
    assert kernel_direction(basin_dir=0.2, tape_trend=-0.4, emotions=_emotions()) == "flat"


def test_flat_when_anxiety_exceeds_confidence():
    # Even strong positive geometric signal short-circuits to flat
    # when conviction is dominated by anxiety.
    assert kernel_direction(
        basin_dir=0.5, tape_trend=0.5,
        emotions=_emotions(confidence=0.1, anxiety=0.5),
    ) == "flat"


def test_basin_alone_dominates_when_tape_zero():
    assert kernel_direction(basin_dir=0.3, tape_trend=0.0, emotions=_emotions()) == "long"
    assert kernel_direction(basin_dir=-0.3, tape_trend=0.0, emotions=_emotions()) == "short"


def test_tape_can_swing_weak_basin():
    # basin alone says short (-0.1), tape adds + 0.5*0.4 = +0.2 → 0.1 → long
    assert kernel_direction(basin_dir=-0.1, tape_trend=0.4, emotions=_emotions()) == "long"


def test_basin_dominates_over_weak_tape():
    # basin says long (0.3), tape adds 0.5*-0.2 = -0.1 → 0.2 → long (basin wins)
    assert kernel_direction(basin_dir=0.3, tape_trend=-0.2, emotions=_emotions()) == "long"
