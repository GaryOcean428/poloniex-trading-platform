/**
 * Poloniex Futures V3 Markets Catalog Types
 * Shared, strict types to load/serve the normalized markets catalog JSON.
 */
/**
 * Utility: normalize UI symbols like "BTC-USDT" to "BTCUSDT"
 */
export function normalizeFuturesSymbol(sym) {
    if (!sym)
        return sym;
    return sym.replace(/-/g, '').toUpperCase();
}
