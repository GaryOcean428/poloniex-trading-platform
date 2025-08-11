/**
 * Sync Poloniex Futures v3 markets catalog
 * - Fetches product info and risk limits from Poloniex endpoints
 * - Normalizes into docs/markets/poloniex-futures-v3.json
 * - Policy: include all markets; use exchange max leverage and exchange fees
 *
 * Usage:
 *   POLONIEX_API_KEY=... POLONIEX_API_SECRET=... yarn sync:poloniex
 *
 * Notes:
 * - Node 20+ (global fetch)
 * - Uses Poloniex Futures v3 signing per https://api-docs.poloniex.com/v3/futures/api/
 * - Host base (from docs): https://api.poloniex.com with /v3 prefix
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.resolve(ROOT, 'docs/markets/poloniex-futures-v3.json');
const USER_AGENT = 'PolytradeSync/1.1 (+https://github.com/GaryOcean428/poloniex-trading-platform)';

// Per docs: REST base is https://api.poloniex.com with /v3 prefix.
// Keep a small fallback list to be resilient to infra variance.
const BASE_CANDIDATES = [
  { host: 'https://api.poloniex.com',        prefix: '/v3' },
  { host: 'https://api.poloniex.com',        prefix: '/api/v3' }, // some deployments use /api/v3
];

// Endpoint path per docs (relative to prefix)
const PATHS = {
  ALL_PRODUCT_INFO: '/market/allInstruments', // Get All Product Info
  PRODUCT_INFO: '/market/instruments',        // Get Product Info
  MARKET_TICKERS: '/market/tickers',          // Get Market Info (tickers)
  FUTURES_RISK_LIMIT: '/market/riskLimit',    // Get Futures Risk Limit
};

const API_KEY = process.env.POLONIEX_API_KEY || '';
const API_SECRET = process.env.POLONIEX_API_SECRET || '';
const SIGNATURE_METHOD = 'HmacSHA256';
const SIGNATURE_VERSION = '2';

function upperNoDash(sym = '') {
  return String(sym).replace(/-/g, '').toUpperCase();
}

function hasCredentials() {
  return Boolean(API_KEY && API_SECRET);
}

/**
 * Build the Poloniex Futures v3 signature headers.
 * Docs specify:
 * - Headers: key, signatureMethod (optional), signatureVersion (optional), signTimestamp, signature
 * - Signature string format:
 *   Method + "\n" + accessPath + "\n" + (sorted paramString, URL/UTF-8 encoded)
 * - The "parameters" include query params; include signTimestamp in the parameter list for signature generation.
 */
function buildV3Headers(method, accessPath, urlSearchParams) {
  const tsMs = Date.now().toString(); // docs show ms in examples
  // Compose parameter list for signature. Include signTimestamp plus any query params.
  const params = new URLSearchParams(urlSearchParams ? urlSearchParams : '');
  params.set('signTimestamp', tsMs);

  // Sort by ASCII order; URLSearchParams iteration is in insertion order, so rebuild sorted.
  const entries = Array.from(params.entries()).sort(([a], [b]) =>
    a.localeCompare(b, 'en', { numeric: false, sensitivity: 'base' })
  );

  // URL encode k=v pairs and join by &
  const encodedPairs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const paramString = encodedPairs.join('&');

  const requestString = `${method}\n${accessPath}\n${paramString}`;
  const signature = crypto.createHmac('sha256', API_SECRET).update(requestString).digest('base64');

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
    key: API_KEY,
    signTimestamp: tsMs,
    signature: signature,
    signatureMethod: SIGNATURE_METHOD,
    signatureVersion: SIGNATURE_VERSION,
  };

  return { headers, paramString };
}

async function fetchJson(url, { headers = {}, method = 'GET', body = '' } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      ...headers,
    },
    body: method !== 'GET' && body ? body : undefined,
  });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let preview = '';
    try {
      preview = await res.text();
    } catch {}
    throw new Error(`HTTP ${res.status} for ${url} :: ${preview.slice(0, 400)}`);
  }
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err) {
  const msg = String(err && err.message ? err.message : err);
  return (
    msg.includes('HTTP 503') ||
    msg.includes('HTTP 429') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ETIMEDOUT') ||
    msg.toLowerCase().includes('timeout') ||
    msg.toLowerCase().includes('fetch failed') ||
    msg.toLowerCase().includes('network')
  );
}

function backoffDelay(attempt, baseMs = 500, maxMs = 5000) {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * (exp / 2));
  return Math.min(maxMs, exp - Math.floor(exp / 4) + jitter);
}

async function fetchFromCandidates(relativePath, { signed = false, method = 'GET', params } = {}) {
  const errors = [];
  for (const { host, prefix } of BASE_CANDIDATES) {
    const accessPath = prefix + relativePath;
    const url = new URL(host + accessPath);
    if (params && method === 'GET') {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const maxAttempts = 4;
    let attempt = 0;
    while (attempt < maxAttempts) {
      try {
        let headers = {};
        if (signed && hasCredentials()) {
          const { headers: signedHeaders } = buildV3Headers(method, accessPath, url.searchParams.toString());
          headers = signedHeaders;
        } else {
          headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          };
        }

        const json = await fetchJson(url.toString(), { headers, method });
        return json;
      } catch (e) {
        const retryable = isRetryableError(e);
        const attemptInfo = `${url.toString()} [${signed ? 'signed' : 'unsigned'}] [attempt ${attempt + 1}/${maxAttempts}]`;
        console.warn(`Fetch failed: ${attemptInfo} :: ${e.message}${retryable ? ' (retrying)' : ''}`);
        if (!retryable || attempt === maxAttempts - 1) {
          errors.push(e);
          break; // move to next candidate
        }
        await sleep(backoffDelay(attempt));
        attempt++;
      }
    }
  }
  throw new Error(
    `All candidates failed for ${relativePath}: ` + errors.map((e) => e.message).join(' | ')
  );
}

function safeNumber(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function inferPrecisionsFromTickLot(tickSize, lotSize) {
  const tickDecimals =
    typeof tickSize === 'number' && isFinite(tickSize)
      ? (String(tickSize).split('.')[1]?.length ?? 0)
      : null;
  const qtyDecimals =
    typeof lotSize === 'number' && isFinite(lotSize)
      ? (String(lotSize).split('.')[1]?.length ?? 0)
      : null;
  return { pricePrecision: tickDecimals, quantityPrecision: qtyDecimals };
}

function extractProductsCommon(list) {
  return list
    .map((p) => {
      const rawSymbol = String(p?.symbol || p?.contract || p?.instId || p?.name || '');
      const symbol = upperNoDash(rawSymbol);
      let base = String(p?.baseCurrency || p?.base || p?.baseCcy || '').toUpperCase();
      let quote = String(p?.quoteCurrency || p?.quote || p?.quoteCcy || '').toUpperCase();
      // Fallback: derive base/quote from symbol like BTC_USDT_PERP
      if ((!base || !quote) && rawSymbol) {
        const m = rawSymbol.toUpperCase().match(/^([A-Z0-9]+)_([A-Z0-9]+)_(?:PERP|SWAP|FUT|FUTURES)?$/);
        if (m) {
          base = base || m[1];
          quote = quote || m[2];
        }
      }

      let tickSize =
        safeNumber(p?.tickSize) ?? safeNumber(p?.priceTick) ?? safeNumber(p?.priceTickSize) ?? safeNumber(p?.priceIncrement) ?? safeNumber(p?.priceStep) ?? safeNumber(p?.tick) ?? null;

      let lotSize =
        safeNumber(p?.lotSize) ?? safeNumber(p?.qtyStep) ?? safeNumber(p?.quantityStep) ?? safeNumber(p?.quantityIncrement) ?? safeNumber(p?.stepSize) ?? null;

      const minNotional =
        safeNumber(p?.minNotional) ?? safeNumber(p?.minValue) ?? safeNumber(p?.minTradeValue) ?? null;

      const maxLeverage =
        safeNumber(p?.maxLeverage) ?? safeNumber(p?.lever || p?.leverage) ?? null;

      const statusRaw = String(p?.status || p?.state || '').toLowerCase();
      const status =
        statusRaw.includes('trade') || statusRaw === 'online' || statusRaw === 'open'
          ? 'trading'
          : statusRaw.includes('pause')
          ? 'paused'
          : statusRaw.includes('delist')
          ? 'delisted'
          : 'trading';

      let pricePrecision = safeNumber(p?.pricePrecision ?? p?.priceScale);
      let quantityPrecision = safeNumber(p?.quantityPrecision ?? p?.qtyPrecision ?? p?.quantityScale);

      if (pricePrecision == null || quantityPrecision == null) {
        const inferred = inferPrecisionsFromTickLot(tickSize, lotSize);
        if (pricePrecision == null) pricePrecision = inferred.pricePrecision ?? null;
        if (quantityPrecision == null) quantityPrecision = inferred.quantityPrecision ?? null;
      }
      // Fallback: derive tick/lot from precisions if increments are not provided
      if (tickSize == null && pricePrecision != null) {
        const ts = Math.pow(10, -Number(pricePrecision));
        // limit to 8 decimals to avoid FP noise
        tickSize = Number(ts.toFixed(Math.min(8, Number(pricePrecision))));
      }
      if (lotSize == null && quantityPrecision != null) {
        const ls = Math.pow(10, -Number(quantityPrecision));
        lotSize = Number(ls.toFixed(Math.min(8, Number(quantityPrecision))));
      }

      const contractType = String(p?.contractType || p?.type || 'perpetual').toLowerCase();

      return {
        symbol,
        base,
        quote,
        contractType,
        status,
        pricePrecision,
        quantityPrecision,
        tickSize,
        lotSize,
        minNotional,
        maxLeverage,
      };
    })
    .filter((p) => p.symbol);
}

function extractProductsFromAllProductInfo(json) {
  const data =
    (Array.isArray(json?.data) && json.data) ||
    (Array.isArray(json?.products) && json.products) ||
    (Array.isArray(json) && json) ||
    [];
  return extractProductsCommon(data);
}

// /v3/market/tickers shape can vary; this is used only as fallback if allInstruments fails.
function extractProductsFromTickers(json) {
  const candidates = (Array.isArray(json?.data) && json.data) || (Array.isArray(json) && json) || [];
  return extractProductsCommon(candidates);
}

function buildRiskMap(riskData) {
  const out = new Map();
  const list =
    (Array.isArray(riskData?.data) && riskData.data) ||
    (Array.isArray(riskData?.riskLimits) && riskData.riskLimits) ||
    (Array.isArray(riskData) && riskData) ||
    [];

  for (const item of list) {
    const symbol = upperNoDash(item?.symbol || item?.contract || item?.instId);
    if (!symbol) continue;

    let tiers = [];
    if (Array.isArray(item?.tiers)) {
      tiers = item.tiers.map((t) => ({
        tier: safeNumber(t?.tier, 0),
        maxPosition: safeNumber(t?.maxPosition, null),
        initialMarginRate: safeNumber(t?.initialMarginRate, null),
        maintenanceMarginRate: safeNumber(t?.maintenanceMarginRate, null),
      }));
    } else if (Array.isArray(item)) {
      tiers = item.map((t) => ({
        tier: safeNumber(t?.tier, 0),
        maxPosition: safeNumber(t?.maxPosition, null),
        initialMarginRate: safeNumber(t?.initialMarginRate, null),
        maintenanceMarginRate: safeNumber(t?.maintenanceMarginRate, null),
      }));
    } else {
      const t = {
        tier: safeNumber(item?.tier, 0),
        maxPosition: safeNumber(item?.maxPosition, null),
        initialMarginRate: safeNumber(item?.initialMarginRate, null),
        maintenanceMarginRate: safeNumber(item?.maintenanceMarginRate, null),
      };
      if (t.maxPosition !== null || t.initialMarginRate !== null || t.maintenanceMarginRate !== null) {
        tiers = [t];
      }
    }

    out.set(symbol, tiers);
  }

  return out;
}

function mergeProductsWithRisk(products, riskMap) {
  return products.map((prod) => {
    const tiers = riskMap.get(prod.symbol) || [];
    let maintenanceMarginTable = [];
    if (tiers.length) {
      maintenanceMarginTable = tiers
        .map((t) => ({
          notionalFloor: safeNumber(t.maxPosition, 0), // approximation
          maintenanceMarginRate: safeNumber(t.maintenanceMarginRate, null),
        }))
        .filter((x) => x.maintenanceMarginRate !== null);
    }

    return {
      ...prod,
      maintenanceMarginTable,
      riskLimits: tiers,
      feesBps: { maker: null, taker: null }, // fill from docs/policy if needed
      funding: { intervalHours: 8, rateCap: null },
    };
  });
}

async function loadCatalog() {
  try {
    const raw = await fs.readFile(CATALOG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        _note:
          'Generated markets catalog. Policy: include all markets; use exchange max leverage and exchange fees.',
        version: 1,
        source: '../railway-poloniex-docs.md',
        lastSynced: '',
        markets: [],
      };
    }
    throw e;
  }
}

async function saveCatalog(catalog) {
  const json = JSON.stringify(catalog, null, 2);
  await fs.writeFile(CATALOG_PATH, json, 'utf-8');
}

async function getProductsResilient() {
  // Prefer signed fetch if credentials provided
  if (hasCredentials()) {
    try {
      const allInfo = await fetchFromCandidates(PATHS.ALL_PRODUCT_INFO, { signed: true });
      const products = extractProductsFromAllProductInfo(allInfo);
      if (products.length) return products;
    } catch {}
  }

  // Fallback: signed tickers (structure may be less rich)
  if (hasCredentials()) {
    try {
      const tickers = await fetchFromCandidates(PATHS.MARKET_TICKERS, { signed: true });
      const products = extractProductsFromTickers(tickers);
      if (products.length) return products;
    } catch {}
  }

  // As last resort, try unsigned (some market endpoints may be public)
  try {
    const allInfo = await fetchFromCandidates(PATHS.ALL_PRODUCT_INFO, { signed: false });
    const products = extractProductsFromAllProductInfo(allInfo);
    if (products.length) return products;
  } catch {}

  try {
    const tickers = await fetchFromCandidates(PATHS.MARKET_TICKERS, { signed: false });
    const products = extractProductsFromTickers(tickers);
    if (products.length) return products;
  } catch {}

  return [];
}

async function getRiskResilient() {
  // Prefer signed
  if (hasCredentials()) {
    try {
      return await fetchFromCandidates(PATHS.FUTURES_RISK_LIMIT, { signed: true });
    } catch {}
  }
  // Try unsigned
  try {
    return await fetchFromCandidates(PATHS.FUTURES_RISK_LIMIT, { signed: false });
  } catch {
    return null;
  }
}

async function main() {
  console.log('Syncing Poloniex Futures v3 markets catalog...');
  if (!hasCredentials()) {
    console.warn(
      'Warning: POLONIEX_API_KEY/SECRET not set. Private endpoints may return 400 and markets could remain empty.'
    );
  }

  const [products, riskData] = await Promise.all([getProductsResilient(), getRiskResilient()]);

  if (!products.length) {
    console.warn('No products extracted from Poloniex endpoints.');
  }

  const riskMap = riskData ? buildRiskMap(riskData) : new Map();
  const merged = mergeProductsWithRisk(products, riskMap);

  const catalog = await loadCatalog();
  const prevCount = Array.isArray(catalog.markets) ? catalog.markets.length : 0;
  const nextCount = merged.length;

  const updated = {
    ...catalog,
    version: (Number.isFinite(catalog.version) ? catalog.version : 1) + (nextCount !== prevCount ? 1 : 0),
    lastSynced: new Date().toISOString(),
    markets: merged,
  };

  await saveCatalog(updated);
  console.log(
    `Catalog written to ${path.relative(ROOT, CATALOG_PATH)} with ${merged.length} markets.`
  );
}

// Node ESM-compatible direct-run check
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  main().catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  });
}
