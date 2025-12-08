# Python Poloniex Futures Service

Purpose:
- Fetch Poloniex Futures v3 markets (product info + risk limits) using official SDK if present, otherwise signed REST.
- Normalize to the project catalog schema at docs/markets/poloniex-futures-v3.json.
- Support ML/research workflows (DQN/QL) in Python separate from the Node.js OMS.

Directory
- python-services/poloniex/ingest_markets.py  # main ingestion script

Python version
- Python 3.8+ recommended

Dependencies
- requests
- Optional: polo-sdk-python (not published to PyPI). You can clone and install from source:
  git clone https://github.com/poloniex/polo-sdk-python
  cd polo-sdk-python
  pip install .

Install (minimal)
- python3 -m venv .venv
- source .venv/bin/activate
- pip install requests

Environment Variables (session-only; do not commit secrets)
- POLO_API_KEY / POLO_API_SECRET (preferred for Python SDK)
- POLONIEX_API_KEY / POLONIEX_API_SECRET (fallback names)

Run
- source .venv/bin/activate
- export POLO_API_KEY="your_key"
- export POLO_API_SECRET="your_secret"
- python3 python-services/poloniex/ingest_markets.py

Behavior
- If credentials are present, performs signed GETs:
  - /v3/futures/api/market/get-all-product-info
  - /v3/futures/api/market/get-market-info (fallback)
  - /v3/futures/api/market/get-futures-risk-limit
- Writes normalized catalog to docs/markets/poloniex-futures-v3.json with:
  - tick/lot size, precision, minNotional, maxLeverage
  - risk tiers and maintenance margin table
  - funding cadence (8h)
- Updates lastSynced and bumps version when market count changes.

Troubleshooting
- 400 Invalid Apikey or Signature
  - Ensure API key is a Futures key (not Spot)
  - Ensure IP is allowlisted for this machine
  - Timestamp skew: the script uses seconds for PF-API-TIMESTAMP
  - Some accounts require a passphrase; add PF-API-PASSPHRASE support if needed
- 503 Service Unavailable
  - The futures host is intermittently unavailable; the script retries alternate host/prefix combinations

Notes
- This service is optional and complements the existing Node.js ingestion. Use it for Python-native data tasks, research, and ML workflows. Keep secrets out of the repository.
