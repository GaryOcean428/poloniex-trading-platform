"""
ML Worker FastAPI Server
Serves ML predictions via HTTP and listens on Redis pub/sub.
"""

import json
import logging
import os
import sys
import threading
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# Ensure src/ is on the path so models can be imported
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from ensemble_predictor import EnsemblePredictor

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
    """Subscribe to ml:predict:request and publish responses."""
    if not REDIS_URL:
        logger.info("REDIS_URL not set — Redis pub/sub listener disabled")
        return

    try:
        import redis
    except ImportError:
        logger.warning("redis package not installed — Redis pub/sub listener disabled")
        return

    def _listener():
        REQUEST_CHANNEL = "ml:predict:request"
        HEALTH_KEY = "ml:health"
        try:
            r = redis.from_url(REDIS_URL, decode_responses=True)
            pubsub = r.pubsub()
            pubsub.subscribe(REQUEST_CHANNEL)
            logger.info(f"Redis pub/sub listener subscribed to {REQUEST_CHANNEL}")

            # Write initial health heartbeat
            r.set(HEALTH_KEY, json.dumps({"status": "ok"}), ex=90)

            for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                    request_id = payload.pop("requestId", None)
                    result = _handle_predict(payload)
                    if request_id:
                        r.publish(f"ml:predict:response:{request_id}", json.dumps(result, default=str))
                    # Refresh heartbeat
                    r.set(HEALTH_KEY, json.dumps({"status": "ok"}), ex=90)
                except Exception as exc:
                    logger.error(f"Redis handler error: {exc}", exc_info=True)
                    if request_id:
                        r.publish(
                            f"ml:predict:response:{request_id}",
                            json.dumps({"status": "error", "error": str(exc)}),
                        )
        except Exception as exc:
            logger.error(f"Redis listener crashed: {exc}", exc_info=True)

    t = threading.Thread(target=_listener, daemon=True, name="redis-pubsub")
    t.start()


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

    The ensemble predictor (or a future online-training job) can consume
    these to re-weight models toward what actually worked in live trades.
    """
    if not REDIS_URL:
        logger.info("REDIS_URL not set — trade-outcome listener disabled")
        return

    try:
        import redis
    except ImportError:
        logger.warning("redis package not installed — trade-outcome listener disabled")
        return

    def _listener():
        CHANNEL = "ml:trade:outcome"
        try:
            r = redis.from_url(REDIS_URL, decode_responses=True)
            pubsub = r.pubsub()
            pubsub.subscribe(CHANNEL)
            logger.info(f"Trade-outcome listener subscribed to {CHANNEL}")

            for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                    _record_trade_outcome(payload)
                    logger.info(
                        "trade_outcome",
                        extra={
                            "symbol": payload.get("symbol"),
                            "phase": payload.get("phase"),
                            "signal": payload.get("signal"),
                            "strength": payload.get("strength"),
                            "realized_pnl": payload.get("realizedPnl"),
                        },
                    )
                except Exception as exc:
                    logger.error(f"Trade-outcome handler error: {exc}", exc_info=True)
        except Exception as exc:
            logger.error(f"Trade-outcome listener crashed: {exc}", exc_info=True)

    t = threading.Thread(target=_listener, daemon=True, name="trade-outcome-listener")
    t.start()


# ---------------------------------------------------------------------------
# Shared prediction logic
# ---------------------------------------------------------------------------

def _handle_predict(payload: dict) -> dict:
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


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/ml/predict")
async def ml_predict(request: Request):
    payload = await request.json()
    result = _handle_predict(payload)
    status_code = 200 if result.get("status") != "error" else 422
    return JSONResponse(content=result, status_code=status_code)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
