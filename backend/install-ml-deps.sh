#!/bin/bash
# Install Python ML dependencies for Railway deployment

echo "Installing Python ML dependencies..."

# Check if pip3.11 is available
if command -v pip3.11 &> /dev/null; then
    PIP_CMD=pip3.11
elif command -v pip3 &> /dev/null; then
    PIP_CMD=pip3
else
    echo "Error: pip3 not found"
    exit 1
fi

# Install dependencies
cd /home/ubuntu/poloniex-trading-platform/backend/src/ml
$PIP_CMD install -r requirements.txt --user

echo "✅ ML dependencies installed successfully"
