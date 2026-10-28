// Android app: the kiosk pages talk to the Windows agent through a few local URLs
// (/__bridge/call, /api/printers, /api/direct-print, ...). In the Android app there is no
// local server, so those fetches go to the native app through window.PBNative, a channel
// the app opens only for its own origin. Every other request is left alone.
(() => {
  const native = window.PBNative;
  if (!native || window.__pbAndroid) return;
  window.__pbAndroid = true;

  const ROUTES = new Set([
    '/__bridge/call', '/__agent/status', '/api/printers', '/api/direct-print',
    '/__setup/info', '/__setup/status', '/__setup/save',
  ]);
  // Printing a long receipt over Bluetooth can take a while; never wait forever.
  const TIMEOUT_MS = 180000;
  const pending = new Map();
  let seq = 0;

  const reply = (status, body) => new Response(body, {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

  native.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch (_) { return; }
    const done = pending.get(msg.id);
    if (!done) return;
    pending.delete(msg.id);
    done(reply(msg.status || 200, typeof msg.body === 'string' ? msg.body : '{}'));
  };

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    let url;
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    try { url = new URL(request ? request.url : String(input), location.href); } catch (_) { return nativeFetch(input, init); }
    if (url.origin !== location.origin || !ROUTES.has(url.pathname)) return nativeFetch(input, init);

    const method = String((init && init.method) || (request && request.method) || 'GET').toUpperCase();
    const rawBody = init && init.body != null ? init.body : null;
    const bodyText = rawBody == null ? Promise.resolve(request && method !== 'GET' ? request.text() : null)
      : Promise.resolve(typeof rawBody === 'string' ? rawBody : new Response(rawBody).text());
    return bodyText.then((body) => new Promise((resolve) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        if (pending.delete(id)) resolve(reply(504, JSON.stringify({ error: 'agent_timeout' })));
      }, TIMEOUT_MS);
      pending.set(id, (response) => { clearTimeout(timer); resolve(response); });
      native.postMessage(JSON.stringify({ id, method, path: url.pathname, body }));
    }));
  };

  // The pages ship inside the app; a service worker would only keep serving old copies after an update.
  const workers = navigator.serviceWorker;
  if (workers) {
    try {
      workers.register = () => Promise.resolve({ unregister: () => Promise.resolve(true) });
      workers.getRegistrations().then((list) => list.forEach((r) => r.unregister())).catch(() => {});
    } catch (_) { /* not available in this WebView */ }
  }
})();
