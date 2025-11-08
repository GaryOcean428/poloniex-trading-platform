/**
 * Caching middleware for market data endpoints
 * Provides ETag-based caching for better performance
 */
let cachedETag = null;
/**
 * Set caching headers for responses
 */
export async function setCachingHeaders(res) {
    const etag = `"${Date.now()}"`;
    cachedETag = etag;
    res.set({
        'Cache-Control': 'public, max-age=60, must-revalidate',
        'ETag': etag,
        'Last-Modified': new Date().toUTCString()
    });
}
/**
 * Get current cached ETag
 */
export function getCachedETag() {
    return cachedETag;
}
/**
 * Cache middleware for routes
 */
export function cacheMiddleware(maxAge = 60) {
    return (req, res, next) => {
        // Check if client has cached version
        const clientETag = req.headers['if-none-match'];
        const currentETag = getCachedETag();
        if (clientETag && clientETag === currentETag) {
            return res.status(304).end();
        }
        // Set cache headers
        setCachingHeaders(res);
        next();
    };
}
