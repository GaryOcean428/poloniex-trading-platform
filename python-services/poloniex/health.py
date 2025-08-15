from fastapi import FastAPI
import os
import subprocess
import sys
from pathlib import Path

app = FastAPI()

@app.get("/health")
async def health():
    # Basic liveness/readiness endpoint for Railway
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
    # Unified health endpoint for Railway deployment
    return {
        "status": "healthy",
        "timestamp": Path(__file__).stat().st_mtime,
        "service": "ml-worker",
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
        )
        return {
            "ok": proc.returncode == 0,
            "code": proc.returncode,
            "output": proc.stdout[-4000:],  # return tail to limit payload size
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
