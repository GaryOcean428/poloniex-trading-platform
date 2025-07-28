#!/bin/bash

# Deployment validation script for Railway
# This script can be run after deployment to validate that all build errors are fixed

echo "🔧 Validating Poloniex Trading Platform deployment..."

# Get the current host URL
if [ -n "$RAILWAY_STATIC_URL" ]; then
    BASE_URL="$RAILWAY_STATIC_URL"
elif [ -n "$RAILWAY_PRIVATE_DOMAIN" ]; then
    BASE_URL="https://$RAILWAY_PRIVATE_DOMAIN"
else
    BASE_URL="http://localhost:${PORT:-3000}"
fi

echo "🌐 Testing deployment at: $BASE_URL"

# Function to test an endpoint
test_endpoint() {
    local path="$1"
    local expected_mime="$2"
    local url="${BASE_URL}${path}"
    
    echo "📄 Testing $path..."
    
    # Get response with timeout
    local response=$(curl -s -I --max-time 10 "$url" 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        echo "   ❌ FAIL: Request failed or timed out"
        return 1
    fi
    
    local status=$(echo "$response" | head -n1 | grep -o '[0-9]\{3\}')
    local content_type=$(echo "$response" | grep -i "content-type:" | cut -d' ' -f2- | tr -d '\r')
    
    if [ "$status" != "200" ]; then
        echo "   ❌ FAIL: HTTP $status"
        return 1
    fi
    
    if [[ ! "$content_type" =~ $expected_mime ]]; then
        echo "   ❌ FAIL: Expected '$expected_mime', got '$content_type'"
        return 1
    fi
    
    echo "   ✅ PASS ($status, $content_type)"
    return 0
}

# Test health check first
echo "🏥 Testing health endpoint..."
if ! test_endpoint "/api/health" "application/json"; then
    echo "❌ Health check failed - server may not be running"
    exit 1
fi

echo "✅ Server is healthy"
echo

# Test the problematic assets mentioned in the issue
TESTS_PASSED=0
TOTAL_TESTS=0

echo "📋 Testing assets that were causing build errors..."

# Test service worker (was getting 403)
((TOTAL_TESTS++))
if test_endpoint "/sw.js" "application/javascript"; then
    ((TESTS_PASSED++))
fi

# Test manifest icon (was missing)
((TOTAL_TESTS++))
if test_endpoint "/icon-192.png" "image/png"; then
    ((TESTS_PASSED++))
fi

# Test manifest file
((TOTAL_TESTS++))
if test_endpoint "/manifest.json" "application/manifest\+json"; then
    ((TESTS_PASSED++))
fi

# Test main page (should serve index.html)
((TOTAL_TESTS++))
if test_endpoint "/" "text/html"; then
    ((TESTS_PASSED++))
fi

# Get the actual JS bundle name from the index.html
echo "🔍 Checking for JS bundles..."
INDEX_CONTENT=$(curl -s --max-time 10 "$BASE_URL/" 2>/dev/null)
if [ $? -eq 0 ]; then
    JS_FILE=$(echo "$INDEX_CONTENT" | grep -o '/assets/index-[^"]*\.js' | head -n1)
    if [ -n "$JS_FILE" ]; then
        echo "📦 Found JS bundle: $JS_FILE"
        ((TOTAL_TESTS++))
        if test_endpoint "$JS_FILE" "application/javascript"; then
            ((TESTS_PASSED++))
        fi
    else
        echo "⚠️  Could not find main JS bundle in index.html"
    fi
else
    echo "⚠️  Could not fetch index.html to check for JS bundles"
fi

echo
echo "📊 Validation Results:"
echo "   Passed: $TESTS_PASSED/$TOTAL_TESTS"

if [ $TESTS_PASSED -eq $TOTAL_TESTS ]; then
    echo "✅ All validation tests passed!"
    echo
    echo "🎉 Build errors have been successfully resolved:"
    echo "   • JS modules are served with correct MIME type (not as text/html)"
    echo "   • Service worker loads without 403 errors"
    echo "   • Manifest icons are accessible"
    echo "   • Static file serving is working correctly"
    echo
    echo "🚀 Deployment is ready for production!"
    exit 0
else
    echo "❌ Some validation tests failed."
    echo "   This may indicate deployment issues that need attention."
    exit 1
fi