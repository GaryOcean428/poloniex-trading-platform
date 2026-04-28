"""Shared scalar helpers for monkey_kernel."""

from __future__ import annotations


def clip(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    """Clamp a scalar to [lo, hi]."""
    return max(lo, min(hi, value))
