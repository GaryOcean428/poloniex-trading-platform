import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { normalizeFuturesSymbol, } from '../types/markets.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_CATALOG_PATH = process.env.CATALOG_PATH || '';
const ENV_SHARED_DIR = process.env.SHARED_DIR || '';
const SHARED_CATALOG_PATH = ENV_SHARED_DIR
    ? path.resolve(ENV_SHARED_DIR, 'catalogs/poloniex-futures-v3.json')
    : '';
const CATALOG_PATH = path.resolve(__dirname, '../../../docs/markets/poloniex-futures-v3.json');
const ALT_CATALOG_PATH = path.resolve(process.cwd(), 'docs/markets/poloniex-futures-v3.json');
let catalogCache = null;
let etagCache = null;
async function resolveCatalogPath() {
    if (ENV_CATALOG_PATH) {
        try {
            await fs.stat(ENV_CATALOG_PATH);
            return ENV_CATALOG_PATH;
        }
        catch {
        }
    }
    if (SHARED_CATALOG_PATH) {
        try {
            await fs.stat(SHARED_CATALOG_PATH);
            return SHARED_CATALOG_PATH;
        }
        catch {
        }
    }
    try {
        await fs.stat(CATALOG_PATH);
        return CATALOG_PATH;
    }
    catch {
        return ALT_CATALOG_PATH;
    }
}
export async function getCatalogDebugInfo() {
    const envCatalogPath = ENV_CATALOG_PATH;
    const sharedCatalogPath = SHARED_CATALOG_PATH;
    const primaryPath = CATALOG_PATH;
    const altPath = ALT_CATALOG_PATH;
    const [envCatalogExists, sharedCatalogExists, primaryExists, altExists] = await Promise.all([
        envCatalogPath
            ? fs.stat(envCatalogPath).then(() => true).catch(() => false)
            : Promise.resolve(false),
        sharedCatalogPath
            ? fs.stat(sharedCatalogPath).then(() => true).catch(() => false)
            : Promise.resolve(false),
        fs.stat(primaryPath).then(() => true).catch(() => false),
        fs.stat(altPath).then(() => true).catch(() => false),
    ]);
    return {
        envCatalogPath,
        envCatalogExists,
        sharedCatalogPath,
        sharedCatalogExists,
        primaryPath,
        primaryExists,
        altPath,
        altExists,
    };
}
function computeETag(payload) {
    const json = JSON.stringify(payload);
    return crypto.createHash('sha1').update(json).digest('hex');
}
export async function loadCatalog() {
    if (catalogCache)
        return catalogCache;
    const filePath = await resolveCatalogPath();
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    catalogCache = parsed;
    etagCache = computeETag(parsed);
    return parsed;
}
export async function reloadCatalog() {
    catalogCache = null;
    etagCache = null;
    return loadCatalog();
}
export function getCachedETag() {
    return etagCache;
}
export async function getCatalog() {
    return loadCatalog();
}
export async function getSymbols() {
    const cat = await loadCatalog();
    return (cat.markets || []).map((m) => m.symbol).filter(Boolean);
}
export async function getEntry(symbol) {
    if (!symbol)
        return undefined;
    const sym = normalizeFuturesSymbol(symbol);
    const cat = await loadCatalog();
    return (cat.markets || []).find((m) => m.symbol === sym);
}
export async function isValidSymbol(symbol) {
    return (await getEntry(symbol)) != null;
}
export async function getMaxLeverage(symbol) {
    const entry = await getEntry(symbol);
    return entry?.maxLeverage ?? null;
}
export async function getPrecisions(symbol) {
    const entry = await getEntry(symbol);
    return {
        pricePrecision: entry?.pricePrecision ?? null,
        quantityPrecision: entry?.quantityPrecision ?? null,
        tickSize: entry?.tickSize ?? null,
        lotSize: entry?.lotSize ?? null,
    };
}
export async function getFees(symbol) {
    const entry = await getEntry(symbol);
    return {
        maker: entry?.feesBps?.maker ?? null,
        taker: entry?.feesBps?.taker ?? null,
    };
}
