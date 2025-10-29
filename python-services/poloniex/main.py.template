#!/usr/bin/env python3
"""
Entry point for ML Worker service.
"""

import os
import sys
from pathlib import Path

# Import and run the FastAPI application
from health import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
