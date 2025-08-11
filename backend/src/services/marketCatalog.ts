import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  MarketCatalog,
  MarketEntry,
  normalizeFuturesSymbol,
} from '../types/markets.js';

/**
 * Loads and serves the normalized Poloniex Futures V3 markets catalog JSON.
 * - Source file: docs/markets/poloniex-futures-v3.json (repo root)
 * - Caches in-memory; provides helpers and ETag for HTTP caching
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve catalog JSON relative to this file.
 * In dev (ts-node), __dirname ~= backend/src/services
 * Project root is 3 levels up: ../../..
 * => backend/src/services -> backend/src -> backend -> project root
 */
const CATALOG_PATH = path.resolve(
  __dirname,
  '../../../docs/markets/poloniex-futures-v3.json',
);

// Fallback if above resolution fails at runtime (e.g., different build layout)
const ALT_CATALOG_PATH = path.resolve(
  process.cwd(),
  'docs/markets/poloniex-futures-v3.json',
);

let catalogCache: MarketCatalog | null = null;
let etagCache: string | null = null;

async function resolveCatalogPath(): Promise<string> {
  try {
    // Test primary path
    await fs.stat(CATALOG_PATH);
    return CATALOG_PATH;
  } catch {
    // Fallback to CWD-based path
    return ALT_CATALOG_PATH;
  }
}

/**
 * Debug helper: return candidate file paths and whether they exist.
 */
export async function getCatalogDebugInfo(): Promise<{
  primaryPath: string;
  primaryExists: boolean;
  altPath: string;
  altExists: boolean;
}> {
  const primaryPath = CATALOG_PATH;
  const altPath = ALT_CATALOG_PATH;
  const primaryExists = await fs
    .stat(primaryPath)
    .then(() => true)
    .catch(() => false);
  const altExists = await fs
    .stat(altPath)
    .then(() => true)
    .catch(() => false);

  return { primaryPath, primaryExists, altPath, altExists };
}

function computeETag(payload: unknown): string {
  const json = JSON.stringify(payload);
  return crypto.createHash('sha1').update(json).digest('hex');
}

export async function loadCatalog(): Promise<MarketCatalog> {
  if (catalogCache) return catalogCache;

  const filePath = await resolveCatalogPath();
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as MarketCatalog;

  catalogCache = parsed;
  etagCache = computeETag(parsed);
  return parsed;
}

export async function reloadCatalog(): Promise<MarketCatalog> {
  catalogCache = null;
  etagCache = null;
  return loadCatalog();
}

export function getCachedETag(): string | null {
  return etagCache;
}

export async function getCatalog(): Promise<MarketCatalog> {
  return loadCatalog();
}

export async function getSymbols(): Promise<string[]> {
  const cat = await loadCatalog();
  return (cat.markets || []).map((m: MarketEntry) => m.symbol).filter(Boolean);
}

export async function getEntry(symbol?: string): Promise<MarketEntry | undefined> {
  if (!symbol) return undefined;
  const sym = normalizeFuturesSymbol(symbol);
  const cat = await loadCatalog();
  return (cat.markets || []).find((m: MarketEntry) => m.symbol === sym);
}

export async function isValidSymbol(symbol?: string): Promise<boolean> {
  return (await getEntry(symbol)) != null;
}

export async function getMaxLeverage(symbol: string): Promise<number | null> {
  const entry = await getEntry(symbol);
  return entry?.maxLeverage ?? null;
}

export async function getPrecisions(symbol: string): Promise<{
  pricePrecision: number | null;
  quantityPrecision: number | null;
  tickSize: number | null;
  lotSize: number | null;
}> {
  const entry = await getEntry(symbol);
  return {
    pricePrecision: entry?.pricePrecision ?? null,
    quantityPrecision: entry?.quantityPrecision ?? null,
    tickSize: entry?.tickSize ?? null,
    lotSize: entry?.lotSize ?? null,
  };
}

export async function getFees(symbol: string): Promise<{
  maker: number | null;
  taker: number | null;
}> {
  const entry = await getEntry(symbol);
  return {
    maker: entry?.feesBps?.maker ?? null,
    taker: entry?.feesBps?.taker ?? null,
  };
}
