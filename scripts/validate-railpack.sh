#!/bin/bash
set -euo pipefail

echo "Validating Railpack configurations..."

# Ensure files exist
for f in frontend/railpack.json backend/railpack.json python-services/poloniex/railpack.json; do
  [[ -f "$f" ]] || { echo "ERROR: Missing $f"; exit 1; }
  jq . "$f" >/dev/null || { echo "ERROR: Invalid JSON in $f"; exit 1; }
  echo "✓ JSON valid: $f"

done

# Check providers using v0.3.0 schema placement (root-level provider)
frontend_provider=$(jq -r '.provider // empty' frontend/railpack.json)
backend_provider=$(jq -r '.provider // empty' backend/railpack.json)
ml_provider=$(jq -r '.provider // empty' python-services/poloniex/railpack.json)

[[ "$frontend_provider" == "node" ]] || { echo "ERROR: Frontend provider must be 'node' but was '${frontend_provider:-missing}'"; exit 1; }
[[ "$backend_provider" == "node" ]] || { echo "ERROR: Backend provider must be 'node' but was '${backend_provider:-missing}'"; exit 1; }
[[ "$ml_provider" == "python" ]] || { echo "ERROR: ML-worker provider must be 'python' but was '${ml_provider:-missing}'"; exit 1; }

echo "✓ All services have correct providers"
