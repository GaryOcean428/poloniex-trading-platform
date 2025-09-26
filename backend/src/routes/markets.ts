import express from 'express';
import {
  getCatalog,
  getCachedETag,
  getSymbols,
  getEntry,
  getCatalogDebugInfo,
} from '../services/marketCatalog.js';

const router = express.Router();

// Helper to set caching headers with ETag
async function setCachingHeaders(res: express.Response) {
  const etag = getCachedETag();
  if (etag) {
    res.setHeader('ETag', etag);
  }
  // Cache for 5 minutes; clients can revalidate using ETag
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
}

// GET full catalog
router.get('/poloniex-futures-v3', async (req, res) => {
  try {
    const catalog = await getCatalog();

    // ETag handling (basic)
    await setCachingHeaders(res);
    const ifNoneMatch = req.headers['if-none-match'];
    const currentEtag = getCachedETag();
    if (ifNoneMatch && currentEtag && ifNoneMatch === currentEtag) {
      return res.status(304).end();
    }

    return res.json(catalog);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load catalog' });
  }
});

// GET symbols list
router.get('/poloniex-futures-v3/symbols', async (_req, res) => {
  try {
    const symbols = await getSymbols();
    await setCachingHeaders(res);
    return res.json(symbols);
  } catch {
    return res.status(500).json({ error: 'Failed to load symbols' });
  }
});

// Debug: path resolution for catalog file
router.get('/poloniex-futures-v3/debug', async (_req, res) => {
  try {
    const info = await getCatalogDebugInfo();
    return res.json(info);
  } catch {
    return res.status(500).json({ error: 'debug_failed' });
  }
});

// GET single market entry
router.get('/poloniex-futures-v3/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const entry = await getEntry(symbol);
    await setCachingHeaders(res);
    if (!entry) {
      return res.status(404).json({ error: 'Symbol not found' });
    }
    return res.json(entry);
  } catch {
    return res.status(500).json({ error: 'Failed to load market entry' });
  }
});

// Root endpoint for markets - redirect to poloniex futures
router.get('/', async (req, res) => {
  try {
    const symbols = await getSymbols();
    await setCachingHeaders(res);
    return res.json({ 
      status: 'ok', 
      service: 'markets',
      symbols: symbols,
      endpoints: [
        'GET /api/markets/poloniex-futures-v3',
        'GET /api/markets/poloniex-futures-v3/symbols',
        'GET /api/markets/poloniex-futures-v3/:symbol'
      ]
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load markets data' });
  }
});

export default router;
