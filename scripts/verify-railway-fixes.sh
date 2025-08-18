#!/bin/bash

# Verification script for Railway Yarn Berry compatibility and shared module resolution fixes

set -e

echo "🔍 Verifying Railway deployment fixes..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    if [ "$2" == "SUCCESS" ]; then
        echo -e "${GREEN}✅ $1${NC}"
    elif [ "$2" == "ERROR" ]; then
        echo -e "${RED}❌ $1${NC}"
        exit 1
    else
        echo -e "${YELLOW}⏳ $1${NC}"
    fi
}

print_status "Starting Railway deployment verification" "INFO"

# 1. Verify Yarn Berry version
print_status "Checking Yarn version..." "INFO"
YARN_VERSION=$(yarn --version)
if [[ "$YARN_VERSION" == "4.9.2" ]]; then
    print_status "Yarn Berry 4.9.2 confirmed" "SUCCESS"
else
    print_status "Expected Yarn 4.9.2, got $YARN_VERSION" "ERROR"
fi

# 2. Verify .yarnrc.yml configuration
print_status "Checking .yarnrc.yml configuration..." "INFO"
if grep -q "enableImmutableInstalls: true" .yarnrc.yml; then
    print_status ".yarnrc.yml has enableImmutableInstalls: true" "SUCCESS"
else
    print_status ".yarnrc.yml missing enableImmutableInstalls: true" "ERROR"
fi

# 3. Verify railpack.json files have Yarn Berry commands
print_status "Checking backend railpack.json..." "INFO"
if grep -q "yarn install --immutable --immutable-cache" backend/railpack.json; then
    print_status "Backend uses correct Yarn Berry install command" "SUCCESS"
else
    print_status "Backend railpack.json missing Yarn Berry install command" "ERROR"
fi

if grep -q "copy-shared" backend/railpack.json; then
    print_status "Backend has copy-shared step" "SUCCESS"
else
    print_status "Backend railpack.json missing copy-shared step" "ERROR"
fi

print_status "Checking frontend railpack.json..." "INFO"
if grep -q "yarn install --immutable --immutable-cache" frontend/railpack.json; then
    print_status "Frontend uses correct Yarn Berry install command" "SUCCESS"
else
    print_status "Frontend railpack.json missing Yarn Berry install command" "ERROR"
fi

if grep -q "copy-shared" frontend/railpack.json; then
    print_status "Frontend has copy-shared step" "SUCCESS"
else
    print_status "Frontend railpack.json missing copy-shared step" "ERROR"
fi

# 4. Test backend build simulation
print_status "Testing backend build simulation..." "INFO"
cd backend
if [ -d shared ]; then
    rm -rf shared
fi
cp -r ../shared ./shared
if npx tsc > /dev/null 2>&1; then
    print_status "Backend TypeScript compilation successful" "SUCCESS"
else
    print_status "Backend TypeScript compilation failed" "ERROR"
fi
rm -rf shared dist
cd ..

# 5. Test frontend build simulation
print_status "Testing frontend build simulation..." "INFO"
cd frontend
if [ -d src/shared ]; then
    rm -rf src/shared
fi
mkdir -p src/shared/types src/shared/middleware
cp ../shared/types/*.ts src/shared/types/
cp ../shared/*.ts src/shared/
cp -r ../shared/middleware src/shared/

if npx tsc --noEmit --skipLibCheck > /dev/null 2>&1; then
    print_status "Frontend TypeScript compilation successful" "SUCCESS"
else
    print_status "Frontend TypeScript compilation failed" "ERROR"
fi

if npx vite build > /dev/null 2>&1; then
    print_status "Frontend Vite build successful" "SUCCESS"
else
    print_status "Frontend Vite build failed" "ERROR"
fi

rm -rf src/shared dist
cd ..

# 6. Verify shared types are properly exported
print_status "Checking shared types exports..." "INFO"
if grep -q "export { StrategyType }" frontend/src/types/index.ts; then
    print_status "StrategyType exported as value" "SUCCESS"
else
    print_status "StrategyType not properly exported" "ERROR"
fi

if grep -q "export \* from '@shared/types/strategy'" frontend/src/types/index.ts; then
    print_status "Shared types re-exported" "SUCCESS"
else
    print_status "Shared types not re-exported" "ERROR"
fi

# 7. Verify TypeScript configurations
print_status "Checking TypeScript configurations..." "INFO"
if grep -q '"@shared/\*": \["./src/shared/\*"' frontend/tsconfig.json; then
    print_status "Frontend tsconfig.json has updated @shared paths" "SUCCESS"
else
    print_status "Frontend tsconfig.json missing updated @shared paths" "ERROR"
fi

if grep -q '"@shared/\*": \["./shared/\*"' backend/tsconfig.json; then
    print_status "Backend tsconfig.json has updated @shared paths" "SUCCESS"
else
    print_status "Backend tsconfig.json missing updated @shared paths" "ERROR"
fi

# 8. Verify Vite configuration
print_status "Checking Vite configuration..." "INFO"
if grep -q '"@shared": path.resolve(__dirname, "./src/shared")' frontend/vite.config.ts; then
    print_status "Vite config updated for copied shared directory" "SUCCESS"
else
    print_status "Vite config not updated for copied shared directory" "ERROR"
fi

echo ""
print_status "All verifications passed! 🎉" "SUCCESS"
echo ""
echo "✅ Backend: Yarn Berry compatible with shared module copying"
echo "✅ Frontend: Yarn Berry compatible with shared module copying"
echo "✅ TypeScript: Configurations updated for isolated builds"
echo "✅ Vite: Configuration updated for Railway deployment"
echo ""
echo "🚀 Ready for Railway deployment!"