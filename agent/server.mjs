// Photobooth Windows agent:  npm run build && npm run agent   (or the installed launcher)
// Serves the built kiosk (dist-next) on loopback and implements the native bridge
// contract (docs/REDEEM_NATIVE_BRIDGE.md) as window.PhotoboothDevice /
// window.PhotoboothPrinter. The device credential never leaves this process.
// With no config yet it serves a first-run setup page instead (see runSetup).
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { createDeviceBridge, clientScript } from '../bridge/core.mjs';
import { APP_ROOT, CONFIG_FILE, DATA_DIR, JOBS_FILE, WEB_ROOT } from './paths.mjs';
import { protect, unprotect } from './dpapi.mjs';
import { createJournal } from './jobs.mjs';
import { createPrintService } from './print-pass.mjs';
import { listPrinters, printerHealth, printImage } from './printer-win.mjs';
import { createHeartbeat } from './heartbeat.mjs';
import { createUpdater, isValidChannel, readInstalledVersion } from './updater.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEFAULT_PORT = 8787;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

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

async function loadConfig() {
  try { return JSON.parse(await readFile(CONFIG_FILE, 'utf8')); } catch { return null; }
}

// Supabase URL + publishable key (public by design). The installer build writes them to
// agent/defaults.json; for local runs use PB_PUBLISHABLE_KEY. The legacy anon JWT inside
// shared.js is NOT accepted by the device Edge Functions, so it is never used as a fallback.
async function builtInSupabase() {
  let defaults = {};
  try { defaults = JSON.parse(await readFile(join(import.meta.dirname, "defaults.json"), "utf8")); } catch {}
  let supabaseUrl = defaults.supabaseUrl || process.env.PB_SUPABASE_URL || "";
  if (!supabaseUrl) {
    try {
      const source = await readFile(join(WEB_ROOT, "shared.js"), "utf8");
      supabaseUrl = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(source)?.[1] ?? "";
    } catch {}
  }
  return { supabaseUrl, publishableKey: defaults.publishableKey || process.env.PB_PUBLISHABLE_KEY || "" };
}

// ---------------------------------------------------------------- first-run setup
async function runSetup() {
  const page = await readFile(join(import.meta.dirname, 'setup-page.html'), 'utf8');
  const builtIn = await builtInSupabase();
  const server = createServer(async (req, res) => {
    if (!hostAllowed(req)) return json(res, 403, { error: 'forbidden' });
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/__setup/info' && req.method === 'GET') {
      return json(res, 200, { ...(await listPrinters()), configured: false });
    }
    if (pathname === '/__setup/status' && req.method === 'GET') {
      return json(res, 200, { configured: !!(await loadConfig()) });
    }
    if (pathname === '/__setup/save' && req.method === 'POST') {
      if (req.headers['x-pb-setup'] !== '1') return json(res, 403, { error: 'forbidden' });
      let input;
      try { input = JSON.parse(await readBody(req, 16384) || '{}'); } catch { return json(res, 400, { error: 'invalid_json' }); }
      const kioskId = String(input.kioskId || '').trim();
      const credential = String(input.credential || '').trim();
      const packageId = String(input.packageId || '').trim();
      const mode = input.mode === 'event' ? 'event' : 'redeem';
      const updateChannel = input.updateChannel === 'canary' ? 'canary' : 'stable';
      if (!UUID.test(kioskId) || credential.length < 20 || (packageId && !UUID.test(packageId))) {
        return json(res, 400, { error: 'invalid_input' });
      }
      if (!builtIn.supabaseUrl || !builtIn.publishableKey) return json(res, 500, { error: 'build_missing_supabase' });

      // Prove the credential works before saving anything.
      const probe = createDeviceBridge({ ...builtIn, credential, kioskId, packageId });
      let check;
      try { check = await probe.handlers.listPassOffers(); } catch { return json(res, 502, { error: 'network_error' }); }
      if (check?.code === 'INVALID_CREDENTIALS') return json(res, 500, { error: 'build_missing_supabase' });
      if (String(check?.error || '').startsWith('device_') || check?.error === 'bad_upstream_response') {
        return json(res, 401, { error: 'credential_rejected' });
      }

      await mkdir(dirname(CONFIG_FILE), { recursive: true });
      await writeFile(CONFIG_FILE, JSON.stringify({
        ...builtIn, kioskId, packageId, mode, updateChannel, printerName: String(input.printerName || '').slice(0, 200),
        port: DEFAULT_PORT, credentialDpapi: await protect(credential),
      }, null, 2));
      json(res, 200, { ok: true });
      // The launcher restarts the agent, which then comes up in normal mode.
      setTimeout(() => process.exit(0), 800);
      return;
    }
    // Any other page: the setup form.
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(page);
  });
  server.listen(DEFAULT_PORT, '127.0.0.1', () => {
    console.log(`Photobooth setup on http://localhost:${DEFAULT_PORT}/`);
  });
}

// ------------------------------------------------------------------- normal mode
async function runKiosk(config) {
  const credential = await unprotect(config.credentialDpapi);
  const { handlers: deviceHandlers, internal, isAdmin } = createDeviceBridge({
    supabaseUrl: config.supabaseUrl, publishableKey: config.publishableKey, credential,
    kioskId: config.kioskId, packageId: config.packageId,
  });

  // ---- self-update (installed copies only; a dev checkout never updates itself)
  const activity = { at: Date.now(), page: '' };
  const installed = existsSync(join(APP_ROOT, 'runtime', 'node.exe')) || process.env.PB_AGENT_UPDATES === '1';
  const currentVersion = await readInstalledVersion(APP_ROOT);
  let updater = null;
  if (installed) {
    try {
      updater = createUpdater({
        appRoot: APP_ROOT, dataDir: DATA_DIR, currentVersion,
        baseUrl: `${config.supabaseUrl}/storage/v1/object/public/updates`,
        channel: isValidChannel(config.updateChannel) ? config.updateChannel : 'stable',
        publicKeyPem: await readFile(join(import.meta.dirname, 'update-public-key.pem'), 'utf8'),
        // At the welcome screen nobody has started yet, so a restart costs nothing; mid-flow wait for 10 quiet minutes.
        isIdle: () => {
          const quiet = Date.now() - activity.at;
          return activity.page === '/home.html' || activity.page === '' ? quiet > 20_000 : quiet > 10 * 60_000;
        },
        log: (line) => console.log(`[update] ${line}`),
      });
      updater.restartWhenIdle();
      const poll = () => updater.check().catch(() => {});
      setTimeout(poll, 30_000).unref?.();
      setInterval(poll, 5 * 60_000).unref?.();
      setTimeout(() => updater.confirmHealthy().catch(() => {}), 60_000).unref?.();
    } catch (error) {
      console.error('[update] disabled:', error instanceof Error ? error.message : error);
    }
  }

  // ---- what the owner dashboard shows about this kiosk
  const startedAt = new Date().toISOString();
  const runtime = { paper: null, lastError: null, lastErrorAt: null };
  const noteError = (message) => { runtime.lastError = String(message).slice(0, 300); runtime.lastErrorAt = new Date().toISOString(); };

  const journal = createJournal(JOBS_FILE);
  await journal.load();
  const printService = createPrintService({ internal, journal, printImage, printerName: config.printerName || '' });

  // Only the page-facing PhotoboothPrinter surface; start/report stay internal.
  const printerHandlers = {
    printAuthorizedPass: async (a) => {
      const result = await printService.printAuthorizedPass(a);
      if (result && result.status !== 'completed') noteError(`print ${result.status}${result.error ? ': ' + result.error : ''}`);
      return result;
    },
    // Admin test page: one copy, PIN session required, no entitlement involved.
    testPrint: async (a) => {
      if (!isAdmin()) return { success: false, error: 'admin_capability_required' };
      const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(a.dataUrl || '');
      if (!match) return { success: false, error: 'invalid_image' };
      try {
        const result = await printImage({ bytes: Buffer.from(match[2], 'base64'), ext: match[1] === 'jpeg' ? 'jpg' : 'png',
          printerName: String(a.printerName || config.printerName || '').slice(0, 200), copies: 1 });
        return { success: true, printer: result.printer };
      } catch (error) {
        noteError(`test print: ${error instanceof Error ? error.message : 'failed'}`);
        return { success: false, error: error instanceof Error ? error.message : 'print_failed' };
      }
    },
  };
  // Switching the kiosk mode needs the admin PIN session; the agent persists it so the
  // silent-print rules (free event printing vs. paid redeem printing) match what the page shows.
  const modeHandlers = {
    setKioskMode: async (a) => {
      if (!isAdmin()) return { success: false, error: 'admin_capability_required' };
      if (a.mode !== 'event' && a.mode !== 'redeem') return { success: false, error: 'invalid_mode' };
      try {
        const saved = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
        await writeFile(CONFIG_FILE, JSON.stringify({ ...saved, mode: a.mode }, null, 2));
        config.mode = a.mode;
        return { success: true, mode: a.mode };
      } catch {
        return { success: false, error: 'config_write_failed' };
      }
    },
  };
  modeHandlers.reportPageStatus = async (a) => {
    const paper = Number(a.paper);
    if (Number.isInteger(paper) && paper >= 0 && paper <= 100000) runtime.paper = paper;
    return { success: true };
  };
  const handlers = { ...deviceHandlers, ...modeHandlers, ...printerHandlers };
  const groups = {
    PhotoboothDevice: [...Object.keys(deviceHandlers), ...Object.keys(modeHandlers)],
    PhotoboothPrinter: Object.keys(printerHandlers),
  };

  setInterval(() => { printService.flushUnreported().catch(() => {}); }, 30_000);
  printService.flushUnreported().catch(() => {});

  const server = createServer(async (req, res) => {
    if (!hostAllowed(req)) return json(res, 403, { error: 'forbidden' });
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/__bridge.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(clientScript({
        endpoint: '/__bridge/call', kioskId: config.kioskId, packageId: config.packageId, groups, header: 'x-pb-bridge',
        statusEndpoint: '/__agent/status', mode: config.mode, reportStatus: true,
      }));
    }

    if (pathname === '/__agent/status') {
      return json(res, 200, { version: currentVersion, channel: config.updateChannel || 'stable', mode: config.mode,
        ...(updater ? updater.status() : { pending: null, lastError: null }) });
    }

    if (pathname === '/__bridge/call') {
      // Loopback host + custom header: other web pages cannot drive the agent.
      if (req.method !== 'POST' || req.headers['x-pb-bridge'] !== '1') return json(res, 403, { error: 'forbidden' });
      let payload;
      try { payload = JSON.parse(await readBody(req, 30 * 1024 * 1024) || '{}'); } catch { return json(res, 400, { error: 'invalid_json' }); }
      if (payload.method !== 'reportPageStatus') activity.at = Date.now();
      const handler = Object.hasOwn(handlers, payload.method) ? handlers[payload.method] : null;
      if (!handler) return json(res, 400, { error: 'unknown_method' });
      try { return json(res, 200, await handler(payload.args || {})); } catch { return json(res, 200, { error: 'agent_error' }); }
    }

    // Free-event mode only: silent print without an entitlement. Never in redeem mode.
    if (pathname === '/api/printers' && req.method === 'GET') {
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
        noteError(`direct print: ${error instanceof Error ? error.message : 'failed'}`);
        return json(res, 500, { success: false, error: error instanceof Error ? error.message : 'print_failed' });
      }
    }
    if (pathname.startsWith('/api/')) return json(res, 403, { error: 'direct_print_disabled' });

    if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
    if (pathname.endsWith('.html')) {
      activity.at = Date.now();
      activity.page = pathname;
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

  const port = Number(config.port) || DEFAULT_PORT;
  server.listen(port, '127.0.0.1', () => {
    console.log(`Photobooth agent on http://localhost:${port}/home.html (mode: ${config.mode}, kiosk: ${config.kioskId})`);
  });

  createHeartbeat({
    send: (payload) => internal.heartbeat(payload),
    log: (line) => console.log(`[heartbeat] ${line}`),
    snapshot: async () => {
      const health = await printerHealth(config.printerName || '').catch(() => ({ name: config.printerName || '', state: 'unknown', detail: 'check_failed' }));
      const updateError = updater ? updater.status().lastError : null;
      return {
        kioskId: config.kioskId, version: currentVersion, channel: isValidChannel(config.updateChannel) ? config.updateChannel : 'stable',
        mode: config.mode, page: activity.page || '', startedAt,
        printerName: health.name, printerState: health.state, printerDetail: health.detail,
        paperRemaining: runtime.paper,
        lastError: runtime.lastError || (updateError ? `update: ${updateError}` : null), lastErrorAt: runtime.lastErrorAt,
      };
    },
  }).start();
}

const config = await loadConfig();
if (config) {
  await runKiosk(config);
} else {
  await runSetup();
}
