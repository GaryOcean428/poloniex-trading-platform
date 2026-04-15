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
