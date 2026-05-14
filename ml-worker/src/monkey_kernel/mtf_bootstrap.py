"""mtf_bootstrap.py — pre-warm per-timeframe basin histories at startup.

Python port of apps/api/src/services/monkey/mtfBootstrap.ts (PR #671).

Without this, the 4h MTF instance needs ~480 samples * 4h each = 80
days of live ticks before producing decisions. Live warmup is
unworkable for anything beyond 15m.

Bootstrap reads enough OHLCV candles per timeframe to synthesise
basins via perceive() at the target cadence, then populates the
per-timeframe history via set_bootstrap_history().

QIG purity: basins synthesised by the existing perceive() function —
same path used live. No new banned operations, no shortcuts.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np

from .mtf_l_classifier import MTFState, TimeframeLabel, set_bootstrap_history
from .perception import OHLCVCandle, PerceptionInputs, perceive

logger = logging.getLogger("monkey_kernel.mtf_bootstrap")


# How many candles to request per timeframe. Slightly more than the
# warmup minimum (480 + 120 horizon = 600) so the classifier is warm
# immediately at startup.
BOOTSTRAP_CANDLE_COUNT = 700

# Poloniex v3 granularities (in minutes) keyed by timeframe label.
POLONIEX_GRANULARITY_FOR_TF: dict[TimeframeLabel, int] = {
    "15m": 15,
    "1h": 60,
    "4h": 240,
}

# Sliding window for perceive() — matches the live perceive call's
# input shape. Skipping the first PERCEIVE_WINDOW candles ensures each
# basin has a full lookback.
PERCEIVE_WINDOW = 50


async def bootstrap_mtf_for_symbol(
    symbol: str,
    state: MTFState,
    *,
    fetch_klines,  # callable: (symbol, granularity_min, limit) -> list[OHLCVCandle]
) -> None:
    """Pull OHLCV at each timeframe's resolution and synthesise basins
    for the bootstrap.

    Errors (network, parse, perceive raises) caught and logged; the
    function returns with whatever it managed to compute. The MTF state
    warms up gradually from live ticks if bootstrap is empty.
    """
    for label in ("15m", "1h", "4h"):
        try:
            granularity = POLONIEX_GRANULARITY_FOR_TF[label]
            candles = await fetch_klines(symbol, granularity, BOOTSTRAP_CANDLE_COUNT)
            if candles is None or len(candles) < 100:
                logger.warning(
                    "[MTF-bootstrap] insufficient OHLCV from exchange",
                    extra={
                        "symbol": symbol,
                        "label": label,
                        "got": 0 if candles is None else len(candles),
                    },
                )
                continue

            basins: list[np.ndarray] = []
            for i in range(PERCEIVE_WINDOW, len(candles)):
                window = list(candles[i - PERCEIVE_WINDOW : i + 1])
                try:
                    basin = perceive(PerceptionInputs(
                        ohlcv=window,
                        equity_fraction=1.0,
                        margin_fraction=0.0,
                        open_positions=0,
                        session_age_ticks=0,
                        # ml_* fields default to neutral
                    ))
                    basins.append(basin)
                except Exception:  # noqa: BLE001
                    # Skip this bar; basin synthesis will be sparser
                    # but still useful for the classifier.
                    continue

            set_bootstrap_history(state, label, basins)
            logger.info(
                "[MTF-bootstrap] populated history",
                extra={"symbol": symbol, "label": label, "basins": len(basins)},
            )
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "[MTF-bootstrap] failed for timeframe",
                extra={"symbol": symbol, "label": label, "err": str(err)},
            )


def parse_poloniex_kline_row(row: list) -> Optional[OHLCVCandle]:
    """Best-effort parse for the Poloniex v3 kline shape.

    v3 futures kline rows arrive as ``[ts, open, high, low, close, vol, ...]``;
    different endpoints occasionally reorder. We accept the v3 shape and
    drop the row on parse failure.
    """
    try:
        ts, o, h, low, c, v = row[0], row[1], row[2], row[3], row[4], row[5]
        return OHLCVCandle(
            timestamp=int(ts),
            open=float(o),
            high=float(h),
            low=float(low),
            close=float(c),
            volume=float(v),
        )
    except (IndexError, TypeError, ValueError):
        return None
