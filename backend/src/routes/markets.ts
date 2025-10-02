import express from 'express';
import { setCachingHeaders, getCachedETag } from '../middleware/caching.js';
import { getSymbols } from '../services/marketCatalog.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/markets/poloniex-futures-v3 - Get all futures markets data
 * Returns complete market catalog with symbols, contracts, and specifications
 */
router.get('/poloniex-futures-v3', async (req, res) => {
  try {
    // Check for conditional requests using ETag
    const clientETag = req.headers['if-none-match'];
    const currentETag = getCachedETag();
    
    if (clientETag && clientETag === currentETag) {
      return res.status(304).end();
    }

    // Get the market catalog from file or cache
    const fs = await import('fs/promises');
    const path = await import('path');
    
    // Try environment-specified path first
    const catalogPath = process.env.CATALOG_PATH || '/app/shared/catalogs/poloniex-futures-v3.json';
    
    let catalogData;
    try {
      const catalogContent = await fs.readFile(catalogPath, 'utf-8');
      catalogData = JSON.parse(catalogContent);
    } catch (error) {
      // Fallback to docs directory
      const fallbackPath = path.join(process.cwd(), 'docs', 'markets', 'poloniex-futures-v3.json');
      try {
        const fallbackContent = await fs.readFile(fallbackPath, 'utf-8');
        catalogData = JSON.parse(fallbackContent);
      } catch (fallbackError) {
        logger.error('Failed to load market catalog from both paths', {
          primary: catalogPath,
          fallback: fallbackPath,
          primaryError: error.message,
          fallbackError: fallbackError.message
        });
        return res.status(500).json({ 
          error: 'Market catalog not available',
          details: 'Unable to load futures market data'
        });
      }
    }

    // Set caching headers
    await setCachingHeaders(res);
    
    return res.json(catalogData);
  } catch (error) {
    logger.error('Error in GET /api/markets/poloniex-futures-v3', { error: error.message, stack: error.stack });
    return res.status(500).json({
      error: 'Failed to fetch market data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/markets/poloniex-futures-v3/symbols - Get list of available symbols
 */
router.get('/poloniex-futures-v3/symbols', async (req, res) => {
  try {
    const symbols = await getSymbols();
    await setCachingHeaders(res);
    return res.json(symbols);
  } catch (error) {
    logger.error('Error fetching symbols', { error: error.message, stack: error.stack });
    return res.status(500).json({
      error: 'Failed to fetch symbols',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/markets/poloniex-futures-v3/:symbol - Get specific symbol data
 */
router.get('/poloniex-futures-v3/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const symbols = await getSymbols();
    
    if (!symbols.includes(symbol)) {
      return res.status(404).json({ 
        error: 'Symbol not found',
        available: symbols.slice(0, 10) // Show first 10 available symbols
      });
    }
    
    await setCachingHeaders(res);
    return res.json({ 
      symbol,
      status: 'active',
      type: 'futures_perpetual',
      exchange: 'poloniex'
    });
  } catch (error) {
    logger.error('Error fetching symbol', { symbol: req.params.symbol, error: error.message, stack: error.stack });
    return res.status(500).json({
      error: 'Failed to fetch symbol data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/markets/poloniex-futures-v3/debug - Debug endpoint for troubleshooting
 */
router.get('/poloniex-futures-v3/debug', (req, res) => {
  const catalogPath = process.env.CATALOG_PATH || '/app/shared/catalogs/poloniex-futures-v3.json';
  const fs = require('fs');
  const path = require('path');
  
  const altPath = path.join(process.cwd(), 'docs', 'markets', 'poloniex-futures-v3.json');
  
  res.json({
    envCatalogPath: catalogPath,
    envCatalogExists: fs.existsSync(catalogPath),
    altPath: altPath,
    altExists: fs.existsSync(altPath),
    cwd: process.cwd(),
    timestamp: new Date().toISOString()
  });
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
        'GET /api/markets/poloniex-futures-v3 - Get all market data',
        'GET /api/markets/poloniex-futures-v3/symbols - Get symbol list',
        'GET /api/markets/poloniex-futures-v3/:symbol - Get specific symbol data',
        'GET /api/markets/poloniex-futures-v3/debug - Debug information'
      ]
    });
  } catch (error) {
    logger.error('Error in GET /api/markets', { error: error.message, stack: error.stack });
    return res.status(500).json({
      error: 'Failed to load markets data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
