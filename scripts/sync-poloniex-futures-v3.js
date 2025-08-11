/**
 * Sync Poloniex Futures v3 markets catalog
 * - Fetches product info and risk limits from public Poloniex endpoints
 * - Normalizes into docs/markets/poloniex-futures-v3.json
 * - Policy: include all markets; use exchange max leverage and exchange fees (fees may be default/null if not provided per-market)
 *
 * Usage:
 *   yarn sync:poloniex
 *
 * Notes:
 * - Requires Node 20+ (global fetch available)
 * - Runs as ESM (root package.json has "type": "module")
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.resolve(ROOT, 'docs/markets/poloniex-futures-v3.json');

// Public endpoints (canonical host/prefix)
const BASE_HOST = 'https://api.poloniex.com';
const API_PREFIX = '/v3/futures/api';

const ENDPOINTS = {
  ALL_PRODUCT_INFO: `${BASE_HOST}${API_PREFIX}/market/get-all-product-info`,
  FUTURES_RISK_LIMIT: `${BASE_HOST}${API_PREFIX}/market/get-futures-risk-limit`,
  // Optional sources we might tap later:
  // FUNDING_HISTORY: `${BASE_HOST}${API_PREFIX}/market/get-the-historical-funding-rates`,
};

function upperNoDash(sym = '') {
  return String(sym).replace(/-/g, '').toUpperCase();
}

async function fetchJson(url) {
  const res = await fetch(url, { method: 'GET' });
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

function buildRiskMap(riskData) {
  // Attempt to normalize risk tiers response into a map keyed by symbol
  // Shapes may vary; we defensively search for arrays with symbol tiers
  const out = new Map();

  const list =
    (Array.isArray(riskData?.data) && riskData.data) ||
    (Array.isArray(riskData?.riskLimits) && riskData.riskLimits) ||
    (Array.isArray(riskData) && riskData) ||
    [];

  for (const item of list) {
    // Common shapes we might see:
    // { symbol, tiers: [{ tier, maxPosition, initialMarginRate, maintenanceMarginRate }, ...] }
    // or flattened fields
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
      // In case some endpoints return an array of tier objects per symbol
      tiers = item.map((t) => ({
        tier: safeNumber(t?.tier, 0),
        maxPosition: safeNumber(t?.maxPosition, null),
        initialMarginRate: safeNumber(t?.initialMarginRate, null),
        maintenanceMarginRate: safeNumber(t?.maintenanceMarginRate, null),
      }));
    } else {
      // Single tier fallback
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

function extractProducts(productInfo) {
  // Normalize product info into an array of product records
  // We expect something like productInfo.data or similar
  const data =
    (Array.isArray(productInfo?.data) && productInfo.data) ||
    (Array.isArray(productInfo?.products) && productInfo.products) ||
    (Array.isArray(productInfo) && productInfo) ||
    [];

  return data.map((p) => {
    // Attempt to accommodate various likely keys
    const symbol = upperNoDash(p?.symbol || p?.contract || p?.instId || p?.name);
    const base = String(p?.baseCurrency || p?.base || '').toUpperCase();
    const quote = String(p?.quoteCurrency || p?.quote || '').toUpperCase();

    const tickSize =
      safeNumber(p?.tickSize) ??
      safeNumber(p?.priceTick) ??
      safeNumber(p?.priceTickSize) ??
      null;

    const lotSize =
      safeNumber(p?.lotSize) ??
      safeNumber(p?.qtyStep) ??
      safeNumber(p?.quantityStep) ??
      null;

    const minNotional =
      safeNumber(p?.minNotional) ??
      safeNumber(p?.minValue) ??
      safeNumber(p?.minTradeValue) ??
      null;

    const maxLeverage =
      safeNumber(p?.maxLeverage) ??
      safeNumber(p?.lever || p?.leverage) ??
      null;

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

    // Futures type (default perpetual if not provided)
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
  }).filter((p) => p.symbol);
}

function mergeProductsWithRisk(products, riskMap) {
  return products.map((prod) => {
    const tiers = riskMap.get(prod.symbol) || [];
    let maintenanceMarginTable = [];
    // Try to derive a simple maintenance margin table from tiers if available
    if (tiers.length) {
      maintenanceMarginTable = tiers
        .map((t) => ({
          notionalFloor: safeNumber(t.maxPosition, 0), // best-effort; depends on API semantics
          maintenanceMarginRate: safeNumber(t.maintenanceMarginRate, null),
        }))
        .filter((x) => x.maintenanceMarginRate !== null);
    }

    return {
      ...prod,
      maintenanceMarginTable,
      riskLimits: tiers,
      // Fees may be global/default. If unavailable per-market, leave null to be enriched later.
      feesBps: { maker: null, taker: null },
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

async function main() {
  console.log('Syncing Poloniex Futures v3 markets catalog...');
  const [productInfo, riskData] = await Promise.all([
    fetchJson(ENDPOINTS.ALL_PRODUCT_INFO).catch((e) => {
      console.warn('Warning: failed to fetch ALL_PRODUCT_INFO:', e.message);
      return null;
    }),
    fetchJson(ENDPOINTS.FUTURES_RISK_LIMIT).catch((e) => {
      console.warn('Warning: failed to fetch FUTURES_RISK_LIMIT:', e.message);
      return null;
    }),
  ]);

  const products = productInfo ? extractProducts(productInfo) : [];
  const riskMap = riskData ? buildRiskMap(riskData) : new Map();

  if (!products.length) {
    console.warn('No products extracted. Catalog will not be updated with markets.');
  }

  const merged = mergeProductsWithRisk(products, riskMap);

  const catalog = await loadCatalog();
  // Increment version if markets have changed materially
  const prevCount = Array.isArray(catalog.markets) ? catalog.markets.length : 0;
  const nextCount = merged.length;

  const updated = {
    ...catalog,
    version: (Number.isFinite(catalog.version) ? catalog.version : 1) + (nextCount !== prevCount ? 1 : 0),
    lastSynced: new Date().toISOString(),
    markets: merged,
  };

  await saveCatalog(updated);
  console.log(`Catalog written to ${path.relative(ROOT, CATALOG_PATH)} with ${merged.length} markets.`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  });
}
