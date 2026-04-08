"""Health and utility endpoints for the ML worker service.

Exposes /health and /healthz for Railway liveness and readiness checks,
a small /run/ingest helper to invoke ingest_markets.py on demand, and the
/ml/predict endpoint that handles ML inference requests from polytrade-be
via HTTP. Also runs a background Redis pub/sub listener on ml:predict:request
and publishes a heartbeat to ml:health every 30 seconds.
"""

import asyncio
import json
import os
import subprocess
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from proprietary_core.regime import RegimeDetector
from proprietary_core.strategy_loop import MarketRegime, StrategyLoop

# Constants
MAX_OUTPUT_LENGTH = 4000  # Maximum length of stdout to return in response
REDIS_HEARTBEAT_INTERVAL = 30  # seconds between ml:health heartbeats
PREDICT_REQUEST_CHANNEL = "ml:predict:request"
PREDICT_RESPONSE_PREFIX = "ml:predict:response:"
HEALTH_CHANNEL = "ml:health"

# ---------------------------------------------------------------------------
# Prediction helpers
# ---------------------------------------------------------------------------

def _strategy_to_signal(strategy_value: str, regime: str) -> dict[str, Any]:
    """Translate StrategyLoop output into the signal format expected by polytrade-be."""
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


def _run_prediction(payload: dict[str, Any]) -> dict[str, Any]:
    """Core prediction logic shared by HTTP and Redis paths."""
    action = payload.get("action", "multi_horizon")
    symbol = payload.get("symbol", "UNKNOWN")
    data = payload.get("data", [])
    current_price = float(payload.get("current_price", 0.0))

    if action == "health":
        return {"status": "healthy", "service": "ml-worker", "models": ["regime", "strategy_loop"]}

    if not data:
        raise ValueError("No OHLCV data provided")

    # Extract close prices from OHLCV list
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

    # Run strategy loop over the price series
    loop = StrategyLoop(symbol=symbol)
    decision = None
    for p in prices:
        decision = loop.tick(price=p)

    if decision is None or decision.regime is None:
        # Insufficient data — return neutral signals
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
        # Override strength with regime confidence
        sig["strength"] = round(confidence_raw, 4)
        return sig

    # multi_horizon / predict — return per-horizon predictions
    horizon_decay = {"1h": 1.0, "4h": 0.85, "24h": 0.70}
    result: dict[str, Any] = {}
    for h, decay in horizon_decay.items():
        h_conf = int(min(confidence_pct * decay, 95))
        h_dir = direction if h_conf >= 45 else "NEUTRAL"
        # Simple price projection based on trend strength and horizon
        horizon_hours = {"1h": 1, "4h": 4, "24h": 24}[h]
        price_change = trend_strength * 0.01 * horizon_hours * (1.0 if h_dir != "BEARISH" else -1.0)
        predicted_price = round(current_price * (1.0 + price_change), 8)
        result[h] = {"price": predicted_price, "confidence": h_conf, "direction": h_dir}

    if action == "predict":
        horizon = payload.get("horizon", "1h")
        return result.get(horizon, result["1h"])

    return result  # multi_horizon returns all horizons


# ---------------------------------------------------------------------------
# Background tasks: heartbeat + Redis pub/sub listener
# ---------------------------------------------------------------------------

_redis_url: str | None = None
_background_tasks: list[asyncio.Task[Any]] = []


async def _heartbeat_loop() -> None:
    """Publish a heartbeat to ml:health every REDIS_HEARTBEAT_INTERVAL seconds."""
    global _redis_url
    if not _redis_url:
        return
    try:
        r = aioredis.from_url(_redis_url, decode_responses=True)
        while True:
            try:
                payload = json.dumps({
                    "status": "ok",
                    "service": "ml-worker",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                await r.set(HEALTH_CHANNEL, payload, ex=REDIS_HEARTBEAT_INTERVAL * 3)
                await r.publish(HEALTH_CHANNEL, payload)
            except Exception as exc:
                # Log but don't crash
                print(f"[ml-worker] heartbeat error: {exc}", file=sys.stderr)
            await asyncio.sleep(REDIS_HEARTBEAT_INTERVAL)
    except Exception as exc:
        print(f"[ml-worker] heartbeat task crashed: {exc}", file=sys.stderr)


async def _pubsub_listener_loop() -> None:
    """Subscribe to ml:predict:request and publish responses."""
    global _redis_url
    if not _redis_url:
        return
    try:
        r = aioredis.from_url(_redis_url, decode_responses=True)
        pub = aioredis.from_url(_redis_url, decode_responses=True)
        ps = r.pubsub()
        await ps.subscribe(PREDICT_REQUEST_CHANNEL)
        async for message in ps.listen():
            if message["type"] != "message":
                continue
            try:
                payload = json.loads(message["data"])
                request_id = payload.get("requestId", "")
                try:
                    result = _run_prediction(payload)
                    response = {"status": "success", "requestId": request_id, **result}
                except Exception as pred_exc:
                    response = {"status": "error", "requestId": request_id, "error": str(pred_exc)}
                response_channel = f"{PREDICT_RESPONSE_PREFIX}{request_id}"
                await pub.publish(response_channel, json.dumps(response))
            except Exception as exc:
                print(f"[ml-worker] pubsub handler error: {exc}", file=sys.stderr)
    except Exception as exc:
        print(f"[ml-worker] pubsub listener crashed: {exc}", file=sys.stderr)


@asynccontextmanager
async def lifespan(application: FastAPI):  # type: ignore[type-arg]
    """Start background tasks on startup and cancel on shutdown."""
    global _redis_url
    _redis_url = os.getenv("REDIS_URL") or os.getenv("REDIS_PUBLIC_URL")
    if _redis_url:
        _background_tasks.append(asyncio.create_task(_heartbeat_loop()))
        _background_tasks.append(asyncio.create_task(_pubsub_listener_loop()))
    yield
    for task in _background_tasks:
        task.cancel()


app = FastAPI(
    title="ML Worker Service",
    description="Poloniex ML Worker with health checks, ML inference, and market ingestion",
    version="1.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    """Basic liveness/readiness endpoint for Railway."""
    return {
        "status": "ok",
        "service": "ml-worker",
        "python": sys.version.split()[0],
        "cwd": str(Path.cwd()),
        "env": {
            "PORT": os.getenv("PORT", ""),
            "PYTHONUNBUFFERED": os.getenv("PYTHONUNBUFFERED", ""),
        },
    }


@app.get("/healthz")
async def healthz():
    """Unified health endpoint for Railway deployment."""
    return {
        "status": "healthy",
        "service": "ml-worker",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "python": sys.version.split()[0],
        "cwd": str(Path.cwd()),
        "env": {
            "PORT": os.getenv("PORT", ""),
            "PYTHONUNBUFFERED": os.getenv("PYTHONUNBUFFERED", ""),
        },
    }


@app.get("/")
async def root():
    """Root endpoint with service information."""
    return {
        "service": "ml-worker",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "healthz": "/healthz",
            "predict": "/ml/predict (POST)",
            "ingest": "/run/ingest (POST)",
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# ML prediction endpoint
# ---------------------------------------------------------------------------

class PredictRequest(BaseModel):
    """Request body for /ml/predict."""

    action: str = "multi_horizon"
    symbol: str = "UNKNOWN"
    data: list[Any] = []
    horizon: str = "1h"
    current_price: float = 0.0


@app.post("/ml/predict")
async def ml_predict(request: PredictRequest):
    """Run ML inference using the intelligence layer.

    Accepts the same payload format as the legacy predict.py script so that
    polytrade-be can call this endpoint without changing its request schema.
    """
    try:
        result = _run_prediction(request.model_dump())
        return {"status": "success", **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/run/ingest")
async def run_ingest():
    """
    Optional trigger to run markets ingestion on-demand in Railway.
    Expects POLONIEX_API_KEY / POLONIEX_API_SECRET set in service variables.
    """
    script = Path(__file__).resolve().parent / "ingest_markets.py"
    
    if not script.exists():
        raise HTTPException(
            status_code=500,
            detail=f"ingest_markets.py not found at {script}"
        )
    
    # Verify API credentials are set
    if not os.getenv("POLONIEX_API_KEY") or not os.getenv("POLONIEX_API_SECRET"):
        raise HTTPException(
            status_code=500,
            detail="POLONIEX_API_KEY and POLONIEX_API_SECRET must be set"
        )
    
    try:
        # Run as a subprocess so we don't block the ASGI worker long-term
        proc = subprocess.run(
            [sys.executable, str(script)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=str(script.parent),
            env=os.environ.copy(),
            timeout=60 * 10,  # 10 minute timeout
            text=True,
            check=True,
        )
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "code": 0,
                "message": "Ingestion completed successfully",
                "output": proc.stdout[-MAX_OUTPUT_LENGTH:],  # return tail to limit payload size
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
    except subprocess.TimeoutExpired as e:
        return JSONResponse(
            status_code=504,
            content={
                "ok": False,
                "error": "timeout",
                "message": "Ingestion process timed out after 10 minutes",
                "output": (e.stdout or "")[-4000:] if hasattr(e, 'stdout') else "",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
    except subprocess.CalledProcessError as e:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "code": e.returncode,
                "error": "process_failed",
                "message": f"Ingestion process failed with exit code {e.returncode}",
                "output": (e.stdout or "")[-4000:],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": "unexpected_error",
                "message": str(e),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )


@app.get("/api/status")
async def api_status():
    """Extended status endpoint with environment information."""
    return {
        "service": "ml-worker",
        "status": "operational",
        "python_version": sys.version,
        "working_directory": str(Path.cwd()),
        "script_location": str(Path(__file__).resolve()),
        "environment": {
            "PORT": os.getenv("PORT", "not set"),
            "PYTHONUNBUFFERED": os.getenv("PYTHONUNBUFFERED", "not set"),
            "RAILWAY_ENVIRONMENT": os.getenv("RAILWAY_ENVIRONMENT", "not set"),
            "RAILWAY_SERVICE_NAME": os.getenv("RAILWAY_SERVICE_NAME", "not set"),
        },
        "api_credentials_configured": bool(
            os.getenv("POLONIEX_API_KEY") and os.getenv("POLONIEX_API_SECRET")
        ),
        "ingest_script_exists": (Path(__file__).resolve().parent / "ingest_markets.py").exists(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "health:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
        reload=False
    )
