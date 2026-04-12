# ml-worker

Python-based ML inference service for the Poloniex trading platform.

## Overview

This service provides ML predictions (ARIMA, LSTM, GBM, Prophet, Transformer ensemble) to the
Node.js API via HTTP. It is deployed as a separate Railway service.

## HTTP Contract

### POST /ml/predict

**Request body:**
```json
{
  "action": "signal" | "predict" | "multi_horizon" | "train",
  "symbol": "BTC_USDT",
  "data": [{ "timestamp": 1234567890, "open": 100, "high": 105, "low": 95, "close": 102, "volume": 1000 }],
  "horizon": "1h" | "4h" | "24h",
  "current_price": 102.5
}
```

**Response:**
```json
{
  "status": "success",
  "signal": "BUY" | "SELL" | "HOLD",
  "strength": 0.75,
  "reason": "regime=creator strategy=momentum"
}
```

### GET /health

Returns `{ "status": "ok" }` when the service is healthy.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default: 8000) |

## Railway Configuration

The API service must have `ML_WORKER_URL` set to point to this service:

```
ML_WORKER_URL=http://ml-worker.railway.internal:8000
```

## Running Locally

```bash
pip install -r requirements.txt
python src/predict.py
```

## Architecture

```
apps/api (Node.js) --HTTP POST /ml/predict--> ml-worker (Python/FastAPI)
                   --GET /health------------>
```

The API falls back to SMA/momentum heuristics (via `simpleMlService.ts`) when this service is
unavailable or `ML_WORKER_URL` is not configured.
