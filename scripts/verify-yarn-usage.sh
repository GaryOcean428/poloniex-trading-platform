#!/bin/bash

# Verify Yarn Usage Script for Railway Backend Deployment
# This script helps verify that Yarn is being used instead of npm

echo "========================================="
echo "Yarn Usage Verification for Backend"
echo "========================================="
echo ""

# Check if we're in the correct directory
if [ ! -f "backend/package.json" ]; then
    echo "❌ Error: Not in the polytrade root directory"
    echo "   Please run this script from the project root"
    exit 1
fi

echo "✅ Checking configuration files..."
echo ""

# Check for railpack.json
if [ -f "backend/railpack.json" ]; then
    echo "✅ backend/railpack.json exists"
    echo "   Configuration:"
    grep -A1 '"yarn"' backend/railpack.json | sed 's/^/   /'
    grep -A1 '"install"' backend/railpack.json | sed 's/^/   /'
    grep -A1 '"build"' backend/railpack.json | sed 's/^/   /'
else
    echo "❌ backend/railpack.json is missing!"
fi

echo ""

# Check for railway.toml (should not exist)
if [ -f "railway.toml" ] || [ -f "backend/railway.toml" ]; then
    echo "⚠️  WARNING: railway.toml file found!"
    echo "   This will conflict with railpack.json"
    echo "   Please remove railway.toml files"
else
    echo "✅ No railway.toml files found (good!)"
fi

echo ""

# Check yarn configuration
if [ -f ".yarnrc.yml" ]; then
    echo "✅ .yarnrc.yml exists"
    echo "   Yarn version:"
    grep "yarnPath" .yarnrc.yml | sed 's/^/   /'
else
    echo "❌ .yarnrc.yml is missing!"
fi

echo ""

# Check for yarn.lock
if [ -f "backend/yarn.lock" ]; then
    echo "✅ backend/yarn.lock exists"
else
    echo "⚠️  backend/yarn.lock is missing"
    echo "   Run 'cd backend && yarn install' to generate it"
fi

# Check for package-lock.json (should not exist)
if [ -f "backend/package-lock.json" ]; then
    echo "❌ backend/package-lock.json exists!"
    echo "   This indicates npm was used. Please remove it:"
    echo "   rm backend/package-lock.json"
else
    echo "✅ No package-lock.json found (good!)"
fi

echo ""
echo "========================================="
echo "Railway Dashboard Configuration Required:"
echo "========================================="
echo ""
echo "1. Go to Railway Dashboard → Services → Backend (polytrade-be)"
echo "2. Navigate to Settings → Build & Deploy"
echo "3. CLEAR these fields (leave blank):"
echo "   - Install Command"
echo "   - Build Command"
echo "   - Watch Paths"
echo "4. Save and Redeploy"
echo ""
echo "If clearing doesn't work, explicitly set:"
echo "   Install Command: corepack enable; corepack prepare yarn@4.9.2 --activate; yarn --cwd .. install --check-cache"
echo "   Build Command: yarn run build"
echo ""
echo "========================================="
