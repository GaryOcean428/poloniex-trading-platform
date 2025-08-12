#!/bin/bash
set -e

echo "🔍 Verifying project structure for Railway deployment..."

# Check frontend
if [ -f "frontend/package.json" ] && [ -f "frontend/railpack.json" ]; then
  echo "✅ Frontend structure valid"
else
  echo "❌ Frontend missing required files"
  exit 1
fi

# Check backend
if [ -f "backend/package.json" ] && [ -f "backend/railpack.json" ]; then
  echo "✅ Backend structure valid"
else
  echo "❌ Backend missing required files"
  exit 1
fi

# Check ML worker (python service)
if [ -f "python-services/poloniex/requirements.txt" ] && [ -f "python-services/poloniex/railpack.json" ]; then
  echo "✅ ML worker dependencies present"
else
  echo "❌ ML worker missing requirements.txt or railpack.json"
  exit 1
fi

# Check health endpoints exist
if [ -f "python-services/poloniex/health.py" ]; then
  echo "✅ Python health endpoint present"
else
  echo "❌ Python health endpoint missing"
  exit 1
fi

if [ -f "frontend/serve.js" ]; then
  echo "✅ Frontend serve script present"
else
  echo "❌ Frontend serve script missing"
  exit 1
fi

echo "🎉 All services ready for Railway deployment"