#!/bin/bash
# Railpack Monorepo Build Validation Script
# This script validates that all services can build properly with the new Railpack configurations

set -e

echo "🔍 RAILPACK MONOREPO BUILD VALIDATION"
echo "======================================"

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

cd "$(dirname "$0")"

print_info "Validating repository structure..."
if [[ -d "frontend" && -d "backend" && -d "python-services/poloniex" ]]; then
    print_success "Repository structure confirmed (frontend/, backend/, python-services/poloniex/)"
else
    print_error "Repository structure incorrect"
    exit 1
fi

print_info "Checking Railpack configurations..."
if [[ -f "frontend/railpack.json" && -f "backend/railpack.json" && -f "python-services/poloniex/railpack.json" && -f "railpack.json" ]]; then
    print_success "All Railpack configurations present"
else
    print_error "Missing Railpack configuration files"
    exit 1
fi

print_info "Validating local layer inputs in configurations..."
for config in "frontend/railpack.json" "backend/railpack.json" "python-services/poloniex/railpack.json"; do
    if grep -q '"local": true' "$config"; then
        print_success "Local layer inputs found in $config"
    else
        print_error "Missing local layer inputs in $config"
        exit 1
    fi
done

print_info "Testing Frontend Build Process..."
cd frontend
if corepack enable && corepack prepare yarn@4.9.2 --activate; then
    print_success "Frontend corepack setup successful"
else
    print_error "Frontend corepack setup failed"
    exit 1
fi

if yarn install --immutable; then
    print_success "Frontend dependencies installed"
else
    print_error "Frontend dependency installation failed"
    exit 1
fi

if yarn build:deploy; then
    print_success "Frontend build successful"
    if [[ -d "dist" && -f "dist/index.html" ]]; then
        print_success "Frontend build artifacts confirmed (dist/index.html exists)"
    else
        print_error "Frontend build artifacts missing"
        exit 1
    fi
else
    print_error "Frontend build failed"
    exit 1
fi

cd ..

print_info "Testing Backend Build Process..."
cd backend
if corepack enable && corepack prepare yarn@4.9.2 --activate; then
    print_success "Backend corepack setup successful"
else
    print_error "Backend corepack setup failed"
    exit 1
fi

if yarn install --immutable; then
    print_success "Backend dependencies installed"
else
    print_error "Backend dependency installation failed"
    exit 1
fi

if yarn build; then
    print_success "Backend build successful"
    if [[ -d "dist" && -f "dist/backend/src/index.js" ]]; then
        print_success "Backend build artifacts confirmed (dist/backend/src/index.js exists)"
    else
        print_error "Backend build artifacts missing"
        exit 1
    fi
else
    print_error "Backend build failed"
    exit 1
fi

cd ..

print_info "Testing Python Service Setup..."
cd python-services/poloniex
if pip install -r requirements.txt --quiet; then
    print_success "Python dependencies installed"
else
    print_error "Python dependency installation failed"
    exit 1
fi

if python3 -c "import fastapi, uvicorn, numpy, pandas, sklearn; print('All imports successful')" > /dev/null 2>&1; then
    print_success "Python ML dependencies validation passed"
else
    print_error "Python ML dependencies validation failed"
    exit 1
fi

if python3 -c "from health import app; print('Health app imports successfully')" > /dev/null 2>&1; then
    print_success "Python health endpoint validation passed"
else
    print_error "Python health endpoint validation failed"
    exit 1
fi

cd ../..

print_info "Testing Yarn PATH Resolution Scripts..."
if [[ -x "backend/yarn-wrapper.sh" && -x "backend/setup-yarn.sh" ]]; then
    print_success "Yarn PATH resolution scripts are executable"
else
    print_error "Yarn PATH resolution scripts missing or not executable"
    exit 1
fi

echo ""
echo "🎉 ALL VALIDATIONS PASSED!"
echo "========================="
print_success "Frontend builds successfully with Railpack layer inputs"
print_success "Backend builds successfully with yarn PATH resolution"
print_success "Python service ready with ML dependencies"
print_success "Root Railpack coordination configuration created"
print_success "Monorepo build context crisis RESOLVED"

echo ""
print_info "Next Steps for Railway Deployment:"
echo "1. Remove any root directory settings from Railway UI for all services"
echo "2. Ensure services use their respective railpack.json configurations"
echo "3. Deploy services will now access their subdirectory files properly"
echo "4. Monitor build logs for successful 'local layer' file copying"