const CACHE_NAME = 'poloniex-trading-v2.0-cors-fix';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png'
];

// Cache trading data for offline access
const TRADING_DATA_CACHE = 'trading-data-v2';
const OFFLINE_FALLBACK_DATA = {
  markets: [],
  lastUpdate: new Date().toISOString(),
  offline: true
};

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('PWA: Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((error) => {
        console.error('PWA: Failed to cache static assets:', error);
      })
  );
  // Take control immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('PWA: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all clients
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip external requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Network-first for navigations to avoid stale index.html after deploy
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              // Always keep the latest index cached at '/'
              cache.put('/', responseClone);
            });
          }
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  const isApiRequest = event.request.url.includes('/api/');
  const isTradingDataRequest = isApiRequest && (
    event.request.url.includes('/api/market') ||
    event.request.url.includes('/api/trade')
  );

  // For non-trading-data API calls, only serve from cache if available;
  // otherwise let the browser handle the request natively so errors
  // propagate to the frontend's own error handling (no artificial 503).
  if (isApiRequest && !isTradingDataRequest) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        // Serve stale cache immediately and refresh in background
        if (cachedResponse) {
          fetch(event.request).then((response) => {
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
              });
            }
          }).catch(() => { /* background refresh failed, stale cache is fine */ });
          return cachedResponse;
        }

        // No cache — pass through to network; cache successful responses
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        }).catch(() => {
          // Network error (ERR_NETWORK_CHANGED, offline, etc.)
          // Return a proper JSON error response so the frontend's error
          // handling (axios .catch) can process it cleanly instead of
          // generating "Uncaught (in promise)" console errors.
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Network unavailable',
              offline: true,
              timestamp: new Date().toISOString()
            }),
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'application/json' }
            }
          );
        });
      })
    );
    return;
  }

  // Trading data API calls — provide offline fallback
  if (isTradingDataRequest) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          fetch(event.request).then((response) => {
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
              });
            }
          }).catch(() => { /* background refresh failed */ });
          return cachedResponse;
        }

        return fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
              });
              // Cache trading data separately for offline access
              response.clone().json().then((data) => {
                caches.open(TRADING_DATA_CACHE).then((cache) => {
                  cache.put(event.request, new Response(JSON.stringify({
                    ...data,
                    cached: true,
                    cacheTime: new Date().toISOString()
                  })));
                });
              }).catch(() => { /* Ignore JSON parsing errors */ });
            }
            return response;
          })
          .catch(() => {
            // Try to return cached trading data for offline mode
            return caches.open(TRADING_DATA_CACHE).then((cache) => {
              return cache.match(event.request).then((cached) => {
                if (cached) {
                  return cached;
                }
                // Return fallback offline data
                return new Response(
                  JSON.stringify({
                    ...OFFLINE_FALLBACK_DATA,
                    message: 'Using offline data due to connectivity issues'
                  }),
                  {
                    status: 200,
                    statusText: 'OK (Offline)',
                    headers: {
                      'Content-Type': 'application/json'
                    }
                  }
                );
              });
            });
          });
      })
    );
    return;
  }

  // Static assets — cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
              });
            }
            return response;
          });
        // No .catch() — let network errors propagate naturally for static assets
      })
  );
});

// Background sync for when connectivity is restored
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    console.log('PWA: Background sync triggered');
    // Here you could sync pending trades, update cache, etc.
  }
});

// Push notifications (future enhancement)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const options = {
    body: event.data.text(),
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'View Dashboard',
        icon: '/favicon.ico'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/favicon.ico'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Poloniex Trading', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Handle messages from clients (pages) and browser extensions
// This prevents "message channel closed" errors from browser extensions
self.addEventListener('message', (event) => {
  if (event.data && event.data.type) {
    switch (event.data.type) {
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;
      case 'CLIENTS_CLAIM':
        self.clients.claim();
        break;
      default:
        break;
    }
  }
  // Acknowledge messages via MessagePort to prevent "message channel closed" errors
  if (event.ports && event.ports[0]) {
    event.ports[0].postMessage({ ack: true });
  }
});
