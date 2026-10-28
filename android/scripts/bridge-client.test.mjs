import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceBridge } from '../../bridge/core.mjs';
import { bridgeClientTemplate, bridgeShim, fillBridgeClient, PLACEHOLDERS } from './bridge-client.mjs';

const KIOSK = '11111111-1111-4111-8111-111111111111';
const GROUPS = { PhotoboothDevice: ['claimPrintPass', 'setPrinterName'], PhotoboothPrinter: ['printAuthorizedPass'] };

// A page in the Android WebView: window.PBNative answers like the native app does.
function androidPage() {
  const sent = [];
  const native = {
    onmessage: null,
    postMessage(text) {
      const msg = JSON.parse(text);
      sent.push(msg);
      setTimeout(() => native.onmessage({ data: JSON.stringify({ id: msg.id, status: 200, body: JSON.stringify({ ok: true, path: msg.path }) }) }), 0);
    },
  };
  const storage = new Map();
  const pageFetch = vi.fn(async () => new Response('{"web":true}'));
  const window = {
    PBNative: native,
    fetch: pageFetch,
    location: { href: 'https://appassets.androidplatform.net/home.html', origin: 'https://appassets.androidplatform.net', pathname: '/home.html' },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
    },
    navigator: { serviceWorker: { register: vi.fn(), getRegistrations: async () => [] } },
    Request, Response, URL, setTimeout, clearTimeout, setInterval: () => 0, JSON, Promise, Object,
  };
  window.window = window;
  vm.createContext(window);
  vm.runInContext(bridgeShim(), window);
  vm.runInContext(fillBridgeClient(bridgeClientTemplate(), { kioskId: KIOSK, packageId: '', mode: 'redeem', groups: GROUPS }), window);
  return { window, sent, storage, pageFetch };
}

describe('Android bridge client', () => {
  it('fills every placeholder', () => {
    const filled = fillBridgeClient(bridgeClientTemplate(), { kioskId: KIOSK, packageId: '', mode: 'event', groups: GROUPS });
    for (const value of Object.values(PLACEHOLDERS)) expect(filled).not.toContain(value);
  });

  it('gives the pages the same bridge globals as the Windows agent, routed to the app', async () => {
    const { window, sent, storage } = androidPage();
    expect(Object.keys(window.PhotoboothDevice)).toEqual(['claimPrintPass', 'setPrinterName']);
    expect(Object.keys(window.PhotoboothPrinter)).toEqual(['printAuthorizedPass']);
    expect(storage.get('kiosk_id')).toBe(KIOSK);
    expect(storage.get('kiosk_mode')).toBe('redeem');

    const result = await window.PhotoboothDevice.claimPrintPass({ code: '1234A' });
    expect(result).toEqual({ ok: true, path: '/__bridge/call' });
    expect(sent[0]).toMatchObject({ method: 'POST', path: '/__bridge/call' });
    expect(JSON.parse(sent[0].body)).toEqual({ method: 'claimPrintPass', args: { code: '1234A' } });
  });

  it('routes the local printer endpoints and leaves every other request alone', async () => {
    const { window, sent, pageFetch } = androidPage();
    const printers = await (await window.fetch('/api/printers')).json();
    expect(printers.path).toBe('/api/printers');
    expect(sent.at(-1)).toMatchObject({ method: 'GET', path: '/api/printers', body: null });

    await window.fetch('/api/direct-print', { method: 'POST', body: JSON.stringify({ image: 'x' }) });
    expect(sent.at(-1)).toMatchObject({ method: 'POST', path: '/api/direct-print', body: '{"image":"x"}' });

    await window.fetch('https://example.supabase.co/functions/v1/session-gif', { method: 'POST' });
    await window.fetch('/theme-packs/boarding-80mm.json');
    expect(pageFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the bundled pages from installing a service worker', async () => {
    const { window } = androidPage();
    const registration = await window.navigator.serviceWorker.register('/sw.js');
    expect(await registration.unregister()).toBe(true);
  });
});

describe('Android native bridge', () => {
  it('offers the same device methods as bridge/core.mjs', () => {
    const kotlin = readFileSync(new URL('../app/src/main/java/com/memories/photobooth/DeviceApi.kt', import.meta.url), 'utf8');
    const native = [...kotlin.matchAll(/^\s*"(\w+)" to h \{/gm)].map((m) => m[1]).sort();
    const web = Object.keys(createDeviceBridge({ supabaseUrl: '', publishableKey: '', credential: '', kioskId: '', packageId: '' }).handlers).sort();
    expect(native).toEqual(web);
  });
});
