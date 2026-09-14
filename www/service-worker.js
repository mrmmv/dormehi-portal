const CACHE_NAME = 'learner-portal-v18-offline-sync'; // Bumped version forces cache refresh
const STATIC_ASSETS = [
    './logo.png',
    './fontawesome-free-6.4.0-web/css/all.min.css',
    './js/offline-exam-manager.js'
];

// Install: only cache truly static assets (images, fonts)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting(); // Activate immediately
});

// Activate: delete old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim(); // Take control of all pages immediately
});

// Fetch: Network-First for HTML/JS/CSS, Cache-First for images/fonts
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const isScript = url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.html');

    if (isScript) {
        // NETWORK FIRST: Always get fresh JS/CSS/HTML from server
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Update cache with fresh version
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => {
                    // Offline fallback: use cached version
                    return caches.match(event.request);
                })
        );
    } else {
        // CACHE FIRST: Use cached images/fonts, fetch if not cached
        event.respondWith(
            caches.match(event.request)
                .then((response) => {
                    return response || fetch(event.request).catch(() => null);
                })
        );
    }
});

// Handle clicks on push notifications
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes('/') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
