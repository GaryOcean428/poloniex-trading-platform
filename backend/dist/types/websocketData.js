export function isAccountData(data) {
    return typeof data === 'object' && data !== null &&
        ('accountId' in data || 'equity' in data || 'availableBalance' in data);
}
export function isPositionData(data) {
    return typeof data === 'object' && data !== null &&
        ('symbol' in data && 'currentQty' in data);
}
export function isOrderData(data) {
    return typeof data === 'object' && data !== null &&
        ('orderId' in data || 'status' in data);
}
export function isTradeExecutionData(data) {
    return typeof data === 'object' && data !== null &&
        ('tradeId' in data && 'orderId' in data);
}
export function isTickerData(data) {
    return typeof data === 'object' && data !== null &&
        ('symbol' in data && ('price' in data || 'lastPrice' in data));
}
export function isOrderBookData(data) {
    return typeof data === 'object' && data !== null &&
        ('asks' in data || 'bids' in data);
}
export function isTradeData(data) {
    return typeof data === 'object' && data !== null &&
        ('symbol' in data && 'price' in data && 'size' in data);
}
export function isFundingData(data) {
    return typeof data === 'object' && data !== null &&
        ('fundingRate' in data);
}
