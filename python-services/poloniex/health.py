"""Health and utility endpoints for the ML worker service.

Exposes /health and /healthz for Railway liveness and readiness checks,
and a small /run/ingest helper to invoke ingest_markets.py on demand.
"""

import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI

app = FastAPI()


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
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "python": sys.version.split()[0],
        "cwd": str(Path.cwd()),
        "env": {
            "PORT": os.getenv("PORT", ""),
            "PYTHONUNBUFFERED": os.getenv("PYTHONUNBUFFERED", ""),
        },
    }


@app.post("/run/ingest")
async def run_ingest():
    """
    Optional trigger to run markets ingestion on-demand in Railway.
    Expects POLONIEX_API_KEY / POLONIEX_API_SECRET set in service variables.
    """
    script = Path(__file__).resolve().parent / "ingest_markets.py"
    if not script.exists():
        return {"ok": False, "error": "ingest_markets.py not found"}
    try:
        # Run as a subprocess so we don't block the ASGI worker long-term
        proc = subprocess.run(
            [sys.executable, str(script)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=str(Path(__file__).resolve().parent),
            env=os.environ.copy(),
            timeout=60 * 10,
            text=True,
            check=True,
        )
        return {
            "ok": True,
            "code": 0,
            "output": proc.stdout[-4000:],  # return tail to limit payload size
        }
    except subprocess.CalledProcessError as e:
        return {
            "ok": False,
            "code": e.returncode,
            "output": (e.stdout or "")[-4000:],
        }
