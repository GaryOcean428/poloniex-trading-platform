"""regime_qigwarp.py — flag-gated cutover from bespoke RegimeDetector
to the published ``qig_warp.classify_regime`` on the v0.8 StrategyLoop
trading path.

Issue #695 surfaced that ``qig_warp`` and ``qig_compute`` are declared
in ``requirements.txt`` and imported, but unreachable on the live
``ROUTE_VERSION=v0.8`` route — the trading layer reinvented what the
published packages already do. The ``regime_shadow.py`` infrastructure
ran the published classifier in parallel and emitted a parity log via
``/governance/regime-parity`` for operator review.

This module is the cutover. Mapping is intentionally explicit so the
operator can read what the swap does:

  qig_warp.Regime      MarketRegime          rationale
  ─────────────────    ─────────────────    ────────────────────────────
  CRITICAL             CREATOR              phase transition / high
                                            disorder pressure → "price
                                            discovery, volatile"
  ORDERED              PRESERVER            low entropy + coupled →
                                            "trending, orderly"
  DISORDERED           DISSOLVER            no structure, decoupled →
                                            "dead market, noise"

The shadow's calibration (h ← entropy, J ← trend_strength, dim = 2)
is preserved verbatim — that's what the parity log was collected
against. If the parity log distribution shows a calibration error,
the fix is to adjust the h/J transforms HERE, not change the
mapping table — the mapping above is canonical per the docstring
intent of both ``MarketRegime`` and ``qig_warp.Regime``.

Default OFF. Flip via env: ``REGIME_CLASSIFIER=qig_warp``. Other
values (or unset) keep the bespoke ``RegimeDetector`` live. The
shadow continues to log diffs in both directions so the operator
can confirm the swap behaves as the parity data predicted.

Out of scope: issue #711 (TS K vs Py K kernel regime classifier
divergence) is a different module — ``apps/api/src/services/monkey/
regime.ts`` and ``ml-worker/src/monkey_kernel/regime.py`` produce
TREND_UP/CHOP/TREND_DOWN labels for K-kernel decisions, not the
CREATOR/PRESERVER/DISSOLVER labels this module handles. The K-kernel
divergence needs its own work — they share no code with this path.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from .regime import MarketRegime, RegimeState

logger = logging.getLogger(__name__)


def qig_warp_classifier_live() -> bool:
    """Default-off env flag controlling the regime classifier swap.

    Returns True only when ``REGIME_CLASSIFIER`` is exactly
    ``qig_warp`` (case-insensitive, whitespace-trimmed). Any other
    value or unset keeps the bespoke ``RegimeDetector`` live.

    Per the #689 cutover discipline, this flag exists so the operator
    can flip the swap after reviewing parity data, then unflip it if
    live behaviour diverges from the parity-log prediction.
    """
    return os.environ.get("REGIME_CLASSIFIER", "").strip().lower() == "qig_warp"


# Canonical mapping from qig_warp's published regime enum to the
# bot-internal MarketRegime. Keep the comparisons string-based so an
# import failure of qig_warp can't break this module's surface.
_WARP_TO_MARKET: dict[str, MarketRegime] = {
    "critical": MarketRegime.CREATOR,
    "ordered": MarketRegime.PRESERVER,
    "disordered": MarketRegime.DISSOLVER,
}


def map_warp_to_market(warp_regime: str) -> Optional[MarketRegime]:
    """Translate a ``qig_warp.Regime`` name into a ``MarketRegime``.

    Accepts the enum's ``.value`` or ``.name`` (both lowercased
    here). Returns ``None`` for unrecognised values so the caller can
    decide whether to fall back to the bespoke classifier or skip.
    """
    if not warp_regime:
        return None
    return _WARP_TO_MARKET.get(warp_regime.strip().lower())


def classify_with_qig_warp(
    regime_state: RegimeState,
) -> Optional[MarketRegime]:
    """Run ``qig_warp.classify_regime`` against an already-computed
    ``RegimeState`` and translate to ``MarketRegime``.

    Same calibration as the shadow path (h = entropy, J =
    trend_strength, dim = 2). Returns ``None`` on any failure —
    qig_warp import error, classifier exception, or unrecognised
    enum value — so the caller can fall back to the bespoke output.

    Never raises. The whole point of this module is to be the safe
    switch behind a flag; if the published path explodes, the live
    path keeps running on the bespoke ``RegimeDetector``.
    """
    if regime_state is None:
        return None
    try:
        from qig_warp import classify_regime  # type: ignore[import-not-found]
        warp_regime = classify_regime(
            h=float(regime_state.entropy),
            J=float(regime_state.trend_strength),
            dim=2,
        )
        # qig_warp.Regime exposes .value (preferred) or .name; map_warp_to_market
        # accepts either as a string.
        as_str = getattr(warp_regime, "value", None) or getattr(
            warp_regime, "name", str(warp_regime),
        )
        mapped = map_warp_to_market(as_str)
        if mapped is None:
            logger.warning(
                "[regime_qigwarp] unmapped warp regime %r — falling back to bespoke",
                as_str,
            )
        return mapped
    except ImportError as exc:
        logger.warning(
            "[regime_qigwarp] qig_warp import failed — falling back to bespoke: %s",
            exc,
        )
        return None
    except Exception as exc:  # noqa: BLE001 — never break live on shadow path
        logger.warning(
            "[regime_qigwarp] classify failed — falling back to bespoke: %s",
            exc,
        )
        return None
