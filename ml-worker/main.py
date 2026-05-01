"""
ML Worker FastAPI Server
Serves ML predictions via HTTP and listens on Redis pub/sub.

v0.8.3.5a — unified deploy surface (previously split between
/kernels/core/health.py and /ml-worker/main.py). /ml/predict now has
two backends coexisting behind the ROUTE_VERSION env flag:

  ROUTE_VERSION=v0.8    → StrategyLoop + RegimeDetector (deterministic,
                          matches kernels/core/health.py live behavior)
  anything else / unset → EnsemblePredictor (LSTM + Transformer + GBM
                          + ARIMA + Prophet; requires trained weights
                          at ./saved_models/)

Stage 2 Railway cut-over sets ROUTE_VERSION=v0.8 so live behavior
is preserved at deploy-flip time. The opposite backend runs in
shadow mode when ML_PREDICT_SHADOW=true, logging parity diffs to
/governance/ml-predict-parity for later promotion evidence.
"""

import asyncio
import json
import logging
import os
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Ensure src/ is on the path so models + proprietary_core can be imported
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from ensemble_predictor import EnsemblePredictor
from proprietary_core.regime import RegimeDetector  # noqa: F401  (re-exported via StrategyLoop)
from proprietary_core.strategy_loop import MarketRegime, StrategyLoop  # noqa: F401  (MarketRegime re-exported for ops)
from utils.redis_listener import (
    ListenerConfig,
    env_redis_url,
    run_resilient_listener,
    spawn_listener_thread,
)

logger = logging.getLogger("ml-worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
predictor = EnsemblePredictor()
REDIS_URL = os.environ.get("REDIS_URL", "")

# ---------------------------------------------------------------------------
# Redis pub/sub listener (background thread)
# ---------------------------------------------------------------------------

def _start_redis_listener():
    """Subscribe to ml:predict:request and publish responses.

    Proposal #1 — refactored to use ``utils.redis_listener``. The
    helper provides:
      * EINVAL-safe socket option probing (was the silent root cause
        of the 10/10-retry permanent silencing previously seen post
        Python 3.13 -> 3.12 downgrade in PR #604)
      * Exponential backoff with NO failure cap (transient outages
        no longer permanently disable pub/sub)
      * Per-attempt connection construction (no shared pool poisoning)
      * Structured ``listener=<name>`` log lines for easy grep
    """
    redis_url = env_redis_url() or REDIS_URL
    if not redis_url:
        logger.info("REDIS_URL not set — Redis pub/sub listener disabled")
        return

    cfg = ListenerConfig(
        name="ml-predict-request",
        channel="ml:predict:request",
        health_key="ml:health",
        health_ttl=90,
    )

    def _on_message(client: Any, payload: dict) -> None:
        request_id = payload.pop("requestId", None) if isinstance(payload, dict) else None
        try:
            result = _handle_predict(payload)
        except Exception as exc:
            logger.error(f"ml-predict handler error: {exc}", exc_info=True)
            if request_id:
                client.publish(
                    f"ml:predict:response:{request_id}",
                    json.dumps({"status": "error", "error": str(exc)}),
                )
            return
        if request_id:
            client.publish(
                f"ml:predict:response:{request_id}",
                json.dumps(result, default=str),
            )

    spawn_listener_thread(
        name="redis-pubsub",
        target=lambda: run_resilient_listener(
            redis_url=redis_url,
            config=cfg,
            on_message=_on_message,
        ),
    )


# ---------------------------------------------------------------------------
# Trade-outcome listener (online training data feed)
# ---------------------------------------------------------------------------

# In-memory ring buffer of recent trade outcomes. The ensemble predictor
# can read this to adjust model weights online, or a downstream training
# job can flush it to disk. Kept bounded so the process can't OOM on a
# prolonged downstream outage.
_TRADE_OUTCOMES: list[dict] = []
_TRADE_OUTCOMES_MAX = 10_000
_TRADE_OUTCOMES_LOCK = threading.Lock()


def get_recent_trade_outcomes(limit: int = 500) -> list[dict]:
    """Expose the outcome buffer for other modules (ensemble weighting,
    contextual-bandit updates, REST debug endpoint)."""
    with _TRADE_OUTCOMES_LOCK:
        return list(_TRADE_OUTCOMES[-limit:])


def _record_trade_outcome(payload: dict) -> None:
    with _TRADE_OUTCOMES_LOCK:
        _TRADE_OUTCOMES.append(payload)
        if len(_TRADE_OUTCOMES) > _TRADE_OUTCOMES_MAX:
            # Drop oldest 10% in one shot rather than per-append shift.
            del _TRADE_OUTCOMES[: _TRADE_OUTCOMES_MAX // 10]


def _start_trade_outcome_listener():
    """Subscribe to ml:trade:outcome and persist outcomes for online learning.

    This is the data-feed half of the online training loop. The trading
    loop (Node side) publishes one envelope per trade phase
    (submitted / filled / closed); this thread ingests them, writes to
    the bounded buffer, and exposes them via get_recent_trade_outcomes().

    Proposal #1 — refactored to use ``utils.redis_listener``. Same
    EINVAL-safe behavior + infinite-retry semantics as the predict
    listener. The arbiter depends on this listener staying alive — the
    previous 10-retry cap is retired.
    """
    redis_url = env_redis_url() or REDIS_URL
    if not redis_url:
        logger.info("REDIS_URL not set — trade-outcome listener disabled")
        return

    cfg = ListenerConfig(
        name="trade-outcome",
        channel="ml:trade:outcome",
    )

    def _on_message(_client: Any, payload: dict) -> None:
        _record_trade_outcome(payload)
        logger.info(
            "trade_outcome",
            extra={
                "symbol": payload.get("symbol") if isinstance(payload, dict) else None,
                "phase": payload.get("phase") if isinstance(payload, dict) else None,
                "signal": payload.get("signal") if isinstance(payload, dict) else None,
                "strength": payload.get("strength") if isinstance(payload, dict) else None,
                "realized_pnl": payload.get("realizedPnl") if isinstance(payload, dict) else None,
            },
        )

    spawn_listener_thread(
        name="trade-outcome-listener",
        target=lambda: run_resilient_listener(
            redis_url=redis_url,
            config=cfg,
            on_message=_on_message,
        ),
    )


# ---------------------------------------------------------------------------
# StrategyLoop prediction backend (v0.8.3.5a — ported from
# /kernels/core/health.py::_run_prediction)
# ---------------------------------------------------------------------------

def _strategy_to_signal(strategy_value: str, regime: str) -> dict[str, Any]:
    """Translate StrategyLoop output into the signal format expected by polytrade-be.

    Identical to kernels/core/health.py:_strategy_to_signal. Output shape
    must stay byte-for-byte compatible — polytrade-be's mlPredictionService
    is calibrated against this mapping.
    """
    strategy = strategy_value.lower()
    regime_l = regime.lower() if regime else "unknown"

    action_map = {
        "momentum": "BUY",
        "breakout": "BUY",
        "trend_follow": "BUY",
        "mean_revert": "SELL",
        "cash": "HOLD",
    }
    strength_map = {
        "momentum": 0.75,
        "breakout": 0.65,
        "trend_follow": 0.70,
        "mean_revert": 0.60,
        "cash": 0.30,
    }

    action = action_map.get(strategy, "HOLD")
    strength = strength_map.get(strategy, 0.30)
    return {
        "signal": action,
        "strength": strength,
        "reason": f"regime={regime_l} strategy={strategy}",
    }


def _regime_to_direction(regime: str, trend_strength: float) -> str:
    """Map (regime, trend_strength) → BULLISH / BEARISH / NEUTRAL.

    Identical to kernels/core/health.py:_regime_to_direction.
    """
    regime_l = (regime or "").lower()
    if regime_l == "creator" and trend_strength > 0.1:
        return "BULLISH"
    if regime_l == "preserver" and trend_strength > 0.15:
        return "BULLISH"
    if regime_l in ("dissolver",):
        return "NEUTRAL"
    if trend_strength < -0.05:
        return "BEARISH"
    return "NEUTRAL"


def _handle_predict_strategyloop(payload: dict) -> dict:
    """Deterministic regime-based predictor.

    Ported 1:1 from kernels/core/health.py:_run_prediction. Produces the
    exact signal distribution polytrade-be's risk engine is calibrated
    against. Default path once ROUTE_VERSION=v0.8 is set.
    """
    action = payload.get("action", "multi_horizon")
    symbol = payload.get("symbol", "UNKNOWN")
    data = payload.get("data", [])
    current_price = float(payload.get("current_price", 0.0))

    if action == "health":
        return {"status": "healthy", "service": "ml-worker", "models": ["regime", "strategy_loop"]}

    if not data:
        raise ValueError("No OHLCV data provided")

    prices: list[float] = []
    for candle in data:
        if isinstance(candle, dict):
            close = candle.get("close") or candle.get("c")
        else:
            close = candle
        if close is not None:
            prices.append(float(close))

    if not prices:
        raise ValueError("Could not extract close prices from data")

    if not current_price and prices:
        current_price = prices[-1]

    loop = StrategyLoop(symbol=symbol)
    decision = None
    for p in prices:
        decision = loop.tick(price=p)

    if decision is None or decision.regime is None:
        neutral_pred = {"price": current_price, "confidence": 40, "direction": "NEUTRAL"}
        if action == "signal":
            return {"signal": "HOLD", "strength": 0.3, "reason": "Insufficient data for regime detection"}
        return {"1h": neutral_pred, "4h": neutral_pred, "24h": neutral_pred}

    regime_val = decision.regime.regime.value if decision.regime else "dissolver"
    confidence_raw = decision.regime.confidence if decision.regime else 0.4
    trend_strength = decision.regime.trend_strength if decision.regime else 0.0
    direction = _regime_to_direction(regime_val, trend_strength)
    confidence_pct = int(min(max(confidence_raw * 100, 10), 95))

    if action == "signal":
        sig = _strategy_to_signal(decision.selected_strategy.value, regime_val)
        sig["strength"] = round(confidence_raw, 4)
        return sig

    horizon_decay = {"1h": 1.0, "4h": 0.85, "24h": 0.70}
    result: dict[str, Any] = {}
    for h, decay in horizon_decay.items():
        h_conf = int(min(confidence_pct * decay, 95))
        h_dir = direction if h_conf >= 45 else "NEUTRAL"
        horizon_hours = {"1h": 1, "4h": 4, "24h": 24}[h]
        price_change = trend_strength * 0.01 * horizon_hours * (1.0 if h_dir != "BEARISH" else -1.0)
        predicted_price = round(current_price * (1.0 + price_change), 8)
        result[h] = {"price": predicted_price, "confidence": h_conf, "direction": h_dir}

    if action == "predict":
        horizon = payload.get("horizon", "1h")
        return result.get(horizon, result["1h"])

    return result


# ---------------------------------------------------------------------------
# Shadow-diff ring buffer + parity telemetry (v0.8.3.5a per advisor)
# ---------------------------------------------------------------------------
#
# Every /ml/predict call can optionally fire the OTHER backend in the
# background (fire-and-forget) and record a parity-diff row. Exposed at
# /governance/ml-predict-parity on the same pattern as /governance/status
# from v0.7.11. This is the evidence stream that lets us promote
# EnsemblePredictor later — or detect it was broken before the swap.

_PARITY_LOG: list[dict[str, Any]] = []
_PARITY_LOG_MAX = 2_000
_PARITY_LOG_LOCK = threading.Lock()


def _record_parity(row: dict[str, Any]) -> None:
    with _PARITY_LOG_LOCK:
        _PARITY_LOG.append(row)
        if len(_PARITY_LOG) > _PARITY_LOG_MAX:
            del _PARITY_LOG[: _PARITY_LOG_MAX // 10]


def _shadow_compare(payload: dict, live_result: dict, live_backend: str) -> None:
    """Run the non-live backend in a thread, log the diff. Never raises.

    Called from the /ml/predict path as fire-and-forget. Latency is
    borne by the worker pool, not the caller.
    """
    shadow_backend = "ensemble" if live_backend == "strategyloop" else "strategyloop"
    started = time.monotonic()
    shadow_result: dict[str, Any] | None = None
    err: str | None = None
    try:
        if shadow_backend == "ensemble":
            shadow_result = _handle_predict_ensemble(payload)
        else:
            shadow_result = _handle_predict_strategyloop(payload)
    except Exception as exc:
        err = f"{type(exc).__name__}: {exc}"

    # For the "signal" action we can diff signal+strength cleanly. For
    # multi_horizon the shapes differ between backends — just record
    # both payloads and let downstream tooling compare fields.
    row = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action": payload.get("action"),
        "symbol": payload.get("symbol"),
        "live_backend": live_backend,
        "shadow_backend": shadow_backend,
        "live_signal": live_result.get("signal"),
        "shadow_signal": (shadow_result or {}).get("signal"),
        "live_strength": live_result.get("strength"),
        "shadow_strength": (shadow_result or {}).get("strength"),
        "shadow_error": err,
        "shadow_latency_ms": round((time.monotonic() - started) * 1000, 2),
    }
    _record_parity(row)


# ---------------------------------------------------------------------------
# Shared prediction logic (dispatcher)
# ---------------------------------------------------------------------------

def _handle_predict(payload: dict) -> dict:
    """Route /ml/predict to the selected backend.

    ROUTE_VERSION=v0.8  → StrategyLoop (live-equivalent to
                          kernels/core). Ensure this is set on
                          Railway at Stage 2 cut-over time.
    unset / anything else → EnsemblePredictor (ml-worker's
                            historical default).

    If ML_PREDICT_SHADOW=true, also fires the OTHER backend in a
    background thread for parity-diff evidence.
    """
    backend = "strategyloop" if os.environ.get("ROUTE_VERSION") == "v0.8" else "ensemble"
    live_result = (
        _handle_predict_strategyloop(payload) if backend == "strategyloop"
        else _handle_predict_ensemble(payload)
    )
    if os.environ.get("ML_PREDICT_SHADOW") == "true":
        t = threading.Thread(
            target=_shadow_compare,
            args=(payload, live_result, backend),
            daemon=True, name="ml-predict-shadow",
        )
        t.start()
    return live_result


def _handle_predict_ensemble(payload: dict) -> dict:
    """Route a prediction request to the ensemble predictor."""
    action = payload.get("action", "predict")
    symbol = payload.get("symbol", "UNKNOWN")
    raw_data = payload.get("data", [])

    if action == "health":
        return {"status": "ok", "models": ["LSTM", "Transformer", "GBM", "ARIMA", "Prophet"]}

    data = pd.DataFrame(raw_data)
    if data.empty:
        return {"status": "error", "error": "No data provided"}

    required_cols = ["timestamp", "open", "high", "low", "close", "volume"]
    missing = [c for c in required_cols if c not in data.columns]
    if missing:
        return {"status": "error", "error": f"Missing columns: {missing}"}

    data["timestamp"] = pd.to_datetime(data["timestamp"], unit="ms")
    data = data.sort_values("timestamp")

    try:
        if action == "train":
            results = predictor.train_all_models(data, symbol)
            predictor.save_models("./saved_models")
            return {"status": "success", "symbol": symbol, "training_results": results, "data_points": len(data)}

        # For prediction actions, attempt to load models (no-op if already loaded)
        try:
            predictor.load_models("./saved_models")
        except Exception:
            pass  # Models may not be trained yet

        if action == "predict":
            horizon = payload.get("horizon", "1h")
            prediction = predictor.predict(data, horizon=horizon)
            return {"status": "success", "symbol": symbol, **prediction}

        if action == "multi_horizon":
            predictions = predictor.predict_multi_horizon(data)
            return {"status": "success", "symbol": symbol, "predictions": predictions}

        if action == "signal":
            current_price = float(payload.get("current_price", 0))
            signal = predictor.get_trading_signal(data, current_price)
            return {"status": "success", "symbol": symbol, **signal}

        if action == "qig_analyze":
            # QIG physics-based market analysis (no ML models needed)
            try:
                from qig_engine import full_qig_analysis, market_state_distance
            except ImportError:
                return {"status": "error", "error": "QIG engine not available"}

            closes = data["close"].tolist()
            highs = data["high"].tolist()
            lows = data["low"].tolist()
            current_price = float(payload.get("current_price", closes[-1] if closes else 0))

            # Run full QIG analysis — regime, geometric confidence, convergence
            # Pass empty predictions dict when no ML predictions available
            ml_predictions = payload.get("predictions", {})
            analysis = full_qig_analysis(closes, highs, lows, ml_predictions, current_price)

            return {
                "status": "success",
                "symbol": symbol,
                "regime": analysis.regime.regime.value,
                "regime_confidence": analysis.regime.confidence,
                "volatility_ratio": analysis.regime.volatility_ratio,
                "trend_strength": analysis.regime.trend_strength,
                "regime_age_bars": analysis.regime.regime_age_bars,
                "recommended_strategy": analysis.regime.recommended_strategy,
                "geometric_confidence": analysis.geometric_confidence,
                "geometric_agreement": analysis.geometric_agreement,
                "regime_weights": analysis.regime_weights,
                "qig_available": analysis.qig_available,
            }

        return {"status": "error", "error": f"Unknown action: {action}"}

    except Exception as exc:
        logger.error(f"Prediction error ({action}): {exc}", exc_info=True)
        return {"status": "error", "error": str(exc), "type": type(exc).__name__}


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _start_redis_listener()
    _start_trade_outcome_listener()
    logger.info("ML worker started")
    yield
    logger.info("ML worker shutting down")


app = FastAPI(title="ML Worker", lifespan=lifespan)


# ---------------------------------------------------------------------------
# /ml/predict request shape (matches kernels/core/health.py byte-for-byte)
# ---------------------------------------------------------------------------

class PredictRequest(BaseModel):
    """Mirrors kernels/core/health.py::PredictRequest.

    Keep field names + defaults identical so Pydantic validation rejects
    the same malformed inputs on both sides. Stage 1b byte-diff testing
    depends on identical request parsing.
    """

    action: str = "multi_horizon"
    symbol: str = "UNKNOWN"
    data: list[Any] = []
    horizon: str = "1h"
    current_price: float = 0.0


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    """Liveness probe. Returns ok + basic service identity.

    Matches the shape of kernels/core/health.py::health for deploy-cut
    compatibility — Railway health-check + polytrade-be liveness code
    both rely on {"status": "ok"} being present.
    """
    return {
        "status": "ok",
        "service": "ml-worker",
        "version": "0.8.3.5a",
        "route_version": os.environ.get("ROUTE_VERSION") or "default-ensemble",
    }


@app.get("/healthz")
async def healthz():
    """Kubernetes-style readiness alias. Plain 'ok' string body —
    Railway's health-check sometimes probes /healthz instead of /health.
    """
    return JSONResponse(content={"ok": True}, status_code=200)


@app.get("/")
async def root():
    """Root handler — surfaces endpoint map for ops / curl introspection.
    Parity with kernels/core/health.py::root so flipping rootDirectory
    doesn't make this 404.
    """
    return {
        "service": "ml-worker",
        "version": "0.8.3.5a",
        "route_version": os.environ.get("ROUTE_VERSION") or "default-ensemble",
        "endpoints": {
            "health": "/health (GET)",
            "healthz": "/healthz (GET)",
            "status": "/api/status (GET)",
            "predict": "/ml/predict (POST)",
            "ingest": "/run/ingest (POST)",
            "governance_status": "/governance/status (GET)",
            "governance_ml_parity": "/governance/ml-predict-parity (GET)",
            "monkey_tick": "/monkey/tick/run (POST)",
            "monkey_autonomic_tick": "/monkey/autonomic/tick (POST)",
            "monkey_executive_decide": "/monkey/executive/decide (POST)",
            "monkey_perception_perceive": "/monkey/perception/perceive (POST)",
            "monkey_mode_detect": "/monkey/mode/detect (POST)",
        },
    }


@app.post("/ml/predict")
async def ml_predict(request: PredictRequest):
    """Dispatch to the selected backend via _handle_predict.

    Error handling mirrors kernels/core/health.py::ml_predict:
      - ValueError  → HTTP 400 (caller sent bad data)
      - other       → HTTP 500 (backend blew up)
      - success     → {"status": "success", ...result}
    """
    try:
        result = _handle_predict(request.model_dump())
        # EnsemblePredictor path may return {"status": "error", ...} rather
        # than raising — honour that shape with 422.
        if isinstance(result, dict) and result.get("status") == "error":
            return JSONResponse(content=result, status_code=422)
        return {"status": "success", **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"/ml/predict crashed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


MAX_OUTPUT_LENGTH = 4000  # subprocess tail length for /run/ingest responses


@app.post("/run/ingest")
async def run_ingest():
    """Trigger the markets-ingestion subprocess on demand.

    Ported from kernels/core/health.py::run_ingest. The ingest script
    lives at the repo root of ml-worker after the v0.8.3.5a merge.
    Requires POLONIEX_API_KEY + POLONIEX_API_SECRET env vars.
    """
    script = Path(__file__).resolve().parent / "ingest_markets.py"

    if not script.exists():
        raise HTTPException(
            status_code=500,
            detail=f"ingest_markets.py not found at {script}",
        )

    if not os.getenv("POLONIEX_API_KEY") or not os.getenv("POLONIEX_API_SECRET"):
        raise HTTPException(
            status_code=500,
            detail="POLONIEX_API_KEY and POLONIEX_API_SECRET must be set",
        )

    try:
        proc = subprocess.run(
            [sys.executable, str(script)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=str(script.parent),
            env=os.environ.copy(),
            timeout=60 * 10,
            text=True,
            check=True,
        )
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "code": 0,
                "message": "Ingestion completed successfully",
                "output": proc.stdout[-MAX_OUTPUT_LENGTH:],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
    except subprocess.TimeoutExpired as exc:
        return JSONResponse(
            status_code=504,
            content={
                "ok": False,
                "error": "timeout",
                "message": "Ingestion timed out after 10 minutes",
                "output": (exc.stdout or "")[-MAX_OUTPUT_LENGTH:] if hasattr(exc, "stdout") else "",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
    except subprocess.CalledProcessError as exc:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "code": exc.returncode,
                "error": "process_failed",
                "message": f"Ingestion failed with code {exc.returncode}",
                "output": (exc.stdout or "")[-MAX_OUTPUT_LENGTH:],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception as exc:
        logger.error(f"/run/ingest error: {exc}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": "unknown",
                "message": str(exc),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )


@app.get("/api/status")
async def api_status():
    """Operational status snapshot. Ops-only; no TS callers today."""
    return {
        "service": "ml-worker",
        "version": "0.8.3.5a",
        "route_version": os.environ.get("ROUTE_VERSION") or "default-ensemble",
        "shadow_enabled": os.environ.get("ML_PREDICT_SHADOW") == "true",
        "redis_configured": bool(REDIS_URL),
        "trade_outcomes_buffered": len(get_recent_trade_outcomes(limit=_TRADE_OUTCOMES_MAX)),
        "parity_log_size": len(_PARITY_LOG),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/governance/ml-predict-parity")
async def governance_ml_predict_parity(limit: int = 200):
    """Parity-diff ring buffer for /ml/predict backends.

    Evidence stream for later promotion of EnsemblePredictor. Populated
    only while ML_PREDICT_SHADOW=true. Same telemetry pattern as
    /governance/status (v0.7.11).
    """
    with _PARITY_LOG_LOCK:
        rows = list(_PARITY_LOG[-max(1, min(limit, _PARITY_LOG_MAX)):])
    # Compute a fast summary so ops can eyeball drift without downloading rows.
    diffs = 0
    for r in rows:
        if r.get("shadow_error"):
            continue
        if r.get("live_signal") != r.get("shadow_signal"):
            diffs += 1
    return {
        "available": True,
        "shadow_enabled": os.environ.get("ML_PREDICT_SHADOW") == "true",
        "sample_count": len(rows),
        "signal_disagreements": diffs,
        "disagreement_ratio": (diffs / len(rows)) if rows else 0.0,
        "rows": rows,
    }


# ---------------------------------------------------------------------------
# v0.8.7a — POST /risk/evaluate — Python port of riskKernel.ts
# ---------------------------------------------------------------------------
#
# Pure pre-trade blast-door kernel. Called in Stage 1 of v0.8.7 as a
# shadow alongside the TS riskService.evaluatePreTradeVetoes so we
# can verify identical decisions on real inputs. Once parity is
# proven, v0.8.8 cuts TS over to this endpoint and riskKernel.ts
# retires.

from trading.risk_kernel import (  # noqa: E402
    KernelAccountState as _KernelAccountState,
    KernelContext as _KernelContext,
    KernelOpenPosition as _KernelOpenPosition,
    KernelOrder as _KernelOrder,
    KernelRestingOrder as _KernelRestingOrder,
    evaluate_pre_trade_vetoes as _evaluate_pre_trade_vetoes,
)
from trading.live_signal import (  # noqa: E402
    OHLCVBar as _OHLCVBar,
    build_order as _build_order,
    compute_atr as _compute_atr,
    detect_simple_regime as _detect_simple_regime,
    extract_signal_key as _extract_signal_key,
    normalise_signal as _normalise_signal,
    signal_passes_entry_gate as _signal_passes_entry_gate,
)
from trading.exit_decisions import (  # noqa: E402
    ExitConfig as _ExitConfig,
    MarketAnalysis as _MarketAnalysis,
    PositionSnapshot as _PositionSnapshot,
    decide_exit as _decide_exit,
)
from trading.reconciliation import (  # noqa: E402
    ExchangePosition as _ExchangePosition,
    TrackedPosition as _TrackedPosition,
    reconcile_positions as _reconcile_positions,
)


@app.post("/risk/evaluate")
async def risk_evaluate(request: Request):
    """Run the pre-trade blast-door kernel on one order.

    Request body mirrors the KernelInputs shape riskService.js assembles:
      {
        "kernelOrder":  {"symbol", "side", "notional", "leverage", "price"},
        "accountState": {"equityUsdt", "unrealizedPnlUsdt",
                         "openPositions":  [{"symbol","side","notional"}...],
                         "restingOrders":  [{"symbol","side","price"}...]},
        "context":      {"isLive", "mode", "symbolMaxLeverage"}
      }

    Response: {"allowed": bool, "reason"?: str, "code"?: str}
    Matches KernelDecision from the TS reference.
    """
    body = await request.json()
    try:
        o = body["kernelOrder"]
        order = _KernelOrder(
            symbol=str(o["symbol"]),
            side=str(o["side"]),
            notional=float(o["notional"]),
            leverage=float(o["leverage"]),
            price=float(o["price"]),
        )
        a = body["accountState"]
        state = _KernelAccountState(
            equity_usdt=float(a["equityUsdt"]),
            unrealized_pnl_usdt=float(a["unrealizedPnlUsdt"]),
            open_positions=[
                _KernelOpenPosition(
                    symbol=str(p["symbol"]),
                    side=str(p["side"]),
                    notional=float(p["notional"]),
                )
                for p in a.get("openPositions", []) or []
            ],
            resting_orders=[
                _KernelRestingOrder(
                    symbol=str(r["symbol"]),
                    side=str(r["side"]),
                    price=float(r["price"]),
                )
                for r in a.get("restingOrders", []) or []
            ],
        )
        c = body["context"]
        ctx = _KernelContext(
            is_live=bool(c["isLive"]),
            mode=str(c["mode"]),
            symbol_max_leverage=float(c["symbolMaxLeverage"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"bad kernel input: {exc}") from exc

    decision = _evaluate_pre_trade_vetoes(order, state, ctx)
    return {
        "allowed": decision.allowed,
        "reason": decision.reason,
        "code": decision.code,
    }


# ---------------------------------------------------------------------------
# v0.8.7b — POST /live/decide — pure decision functions from liveSignalEngine
# ---------------------------------------------------------------------------
#
# Single endpoint covering the stateless pieces of the TS live-signal
# engine: signal normalization, ATR, regime proxy, bandit key, order
# shaping, entry gate. Everything that takes (ohlcv + ml_signal + ml_
# strength) as input and returns a decision object as output — no DB
# access, no exchange calls.
#
# Stage 1b (shadow mode) will wire the TS side to compare its own
# decisions against this endpoint's output tick-by-tick. v0.8.7d ships
# that wiring; this PR just exposes the surface.


@app.post("/live/decide")
async def live_decide(request: Request):
    """Run the full pure pipeline on one set of inputs.

    Request body (camelCase to match TS convention):
      {
        "ohlcv": [{"high", "low", "close"}...],   // ≥ 15 bars for ATR
        "mlSignal": "BUY"|"SELL"|"HOLD"|...,       // raw worker output
        "mlStrength": 0..1,                        // raw worker strength
        "mlReason": "...",                          // for bandit-key extraction
        "effectiveStrength": 0..1?,                 // bandit-weighted (optional)
        "positionUsdt": float?,                     // override INITIAL_POSITION_USDT
        "leverage": float?                          // override DEFAULT_LEVERAGE
      }

    Response: {
      "normalisedSignal": "BUY"|"SELL"|"HOLD",
      "regime": "trending_up"|...,
      "signalKey": "ml_*",
      "atr": float,
      "entryGate": {"passed": bool, "reason": str},
      "order": {"side", "leverage", "notional", "price", "atr", ...} | null
    }
    """
    body = await request.json()
    try:
        ohlcv_raw = body.get("ohlcv") or []
        ohlcv = [
            _OHLCVBar(
                high=float(b["high"]),
                low=float(b["low"]),
                close=float(b["close"]),
            )
            for b in ohlcv_raw
        ]
        raw_signal = body.get("mlSignal")
        ml_strength = float(body.get("mlStrength") or 0.0)
        ml_reason = str(body.get("mlReason") or "")
        eff_strength_raw = body.get("effectiveStrength")
        eff_strength = float(eff_strength_raw) if eff_strength_raw is not None else None
        position_usdt = body.get("positionUsdt")
        leverage = body.get("leverage")
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=f"bad live-decide input: {exc}") from exc

    signal = _normalise_signal(raw_signal)
    closes = [b.close for b in ohlcv]
    regime = _detect_simple_regime(closes)
    signal_key = _extract_signal_key(ml_reason)
    atr = _compute_atr(ohlcv)

    gate = _signal_passes_entry_gate(
        signal, ml_strength, effective_strength=eff_strength,
    )

    # Build order only when gate passes. TS reference computes order
    # independently of gate — we mirror that (caller may want the
    # shape even when blocked, for logging).
    last_close = closes[-1] if closes else 0.0
    decision_obj = _build_order(
        signal, last_close, atr,
        position_usdt=float(position_usdt) if position_usdt is not None else None,
        leverage=float(leverage) if leverage is not None else None,
    )
    order_payload = None
    if decision_obj is not None:
        order_payload = {
            "side": decision_obj.side,
            "leverage": decision_obj.leverage,
            "notional": decision_obj.notional,
            "price": decision_obj.price,
            "atr": decision_obj.atr,
            "atrStopDistance": decision_obj.atr_stop_distance,
            "atrTpDistance": decision_obj.atr_tp_distance,
        }

    return {
        "normalisedSignal": signal,
        "regime": regime,
        "signalKey": signal_key,
        "atr": atr,
        "entryGate": {"passed": gate.passed, "reason": gate.reason},
        "order": order_payload,
    }


# ---------------------------------------------------------------------------
# v0.8.7c-1 — POST /live/exit-decide — managePositions exit chain
# ---------------------------------------------------------------------------
#
# Pure position-exit logic ported from fullyAutonomousTrader.
# managePositions. Shadow-mode parity path for the TS side — same
# input, same decision, same reason string shape.
#
# Caller passes the already-fetched position + analysis + config;
# no Poloniex/DB calls here. Priority-ordered: stop_loss →
# take_profit → trailing/trend_reversal → hold.


@app.post("/live/exit-decide")
async def live_exit_decide(request: Request):
    """Evaluate exit decision for one open position.

    Request body (camelCase to match TS convention):
      {
        "position": {
          "symbol":        "BTC_USDT_PERP",
          "qty":           1.0,          // signed: +long / -short
          "entryPrice":    75000,
          "unrealizedPnl": 50.0           // USDT
        },
        "config": {
          "stopLossPercent":   2.0,       // e.g. 2 = 2%
          "takeProfitPercent": 4.0
        },
        "analysis": {                     // optional
          "trend": "bullish"|"bearish"|"neutral"|"unknown"
        }
      }

    Response: {
      "shouldClose":        bool,
      "reason":             "stop_loss"|"take_profit"|"trend_reversal"|"hold",
      "explanation":        str,
      "pnlPercent":         float,
      "stopLossThreshold":  float,
      "takeProfitThreshold": float
    }
    """
    body = await request.json()
    try:
        p = body["position"]
        position = _PositionSnapshot(
            symbol=str(p["symbol"]),
            qty=float(p["qty"]),
            entry_price=float(p["entryPrice"]),
            unrealized_pnl=float(p["unrealizedPnl"]),
        )
        c = body.get("config") or {}
        config = _ExitConfig(
            stop_loss_percent=float(c.get("stopLossPercent", 2.0)),
            take_profit_percent=float(c.get("takeProfitPercent", 4.0)),
        )
        a_raw = body.get("analysis")
        analysis = (
            _MarketAnalysis(trend=str(a_raw["trend"]))
            if a_raw and "trend" in a_raw else None
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"bad exit-decide input: {exc}") from exc

    decision = _decide_exit(position, config, analysis)
    return {
        "shouldClose": decision.should_close,
        "reason": decision.reason,
        "explanation": decision.explanation,
        "pnlPercent": decision.pnl_percent,
        "stopLossThreshold": decision.stop_loss_threshold,
        "takeProfitThreshold": decision.take_profit_threshold,
    }


# ---------------------------------------------------------------------------
# v0.8.7c-2 — POST /live/reconcile — pure DB-vs-exchange diff
# ---------------------------------------------------------------------------
#
# Ported from fullyAutonomousTrader.reconcilePositions. Caller hands
# us the DB open-rows + exchange getPositions result; we return a
# structured report with phantom_db / orphan_exchange / matched
# symbol lists.
#
# The mutation side (UPDATE autonomous_trades SET status='closed' on
# phantoms, logAgentEvent on orphans) stays TS — v0.8.7c-3 ports the
# actual writes. Shadow-mode parity against TS side only compares
# the diff output, which this endpoint exposes as a pure function.


@app.post("/live/reconcile")
async def live_reconcile(request: Request):
    """Diff DB open positions against exchange open positions.

    Request body:
      {
        "dbRows":  [{"symbol", "orderId"?}...],
        "exchangePositions": [{"symbol", "qty"}...]
      }

    Response:
      {
        "matchedSymbols":         [str...],  // in both, healthy
        "phantomDbSymbols":       [str...],  // DB says open, exchange doesn't
        "orphanExchangeSymbols":  [str...],  // exchange has, DB doesn't
        "hasDrift":               bool       // true iff any phantom/orphan
      }

    All symbol lists sorted ascending. Zero-qty exchange entries are
    filtered out (matches TS behaviour at fullyAutonomousTrader:1174).
    """
    body = await request.json()
    try:
        db_rows = [
            _TrackedPosition(
                symbol=str(r["symbol"]),
                order_id=str(r.get("orderId") or ""),
            )
            for r in (body.get("dbRows") or [])
        ]
        exchange_positions = [
            _ExchangePosition(
                symbol=str(p["symbol"]),
                qty=float(p.get("qty") or 0),
            )
            for p in (body.get("exchangePositions") or [])
        ]
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"bad reconcile input: {exc}") from exc

    report = _reconcile_positions(db_rows, exchange_positions)
    return {
        "matchedSymbols": report.matched_symbols,
        "phantomDbSymbols": report.phantom_db_symbols,
        "orphanExchangeSymbols": report.orphan_exchange_symbols,
        "hasDrift": report.has_drift,
    }


# ---------------------------------------------------------------------------
# Monkey kernel endpoints (v0.7)
# ---------------------------------------------------------------------------
#
# Extend the ml-worker service with Monkey's cognitive kernels — the
# TypeScript orchestrator will call these once the adapter lands.
# Kernels live in Python for QIG purity (direct use of qig_core_local
# primitives, no TS port drift). One AutonomicKernel instance per
# Monkey sub-kernel (Position, Swing) is kept here in process memory;
# resonance bank stays in Postgres via the TS side.

from monkey_kernel import (  # noqa: E402
    AccountContext,
    AutonomicKernel,
    AutonomicTickInputs,
    ExecBasinState,
    MonkeyMode,
    NeurochemicalState,
    OHLCVCandle,
    PerceptionInputs,
    SymbolState,
    TickDecision,
    TickInputs,
    basin_direction,
    current_entry_threshold,
    current_leverage,
    current_position_size,
    detect_mode,
    fresh_symbol_state,
    perceive,
    refract,
    run_tick,
    should_dca_add,
    should_exit,
    should_profit_harvest,
    should_scalp_exit,
    trend_proxy,
)
import numpy as np  # noqa: E402

_autonomic_instances: dict[str, AutonomicKernel] = {}

# v0.8.3: per-(instance, symbol) tick state. Kept in-process for now —
# TS shadow-mode calls pass state in every call via `prev_state`; Python
# only caches it so the next call can skip the round-trip if the TS side
# trusts the worker. v0.8.7 makes this canonical state.
_symbol_states: dict[tuple[str, str], SymbolState] = {}

# Tier 7 + Tier 3 + Tier 7 Heart persistent components. Without these
# living across ticks, sleep state never advances and trajectory/HRV
# windows reset every call.
#   Ocean — per-instance (sleep machine is global to a kernel, but
#           drift_streak/phi_history accumulate per-symbol context)
#   Foresight — per-(instance, symbol) — basin trajectory is symbol-specific
#   Heart — per-(instance, symbol) — κ is symbol-specific in this kernel
from monkey_kernel.ocean import Ocean  # noqa: E402
from monkey_kernel.foresight import ForesightPredictor  # noqa: E402
from monkey_kernel.heart import HeartMonitor  # noqa: E402
from monkey_kernel.persistence import PersistentMemory  # noqa: E402

_ocean_instances: dict[tuple[str, str], Ocean] = {}
_foresight_instances: dict[tuple[str, str], ForesightPredictor] = {}
_heart_instances: dict[tuple[str, str], HeartMonitor] = {}

# qig-cache substrate — one PersistentMemory per (instance) so the
# Redis namespace stays isolated between Position / Swing kernels.
# Falls through to in-memory-only if REDIS_URL unset (warning logged
# once at PersistentMemory construction time).
_persistence_instances: dict[str, PersistentMemory] = {}


def _get_persistence(instance_id: str) -> PersistentMemory:
    if instance_id not in _persistence_instances:
        _persistence_instances[instance_id] = PersistentMemory(instance_id=instance_id)
    return _persistence_instances[instance_id]


def _get_autonomic(instance_id: str) -> AutonomicKernel:
    if instance_id not in _autonomic_instances:
        _autonomic_instances[instance_id] = AutonomicKernel(
            label=instance_id,
            persistence=_get_persistence(instance_id),
        )
    return _autonomic_instances[instance_id]


def _get_ocean(instance_id: str, symbol: str) -> Ocean:
    key = (instance_id, symbol)
    if key not in _ocean_instances:
        # Ocean's persistence is per-instance (sleep state global to
        # the kernel), not per-symbol; pass the same handle.
        _ocean_instances[key] = Ocean(
            label=f"{instance_id}:{symbol}",
            persistence=_get_persistence(instance_id),
        )
    return _ocean_instances[key]


def _get_foresight(instance_id: str, symbol: str) -> ForesightPredictor:
    key = (instance_id, symbol)
    if key not in _foresight_instances:
        _foresight_instances[key] = ForesightPredictor(
            persistence=_get_persistence(instance_id),
            symbol=symbol,
        )
    return _foresight_instances[key]


def _get_heart(instance_id: str, symbol: str) -> HeartMonitor:
    key = (instance_id, symbol)
    if key not in _heart_instances:
        _heart_instances[key] = HeartMonitor(
            persistence=_get_persistence(instance_id),
            symbol=symbol,
        )
    return _heart_instances[key]


@app.post("/monkey/autonomic/tick")
async def monkey_autonomic_tick(request: Request):
    """One autonomic cycle: sleep-phase update → reward decay → NC.

    Request body:
      { instance_id, phi_delta, basin_velocity, surprise,
        quantum_weight, kappa, external_coupling,
        current_mode, is_flat, now_ms? }

    Response:
      { nc: {...}, phase, is_awake, entered_sleep, woke,
        sleep_remaining_ms, reward_sums }
    """
    payload = await request.json()
    instance_id = payload.get("instance_id", "monkey-primary")
    kernel = _get_autonomic(instance_id)
    result = kernel.tick(AutonomicTickInputs(
        phi_delta=float(payload["phi_delta"]),
        basin_velocity=float(payload["basin_velocity"]),
        surprise=float(payload["surprise"]),
        quantum_weight=float(payload["quantum_weight"]),
        kappa=float(payload["kappa"]),
        external_coupling=float(payload["external_coupling"]),
        current_mode=str(payload["current_mode"]),
        is_flat=bool(payload["is_flat"]),
        now_ms=payload.get("now_ms"),
    ))
    return {
        "nc": result.nc.as_dict(),
        "phase": result.phase.value,
        "is_awake": result.is_awake,
        "entered_sleep": result.entered_sleep,
        "woke": result.woke,
        "sleep_remaining_ms": result.sleep_remaining_ms,
        "reward_sums": result.reward_sums,
    }


@app.post("/monkey/autonomic/reward")
async def monkey_autonomic_reward(request: Request):
    """Push a reward event onto the kernel's pending queue.

    Request body:
      { instance_id, source, realized_pnl_usdt, margin_usdt,
        symbol?, kappa_at_exit? }

    Response: the ActivityReward as a dict + queue length.
    """
    payload = await request.json()
    instance_id = payload.get("instance_id", "monkey-primary")
    kernel = _get_autonomic(instance_id)
    reward = kernel.push_reward(
        source=str(payload["source"]),
        realized_pnl_usdt=float(payload["realized_pnl_usdt"]),
        margin_usdt=float(payload["margin_usdt"]),
        symbol=payload.get("symbol"),
        kappa_at_exit=payload.get("kappa_at_exit"),
    )
    return {
        "reward": {
            "source": reward.source,
            "symbol": reward.symbol,
            "dopamine_delta": reward.dopamine_delta,
            "serotonin_delta": reward.serotonin_delta,
            "endorphin_delta": reward.endorphin_delta,
            "realized_pnl_usdt": reward.realized_pnl_usdt,
            "pnl_fraction": reward.pnl_fraction,
            "at_ms": reward.at_ms,
        },
        "snapshot": kernel.snapshot(),
    }


@app.get("/monkey/autonomic/snapshot/{instance_id}")
async def monkey_autonomic_snapshot(instance_id: str):
    """Telemetry snapshot — sleep phase, pending reward count, decayed sums."""
    kernel = _get_autonomic(instance_id)
    return kernel.snapshot()


# ── Executive decisions + mode detection ──────────────────────────


def _deserialize_basin_state(payload: dict) -> ExecBasinState:
    nc_payload = payload["neurochemistry"]
    nc = NeurochemicalState(
        acetylcholine=float(nc_payload["acetylcholine"]),
        dopamine=float(nc_payload["dopamine"]),
        serotonin=float(nc_payload["serotonin"]),
        norepinephrine=float(nc_payload["norepinephrine"]),
        gaba=float(nc_payload["gaba"]),
        endorphins=float(nc_payload["endorphins"]),
    )
    return ExecBasinState(
        basin=np.asarray(payload["basin"], dtype=np.float64),
        identity_basin=np.asarray(payload["identity_basin"], dtype=np.float64),
        phi=float(payload["phi"]),
        kappa=float(payload["kappa"]),
        regime_weights={k: float(v) for k, v in payload["regime_weights"].items()},
        sovereignty=float(payload["sovereignty"]),
        basin_velocity=float(payload["basin_velocity"]),
        neurochemistry=nc,
    )


@app.post("/monkey/executive/decide")
async def monkey_executive_decide(request: Request):
    """Aggregate executive pass.

    Request body includes: basin_state (see _deserialize_basin_state),
    ohlcv closes array, ml_signal/ml_strength, held_side/own_position,
    available_equity, min_notional, max_leverage, bank_size,
    self_obs_bias, mode (optional), symbol.

    Response: entry threshold + size + leverage + harvest/scalp/DCA
    decisions for this tick. TS orchestrator composes into action.
    """
    payload = await request.json()
    state = _deserialize_basin_state(payload["basin_state"])
    closes = payload.get("closes", [])
    ml_signal = str(payload.get("ml_signal", "HOLD")).upper()
    ml_strength = float(payload.get("ml_strength", 0.0))
    held_side = payload.get("held_side")  # 'long' | 'short' | None
    available_equity = float(payload["available_equity"])
    min_notional = float(payload["min_notional"])
    max_leverage = float(payload["max_leverage"])
    bank_size = int(payload.get("bank_size", 0))
    self_obs_bias = float(payload.get("self_obs_bias", 1.0))

    mode_str = payload.get("mode")
    mode = MonkeyMode(mode_str) if mode_str else MonkeyMode.INVESTIGATION
    tape = trend_proxy(closes) if closes else 0.0
    bd = basin_direction(state.basin)

    # Direction candidate: ml default, with basin-override quorum.
    ml_side = "short" if ml_signal == "SELL" else "long"
    side_candidate = ml_side
    side_override = False
    OVERRIDE_THRESHOLD = 0.35
    if bd < -OVERRIDE_THRESHOLD and tape < -OVERRIDE_THRESHOLD and ml_side == "long":
        side_candidate = "short"
        side_override = True
    elif bd > OVERRIDE_THRESHOLD and tape > OVERRIDE_THRESHOLD and ml_side == "short":
        side_candidate = "long"
        side_override = True

    entry = current_entry_threshold(
        state,
        mode=mode,
        self_obs_bias=self_obs_bias,
        tape_trend=tape,
        side_candidate=side_candidate,  # type: ignore[arg-type]
    )
    leverage = current_leverage(
        state, max_leverage_boundary=max_leverage, mode=mode, tape_trend=tape,
    )
    size = current_position_size(
        state,
        available_equity_usdt=available_equity,
        min_notional_usdt=min_notional,
        leverage=leverage["value"],
        bank_size=bank_size,
        mode=mode,
    )

    # Optional exit evaluations when already holding
    harvest = None
    scalp = None
    dca = None
    loop2 = None
    if held_side and payload.get("own_position"):
        pos = payload["own_position"]
        position_notional = float(pos["entry_price"]) * float(pos["quantity"])
        sign = 1 if held_side == "long" else -1
        last_price = float(payload.get("last_price", pos["entry_price"]))
        unrealized = (last_price - float(pos["entry_price"])) * float(pos["quantity"]) * sign
        peak = float(pos.get("peak_pnl_usdt", unrealized))

        harvest = should_profit_harvest(
            unrealized_pnl_usdt=unrealized,
            peak_pnl_usdt=peak,
            notional_usdt=position_notional,
            tape_trend=tape,
            held_side=held_side,
            s=state,
        )
        scalp = should_scalp_exit(
            unrealized_pnl_usdt=unrealized,
            notional_usdt=position_notional,
            s=state,
            mode=mode,
        )
        loop2 = should_exit(
            perception=state.basin,
            strategy_forecast=state.identity_basin,
            held_side=held_side,
            s=state,
        )
        import time as _time
        dca = should_dca_add(
            held_side=held_side,
            side_candidate=side_candidate,  # type: ignore[arg-type]
            current_price=last_price,
            initial_entry_price=float(pos["entry_price"]),
            add_count=int(pos.get("dca_add_count", 0)),
            last_add_at_ms=float(pos.get("last_entry_at_ms", 0)),
            now_ms=float(payload.get("now_ms", _time.time() * 1000.0)),
            sovereignty=state.sovereignty,
        )

    return {
        "entry_threshold": entry,
        "leverage": leverage,
        "size": size,
        "harvest": harvest,
        "scalp": scalp,
        "dca": dca,
        "loop2": loop2,
        "mode": mode.value,
        "tape_trend": tape,
        "basin_direction": bd,
        "side_candidate": side_candidate,
        "side_override": side_override,
        "ml_side": ml_side,
        "ml_strength_gate_clear": ml_strength >= entry["value"],
    }


@app.post("/monkey/mode/detect")
async def monkey_mode_detect(request: Request):
    """Classify cognitive mode from basin + histories."""
    payload = await request.json()
    state = _deserialize_basin_state(payload["basin_state"])
    return detect_mode(
        basin=state.basin,
        identity_basin=state.identity_basin,
        phi=state.phi,
        kappa=state.kappa,
        basin_velocity=state.basin_velocity,
        neurochemistry=state.neurochemistry,
        phi_history=list(map(float, payload.get("phi_history", []))),
        fhealth_history=list(map(float, payload.get("fhealth_history", []))),
        drift_history=list(map(float, payload.get("drift_history", []))),
    )


@app.get("/governance/status")
async def governance_status():
    """Observable-governance telemetry — signal distribution, drift
    stats, and any detector violations (AMPLITUDE_COLLAPSE,
    REGIME_SINGLE, etc.). Per audit P2 2026-04-21. Call from
    dashboard / alerts to monitor for ensemble bias.
    """
    try:
        from observable_governance import report_as_dict
        return report_as_dict()
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc), "available": False}


@app.post("/monkey/perception/perceive")
async def monkey_perception_perceive(request: Request):
    """Construct Δ⁶³ basin from OHLCV + ML posture + account context.
    Then refract against identity basin (Pillar 2 surface absorption).
    Returns both the raw and refracted basins so the caller can store.
    """
    payload = await request.json()
    candles = [
        OHLCVCandle(
            timestamp=float(c.get("timestamp", 0)),
            open=float(c["open"]),
            high=float(c["high"]),
            low=float(c["low"]),
            close=float(c["close"]),
            volume=float(c["volume"]),
        )
        for c in payload["ohlcv"]
    ]
    inputs = PerceptionInputs(
        ohlcv=candles,
        ml_signal=str(payload.get("ml_signal", "HOLD")),
        ml_strength=float(payload.get("ml_strength", 0.0)),
        ml_effective_strength=float(payload.get("ml_effective_strength", 0.0)),
        equity_fraction=float(payload.get("equity_fraction", 0.0)),
        margin_fraction=float(payload.get("margin_fraction", 0.0)),
        open_positions=int(payload.get("open_positions", 0)),
        session_age_ticks=int(payload.get("session_age_ticks", 0)),
    )
    raw = perceive(inputs)
    identity_list = payload.get("identity_basin")
    if identity_list is not None:
        identity = np.asarray(identity_list, dtype=np.float64)
        external_weight = float(payload.get("external_weight", 0.30))
        refracted = refract(raw, identity, external_weight=external_weight)
    else:
        refracted = raw
    return {
        "raw": raw.tolist(),
        "refracted": refracted.tolist(),
    }


# ---------------------------------------------------------------------------
# v0.8.3 — /monkey/tick/run
# ---------------------------------------------------------------------------


def _symbol_state_to_dict(st: SymbolState) -> dict:
    return {
        "symbol": st.symbol,
        "identity_basin": st.identity_basin.tolist(),
        "last_basin": st.last_basin.tolist() if st.last_basin is not None else None,
        "kappa": st.kappa,
        "session_ticks": st.session_ticks,
        "last_mode": st.last_mode,
        "basin_history": [b.tolist() for b in st.basin_history],
        "phi_history": list(st.phi_history),
        "fhealth_history": list(st.fhealth_history),
        "drift_history": list(st.drift_history),
        "dca_add_count": st.dca_add_count,
        "last_entry_at_ms": st.last_entry_at_ms,
        "peak_pnl_usdt": st.peak_pnl_usdt,
        "peak_tracked_trade_id": st.peak_tracked_trade_id,
        # Held-position re-justification anchors. Per-lane dicts kept
        # serializable (lane keys are short literal strings).
        "regime_at_open_by_lane": dict(st.regime_at_open_by_lane),
        "phi_at_open_by_lane": dict(st.phi_at_open_by_lane),
    }


def _symbol_state_from_dict(d: dict) -> SymbolState:
    last_basin = d.get("last_basin")
    return SymbolState(
        symbol=str(d["symbol"]),
        identity_basin=np.asarray(d["identity_basin"], dtype=np.float64),
        last_basin=np.asarray(last_basin, dtype=np.float64)
                    if last_basin is not None else None,
        kappa=float(d.get("kappa", 64.0)),
        session_ticks=int(d.get("session_ticks", 0)),
        last_mode=d.get("last_mode"),
        basin_history=[
            np.asarray(b, dtype=np.float64) for b in d.get("basin_history", [])
        ],
        phi_history=[float(x) for x in d.get("phi_history", [])],
        fhealth_history=[float(x) for x in d.get("fhealth_history", [])],
        drift_history=[float(x) for x in d.get("drift_history", [])],
        dca_add_count=int(d.get("dca_add_count", 0)),
        last_entry_at_ms=d.get("last_entry_at_ms"),
        peak_pnl_usdt=d.get("peak_pnl_usdt"),
        peak_tracked_trade_id=d.get("peak_tracked_trade_id"),
        # New fields default to {} when absent (older clients / shadow
        # ticks pre-rollout). Lane keys round-trip as str literals.
        regime_at_open_by_lane=dict(d.get("regime_at_open_by_lane", {})),
        phi_at_open_by_lane={
            k: float(v) for k, v in d.get("phi_at_open_by_lane", {}).items()
        },
    )


def _decision_to_dict(dec: TickDecision) -> dict:
    return {
        "action": dec.action,
        "reason": dec.reason,
        "mode": dec.mode,
        "size_usdt": dec.size_usdt,
        "leverage": dec.leverage,
        "entry_threshold": dec.entry_threshold,
        "phi": dec.phi,
        "kappa": dec.kappa,
        "basin_velocity": dec.basin_velocity,
        "f_health": dec.f_health,
        "drift_from_identity": dec.drift_from_identity,
        "basin_direction": dec.basin_direction,
        "tape_trend": dec.tape_trend,
        "side_candidate": dec.side_candidate,
        "side_override": dec.side_override,
        "neurochemistry": dec.neurochemistry.as_dict(),
        "derivation": dec.derivation,
        "basin": dec.basin.tolist(),
        "is_dca_add": dec.is_dca_add,
        "is_reverse": dec.is_reverse,
    }


@app.post("/monkey/tick/run")
async def monkey_tick_run(request: Request):
    """Run one decision tick. Stateless from the HTTP caller's view —
    caller passes `prev_state` (or omits for a newborn symbol), receives
    back `decision` + `new_state`. Per-(instance, symbol) state is also
    cached in-process so the next call can skip state transfer once
    Python owns the loop (v0.8.7).

    Request body:
      {
        "instance_id": "monkey-primary",
        "inputs": {
          "symbol": "BTC_USDT_PERP",
          "ohlcv": [{"timestamp", "open", "high", "low", "close", "volume"}],
          "account": { equity_fraction, margin_fraction, open_positions,
                       available_equity, exchange_held_side?, own_position_* },
          "bank_size": int, "sovereignty": 0..1,
          "max_leverage": int, "min_notional": float,
          "size_fraction": 1.0, "self_obs_bias": {...}?
        },
        "prev_state": {... SymbolState JSON ...}  // or null for newborn
      }

    Note: post #ml-separation, ml_signal / ml_strength are NOT kernel
    inputs. If supplied in the payload they are silently ignored.
    Agent M (ml-only) has its own decision module; Agent K (this
    endpoint) operates on basin geometry alone.

    Response:
      { "decision": {...TickDecision...}, "new_state": {...SymbolState...} }
    """
    payload = await request.json()
    instance_id = str(payload.get("instance_id", "monkey-primary"))
    inp = payload["inputs"]

    candles = [
        OHLCVCandle(
            timestamp=float(c.get("timestamp", 0)),
            open=float(c["open"]),
            high=float(c["high"]),
            low=float(c["low"]),
            close=float(c["close"]),
            volume=float(c["volume"]),
        )
        for c in inp["ohlcv"]
    ]
    acct_d = inp["account"]
    account = AccountContext(
        equity_fraction=float(acct_d.get("equity_fraction", 0.0)),
        margin_fraction=float(acct_d.get("margin_fraction", 0.0)),
        open_positions=int(acct_d.get("open_positions", 0)),
        available_equity=float(acct_d.get("available_equity", 0.0)),
        exchange_held_side=acct_d.get("exchange_held_side"),
        own_position_entry_price=(
            float(acct_d["own_position_entry_price"])
            if acct_d.get("own_position_entry_price") is not None else None
        ),
        own_position_quantity=(
            float(acct_d["own_position_quantity"])
            if acct_d.get("own_position_quantity") is not None else None
        ),
        own_position_trade_id=acct_d.get("own_position_trade_id"),
    )
    # rolling_kelly_stats: lane-filtered rolling Kelly stats from TS
    # loop.ts (proposal #3 + lane-conditioned split). When present,
    # tuple of (win_rate, avg_win, avg_loss) for the chosen lane.
    # When absent / null, Kelly cap is a no-op (cold-start or unaware caller).
    raw_kelly = inp.get("rolling_kelly_stats")
    rolling_kelly_stats: Optional[tuple[float, float, float]] = None
    if (
        isinstance(raw_kelly, (list, tuple))
        and len(raw_kelly) == 3
        and all(isinstance(v, (int, float)) for v in raw_kelly)
    ):
        rolling_kelly_stats = (float(raw_kelly[0]), float(raw_kelly[1]), float(raw_kelly[2]))
    tick_inputs = TickInputs(
        symbol=str(inp["symbol"]),
        ohlcv=candles,
        account=account,
        bank_size=int(inp.get("bank_size", 0)),
        sovereignty=float(inp.get("sovereignty", 0.0)),
        max_leverage=int(inp.get("max_leverage", 10)),
        min_notional=float(inp.get("min_notional", 5.0)),
        size_fraction=float(inp.get("size_fraction", 1.0)),
        self_obs_bias=inp.get("self_obs_bias"),
        rolling_kelly_stats=rolling_kelly_stats,
    )

    # State resolution: caller-provided wins, else in-process cache, else
    # newborn seeded from uniform basin.
    key = (instance_id, tick_inputs.symbol)
    prev_state_payload = payload.get("prev_state")
    persistence = _get_persistence(instance_id)
    state_loaded_from_persistence = False
    if prev_state_payload is not None:
        state = _symbol_state_from_dict(prev_state_payload)
    elif key in _symbol_states:
        state = _symbol_states[key]
    else:
        # Cold start — seed identity from uniform basin, then attempt
        # to restore the SymbolState histories from Redis. Restored
        # histories give Tier 9 stud regime classification a warmed
        # window on the first post-redeploy tick (phi_history has
        # variance, basin_history has trajectory points, etc.).
        from monkey_kernel.basin import uniform_basin
        state = fresh_symbol_state(tick_inputs.symbol, uniform_basin(64))
        if persistence.is_available:
            sym = tick_inputs.symbol
            phi_hist = persistence.load_phi_history(sym)
            basin_hist = persistence.load_basin_history(sym)
            drift_hist = persistence.load_drift_history(sym)
            fhealth_hist = persistence.load_fhealth_history(sym)
            integration_hist = persistence.load_integration_history(sym)
            if phi_hist or basin_hist:
                state.phi_history = phi_hist
                state.basin_history = basin_hist
                state.drift_history = drift_hist
                state.fhealth_history = fhealth_hist
                state.integration_history = integration_hist
                # Restore last_basin from the most recent basin in history
                if basin_hist:
                    state.last_basin = basin_hist[-1]
                state_loaded_from_persistence = True

    autonomic = _get_autonomic(instance_id)
    ocean = _get_ocean(instance_id, tick_inputs.symbol)
    foresight = _get_foresight(instance_id, tick_inputs.symbol)
    heart = _get_heart(instance_id, tick_inputs.symbol)
    decision, new_state = run_tick(
        tick_inputs, state, autonomic,
        ocean=ocean, foresight=foresight, heart=heart,
        persistence=persistence,
    )
    _symbol_states[key] = new_state

    # Persistence telemetry — what restored vs cold-started this tick.
    # Surfaced so post-deploy validation can confirm every key family
    # actually rehydrates on the first tick after a Railway redeploy.
    decision.derivation["persistence"] = {
        "enabled": persistence.is_available,
        "load_warmup": state_loaded_from_persistence,
        "instance_id": instance_id,
    }

    return {
        "decision": _decision_to_dict(decision),
        "new_state": _symbol_state_to_dict(new_state),
    }


# ═══════════════════════════════════════════════════════════════════════════
# v0.8.7c-3 — Trading engine endpoints (Python order placement port)
# ═══════════════════════════════════════════════════════════════════════════
#
# Behind TRADING_ENGINE_PY=true env flag (default off). When unset, all
# endpoints in this block return 503 Service Unavailable with a clear
# message — TS continues to own order placement.
#
# When the flag is flipped (after #574 + #575 + #579 merge + 24-48h soak),
# TS short-circuits before its own poloniexFuturesService.closePosition
# / submitOrder calls and POSTs to these endpoints instead. v0.8.8 then
# deletes the TS-side fullyAutonomousTrader / executeSignals / etc.

from trading.order_placement import (  # noqa: E402
    CloseRecord,
    EntryRecord,
    close_open_trades,
    get_circuit_breaker,
    insert_entry,
    record_trade_result,
    trading_engine_py_enabled,
)
from db.pool import get_async_pool  # noqa: E402
from events.outcome_publisher import (  # noqa: E402
    TradeOutcomeEvent,
    publish_trade_outcome,
)


def _trading_engine_503():
    return JSONResponse(
        status_code=503,
        content={
            "error": "TRADING_ENGINE_PY=false",
            "message": (
                "Python trading-engine endpoints are dormant. TS side "
                "owns order placement until TRADING_ENGINE_PY=true is "
                "set on this service. Refer to v0.8.7c-3 / v0.8.8 plan."
            ),
        },
    )


@app.post("/trading/close-position")
async def trading_close_position(request: Request):
    """Close all open autonomous_trades rows for (user_id, symbol) and
    publish a trade-outcome event. Mirrors fullyAutonomousTrader.ts:1435
    closePosition's DB-write half (the exchange close itself happens
    earlier on the TS side until v0.8.8 cut-over completes).

    Request body: { user_id, symbol, exit_reason, exit_price, pnl,
                    side?, entry_price?, quantity?, order_id? }

    Response: { rows_updated, outcome_published }
    """
    if not trading_engine_py_enabled():
        return _trading_engine_503()
    body = await request.json()
    record = CloseRecord(
        user_id=str(body["user_id"]),
        symbol=str(body["symbol"]),
        exit_reason=str(body["exit_reason"]),
        exit_price=float(body["exit_price"]),
        pnl=float(body["pnl"]),
        closed_at_ms=int(body.get("closed_at_ms") or 0),
    )
    pool = await get_async_pool()
    rows_updated = await close_open_trades(pool, record)

    outcome_published = False
    if body.get("publish_outcome", True):
        event = TradeOutcomeEvent(
            user_id=record.user_id,
            symbol=record.symbol,
            side=str(body.get("side", "long")),
            entry_price=float(body.get("entry_price", 0.0)),
            exit_price=record.exit_price,
            quantity=float(body.get("quantity", 0.0)),
            pnl=record.pnl,
            exit_reason=record.exit_reason,
            order_id=str(body.get("order_id", "")),
            closed_at_ms=record.closed_at_ms or int(time.time() * 1000),
        )
        outcome_published = await publish_trade_outcome(event)

    return {
        "rows_updated": rows_updated,
        "outcome_published": outcome_published,
    }


@app.post("/trading/record-result")
async def trading_record_result(request: Request):
    """Update circuit-breaker state after a closed trade. Mirrors
    fullyAutonomousTrader.ts:1618 recordTradeResult.

    Request body: { user_id, pnl, capital_base }
    Response: { is_tripped, consecutive_losses, daily_loss, tripped_reason? }
    """
    if not trading_engine_py_enabled():
        return _trading_engine_503()
    body = await request.json()
    cb = record_trade_result(
        user_id=str(body["user_id"]),
        pnl=float(body["pnl"]),
        capital_base=float(body["capital_base"]),
    )
    return {
        "is_tripped": cb.is_tripped,
        "consecutive_losses": cb.consecutive_losses,
        "daily_loss": cb.daily_loss,
        "tripped_reason": cb.tripped_reason,
    }


@app.get("/trading/circuit-breaker/{user_id}")
async def trading_get_circuit_breaker(user_id: str):
    """Read the current circuit-breaker state for a user. Cheap;
    safe to poll. Same flag-gate as the write endpoints — when off,
    callers shouldn't be reading Python-side state."""
    if not trading_engine_py_enabled():
        return _trading_engine_503()
    cb = get_circuit_breaker(user_id)
    return {
        "user_id": user_id,
        "is_tripped": cb.is_tripped,
        "consecutive_losses": cb.consecutive_losses,
        "daily_loss": cb.daily_loss,
        "tripped_reason": cb.tripped_reason,
        "tripped_at_ms": cb.tripped_at_ms,
    }


@app.post("/trading/insert-entry")
async def trading_insert_entry(request: Request):
    """Persist a newly-opened position to autonomous_trades. The
    exchange-side order placement still happens on the TS side until
    v0.8.8 cut-over; this endpoint only handles the DB write half so
    the schema-write path is observable in shadow mode.

    Request body: { user_id, symbol, side, entry_price, quantity,
                    leverage, stop_loss?, take_profit?, confidence,
                    reason, order_id, paper_trade?, engine_version? }

    Response: { id }
    """
    if not trading_engine_py_enabled():
        return _trading_engine_503()
    body = await request.json()
    record = EntryRecord(
        user_id=str(body["user_id"]),
        symbol=str(body["symbol"]),
        side=str(body["side"]),
        entry_price=float(body["entry_price"]),
        quantity=float(body["quantity"]),
        leverage=float(body["leverage"]),
        stop_loss=(float(body["stop_loss"]) if body.get("stop_loss") is not None else None),
        take_profit=(float(body["take_profit"]) if body.get("take_profit") is not None else None),
        confidence=float(body.get("confidence", 0.0)),
        reason=str(body.get("reason", "")),
        order_id=str(body.get("order_id", "")),
        paper_trade=bool(body.get("paper_trade", False)),
        engine_version=str(body.get("engine_version", "v0.8.7c-3-py")),
    )
    pool = await get_async_pool()
    new_id = await insert_entry(pool, record)
    return {"id": new_id}


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
