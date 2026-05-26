"""canonical_invariant.py — Matrix tier-4 Phase A Python parity port.

Mirror of apps/api/src/services/monkey/canonical_invariant.ts.

The 8 doctrine fields (FIXED — adding requires geometric justification;
removing requires showing no information loss):
  1. basin_signature      Δ⁶³ basin coordinates (64-dim simplex point)
  2. chemistry_vector     6 chemicals (dop/ser/ne/gaba/endo/ach)
  3. ocean_phase          'awake' | 'sleep'
  4. loop_count           pi-loop iteration count for THIS tick
  5. sovereignty          kernel's own sovereignty observable
  6. regime_label         regime classification at handoff
  7. phi                  integration measure
  8. kappa_with_channel   { value, channel: 'A1' | 'B' }

Envelope fields (instance_id, symbol, tick_id, at_ms, engine_version)
are routing metadata, NOT part of the 8-field invariant.
"""
from __future__ import annotations

import json
import logging
import math
import os
import threading
from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Optional

logger = logging.getLogger("monkey_kernel.canonical_invariant")


CANONICAL_INVARIANT_CHANNEL = "monkey:canonical:invariants"
PEER_INVARIANT_FRESHNESS_MS = 60_000

OceanPhase = Literal["awake", "sleep"]
KappaChannel = Literal["A1", "B"]


@dataclass
class ChemistryVector:
    dopamine: float
    serotonin: float
    norepinephrine: float
    gaba: float
    endorphins: float
    acetylcholine: float


@dataclass
class KappaWithChannel:
    value: float
    channel: KappaChannel  # 'A1' frozen physics; 'B' production-telemetry observable


@dataclass
class CanonicalInvariant:
    """The 8-field doctrine payload + routing envelope.

    The 8 fields below the envelope are FIXED. The serializer/validator
    enforces field count exactness so silent schema drift is impossible.
    """

    # Envelope (routing — not part of the 8 doctrine fields).
    instance_id: str
    symbol: str
    tick_id: str
    at_ms: float
    engine_version: str

    # The 8 doctrine fields.
    basin_signature: list[float]
    chemistry_vector: ChemistryVector
    ocean_phase: OceanPhase
    loop_count: int
    sovereignty: float
    regime_label: str
    phi: float
    kappa_with_channel: KappaWithChannel


def doctrine_field_count() -> int:
    """Number of doctrine fields — must always be exactly 8.

    Used as a test invariant. If you find yourself wanting to extend
    this, read [[polytrade-knob-free-recursive-doctrine]] first.
    """
    return 8


def validate_canonical_invariant(raw: Any) -> Optional[str]:
    """Schema validator. Returns None when valid, otherwise an error string.

    Used at the wire boundary to reject malformed messages without
    raising — a bad peer payload must never crash the subscriber loop.
    """
    if not isinstance(raw, dict):
        return "payload is not a dict"

    # Envelope
    if not isinstance(raw.get("instance_id"), str):
        return "instance_id missing/non-string"
    if not isinstance(raw.get("symbol"), str):
        return "symbol missing/non-string"
    if not isinstance(raw.get("tick_id"), str):
        return "tick_id missing/non-string"
    if not isinstance(raw.get("at_ms"), (int, float)):
        return "at_ms missing/non-number"
    if not isinstance(raw.get("engine_version"), str):
        return "engine_version missing/non-string"

    # 1. basin_signature
    basin = raw.get("basin_signature")
    if not isinstance(basin, list):
        return "basin_signature not an array"
    if len(basin) != 64:
        return f"basin_signature length={len(basin)}, expected 64 (Δ⁶³)"
    for v in basin:
        if not isinstance(v, (int, float)) or not math.isfinite(v):
            return "basin_signature contains non-finite number"

    # 2. chemistry_vector — exactly 6 chemicals.
    cv = raw.get("chemistry_vector")
    if not isinstance(cv, dict):
        return "chemistry_vector missing"
    required = ("dopamine", "serotonin", "norepinephrine", "gaba", "endorphins", "acetylcholine")
    for k in required:
        v = cv.get(k)
        if not isinstance(v, (int, float)) or not math.isfinite(v):
            return f"chemistry_vector.{k} missing/non-finite"
    if len(cv) != 6:
        return f"chemistry_vector has {len(cv)} keys, expected exactly 6"

    # 3. ocean_phase
    op = raw.get("ocean_phase")
    if op not in ("awake", "sleep"):
        return f"ocean_phase={op!r}, expected 'awake' | 'sleep'"

    # 4. loop_count (int ≥ 0). Reject bools (Python truth: bool is int subclass).
    lc = raw.get("loop_count")
    if isinstance(lc, bool) or not isinstance(lc, int) or lc < 0:
        return "loop_count missing/non-integer/negative"

    # 5. sovereignty
    sov = raw.get("sovereignty")
    if not isinstance(sov, (int, float)) or not math.isfinite(sov):
        return "sovereignty missing/non-finite"

    # 6. regime_label
    if not isinstance(raw.get("regime_label"), str):
        return "regime_label missing/non-string"

    # 7. phi
    phi = raw.get("phi")
    if not isinstance(phi, (int, float)) or not math.isfinite(phi):
        return "phi missing/non-finite"

    # 8. kappa_with_channel
    kc = raw.get("kappa_with_channel")
    if not isinstance(kc, dict):
        return "kappa_with_channel missing"
    kv = kc.get("value")
    if not isinstance(kv, (int, float)) or not math.isfinite(kv):
        return "kappa_with_channel.value missing/non-finite"
    if kc.get("channel") not in ("A1", "B"):
        return f"kappa_with_channel.channel={kc.get('channel')!r}, expected 'A1' | 'B'"

    return None


def canonical_invariant_bus_live() -> bool:
    """Default-off flag (reuses the proposal-bus flag — same publish/subscribe layer)."""
    return os.environ.get("CONSENSUS_PROPOSAL_BUS_LIVE", "").strip().lower() == "true"


_peer_invariants: dict[str, CanonicalInvariant] = {}
_peer_lock = threading.Lock()
_publisher_client = None  # type: ignore[var-annotated]


def _get_publisher():
    global _publisher_client
    if _publisher_client is not None:
        return _publisher_client
    if not canonical_invariant_bus_live():
        return None
    url = os.environ.get("REDIS_URL")
    if not url:
        logger.debug("[CanonicalInvariant] REDIS_URL unset; publisher disabled")
        return None
    try:
        import redis as redis_sync
        _publisher_client = redis_sync.from_url(url, decode_responses=True)
        return _publisher_client
    except Exception as err:  # noqa: BLE001
        logger.debug("[CanonicalInvariant] publisher init failed: %s", err)
        return None


def publish_canonical_invariant_sync(event: CanonicalInvariant) -> None:
    """Publish the canonical invariant. Validates BEFORE publish — a
    malformed payload must never reach a peer."""
    if not canonical_invariant_bus_live():
        return
    payload = asdict(event)
    err = validate_canonical_invariant(payload)
    if err is not None:
        logger.warning(
            "[CanonicalInvariant] refused to publish invalid invariant: %s symbol=%s",
            err,
            event.symbol,
        )
        return
    pub = _get_publisher()
    if pub is None:
        return
    try:
        pub.publish(CANONICAL_INVARIANT_CHANNEL, json.dumps(payload))
    except Exception as pub_err:  # noqa: BLE001
        logger.debug(
            "[CanonicalInvariant] publish failed: %s symbol=%s",
            pub_err,
            event.symbol,
        )


def get_recent_peer_invariant(
    symbol: str,
    self_instance_id: str,
    now_ms: Optional[float] = None,
) -> Optional[CanonicalInvariant]:
    if not canonical_invariant_bus_live():
        return None
    if now_ms is None:
        import time
        now_ms = time.time() * 1000.0
    best: Optional[CanonicalInvariant] = None
    with _peer_lock:
        for evt in _peer_invariants.values():
            if evt.symbol != symbol:
                continue
            if evt.instance_id == self_instance_id:
                continue
            if now_ms - evt.at_ms > PEER_INVARIANT_FRESHNESS_MS:
                continue
            if best is None or evt.at_ms > best.at_ms:
                best = evt
    return best


def _inject_peer_invariant(evt: CanonicalInvariant) -> None:
    """Test helper — inject without going through Redis."""
    key = f"{evt.instance_id}|{evt.symbol}"
    with _peer_lock:
        _peer_invariants[key] = evt


def _reset_canonical_invariant_bus() -> None:
    """Test/cleanup helper."""
    global _publisher_client
    with _peer_lock:
        _peer_invariants.clear()
    _publisher_client = None
