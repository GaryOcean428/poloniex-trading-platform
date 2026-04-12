/**
 * Smoke Test: Real Poloniex V3 API Connection
 *
 * Run: npx tsx apps/api/src/scripts/test_real_connection.ts
 *   or: yarn workspace @poloniex-platform/api test:connection
 *
 * Requires POLONIEX_API_KEY and POLONIEX_API_SECRET in .env (or environment).
 *
 * This script uses NO service abstractions — raw axios + crypto only.
 * If any step fails the full error (status, headers, body) is printed and
 * the process exits with code 1.
 */

import 'dotenv/config';
import axios, { AxiosError } from 'axios';
import crypto from 'crypto';

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = 'https://api.poloniex.com';
const API_KEY = process.env.POLONIEX_API_KEY ?? '';
const API_SECRET = process.env.POLONIEX_API_SECRET ?? '';
const REQUEST_TIMEOUT_MS = 15000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate HMAC-SHA256 signature per Poloniex V3 docs.
 * Signature string format:
 *   METHOD\n
 *   /v3/path\n
 *   param1=value1&param2=value2&signTimestamp=<ts>   (GET / DELETE)
 *   requestBody=<json>&signTimestamp=<ts>             (POST / PUT)
 *   signTimestamp=<ts>                               (no params / body)
 */
function generateSignature(
  method: string,
  requestPath: string,
  params: Record<string, string>,
  body: object | null,
  timestamp: string,
  secret: string
): string {
  const methodUpper = method.toUpperCase();
  let paramString: string;

  if (body && (methodUpper === 'POST' || methodUpper === 'PUT')) {
    paramString = `requestBody=${JSON.stringify(body)}&signTimestamp=${timestamp}`;
  } else if (Object.keys(params).length > 0) {
    const allParams: Record<string, string> = { ...params, signTimestamp: timestamp };
    paramString = Object.keys(allParams)
      .sort()
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
      .join('&');
  } else {
    paramString = `signTimestamp=${timestamp}`;
  }

  const message = `${methodUpper}\n${requestPath}\n${paramString}`;
  return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

/** Build authentication headers for a V3 request. */
function authHeaders(
  method: string,
  requestPath: string,
  params: Record<string, string>,
  body: object | null = null
): Record<string, string> {
  const timestamp = Date.now().toString();
  const signature = generateSignature(method, requestPath, params, body, timestamp, API_SECRET);
  return {
    'Content-Type': 'application/json',
    key: API_KEY,
    signature,
    signTimestamp: timestamp,
    signatureMethod: 'hmacSHA256',
    signatureVersion: '2',
  };
}

/** Print a section header to stdout. */
function section(title: string): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

/** Pretty-print any value. */
function dump(label: string, value: unknown): void {
  console.log(`\n${label}:`);
  console.log(JSON.stringify(value, null, 2));
}

/** Print full error details and exit 1. */
function fatal(step: string, err: unknown): never {
  console.error(`\n❌  STEP FAILED: ${step}`);
  if (err instanceof AxiosError) {
    console.error('Status :', err.response?.status);
    console.error('Headers:', JSON.stringify(err.response?.headers ?? {}, null, 2));
    console.error('Body   :', JSON.stringify(err.response?.data ?? {}, null, 2));
    console.error('Message:', err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Poloniex V3 API — Real Connection Smoke Test');
  console.log(new Date().toISOString());

  // ── Preflight: credentials present ──────────────────────────────────────
  if (!API_KEY || !API_SECRET) {
    console.error(
      '❌  POLONIEX_API_KEY and/or POLONIEX_API_SECRET are not set.\n' +
        '    Copy .env.example to .env and fill in your credentials.'
    );
    process.exit(1);
  }
  console.log(`\n✓  Credentials loaded (key prefix: ${API_KEY.slice(0, 6)}…)`);

  // ── Step 1: Signature test vector ───────────────────────────────────────
  section('Step 1 — Signature generation (test vector)');
  {
    // Known test vector: verify our HMAC implementation is correct.
    const testMethod = 'GET';
    const testPath = '/v3/account/balance';
    const testParams: Record<string, string> = { currency: 'USDT' };
    const testTimestamp = '1700000000000';
    const testSecret = 'test_secret_key_for_vector_check';

    const sig = generateSignature(testMethod, testPath, testParams, null, testTimestamp, testSecret);
    const expected = crypto
      .createHmac('sha256', testSecret)
      .update(`GET\n/v3/account/balance\ncurrency=USDT&signTimestamp=1700000000000`)
      .digest('base64');

    if (sig !== expected) {
      console.error(`❌  Signature mismatch!\n  got     : ${sig}\n  expected: ${expected}`);
      process.exit(1);
    }
    console.log(`✓  Signature matches expected value: ${sig}`);
  }

  // ── Step 2: GET /v3/account/balance ─────────────────────────────────────
  section('Step 2 — GET /v3/account/balance');
  {
    const requestPath = '/v3/account/balance';
    const params: Record<string, string> = {};
    try {
      const response = await axios.get(`${BASE_URL}${requestPath}`, {
        headers: authHeaders('GET', requestPath, params),
        timeout: REQUEST_TIMEOUT_MS,
      });
      dump('Raw response (account balance)', response.data);
      console.log('\n✓  Account balance fetched successfully');
    } catch (err) {
      fatal('GET /v3/account/balance', err);
    }
  }

  // ── Step 3: GET /v3/market/tickers?symbol=TRX_USDT_PERP ─────────────────
  section('Step 3 — GET /v3/market/tickers?symbol=TRX_USDT_PERP');
  {
    const requestPath = '/v3/market/tickers';
    const params: Record<string, string> = { symbol: 'TRX_USDT_PERP' };
    try {
      const response = await axios.get(`${BASE_URL}${requestPath}`, {
        headers: authHeaders('GET', requestPath, params),
        params,
        timeout: REQUEST_TIMEOUT_MS,
      });
      dump('Raw response (TRX_USDT_PERP ticker)', response.data);
      console.log('\n✓  TRX_USDT_PERP ticker fetched successfully');
    } catch (err) {
      fatal('GET /v3/market/tickers', err);
    }
  }

  // ── Step 4: GET /v3/market/get-contract-info?symbol=TRX_USDT_PERP ───────
  section('Step 4 — GET /v3/market/get-contract-info?symbol=TRX_USDT_PERP');
  {
    const requestPath = '/v3/market/get-contract-info';
    const params: Record<string, string> = { symbol: 'TRX_USDT_PERP' };
    try {
      const response = await axios.get(`${BASE_URL}${requestPath}`, {
        headers: authHeaders('GET', requestPath, params),
        params,
        timeout: REQUEST_TIMEOUT_MS,
      });
      const data = response.data as Record<string, unknown>;
      const contractData = (data?.data ?? data) as Record<string, unknown>;
      console.log('\nKey contract parameters:');
      console.log(`  tickSize    : ${contractData?.tickSz ?? contractData?.tickSize ?? 'n/a'}`);
      console.log(`  lotSize     : ${contractData?.lotSz ?? contractData?.lotSize ?? 'n/a'}`);
      console.log(`  maxLeverage : ${contractData?.maxLev ?? contractData?.maxLeverage ?? 'n/a'}`);
      dump('Raw response (contract info)', response.data);
      console.log('\n✓  Contract info fetched successfully');
    } catch (err) {
      fatal('GET /v3/market/get-contract-info', err);
    }
  }

  // ── Step 5: GET /v3/trade/position/opens ────────────────────────────────
  section('Step 5 — GET /v3/trade/position/opens');
  {
    const requestPath = '/v3/trade/position/opens';
    const params: Record<string, string> = {};
    try {
      const response = await axios.get(`${BASE_URL}${requestPath}`, {
        headers: authHeaders('GET', requestPath, params),
        timeout: REQUEST_TIMEOUT_MS,
      });
      dump('Raw response (open positions)', response.data);
      console.log('\n✓  Open positions fetched successfully');
    } catch (err) {
      fatal('GET /v3/trade/position/opens', err);
    }
  }

  // ── Done ────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  ✅  All steps passed — Poloniex V3 API connection verified');
  console.log('═'.repeat(60));
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌  Unhandled error:', err);
  process.exit(1);
});
