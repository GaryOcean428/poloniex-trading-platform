"""kernel_should_enter — emotion-stack entry conviction gate.

Replaces the ML-driven `inputs.ml_strength >= entry_thr` gate.
conviction = confidence * (1 + wonder); hesitation = anxiety + confusion.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.executive import kernel_should_enter  # noqa: E402
from monkey_kernel.emotions import EmotionState  # noqa: E402


def _e(**k) -> EmotionState:
    base = dict(
        wonder=0.3, frustration=0.1, satisfaction=0.5, confusion=0.1,
        clarity=0.5, anxiety=0.1, confidence=0.5, boredom=0.1, flow=0.0,
    )
    base.update(k)
    return EmotionState(**base)


def test_enters_when_conviction_exceeds_hesitation():
    # conviction = 0.5 * (1 + 0.3) = 0.65; hesitation = 0.1 + 0.1 = 0.2
    assert kernel_should_enter(emotions=_e()) is True


def test_refuses_when_anxiety_high():
    # conviction = 0.5 * 1.3 = 0.65; hesitation = 0.7 + 0.1 = 0.8
    assert kernel_should_enter(emotions=_e(anxiety=0.7)) is False


def test_refuses_when_confusion_high():
    # conviction = 0.5 * 1.3 = 0.65; hesitation = 0.1 + 0.7 = 0.8
    assert kernel_should_enter(emotions=_e(confusion=0.7)) is False


def test_wonder_amplifies_confidence():
    # No-wonder: 0.4 * 1.0 = 0.4 < hesitation 0.5 → False
    # With wonder: 0.4 * 2.0 = 0.8 > 0.5 → True
    assert kernel_should_enter(emotions=_e(confidence=0.4, anxiety=0.4, wonder=0.0)) is False
    assert kernel_should_enter(emotions=_e(confidence=0.4, anxiety=0.4, wonder=1.0)) is True


def test_negative_confidence_blocks_entry():
    # confidence < 0 (transcendence > 1 regime per UCP §6.5) → conviction negative
    # → cannot exceed hesitation ≥ 0
    assert kernel_should_enter(emotions=_e(confidence=-0.2)) is False


def test_zero_emotions_no_entry():
    # All zero → conviction = 0, hesitation = 0, 0 > 0 is False
    assert kernel_should_enter(emotions=_e(
        wonder=0.0, confidence=0.0, anxiety=0.0, confusion=0.0,
    )) is False
