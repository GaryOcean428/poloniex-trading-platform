"""ML Worker Service — FastAPI application.

Serves the intelligence layer (regime detection, coupling estimation,
basin detection, strategy loop) and health endpoints.
"""

from fastapi import FastAPI

from proprietary_core.api import router as intelligence_router

app = FastAPI(
    title="Poloniex ML Worker",
    description="Intelligence layer: regime detection, coupling estimation, basin detection, strategy loop.",
    version="0.2.0",
)

# Mount intelligence layer endpoints
app.include_router(intelligence_router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "ml-worker",
        "version": "0.2.0",
        "capabilities": [
            "regime_detection",
            "coupling_estimation",
            "basin_detection",
            "strategy_loop",
        ],
    }
