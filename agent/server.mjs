// Photobooth Windows agent:  npm run build && npm run agent
// Serves the built kiosk (dist-next) on loopback and implements the native bridge
// contract (docs/REDEEM_NATIVE_BRIDGE.md) as window.PhotoboothDevice /
// window.PhotoboothPrinter. The device credential never leaves this process.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { createDeviceBridge, clientScript } from '../bridge/core.mjs';
import { CONFIG_FILE, JOBS_FILE, WEB_ROOT } from './paths.mjs';
import { unprotect } from './dpapi.mjs';
import { createJournal } from './jobs.mjs';
import { createPrintService } from './print-pass.mjs';
import { listPrinters, printImage } from './printer-win.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

let config;
try {
  config = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
} catch {
  console.error(`No config at ${CONFIG_FILE}. Run: npm run agent:setup`);
  process.exit(1);
}
const credential = await unprotect(config.credentialDpapi);
const { handlers: deviceHandlers, internal } = createDeviceBridge({
  supabaseUrl: config.supabaseUrl, publishableKey: config.publishableKey, credential,
  kioskId: config.kioskId, packageId: config.packageId,
});

const journal = createJournal(JOBS_FILE);
await journal.load();
const printService = createPrintService({ internal, journal, printImage, printerName: config.printerName || '' });

// Only the page-facing PhotoboothPrinter surface; start/report stay internal.
const printerHandlers = {
  printAuthorizedPass: (a) => printService.printAuthorizedPass(a),
  testPrint: async () => ({ success: false, error: 'use_admin_test_page' }),
};
const handlers = { ...deviceHandlers, ...printerHandlers };
const groups = {
  PhotoboothDevice: Object.keys(deviceHandlers),
  PhotoboothPrinter: Object.keys(printerHandlers),
};

setInterval(() => { printService.flushUnreported().catch(() => {}); }, 30_000);
printService.flushUnreported().catch(() => {});

const hostAllowed = (req) => LOCAL_HOSTS.has(String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase());

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) { reject(new Error('too_large')); req.destroy(); }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
  if (!rel || rel.endsWith(sep)) rel = join(rel, 'index.html');
  const file = join(WEB_ROOT, rel);
  if (!file.startsWith(WEB_ROOT + sep)) return json(res, 403, { error: 'forbidden' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('not_file');
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    json(res, 404, { error: 'not_found' });
  }
}

const server = createServer(async (req, res) => {
  if (!hostAllowed(req)) return json(res, 403, { error: 'forbidden' });
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/__bridge.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(clientScript({
      endpoint: '/__bridge/call', kioskId: config.kioskId, packageId: config.packageId, groups, header: 'x-pb-bridge',
    }));
  }

  if (pathname === '/__bridge/call') {
    // Loopback host + custom header: other web pages cannot drive the agent.
    if (req.method !== 'POST' || req.headers['x-pb-bridge'] !== '1') return json(res, 403, { error: 'forbidden' });
    let payload;
    try { payload = JSON.parse(await readBody(req, 30 * 1024 * 1024) || '{}'); } catch { return json(res, 400, { error: 'invalid_json' }); }
    const handler = Object.hasOwn(handlers, payload.method) ? handlers[payload.method] : null;
    if (!handler) return json(res, 400, { error: 'unknown_method' });
    try { return json(res, 200, await handler(payload.args || {})); } catch { return json(res, 200, { error: 'agent_error' }); }
  }

  // Free-event mode only: silent print without an entitlement. Never in redeem mode.
  if (config.mode === 'event' && pathname === '/api/printers' && req.method === 'GET') {
    return json(res, 200, await listPrinters());
  }
  if (config.mode === 'event' && pathname === '/api/direct-print' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req, 30 * 1024 * 1024) || '{}');
      const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(body.image || '');
      if (!match) return json(res, 400, { success: false, error: 'invalid_image' });
      const copies = Math.min(10, Math.max(1, parseInt(body.copies, 10) || 1));
      const result = await printImage({ bytes: Buffer.from(match[2], 'base64'), ext: match[1] === 'jpeg' ? 'jpg' : 'png',
        printerName: String(body.printerName || config.printerName || ''), copies });
      return json(res, 200, { success: true, printer: result.printer, copies });
    } catch (error) {
      return json(res, 500, { success: false, error: error instanceof Error ? error.message : 'print_failed' });
    }
  }
  if (pathname.startsWith('/api/')) return json(res, 403, { error: 'direct_print_disabled' });

  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  if (pathname.endsWith('.html')) {
    // Inject the bridge before any page script runs.
    try {
      const file = join(WEB_ROOT, normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, ''));
      if (!file.startsWith(WEB_ROOT + sep)) throw new Error('outside');
      const html = (await readFile(file, 'utf8')).replace(/<head([^>]*)>/i, '<head$1><script src="/__bridge.js"></script>');
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      return res.end(html);
    } catch {
      return json(res, 404, { error: 'not_found' });
    }
  }
  return serveStatic(req, res);
});

const port = Number(config.port) || 8787;
server.listen(port, '127.0.0.1', () => {
  console.log(`Photobooth agent on http://localhost:${port}/home.html (mode: ${config.mode}, kiosk: ${config.kioskId})`);
});
