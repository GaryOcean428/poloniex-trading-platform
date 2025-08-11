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
 * - Some endpoints require authentication; if API key/secret present, signed requests are used.
 * - Resilient host/prefix and endpoint variants.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.resolve(ROOT, 'docs/markets/poloniex-futures-v3.json');
const USER_AGENT = 'PolytradeSync/1.0 (+https://github.com/GaryOcean428/poloniex-trading-platform)';

// Candidate hosts/prefixes for Futures v3 (docs show v3/futures/api; some deployments use api/v3)
const BASE_CANDIDATES = [
  { host: 'https://api.poloniex.com',        prefix: '/v3/futures/api' },
  { host: 'https://futures-api.poloniex.com', prefix: '/v3/futures/api' },
  { host: 'https://futures-api.poloniex.com', prefix: '/v3' },
  { host: 'https://api.poloniex.com',        prefix: '/v3' },
  { host: 'https://futures-api.poloniex.com', prefix: '/api/v3' },
  { host: 'https://api.poloniex.com',        prefix: '/api/v3' },
];

// Endpoint path variants (relative to prefix)
const PATHS = {
  ALL_PRODUCT_INFO: '/market/get-all-product-info',
  MARKET_INFO: '/market/get-market-info',
  FUTURES_RISK_LIMIT: '/market/get-futures-risk-limit',
};

const API_KEY = process.env.POLONIEX_API_KEY || '';
const API_SECRET = process.env.POLONIEX_API_SECRET || '';
const API_PASSPHRASE = process.env.POLONIEX_PASSPHRASE || '';

function upperNoDash(sym = '') {
  return String(sym).replace(/-/g, '').toUpperCase();
}

function hasCredentials() {
  return Boolean(API_KEY && API_SECRET);
}

function generateSignature(timestamp, method, requestPath, body = '') {
  const message = timestamp + method + requestPath + body;
  return crypto.createHmac('sha256', API_SECRET).update(message).digest('base64');
}

function buildSignedHeadersVariants(method, requestPath, body = '', queryString = '') {
  // Try multiple variants: seconds and milliseconds timestamps, with and without queryString in the signed path
  const nowMs = Date.now();
  const tsSeconds = Math.floor(nowMs / 1000).toString();
  const tsMillis = String(nowMs);

  const candidates = [];
  for (const ts of [tsSeconds, tsMillis]) {
    for (const includeQuery of [false, true]) {
      const pathForSig = includeQuery && queryString ? requestPath + '?' + queryString : requestPath;
      const sig = generateSignature(ts, method, pathForSig, body);
      const base = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'PF-API-KEY': API_KEY,
        'PF-API-SIGN': sig,
        'PF-API-TIMESTAMP': ts,
      };
      if (API_PASSPHRASE) {
        base['PF-API-PASSPHRASE'] = API_PASSPHRASE;
      }
      candidates.push(base);
    }
  }
  return candidates;
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
    throw new Error(`HTTP ${res.status} for ${url} :: ${preview.slice(0, 200)}`);
  }
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 200)}`);
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
  // Exponential backoff with jitter
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * (exp / 2));
  return Math.min(maxMs, exp - Math.floor(exp / 4) + jitter);
}

async function fetchFromCandidates(relativePath, { signed = false, method = 'GET', params } = {}) {
  const errors = [];
  for (const { host, prefix } of BASE_CANDIDATES) {
    const requestPath = prefix + relativePath;
    const url = new URL(host + requestPath);
    if (params && method === 'GET') {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    let body = '';
    // Build header variants (signed or unsigned)
    const headerVariants = signed && hasCredentials()
      ? buildSignedHeadersVariants(
          method,
          requestPath,
          body,
          url.searchParams.toString()
        )
      : [
          {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
        ];

    const maxAttempts = 4;
    for (const variant of headerVariants) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const json = await fetchJson(url.toString(), { headers: variant, method, body });
          return json;
        } catch (e) {
          const retryable = isRetryableError(e);
          const variantInfo = variant['PF-API-TIMESTAMP'] ? `signed ts=${variant['PF-API-TIMESTAMP']}` : 'unsigned';
          const attemptInfo = `${url.toString()} [${variantInfo}] [attempt ${attempt + 1}/${maxAttempts}]`;
          console.warn(`Fetch failed: ${attemptInfo} :: ${e.message}${retryable ? ' (retrying)' : ''}`);
          if (!retryable || attempt === maxAttempts - 1) {
            errors.push(e);
            break; // move to next variant or next candidate
          }
          await sleep(backoffDelay(attempt));
        }
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
      const symbol = upperNoDash(p?.symbol || p?.contract || p?.instId || p?.name);
      const base = String(p?.baseCurrency || p?.base || '').toUpperCase();
      const quote = String(p?.quoteCurrency || p?.quote || '').toUpperCase();

      const tickSize =
        safeNumber(p?.tickSize) ?? safeNumber(p?.priceTick) ?? safeNumber(p?.priceTickSize) ?? null;

      const lotSize =
        safeNumber(p?.lotSize) ?? safeNumber(p?.qtyStep) ?? safeNumber(p?.quantityStep) ?? null;

      const minNotional =
        safeNumber(p?.minNotional) ?? safeNumber(p?.minValue) ?? safeNumber(p?.minTradeValue) ?? null;

      const maxLeverage = safeNumber(p?.maxLeverage) ?? safeNumber(p?.lever || p?.leverage) ?? null;

      const statusRaw = String(p?.status || p?.state || '').toLowerCase();
      const status =
        statusRaw.includes('trade') || statusRaw === 'online' || statusRaw === 'open'
          ? 'trading'
          : statusRaw.includes('pause')
          ? 'paused'
          : statusRaw.includes('delist')
          ? 'delisted'
          : 'trading';

      let pricePrecision = safeNumber(p?.pricePrecision);
      let quantityPrecision = safeNumber(p?.quantityPrecision ?? p?.qtyPrecision);

      if (pricePrecision == null || quantityPrecision == null) {
        const inferred = inferPrecisionsFromTickLot(tickSize, lotSize);
        if (pricePrecision == null) pricePrecision = inferred.pricePrecision ?? null;
        if (quantityPrecision == null) quantityPrecision = inferred.quantityPrecision ?? null;
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

function extractProductsFromMarketInfo(json) {
  const candidates = [json?.data?.symbols, json?.symbols, json?.data, json].filter((x) =>
    Array.isArray(x)
  )[0] || [];
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
      if (
        t.maxPosition !== null ||
        t.initialMarginRate !== null ||
        t.maintenanceMarginRate !== null
      ) {
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
  // Prefer signed fetch if credentials provided (400 observed unauthenticated)
  if (hasCredentials()) {
    try {
      const allInfo = await fetchFromCandidates(PATHS.ALL_PRODUCT_INFO, { signed: true });
      const products = extractProductsFromAllProductInfo(allInfo);
      if (products.length) {
        return products;
      }
    } catch (e) {
      // continue to fallback
    }
  }

  // Unsigned attempt
  try {
    const allInfo = await fetchFromCandidates(PATHS.ALL_PRODUCT_INFO, { signed: false });
    const products = extractProductsFromAllProductInfo(allInfo);
    if (products.length) {
      return products;
    }
  } catch (e) {
    // continue
  }

  // Fallback to market info (try signed first if creds)
  if (hasCredentials()) {
    try {
      const marketInfo = await fetchFromCandidates(PATHS.MARKET_INFO, { signed: true });
      const products = extractProductsFromMarketInfo(marketInfo);
      if (products.length) {
        return products;
      }
    } catch (e) {
      // continue
    }
  }
  try {
    const marketInfo = await fetchFromCandidates(PATHS.MARKET_INFO, { signed: false });
    const products = extractProductsFromMarketInfo(marketInfo);
    if (products.length) {
      return products;
    }
  } catch (e) {
    // continue
  }

  return [];
}

async function getRiskResilient() {
  if (hasCredentials()) {
    try {
      return await fetchFromCandidates(PATHS.FUTURES_RISK_LIMIT, { signed: true });
    } catch (e) {
      // fallback unsigned
    }
  }
  try {
    return await fetchFromCandidates(PATHS.FUTURES_RISK_LIMIT, { signed: false });
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('Syncing Poloniex Futures v3 markets catalog...');
  if (!hasCredentials()) {
    console.warn(
      'Warning: POLONIEX_API_KEY/SECRET not set. Some endpoints may return 400 and markets could remain empty.'
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

// Node ESM-compatible direct-run check (import.meta.main is not available in Node)
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  main().catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  });
}
