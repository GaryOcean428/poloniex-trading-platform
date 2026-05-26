"""Fail-soft prediction corpus publisher for the Python kernel.

Python never opens Postgres here (see basin_sync_db.py for the libpq
constraint). Snapshots are emitted to Redis for the TS bridge to persist.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .basin_sync_db import basin_sync_db_live

logger = logging.getLogger("monkey_kernel.prediction_capture")

PREDICTION_WRITE_CHANNEL = "monkey:prediction:writes"
_redis_pub_client = None  # type: ignore[var-annotated]


def _get_redis_publisher():
    global _redis_pub_client
    if _redis_pub_client is not None:
        return _redis_pub_client
    url = os.environ.get("REDIS_URL")
    if not url:
        return None
    try:
        import redis as redis_sync
        _redis_pub_client = redis_sync.from_url(url, decode_responses=True)
        return _redis_pub_client
    except Exception as err:  # noqa: BLE001
        logger.debug("[PredictionCapture] redis publisher init failed: %s", err)
        return None


def clamp_cadence_seconds(basin_velocity_running_mean: float | None) -> float:
    if basin_velocity_running_mean is None or basin_velocity_running_mean <= 0:
        return 300.0
    return min(300.0, max(5.0, 1.0 / basin_velocity_running_mean))


def prediction_direction(side: str | None) -> int:
    if side == "long":
        return 1
    if side == "short":
        return -1
    return 0


def build_prediction_payload(
    *,
    trade_id: str | None,
    kernel_id: str,
    perception_basin: np.ndarray,
    strategy_forecast_basin: np.ndarray,
    basin_velocity: float,
    phi: float,
    kappa_eff: float,
    predicted_side: str | None,
    predicted_horizon_seconds: float,
    predicted_terminal_pnl_usdt: float,
    predicted_pnl_stddev_usdt: float,
    predicted_confidence: float,
    neurochemistry: dict[str, float],
    regime_weights: dict[str, float],
    mode: str,
    lane: str,
    snapshot_reason: str,
    triggering_gate: str | None = None,
) -> dict[str, Any]:
    perception = np.asarray(perception_basin, dtype=np.float64).ravel()
    forecast = np.asarray(strategy_forecast_basin, dtype=np.float64).ravel()
    return {
        "trade_id": trade_id,
        "kernel_id": kernel_id,
        "perception_basin": [float(x) for x in perception],
        "strategy_forecast_basin": [float(x) for x in forecast],
        "fisher_rao_disagreement": float(fisher_rao_distance(perception, forecast)),
        "basin_velocity": float(basin_velocity),
        "phi": float(phi),
        "kappa_eff": float(kappa_eff),
        "predicted_horizon_seconds": float(predicted_horizon_seconds),
        "predicted_terminal_pnl_usdt": float(predicted_terminal_pnl_usdt),
        "predicted_pnl_stddev_usdt": float(predicted_pnl_stddev_usdt),
        "predicted_direction": prediction_direction(predicted_side),
        "predicted_confidence": float(max(0.0, min(1.0, predicted_confidence))),
        "neurochemistry": neurochemistry,
        "regime_weights": regime_weights,
        "mode": mode,
        "lane": lane,
        "snapshot_reason": snapshot_reason,
        "triggering_gate": triggering_gate,
        "kernel_version": "v0.8-py",
        "source_path": "ml-worker/src/monkey_kernel/tick.py",
        "at_ms": time.time() * 1000.0,
    }


def publish_prediction(payload: dict[str, Any]) -> None:
    if not basin_sync_db_live():
        return
    client = _get_redis_publisher()
    if client is None:
        return
    try:
        client.publish(PREDICTION_WRITE_CHANNEL, json.dumps(payload))
    except Exception as err:  # noqa: BLE001
        logger.debug("[PredictionCapture] redis publish failed: %s", err)
