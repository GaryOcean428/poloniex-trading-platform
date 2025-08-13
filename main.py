#!/usr/bin/env python3
"""
Root entry point for ML Worker service.
This file exists to help Railway/Railpack detect the Python service.
"""

import os
import sys

# Add the python-services directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'python-services', 'poloniex'))

# Import and run the FastAPI application
from health import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)