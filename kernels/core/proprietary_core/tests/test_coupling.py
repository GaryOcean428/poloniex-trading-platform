"""Tests for the coupling estimator."""

import numpy as np
import pytest

from proprietary_core.coupling import CouplingEstimator


def test_positive_coupling():
    """Positively correlated signal and P&L should give κ > 0."""
    rng = np.random.default_rng(42)
    est = CouplingEstimator(window=30, min_samples=10)

    for _ in range(50):
        signal = rng.normal(0, 1)
        pnl = 2.0 * signal + rng.normal(0, 0.1)  # strong positive coupling
        state = est.update(signal, pnl)

    assert state is not None
    assert state.kappa > 1.5
    assert state.r_squared > 0.9
    assert state.is_coupled is True
    assert state.is_inverted is False


def test_negative_coupling():
    """Inversely correlated signal and P&L should give κ < 0."""
    rng = np.random.default_rng(42)
    est = CouplingEstimator(window=30, min_samples=10)

    for _ in range(50):
        signal = rng.normal(0, 1)
        pnl = -1.5 * signal + rng.normal(0, 0.1)
        state = est.update(signal, pnl)

    assert state is not None
    assert state.kappa < -1.0
    assert state.is_inverted is True


def test_no_coupling():
    """Uncorrelated signal and P&L should give R² near 0."""
    rng = np.random.default_rng(42)
    est = CouplingEstimator(window=30, min_samples=10)

    for _ in range(50):
        signal = rng.normal(0, 1)
        pnl = rng.normal(0, 1)  # independent
        state = est.update(signal, pnl)

    assert state is not None
    assert state.r_squared < 0.3
    assert state.is_coupled is False


def test_stud_crossing():
    """κ sign change should be detected."""
    est = CouplingEstimator(window=15, min_samples=10)
    rng = np.random.default_rng(42)

    # Phase 1: positive coupling
    for _ in range(20):
        s = rng.normal(0, 1)
        est.update(s, 2.0 * s + rng.normal(0, 0.05))

    # Phase 2: negative coupling
    crossings = []
    for _ in range(20):
        s = rng.normal(0, 1)
        state = est.update(s, -2.0 * s + rng.normal(0, 0.05))
        if state and state.stud_crossing:
            crossings.append(state)

    assert len(crossings) > 0, "Expected at least one stud crossing"
