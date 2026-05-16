"""regime_qigwarp.py — canonical qig_warp regime classifier.

MIG-2 (2026-05-16). The bespoke ``RegimeDetector`` has been deleted;
``qig_warp.classify_regime`` is the sole regime authority on the live
trading path. The flag-gated cutover scaffolding from issue #695
(``qig_warp_classifier_live`` + ``regime_shadow``) is also gone — the
parity work is finished.

Canonical mapping (validated against qig-warp/src/qig_warp/regime.py
and the EXP-035-E / EXP-042-E / EXP-079 experimental basis):

  qig_warp.Regime   →  MarketRegime          Physics
  ─────────────────    ─────────────────    ────────────────────────────
  CRITICAL          →  CREATOR              h/J ≈ h_c, ξ ≈ 1/φ,
                                            bridge strongest → price
                                            discovery, phase transition
                                            (Brahma: generates new
                                            structure at criticality)
  ORDERED           →  PRESERVER            h/J ≪ h_c, J-dominated →
                                            trending, orderly, low
                                            noise (Vishnu: maintains
                                            structure)
  DISORDERED        →  DISSOLVER            h/J ≫ h_c, h-dominated →
                                            high noise without trend
                                            (Shiva: structure dissolves
                                            into noise)

Inputs are computed by ``lattice_inputs.market_to_lattice_inputs``
from a window of log returns and passed in here as ``(h, J, dim=2)``.

Failure mode: raises ``RuntimeError`` on qig_warp import failure,
classifier exception, or unrecognised regime value. After MIG-1
``qig_warp`` is pinned in ``requirements.txt`` and the bespoke fallback
is gone — an unreachable classifier means the deploy is broken and
must not be papered over.
"""

from __future__ import annotations

import logging

from .regime import MarketRegime

logger = logging.getLogger(__name__)


# Canonical mapping. String-keyed against the lowercased
# ``qig_warp.Regime.value`` (with ``.name`` fallback) so the import
# resolution and string comparison can't both fail in one step.
_WARP_TO_MARKET: dict[str, MarketRegime] = {
    "critical":   MarketRegime.CREATOR,
    "ordered":    MarketRegime.PRESERVER,
    "disordered": MarketRegime.DISSOLVER,
}


def map_warp_to_market(warp_regime: str | None) -> MarketRegime | None:
    """Translate a ``qig_warp.Regime`` label into a ``MarketRegime``.

    Accepts the enum's ``.value`` or ``.name`` (both lowercased here).
    Returns ``None`` for empty / unrecognised inputs so callers writing
    pure-mapping code (tests, ops tools) can branch without raising.
    """
    if not warp_regime:
        return None
    return _WARP_TO_MARKET.get(warp_regime.strip().lower())


def classify_with_qig_warp(h: float, j: float, dim: int = 2) -> MarketRegime:
    """Call ``qig_warp.classify_regime(h, J, dim)`` and map the result.

    Inputs:
      h:   Shannon entropy of the recent log-return distribution
      j:   |mean / std| of the same returns (coupling strength / J)
      dim: lattice dimension (default 2 — canonical CRITICAL_RATIO_2D)

    Raises ``RuntimeError`` on:
      - qig_warp import failure (deploy is broken; do not paper over)
      - classifier raising (caller may catch + retry; do not hide)
      - unrecognised qig_warp.Regime label (likely a qig-warp version
        bump that introduced a regime we haven't mapped — surface so
        the upgrade can be reconciled)
    """
    try:
        from qig_warp import classify_regime  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "qig_warp is unavailable — ml-worker deploy is broken; "
            "qig-warp is a hard requirement post-MIG-1",
        ) from exc
    try:
        warp_regime = classify_regime(h=float(h), J=float(j), dim=int(dim))
    except Exception as exc:  # noqa: BLE001 — wrap and re-raise with context
        raise RuntimeError(
            f"qig_warp.classify_regime raised on (h={h:.4f}, J={j:.4f}, "
            f"dim={dim}): {type(exc).__name__}: {exc}",
        ) from exc
    label = (
        getattr(warp_regime, "value", None)
        or getattr(warp_regime, "name", None)
        or str(warp_regime)
    )
    mapped = map_warp_to_market(label)
    if mapped is None:
        raise RuntimeError(
            f"qig_warp returned unrecognised regime {label!r} — "
            "mapping table in regime_qigwarp.py needs reconciliation",
        )
    return mapped
