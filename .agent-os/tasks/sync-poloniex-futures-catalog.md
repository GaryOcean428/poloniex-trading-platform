# Task: Sync Poloniex Futures v3 Markets Catalog

Authoritative sources:

- docs/railway-poloniex-docs.md (canonical API + markets doc)
- Output catalog: docs/markets/poloniex-futures-v3.json

Policy

- Include ALL Poloniex futures markets.
- Use exchange maximum leverage and exchange maker/taker fees.

Deliverables

- Updated `docs/markets/poloniex-futures-v3.json` with all markets and fields populated.
- Validation report (console output or markdown snippet) showing counts and sample entries.

Checklist

1) Parse canonical doc
   - Extract market symbols, base/quote, contract type, precision, tick/lot sizes.
   - Extract leverage caps, fee schedule, funding interval, risk tiers if available.
2) Populate JSON
   - Fill `markets[]` entries according to the schema in the file.
   - Set `lastSynced` to ISO timestamp.
3) Validate
   - JSON schema: ensure required fields exist.
   - Spot-check: BTCUSDT, ETHUSDT, and 5 random symbols.
   - Counts: total markets > 0, no duplicates.
4) Commit and reference
   - Cross-check backtester and live services read from the catalog.

Acceptance Criteria

- Every market listed in the canonical doc exists in the catalog exactly once.
- Fees and max leverage match exchange-provided values.
- Funding interval is set to 8 hours unless explicitly specified otherwise.
- Catalog consumed by services without runtime errors.

Notes

- If details are missing in the doc, open an Agent OS task to query exchange endpoints and fill gaps.
