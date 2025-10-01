#!/bin/bash
# Debug script to identify empty YARN_* environment variables
# Usage: ./scripts/debug-yarn-env.sh

echo "==================================="
echo "YARN Environment Variable Debugger"
echo "==================================="
echo ""

# List all environment variables starting with YARN_
echo "📋 All YARN_* environment variables:"
env | grep "^YARN_" | sort || echo "  (none found)"
echo ""

# Check for empty values
echo "🔍 Checking for empty YARN_* boolean variables:"
FOUND_EMPTY=false

for var in $(env | grep "^YARN_" | cut -d= -f1); do
    value="${!var}"
    
    # Check if empty
    if [ -z "$value" ]; then
        echo "  ❌ EMPTY: $var= (no value)"
        FOUND_EMPTY=true
    # Check if it's a boolean setting with invalid value
    elif [[ "$var" == *"ENABLE"* ]] && [[ "$value" != "true" && "$value" != "false" && "$value" != "1" && "$value" != "0" ]]; then
        echo "  ⚠️  INVALID: $var=\"$value\" (expected: true/false/1/0)"
        FOUND_EMPTY=true
    fi
done

if [ "$FOUND_EMPTY" = false ]; then
    echo "  ✅ No empty or invalid YARN_* boolean variables found"
fi

echo ""
echo "📊 Railway/Nixpacks default variables (expected):"
echo "  CI: ${CI:-(not set)}"
echo "  NODE_ENV: ${NODE_ENV:-(not set)}"
echo "  NPM_CONFIG_PRODUCTION: ${NPM_CONFIG_PRODUCTION:-(not set)}"
echo ""

# Check .yarnrc.yml for environment variable references
echo "📄 Checking .yarnrc.yml for environment variable references:"
if [ -f ".yarnrc.yml" ]; then
    if grep -q '\${' .yarnrc.yml; then
        echo "  ⚠️  Found environment variable references:"
        grep '\${' .yarnrc.yml | sed 's/^/    /'
    else
        echo "  ✅ No environment variable references (using literal values)"
    fi
else
    echo "  ❌ .yarnrc.yml not found"
fi

echo ""
echo "==================================="
echo "Diagnosis complete"
echo "==================================="
