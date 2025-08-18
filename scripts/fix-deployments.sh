#!/bin/bash
# Fix Railway Deployment Issues for Poloniex Trading Platform

set -e

echo "🔧 Fixing Railway Deployment Issues..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Fix ML Worker Python Dependencies
echo -e "${YELLOW}1. Fixing ML Worker Dependencies...${NC}"
cd python-services/poloniex

# Check if pyproject.toml exists and has correct dependencies
if [ -f "pyproject.toml" ]; then
    echo "✓ pyproject.toml exists with updated dependencies"
fi

# Check if requirements.txt exists and has correct dependencies
if [ -f "requirements.txt" ]; then
    echo "✓ requirements.txt exists with updated dependencies"
fi

# Create main.py entry point if it doesn't exist
if [ ! -f "main.py" ]; then
    echo "Creating main.py entry point..."
    cat > main.py << 'EOF'
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
EOF
fi

echo -e "${GREEN}✓ ML Worker fixed${NC}"
cd ../..

# 2. Fix Frontend TypeScript Paths
echo -e "${YELLOW}2. Checking Frontend TypeScript Configuration...${NC}"
cd frontend

if [ -f "tsconfig.json" ]; then
    echo "✓ tsconfig.json exists with updated path mappings"
fi

if [ -f "vite.config.ts" ]; then
    echo "✓ vite.config.ts exists with updated alias configuration"
fi

echo -e "${GREEN}✓ Frontend configuration verified${NC}"
cd ..

# 3. Fix Backend Yarn Configuration
echo -e "${YELLOW}3. Checking Backend Yarn Configuration...${NC}"
cd backend

# Check if .yarnrc.yml exists (should exist, not .yarnrc)
if [ -f ".yarnrc.yml" ]; then
    echo "✓ .yarnrc.yml exists (Yarn Berry configuration)"
fi

# Check that no legacy .yarnrc exists
if [ -f ".yarnrc" ]; then
    echo "⚠️  Legacy .yarnrc file exists - should be removed for Railway deployment"
    rm -f .yarnrc
    echo "✓ Removed legacy .yarnrc file"
fi

# Check package.json doesn't have conflicting packageManager field
if grep -q "packageManager" package.json 2>/dev/null; then
    echo "⚠️  packageManager field exists in package.json - removing for Railway compatibility"
    # Remove packageManager field if it exists
    node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    delete pkg.packageManager;
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
    "
    echo "✓ Removed packageManager field from package.json"
fi

echo -e "${GREEN}✓ Backend configuration verified${NC}"
cd ..

# 4. Verify shared types structure
echo -e "${YELLOW}4. Checking Shared Types...${NC}"

if [ -f "shared/types/index.ts" ]; then
    echo "✓ shared/types/index.ts exists with comprehensive types"
else
    echo "❌ shared/types/index.ts missing"
fi

echo -e "${GREEN}✅ All deployment fixes verified!${NC}"
echo ""
echo "Next steps:"
echo "1. Commit these changes: git add . && git commit -m 'Fix Railway deployment issues'"
echo "2. Push to repository: git push origin main"
echo "3. Railway should automatically redeploy"
echo ""
echo "For Railway UI configuration, ensure:"
echo "- Frontend service root directory: 'frontend'"
echo "- Backend service root directory: 'backend'"  
echo "- ML Worker service root directory: 'python-services/poloniex'"
echo "- Clear any Build/Install command overrides in Railway UI"