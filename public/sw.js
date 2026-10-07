const CACHE_NAME = 'photobooth-v18';
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
    '/buy.html',
    '/processing.html',
    '/print.html',
    '/admin.html',
    '/template-editor.html',
    '/template-engine.js',
    '/shared.js',
    '/dither-worker.js',
    '/gif-worker.js',
    '/gif-core.js',
    '/vendor/gifenc.esm.js',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/fonts/Inter-latin.woff2',
    '/fonts/Cantarell-latin-400.woff2',
    '/fonts/Cantarell-latin-700.woff2',
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
            .catch(async () => {
                const isPage = event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html');
                // The local agent restarts for a few seconds when it updates itself: keep trying
                // instead of dropping the customer mid-session.
                if (isPage) {
                    for (let attempt = 0; attempt < 6; attempt++) {
                        await new Promise((resolve) => setTimeout(resolve, 1500));
                        try { return await fetch(event.request); } catch (_) { /* still down */ }
                    }
                }
                const cached = await caches.match(event.request);
                if (cached) return cached;
                if (isPage) {
                    // Same page with another query string (e.g. capture.html?retake=0), then the welcome page.
                    return (await caches.match(event.request, { ignoreSearch: true })) || (await caches.match('/home.html')) || (await caches.match('/'));
                }
                return Response.error();
            })
    );
});
