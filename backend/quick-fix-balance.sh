#!/bin/bash

# Quick Fix Script for Balance Display Issue
# This script applies immediate fixes to resolve the $0.00 balance problem

set -e

echo "=================================================="
echo "Balance Display Quick Fix Script"
echo "=================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Backup current files
echo -e "${YELLOW}Step 1: Backing up current files...${NC}"
mkdir -p backups
cp src/db/connection.js backups/connection.js.backup 2>/dev/null || echo "No connection.js to backup"
cp src/services/apiCredentialsService.ts backups/apiCredentialsService.ts.backup 2>/dev/null || echo "No apiCredentialsService.ts to backup"
echo -e "${GREEN}✓ Backups created${NC}"
echo ""

# Step 2: Apply resilient database connection
echo -e "${YELLOW}Step 2: Applying resilient database connection...${NC}"
if [ -f "src/db/resilient-connection.js" ]; then
    cp src/db/resilient-connection.js src/db/connection.js
    echo -e "${GREEN}✓ Resilient connection applied${NC}"
else
    echo -e "${RED}✗ resilient-connection.js not found${NC}"
    echo "  Please ensure the file exists before running this script"
    exit 1
fi
echo ""

# Step 3: Apply improved API credentials service
echo -e "${YELLOW}Step 3: Applying improved API credentials service...${NC}"
if [ -f "src/services/apiCredentialsService-improved.ts" ]; then
    cp src/services/apiCredentialsService-improved.ts src/services/apiCredentialsService.ts
    echo -e "${GREEN}✓ Improved credentials service applied${NC}"
else
    echo -e "${RED}✗ apiCredentialsService-improved.ts not found${NC}"
    echo "  Please ensure the file exists before running this script"
    exit 1
fi
echo ""

# Step 4: Rebuild TypeScript
echo -e "${YELLOW}Step 4: Rebuilding TypeScript...${NC}"
if command -v yarn &> /dev/null; then
    yarn build
    echo -e "${GREEN}✓ TypeScript rebuilt${NC}"
else
    echo -e "${RED}✗ yarn not found${NC}"
    echo "  Please install yarn or run 'npm run build' manually"
    exit 1
fi
echo ""

# Step 5: Run database migration
echo -e "${YELLOW}Step 5: Running database migration...${NC}"
if [ -f "migrations/006_add_encryption_tag.sql" ]; then
    echo "Checking if migration is needed..."
    # This would need to be run with proper database connection
    echo -e "${YELLOW}⚠ Manual step required:${NC}"
    echo "  Run: node run-migration.js 006_add_encryption_tag.sql"
else
    echo -e "${YELLOW}⚠ Migration file not found - may already be applied${NC}"
fi
echo ""

# Step 6: Restart backend service
echo -e "${YELLOW}Step 6: Restart instructions...${NC}"
echo "To apply changes, restart the backend service:"
echo "  Development: yarn dev"
echo "  Production: pm2 restart backend"
echo ""

echo "=================================================="
echo -e "${GREEN}Quick fix applied successfully!${NC}"
echo "=================================================="
echo ""
echo "Next steps:"
echo "1. Restart the backend service"
echo "2. Run diagnostic: node diagnose-balance-flow.js"
echo "3. Test balance display in frontend"
echo "4. If still showing \$0.00, users need to re-enter API credentials"
echo ""
echo "For detailed analysis, see: BALANCE_DISPLAY_ANALYSIS.md"
