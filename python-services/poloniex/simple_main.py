#!/usr/bin/env python3
"""
Simplified entry point for ML Worker service - for Railway deployment testing.
"""

import os
from fastapi import FastAPI
import uvicorn

app = FastAPI(title="ML Worker Service")

@app.get("/")
def root():
    return {"status": "ok", "service": "ml-worker"}

@app.get("/health")
def health():
    return {"status": "healthy"}

@app.get("/healthz")
def healthz():
    return {"status": "healthy"}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
