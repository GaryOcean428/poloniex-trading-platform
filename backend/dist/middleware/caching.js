let cachedETag = null;
export async function setCachingHeaders(res) {
    const etag = `"${Date.now()}"`;
    cachedETag = etag;
    res.set({
        'Cache-Control': 'public, max-age=60, must-revalidate',
        'ETag': etag,
        'Last-Modified': new Date().toUTCString()
    });
}
export function getCachedETag() {
    return cachedETag;
}
export function cacheMiddleware(maxAge = 60) {
    return (req, res, next) => {
        const clientETag = req.headers['if-none-match'];
        const currentETag = getCachedETag();
        if (clientETag && clientETag === currentETag) {
            return res.status(304).end();
        }
        setCachingHeaders(res);
        next();
    };
}
