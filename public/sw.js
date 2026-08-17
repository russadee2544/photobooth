const CACHE_NAME = 'photobooth-v8';
const ASSETS = [
    '/',
    '/index.html',
    '/home.html',
    '/layout.html',
    '/capture.html',
    '/retake.html',
    '/template.html',
    '/filter.html',
    '/payment.html',
    '/processing.html',
    '/print.html',
    '/admin.html',
    '/template-editor.html',
    '/template-engine.js',
    '/shared.js',
    '/dither-worker.js',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/fonts/Inter-latin.woff2',
    '/fonts/Prompt-latin-300.woff2',
    '/fonts/Prompt-thai-300.woff2',
    '/fonts/Prompt-latin-400.woff2',
    '/fonts/Prompt-thai-400.woff2',
    '/fonts/Prompt-latin-500.woff2',
    '/fonts/Prompt-thai-500.woff2',
    '/fonts/Prompt-latin-600.woff2',
    '/fonts/Prompt-thai-600.woff2',
    '/fonts/Prompt-latin-700.woff2',
    '/fonts/Prompt-thai-700.woff2',
    '/fonts/Prompt-latin-800.woff2',
    '/fonts/Prompt-thai-800.woff2',
    '/fonts/MaterialSymbolsOutlined.woff2'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS).catch((err) => console.warn('Cache addAll warning:', err));
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response.status === 200) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => {
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;
                    if (event.request.headers.get('accept')?.includes('text/html')) {
                        return caches.match('/home.html') || caches.match('/');
                    }
                });
            })
    );
});
