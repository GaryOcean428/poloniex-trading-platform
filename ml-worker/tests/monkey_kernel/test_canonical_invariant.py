"""test_canonical_invariant.py — Python parity tests for Matrix tier-4
Phase A canonical 8-field invariant.

Mirrors apps/api/src/services/monkey/__tests__/canonicalInvariant.test.ts.
The two implementations MUST agree on the schema — a peer payload that
TS accepts must also be accepted by Python (and vice versa).
"""
from __future__ import annotations

import os
import sys
from dataclasses import asdict

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.canonical_invariant import (  # noqa: E402
    CanonicalInvariant,
    ChemistryVector,
    KappaWithChannel,
    doctrine_field_count,
    validate_canonical_invariant,
)


def _basin64() -> list[float]:
    return [1.0 / 64.0] * 64


def _valid(**overrides) -> dict:
    inv = CanonicalInvariant(
        instance_id="monkey-primary",
        symbol="BTC-USDT-PERP",
        tick_id="tick-001",
        at_ms=1.7e12,
        engine_version="v0.9.0-tier4-a-py",
        basin_signature=_basin64(),
        chemistry_vector=ChemistryVector(
            dopamine=0.5, serotonin=0.5, norepinephrine=0.5,
            gaba=0.5, endorphins=0.5, acetylcholine=0.5,
        ),
        ocean_phase="awake",
        loop_count=3,
        sovereignty=0.7,
        regime_label="CHOP",
        phi=0.4,
        kappa_with_channel=KappaWithChannel(value=65.0, channel="B"),
    )
    payload = asdict(inv)
    payload.update(overrides)
    return payload


def test_doctrine_field_count_is_8():
    assert doctrine_field_count() == 8


def test_valid_invariant_accepted():
    assert validate_canonical_invariant(_valid()) is None


def test_ocean_phase_sleep_accepted():
    assert validate_canonical_invariant(_valid(ocean_phase="sleep")) is None


def test_kappa_channel_a1_accepted():
    payload = _valid()
    payload["kappa_with_channel"] = {"value": 64.0, "channel": "A1"}
    assert validate_canonical_invariant(payload) is None


def test_loop_count_zero_accepted():
    assert validate_canonical_invariant(_valid(loop_count=0)) is None


def test_non_dict_rejected():
    assert validate_canonical_invariant(None) == "payload is not a dict"
    assert validate_canonical_invariant("string") == "payload is not a dict"
    assert validate_canonical_invariant(42) == "payload is not a dict"


def test_missing_envelope_rejected():
    payload = _valid()
    del payload["instance_id"]
    assert "instance_id" in (validate_canonical_invariant(payload) or "")


def test_basin_wrong_length_rejected():
    payload = _valid()
    payload["basin_signature"] = [0.0] * 32
    err = validate_canonical_invariant(payload)
    assert err is not None and "expected 64" in err


def test_basin_with_nan_rejected():
    payload = _valid()
    payload["basin_signature"] = _basin64()
    payload["basin_signature"][3] = float("nan")
    err = validate_canonical_invariant(payload)
    assert err is not None and "non-finite" in err


def test_chemistry_missing_chemical_rejected():
    payload = _valid()
    payload["chemistry_vector"] = {
        "dopamine": 0.5, "serotonin": 0.5, "norepinephrine": 0.5,
        "gaba": 0.5, "endorphins": 0.5,
        # missing acetylcholine
    }
    err = validate_canonical_invariant(payload)
    assert err is not None and "acetylcholine" in err


def test_chemistry_extra_chemical_rejected():
    """The chemistry vector is exactly 6 — adding cortisol etc. is
    schema drift and must be rejected."""
    payload = _valid()
    payload["chemistry_vector"] = {
        "dopamine": 0.5, "serotonin": 0.5, "norepinephrine": 0.5,
        "gaba": 0.5, "endorphins": 0.5, "acetylcholine": 0.5,
        "cortisol": 0.5,
    }
    err = validate_canonical_invariant(payload)
    assert err is not None and "exactly 6" in err


def test_ocean_phase_invalid_rejected():
    err = validate_canonical_invariant(_valid(ocean_phase="dream"))
    assert err is not None and "expected" in err


def test_kappa_channel_invalid_rejected():
    payload = _valid()
    payload["kappa_with_channel"] = {"value": 64.0, "channel": "C"}
    err = validate_canonical_invariant(payload)
    assert err is not None and "A1" in err and "B" in err


def test_loop_count_negative_rejected():
    err = validate_canonical_invariant(_valid(loop_count=-1))
    assert err is not None and "negative" in err


def test_loop_count_non_integer_rejected():
    err = validate_canonical_invariant(_valid(loop_count=2.5))
    assert err is not None and "integer" in err


def test_loop_count_bool_rejected():
    """In Python, bool is a subclass of int — must be excluded explicitly."""
    err = validate_canonical_invariant(_valid(loop_count=True))
    assert err is not None and "integer" in err


def test_non_finite_phi_rejected():
    err = validate_canonical_invariant(_valid(phi=float("inf")))
    assert err is not None and "phi" in err


def test_non_finite_sovereignty_rejected():
    err = validate_canonical_invariant(_valid(sovereignty=float("nan")))
    assert err is not None and "sovereignty" in err
