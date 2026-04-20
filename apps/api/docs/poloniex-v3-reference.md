<!--
Vendored from https://github.com/poloniex/polo-skills-hub/tree/master/skills/futures
Commit: bca01fb370f2f6d30fddba5a5eb4467134238f49 (fetched 2026-04-20)
License: MIT (see poloniex-v3-LICENSE.md)
Refresh: gh api repos/poloniex/polo-skills-hub/contents/skills/futures/SKILL.md --jq '.content' | base64 -d
-->

---
name: polo-futures
description: Poloniex perpetual futures trading using the Poloniex Futures API. Authentication requires API key and secret key for certain endpoints. Supports mainnet.
metadata:
  version: 1.0.0
  author: Poloniex
license: MIT
---

# Poloniex Futures Skill

Perpetual futures trading on Poloniex using authenticated and public API endpoints. Return the result in JSON format.

## Base URLs

* Production: https://api.poloniex.com

## Quick Reference

Complete API endpoints for Poloniex Futures. All endpoints use base URL `https://api.poloniex.com`.

### Account
| Endpoint | Description | Required | Optional | Authentication |
|----------|-------------|----------|----------|----------------|
| GET `/v3/account/balance` | Get Account Balance | None | None | Yes |
| GET `/v3/account/bills` | Get Bills Details | None | None | Yes |

### Order
| Endpoint | Description | Required | Optional | Authentication |
|----------|-------------|----------|----------|----------------|
| POST `/v3/trade/order` | Place Order | symbol, side, mgnMode, posSide, type, sz | clOrdId, px, reduceOnly, timeInForce, stpMode | Yes |
| POST `/v3/trade/orders` | Place Multiple Orders (max 10) | symbol, side, mgnMode, posSide, type, sz | clOrdId, px, reduceOnly, timeInForce, stpMode | Yes |
| DELETE `/v3/trade/order` | Cancel Order | symbol | ordId, clOrdId | Yes |
| DELETE `/v3/trade/batchOrders` | Cancel Multiple Orders (max 10) | symbol | ordIds, clOrdIds | Yes |
| DELETE `/v3/trade/allOrders` | Cancel All Orders | None | symbol, side | Yes |
| POST `/v3/trade/position` | Close At Market Price | symbol, mgnMode | posSide, clOrdId | Yes |
| POST `/v3/trade/positionAll` | Close All At Market Price | None | None | Yes |
| GET `/v3/trade/order/opens` | Get Current Orders | None | side, symbol, ordId, clOrdId, from, limit, direct | Yes |
| GET `/v3/trade/order/trades` | Get Execution Details | None | side, symbol, ordId, clOrdId, sTime, eTime, from, limit, direct | Yes |
| GET `/v3/trade/order/history` | Get Order History | None | symbol, side, ordId, clOrdId, state, type, sTime, eTime, from, limit, direct | Yes |
| GET `/v3/trade/order/details` | Get Order Details | None | ordId, clOrdId | Yes |

### Position
| Endpoint | Description | Required | Optional | Authentication |
|----------|-------------|----------|----------|----------------|
| GET `/v3/trade/position/opens` | Get Current Position | None | symbol | Yes |
| GET `/v3/trade/position/history` | Get Position History | None | symbol, mgnMode, posSide, sTime, eTime, from, limit, direct | Yes |
| POST `/v3/trade/position/margin` | Adjust Margin (Isolated Mode) | symbol, amt, type | posSide | Yes |
| GET `/v3/position/leverages` | Get Leverage List | symbol | mgnMode | Yes |
| POST `/v3/position/leverage` | Set Leverage | symbol, mgnMode, posSide, lever | None | Yes |
| GET `/v3/position/mode` | View Position Mode | None | None | Yes |
| POST `/v3/position/mode` | Switch Position Mode | posMode | None | Yes |
| GET `/v3/position/riskLimit` | Get User Position Risk Limit | symbol | mgnMode, posSide | Yes |

### Market Data
| Endpoint | Description | Required | Optional | Authentication |
|----------|-------------|----------|----------|----------------|
| GET `/v3/market/orderBook` | Get Order Book | symbol | scale, limit | No |
| GET `/v3/market/candles` | Get K-line Data | symbol, interval | limit, sTime, eTime | No |
| GET `/v3/market/trades` | Get Execution Info | symbol | limit | No |
| GET `/v3/market/liquidationOrder` | Get Liquidation Orders | None | sTime, eTime, symbol, from, limit, direct | No |
| GET `/v3/market/tickers` | Get Market Info (24h) | None | symbol | No |
| GET `/v3/market/indexPrice` | Get Index Price | None | symbol | No |
| GET `/v3/market/indexPriceComponents` | Get Index Price Components | symbol | None | No |
| GET `/v3/market/indexPriceCandlesticks` | Get Index Price K-line Data | symbol, interval | sTime, eTime, limit | No |
| GET `/v3/market/premiumIndexCandlesticks` | Get Premium Index K-line Data | symbol, interval | sTime, eTime, limit | No |
| GET `/v3/market/markPrice` | Get Mark Price | None | symbol | No |
| GET `/v3/market/markPriceCandlesticks` | Get Mark Price K-line Data | symbol, interval | sTime, eTime, limit | No |
| GET `/v3/market/allInstruments` | Get All Contract Info | None | symbol | No |
| GET `/v3/market/instruments` | Get Contract Info | symbol | None | No |
| GET `/v3/market/fundingRate` | Get Current Funding Rate | symbol | None | No |
| GET `/v3/market/fundingRate/history` | Get Historical Funding Rates | None | symbol, sT, eT, limit | No |
| GET `/v3/market/openInterest` | Get Open Interest | symbol | None | No |
| GET `/v3/market/insurance` | Get Insurance Fund Info | None | None | No |
| GET `/v3/market/riskLimit` | Get Futures Risk Limit | symbol | mgnMode, tier | No |
| GET `/v3/market/limitPrice` | Get Limit Price | symbol | None | No |

---

## Parameters

### Common Parameters

#### Contract & Symbol
* **symbol**: Trading pair (e.g., BTCUSDTPERP, ETHUSDTPERP) — base currency + quote currency

#### Account & Margin
* **mgnMode**: Margin mode (CROSS, ISOLATED)
* **posMode**: Position mode (HEDGE: LONG/SHORT two-way, ONE_WAY: BOTH)

#### Order Parameters
* **ordId**: Order ID
* **clOrdId**: Client-assigned order ID
* **side**: Order side (BUY, SELL)
* **type**: Order type (MARKET, LIMIT, LIMIT_MAKER)
* **sz**: Order size in Cont (contracts)
* **px**: Price — required for LIMIT orders, omit for MARKET orders
* **posSide**: Position side (LONG, SHORT, BOTH — use BOTH for one-way mode)
* **reduceOnly**: Reduce only flag (Boolean)
* **timeInForce**: Time in force (GTC default, FOK, IOC)
* **stpMode**: Self-trade prevention (NONE default, EXPIRE_TAKER, EXPIRE_MAKER, EXPIRE_BOTH)

#### Margin Adjustment Parameters
* **amt**: Margin amount to add or reduce
* **type**: Adjustment type (ADD, REDUCE)

#### Leverage Parameters
* **lever**: Leverage rate (1 to 75)

#### Query & Pagination Parameters
* **from**: Starting ID for cursor-based pagination (default 0)
* **limit**: Page size (default 10, max 100; some endpoints max 500 or 1000)
* **direct**: Search direction (NEXT: chronological default, PREV: reverse)
* **sTime**: Start time (Unix timestamp in milliseconds)
* **eTime**: End time (Unix timestamp in milliseconds)
* **sT**: Start time (Unix timestamp in seconds — funding rate history)
* **eT**: End time (Unix timestamp in seconds — funding rate history)
* **state**: Order state filter (FILLED, PARTIALLY_CANCELED, CANCELED)

#### Market Data Parameters
* **interval**: K-line period (MINUTE_1, MINUTE_5, MINUTE_15, MINUTE_30, HOUR_1, HOUR_2, HOUR_4, HOUR_8, HOUR_12, DAY_1, DAY_3, WEEK_1)
* **scale**: Market depth level
* **tier**: Risk limit tier

### Enums

#### Order Side
* **side**: BUY, SELL

#### Order Type
* **type**: MARKET, LIMIT, LIMIT_MAKER

#### Time in Force
* **timeInForce**: GTC (Good Till Cancel, default), FOK (Fill or Kill), IOC (Immediate or Cancel)

#### Position Side
* **posSide**: LONG, SHORT, BOTH (BOTH = one-way mode)

#### Self-Trade Prevention
* **stpMode**: NONE (default), EXPIRE_TAKER, EXPIRE_MAKER, EXPIRE_BOTH

#### Margin Mode
* **mgnMode**: CROSS, ISOLATED

#### Position Mode
* **posMode**: HEDGE (LONG/SHORT two-way), ONE_WAY (BOTH one-way)

#### Order State
* **state**: FILLED, PARTIALLY_CANCELED, CANCELED

#### Pagination Direction
* **direct**: NEXT (chronological, default), PREV (reverse chronological)

---

## Authentication

For endpoints that require authentication, you will need to provide Poloniex API credentials.

Required credentials:
* **apiKey**: Your Poloniex API key
* **secretKey**: Your Poloniex API secret (for signing)

See `references/authentication.md` for detailed signing instructions.

---

## Security

### Share Credentials

Users can provide Poloniex API credentials by sending a file where the content is in the following format:

```bash
api_key_here
secret_key_here
```

### Never Display Full Secrets

When showing credentials to users:
- **API Key:** Show first 5 + last 4 characters: `abcde...xyz1`
- **Secret Key:** Always mask, show only last 5: `***...key12`

Example response when asked for credentials:
```
Account: main
API Key: abcde...xyz1
Secret: ***...key12
Environment: Production
```

### Listing Accounts

When listing accounts, show names and environment only — never keys:
```
Poloniex Futures Accounts:
* main (Production)
* trading (Production)
```

### Transactions in Production

When performing transactions in production, always confirm with the user before proceeding by asking them to write "CONFIRM" to proceed.

---

## Poloniex Futures Accounts

### main
- API Key: your_api_key
- Secret: your_secret_key
- Environment: https://api.poloniex.com
- Description: Primary perpetual futures trading account


### TOOLS.md Structure

```bash
## Poloniex Futures Accounts

### main
- API Key: abcde...xyz1
- Secret: secret_abc...key
- Environment: https://api.poloniex.com
- Description: Primary perpetual futures trading account

```

## Agent Behavior

1. **Credentials requested**: Mask secrets (show last 5 chars only)
2. **Listing accounts**: Show names and environment, never keys
3. **Account selection**: Ask if ambiguous, default to main
4. **When doing a transaction in production**, confirm with user before by asking to write "CONFIRM" to proceed
5. **New credentials**: Prompt for name, environment

## Adding New Accounts

When user provides new credentials:

* Ask for account name
* Ask: Which environment (Production)
* Store in `TOOLS.md` with masked display confirmation

## User Agent Header

Include `User-Agent` header with the following string: `polo-futures/1.0.0 (Skill)`

## Important Notes

* All timestamps are in Unix milliseconds unless specified otherwise (funding rate history uses seconds)
* Contract codes should use uppercase (e.g., BTCUSDTPERP, ETHUSDTPERP)
* `sz` represents the number of contracts (Cont) for all order types
* Rate limits apply — see Poloniex API documentation for details
* Signature must be calculated for every authenticated request
* Timestamp in signature must be within 5 minutes of server time
* Both CROSS and ISOLATED margin modes are supported
* Position modes: HEDGE (two-way LONG/SHORT) and ONE_WAY (BOTH); use `posSide=BOTH` for one-way mode
* `px` (price) is required for LIMIT orders; omit for MARKET orders
* Batch order endpoints support a maximum of 10 orders per request
* Canceled orders (no fills) via API can only be queried for 5 hours; other order history: 90 days
* Switch position mode only when there are no open positions or pending orders
* Pagination uses cursor-based `from` + `limit` + `direct` parameters
* For `Get Order Details`, either `ordId` or `clOrdId` must be provided; if both are passed, both are verified
* All DELETE requests that do not require parameters must include a request body of `{}` (empty JSON object) — use `json={}` in the request
* All request endpoints must match the endpoints specified in the documentation.


