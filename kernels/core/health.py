"""Health and utility endpoints for the ML worker service.

Exposes /health and /healthz for Railway liveness and readiness checks,
and a small /run/ingest helper to invoke ingest_markets.py on demand.
"""

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

# Constants
MAX_OUTPUT_LENGTH = 4000  # Maximum length of stdout to return in response

app = FastAPI(
    title="ML Worker Service",
    description="Poloniex ML Worker with health checks and market ingestion",
    version="1.0.0"
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
            "ingest": "/run/ingest (POST)",
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


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
