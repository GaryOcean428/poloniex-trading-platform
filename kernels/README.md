# Proprietary Kernels

This directory contains the proprietary computational kernels for the Poloniex Trading Platform.

## Structure

```
kernels/
├── core/              # Core Python/ML logic as installable package
│   ├── proprietary_core/  # Python package
│   │   ├── __init__.py
│   │   └── ...
│   ├── pyproject.toml     # Package definition
│   └── README.md
├── bindings/          # Language bindings (if using C++/Rust)
└── Dockerfile         # Container for ML worker service
```

## Core Package

The `core` directory contains the `proprietary-core` Python package, which provides:

- Machine learning models for trading predictions
- Market analysis algorithms
- Strategy computation engines
- Data processing utilities

### Installation

As a library (for API import):
```bash
cd kernels/core
uv pip install -e .
```

As a development service:
```bash
cd kernels/core
uv pip install -e ".[dev]"
```

### Usage in API

```python
# In your FastAPI/Flask backend
import proprietary_core

# Use the kernel functionality
result = proprietary_core.analyze_market(data)
```

## Development

### Local Development

Run the ML worker service:
```bash
cd kernels/core
uvicorn main:app --reload --port 9080
```

### Testing

```bash
pytest
```

### Linting

```bash
ruff check .
mypy .
```

## Docker

Build and run with Docker:
```bash
docker build -f kernels/Dockerfile -t poloniex-ml-worker .
docker run -p 9080:9080 poloniex-ml-worker
```

## Environment Variables

- `PORT` - Service port (default: 9080)
- `PYTHONUNBUFFERED` - Disable buffering (set to 1)
- `DATABASE_URL` - Postgres connection string
- `BACKEND_URL` - Backend API URL for communication

## API Endpoints

The ML worker exposes:

- `GET /health` - Health check endpoint
- `POST /predict` - ML prediction endpoint (to be implemented)
- `POST /analyze` - Market analysis endpoint (to be implemented)

## Integration

The backend API imports this package:
```python
# apps/api/src/services/ml.py
from proprietary_core import analyze_market, predict_trend

def get_prediction(market_data):
    return predict_trend(market_data)
```
