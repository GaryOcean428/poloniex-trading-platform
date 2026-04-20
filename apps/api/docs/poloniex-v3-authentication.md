<!--
Vendored from https://github.com/poloniex/polo-skills-hub/tree/master/skills/futures/references/authentication.md
Commit: bca01fb370f2f6d30fddba5a5eb4467134238f49 (fetched 2026-04-20)
License: MIT (see poloniex-v3-LICENSE.md)
-->

# Polo Spot Authentication

All private API endpoints require signed requests using HMAC-SHA256.

## Base URLs

| Environment | URL |
|-------------|-----|
| Production | https://api.poloniex.com |

## Environment Variables

Configure your API credentials using environment variables:

```bash
export POLO_API_KEY="your_api_key"
export POLO_SECRET_KEY="your_secret_key"
```

## Overview

All private API requests must be authenticated by signing the request with your Secret Key. Each API Key has permission properties — ensure your API key has the required permissions (Read, Trade, Withdraw) for the operations you need.

Authentication is done by sending required parameters in HTTP **headers** (not query parameters).

## Required Headers for All Authenticated Requests

Every authenticated request must include the following headers:

* **key**: Your API Key (e.g., "A3xxxxxx-99xxxxxx-84xxxxxx-72xxxxxx")
* **signTimestamp**: UTC timestamp in milliseconds (Unix epoch). Valid within 1 minute of server time.
* **signature**: HMAC-SHA256 signature of the request (Base64-encoded)
* **signatureMethod** (optional): Signature method, always "HmacSHA256"
* **signatureVersion** (optional): Signature version, always "2"
* **recvWindow** (optional): Duration in milliseconds for additional timing control

### recvWindow Error Codes

If `recvWindow` is specified, the request will be rejected if `(server_time - signTimestamp) > recvWindow`:

* **400**: signTimestamp is more than 1 second from server time
* **408**: Request timeout as recvWindow threshold has been breached

## Signature Process

### Step 1: Build the Pre-Sign String

The pre-sign string format depends on the request method:

#### GET Requests

Concatenate the HTTP method, path, and sorted query parameters with `\n`:

```
GET\n
/orders\n
limit=5&signTimestamp=1659259836247&symbol=ETH_USDT
```

**Important**:
- Sort all query parameters alphabetically by key name
- Join parameters with `&`
- Do NOT include the `signature` parameter itself
- All parameters must be URL/UTF-8 encoded (space = "%20")

#### POST/DELETE Requests with Body

Concatenate the HTTP method, path, requestBody, and timestamp with `\n`:

```
DELETE\n
/orders/cancelByIds\n
requestBody={"orderIds":["1234567890"],"clientOrderIds":["myId-1"]}&signTimestamp=1631018760000
```

**Important**:
- The body must be included as `requestBody=<json_string>` in the pre-sign string
- Connect requestBody and signTimestamp with `&`

#### POST/DELETE Requests without Body

Concatenate the HTTP method, path, and timestamp with `\n`:

```
DELETE\n
/orders/1\n
signTimestamp=1631018760000
```

### Step 2: Generate Signature

Sign the pre-sign string using HMAC-SHA256 with your Secret Key, then Base64-encode the result:

```python
import hmac
import hashlib
import base64

signature = base64.b64encode(
    hmac.new(
        secret_key.encode('utf-8'),
        presign_string.encode('utf-8'),
        hashlib.sha256
    ).digest()
).decode('utf-8')
```

### Step 3: Send the Request

Add all authentication parameters to the request **headers**, not the URL query string.

**For GET requests:** Query parameters go in the URL, authentication goes in headers.

```bash
curl -X GET \
  --header 'key: A3xxxxxx-99xxxxxx-84xxxxxx-72xxxxxx' \
  --header 'signatureMethod: HmacSHA256' \
  --header 'signatureVersion: 2' \
  --header 'signTimestamp: 1631018760000' \
  --header 'signature: 5g4Rx5A2bLyMWFgR3Aqp+B4w+iJkL7n5OD3SuYtCJK8=' \
  'https://api.poloniex.com/orders?symbol=ETH_USDT&limit=5'
```

**For POST requests:** Authentication in headers, business parameters in JSON body.

```bash
curl -X POST \
  --header 'Content-Type: application/json' \
  --header 'key: A3xxxxxx-99xxxxxx-84xxxxxx-72xxxxxx' \
  --header 'signatureMethod: HmacSHA256' \
  --header 'signatureVersion: 2' \
  --header 'signTimestamp: 1631018760000' \
  --header 'signature: 5g4Rx5A2bLyMWFgR3Aqp+B4w+iJkL7n5OD3SuYtCJK8=' \
  --data '{"symbol":"BTC_USDT","side":"BUY","type":"LIMIT","price":"30000","quantity":"0.001"}' \
  'https://api.poloniex.com/orders'
```

## Request Method Summary

| Method | Query Params in Signature | Body in Signature | Auth Location |
|--------|---------------------------|-------------------|---------------|
| GET | Yes (all params sorted) | N/A | Headers |
| POST with body | No | Yes (as requestBody=...) | Headers |
| POST without body | No | No (only timestamp) | Headers |
| DELETE with body | No | Yes (as requestBody=...) | Headers |
| DELETE without body | No | No (only timestamp) | Headers |

## Additional Required Headers

Include the following headers with every request:

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` (for POST/DELETE requests with body) |
| `User-Agent` | `polo-spot/1.0.0 (Skill)` |

## Security Notes

* **Never share your Secret Key** — Keep it secure at all times
* **Use environment variables** — Store API credentials in `POLO_API_KEY` and `POLO_SECRET_KEY`
* **Use IP whitelist** in Polo API settings for additional security
* **Enable only required permissions** (Read, Trade; avoid Withdraw unless needed)
* **Rotate keys periodically** — Update API keys regularly
* **Monitor API usage** — Check for unauthorized access
* **Timestamp validity** — Requests are valid within 1 minute of server time to prevent replay attacks
* **Use HTTPS only** — All requests must use secure HTTPS protocol

## Common Errors

### Timestamp Outside Valid Window

If you receive a timestamp error (400 or 408):

1. Check server time via `GET /timestamp`
2. Ensure your system clock is synchronized with UTC
3. Verify the timestamp is in Unix milliseconds
4. Timestamp must be within 1 minute of server time
5. If using `recvWindow`, ensure it's set appropriately

### Invalid Signature

If signature validation fails:

1. Verify the pre-sign string format: `METHOD\nPATH\nPARAMS`
2. Ensure line breaks are `\n` (not `\r\n`)
3. For GET requests: all query parameters must be sorted alphabetically and included
4. For POST/DELETE with body: use `requestBody=<json>&signTimestamp=...` format
5. For POST/DELETE without body: only include `signTimestamp=...`
6. Verify the Secret Key is correct
7. Ensure signature is Base64-encoded HMAC-SHA256 digest
8. Check that authentication parameters are in **headers**, not query string

## Example: Authenticated GET Request

Request to get orders with symbol and limit:

**Pre-sign string:**
```
GET\n
/orders\n
limit=5&signTimestamp=1659259836247&symbol=ETH_USDT
```

**Request:**
```bash
curl -X GET \
  --header 'key: A3xxxxxx-99xxxxxx-84xxxxxx-72xxxxxx' \
  --header 'signatureMethod: HmacSHA256' \
  --header 'signatureVersion: 2' \
  --header 'signTimestamp: 1659259836247' \
  --header 'signature: 5g4Rx5A2bLyMWFgR3Aqp+B4w+iJkL7n5OD3SuYtCJK8=' \
  'https://api.poloniex.com/orders?symbol=ETH_USDT&limit=5'
```

## Example: Authenticated POST Request with Body

Request to create a limit order:

**Pre-sign string:**
```
POST\n
/orders\n
requestBody={"symbol":"BTC_USDT","side":"BUY","type":"LIMIT","price":"30000","quantity":"0.001","timeInForce":"GTC"}&signTimestamp=1631018760000
```

**Request:**
```bash
curl -X POST \
  --header 'Content-Type: application/json' \
  --header 'key: A3xxxxxx-99xxxxxx-84xxxxxx-72xxxxxx' \
  --header 'signatureMethod: HmacSHA256' \
  --header 'signatureVersion: 2' \
  --header 'signTimestamp: 1631018760000' \
  --header 'signature: 4F65x5A2bLyMWVQj3Aqp+B4w+iJkL7n5OD3SuYtCJ9o=' \
  --data '{"symbol":"BTC_USDT","side":"BUY","type":"LIMIT","price":"30000","quantity":"0.001","timeInForce":"GTC"}' \
  'https://api.poloniex.com/orders'
```

## Example: Authenticated DELETE Request without Body

Request to cancel order by ID:

**Pre-sign string:**
```
DELETE\n
/orders/1234567890\n
signTimestamp=1631018760000
```

**Request:**
```bash
curl -X DELETE \
  --header 'key: A3xxxxxx-99xxxxxx-84xxxxxx-72xxxxxx' \
  --header 'signatureMethod: HmacSHA256' \
  --header 'signatureVersion: 2' \
  --header 'signTimestamp: 1631018760000' \
  --header 'signature: xyz123...' \
  'https://api.poloniex.com/orders/1234567890'
```

## Example: Authenticated DELETE Request with Body

Request to cancel orders by IDs:

**Pre-sign string:**
```
DELETE\n
/orders/cancelByIds\n
requestBody={"orderIds":["1234567890"],"clientOrderIds":["myId-1"]}&signTimestamp=1631018760000
```

**Request:**
```bash
curl -X DELETE \
  --header 'Content-Type: application/json' \
  --header 'key: A3xxxxxx-99xxxxxx-84xxxxxx-72xxxxxx' \
  --header 'signatureMethod: HmacSHA256' \
  --header 'signatureVersion: 2' \
  --header 'signTimestamp: 1631018760000' \
  --header 'signature: abc456...' \
  --data '{"orderIds":["1234567890"],"clientOrderIds":["myId-1"]}' \
  'https://api.poloniex.com/orders/cancelByIds'
```
