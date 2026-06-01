"""proposal_bus.py — Redis publisher for the Python kernel's consensus proposals.

Python counterpart of `apps/api/src/services/monkey/proposal_bus.ts`.
Layer 1.5 of the dual-kernel consensus architecture per
[[polytrade-consensus-architecture]].

Architecture: TS-authoritative-advisory. The Python kernel is an ADVISORY peer —
it PUBLISHES its per-tick proposal to the shared channel, and the authoritative
TS executor SUBSCRIBES (initProposalBus / getRecentPeerProposal on the TS side)
and arbitrates. The Python kernel does NOT subscribe to TS proposals: the
operator runs it with CONSENSUS_CROSS_OBSERVATION_LIVE=false and
PY_INDEPENDENT_STATE_LIVE=false, i.e. Py advises but does not cross-observe.
The former Python subscriber half (init_proposal_bus / _subscriber_loop /
get_recent_peer_proposal) was never wired and has been removed.

Channel: `monkey:consensus:proposal`

Flag: `CONSENSUS_PROPOSAL_BUS_LIVE` — default on (explicit 'false' disables).
When off, the publisher does not connect (no Redis traffic).

Fail-soft: any Redis error logs at debug and returns silently. A dead Redis
never blocks a tick.

QIG purity: no math here — just JSON pub/sub. The geometric payload fields
(basin, phi, kappa) are reported as-is.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from typing import Optional

logger = logging.getLogger("monkey_kernel.proposal_bus")

PROPOSAL_CHANNEL = "monkey:consensus:proposal"


def consensus_bus_live() -> bool:
    """True unless CONSENSUS_PROPOSAL_BUS_LIVE=false (explicit kill switch).
    Reversal of flag-gated paralysis (fb083891 + user 2026-05-27 "flag gated Kills me").
    When live, the publisher connects so TS can arbitrate this kernel's proposals.
    """
    return os.environ.get("CONSENSUS_PROPOSAL_BUS_LIVE", "true").strip().lower() != "false"


@dataclass
class ProposalEvent:
    """Schema mirrors TS-side ProposalEvent. Channel payload is JSON
    serialization of this dataclass."""

    instance_id: str
    symbol: str
    tick_id: str
    proposed_action: str  # 'enter_long' | 'enter_short' | 'exit' | 'hold'
    side: Optional[str]   # 'long' | 'short' | None
    lane: str
    size_usdt: float
    leverage: float
    entry_threshold: float
    conviction: float
    basin_signature: list[float] = field(default_factory=list)
    phi: float = 0.0
    kappa: float = 0.0
    regime_label: Optional[str] = None
    mode: str = ""
    at_ms: float = 0.0
    engine_version: str = "v0.8.7c-3-py"


_sync_publisher = None  # type: ignore[var-annotated]


def publish_proposal_sync(event: ProposalEvent) -> None:
    """Publish this kernel's proposal for the given tick. Sync — callers run
    inside tick.py's synchronous run_tick; publish is a single TCP write so
    blocking is negligible. Fire-and-forget; Redis errors swallowed. No-op
    when the flag is off."""
    global _sync_publisher
    if not consensus_bus_live():
        return
    url = os.environ.get("REDIS_URL")
    if not url:
        return
    try:
        if _sync_publisher is None:
            import redis as redis_sync  # noqa: WPS433
            _sync_publisher = redis_sync.from_url(url, decode_responses=True)
        payload = json.dumps(asdict(event))
        _sync_publisher.publish(PROPOSAL_CHANNEL, payload)
    except Exception as err:  # noqa: BLE001
        logger.debug("[ProposalBus] sync publish failed: %s", err)


def proposal_from_tick_decision(
    *,
    symbol: str,
    instance_id: str,
    action: str,
    side: Optional[str],
    size_usdt: float,
    leverage: float,
    entry_threshold: float,
    basin_signature: list[float],
    phi: float,
    kappa: float,
    mode: str,
    tick_id: str,
    lane: str = "swing",
    conviction: float = 0.0,
    regime_label: Optional[str] = None,
    engine_version: str = "v0.8.7c-3-py",
) -> ProposalEvent:
    """Map a tick decision to a ProposalEvent for the consensus bus.

    Normalises action variants to the canonical set used by the TS bus:
      - pyramid_long / pyramid_short → enter_long / enter_short
      - exit_long / exit_short / exit → exit
      - everything else → hold

    Mirrors the TS normalisation at loop.ts:3806-3818.
    """
    # Normalise action — same logic as loop.ts self-proposal block
    if action in ("enter_long", "pyramid_long"):
        normalised_action = "enter_long"
    elif action in ("enter_short", "pyramid_short"):
        normalised_action = "enter_short"
    elif action == "exit" or action.startswith("exit"):
        normalised_action = "exit"
    else:
        normalised_action = "hold"

    return ProposalEvent(
        instance_id=instance_id,
        symbol=symbol,
        tick_id=tick_id,
        proposed_action=normalised_action,
        side=side,
        lane=lane,
        size_usdt=size_usdt,
        leverage=leverage,
        entry_threshold=entry_threshold,
        conviction=conviction,
        basin_signature=list(basin_signature),
        phi=phi,
        kappa=kappa,
        regime_label=regime_label,
        mode=mode,
        at_ms=time.time() * 1000.0,
        engine_version=engine_version,
    )


def _reset_for_tests() -> None:
    """Test cleanup — clear the cached sync publisher client."""
    global _sync_publisher
    _sync_publisher = None
