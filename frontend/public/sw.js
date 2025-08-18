const CACHE_NAME = 'poloniex-trading-v1.2';
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
const TRADING_DATA_CACHE = 'trading-data-v1';
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

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // Return cached version if available
        if (cachedResponse) {
          // For API requests, also try to fetch fresh data in background
          if (event.request.url.includes('/api/')) {
            fetch(event.request).then((response) => {
              if (response.ok) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, responseClone);
                });
              }
            }).catch(() => {
              // Ignore fetch errors in background update
            });
          }
          return cachedResponse;
        }

        // Network first for API calls
        if (event.request.url.includes('/api/')) {
          return fetch(event.request)
            .then((response) => {
              if (response.ok) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, responseClone);
                });

                // Cache trading data separately for offline access
                if (event.request.url.includes('/api/market') ||
                    event.request.url.includes('/api/trade')) {
                  response.clone().json().then((data) => {
                    caches.open(TRADING_DATA_CACHE).then((cache) => {
                      cache.put(event.request, new Response(JSON.stringify({
                        ...data,
                        cached: true,
                        cacheTime: new Date().toISOString()
                      })));
                    });
                  }).catch(() => {
                    // Ignore JSON parsing errors
                  });
                }
              }
              return response;
            })
            .catch(() => {
              // Try to return cached trading data for offline mode
              if (event.request.url.includes('/api/market') ||
                  event.request.url.includes('/api/trade')) {
                return caches.open(TRADING_DATA_CACHE).then((cache) => {
                  return cache.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                      return cachedResponse;
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
              }

              // Return a basic offline response for other API calls
              return new Response(
                JSON.stringify({
                  error: 'Offline',
                  message: 'API unavailable in offline mode',
                  timestamp: new Date().toISOString()
                }),
                {
                  status: 503,
                  statusText: 'Service Unavailable',
                  headers: {
                    'Content-Type': 'application/json'
                  }
                }
              );
            });
        }

        // For other requests, try network first, fallback to cache, then offline
        return fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
              });
            }
            return response;
          })
          .catch(() => {
            // If it's a navigation request, return the cached index page
            if (event.request.mode === 'navigate') {
              return caches.match('/');
            }

            // For other failed requests, return a basic response
            return new Response('Offline', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
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
