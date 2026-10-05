// Development-only stand-in for the Android native bridge (window.PhotoboothDevice).
// It runs inside `vite dev` only (apply: 'serve'), so nothing here reaches `vite build`.
//
// Secrets stay in this Node process and never reach the browser, mirroring the
// real agent: the device credential (from .env.local), the admin capability token
// returned by a PIN check, and raw redeem codes returned once by generation (kept
// in memory only so the admin screen can show them; lost on server restart).
//
// The bridge is installed only when .env.local is configured. Without it, plain
// localhost keeps the built-in local demo paths. It never changes kiosk settings
// such as the operating mode; it only fills in kiosk_id/package id when unset.
//
// Scope: payment-order, redeem-pass (claim/touch/reserve/pause), session-gif
// (ticket), admin-pin and admin-redeem (generate/list print passes).
// `start`/`report` and the printer are intentionally not exposed.
import { loadEnv } from 'vite';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ADMIN_SESSION_FALLBACK_MS = 15 * 60 * 1000;

function clientScript(config, methods) {
  return `(() => {
  const cfg = ${JSON.stringify({ configured: config.configured, kioskId: config.kioskId, packageId: config.packageId })};
  if (!cfg.configured) {
    console.info('[dev-bridge] not configured (see .env.example); using the built-in local demo paths');
    return;
  }
  try {
    if (localStorage.getItem('kiosk_id') !== cfg.kioskId) localStorage.setItem('kiosk_id', cfg.kioskId);
    if (cfg.packageId && !localStorage.getItem('kiosk_package_id')) localStorage.setItem('kiosk_package_id', cfg.packageId);
  } catch (_) {}
  const call = async (method, args) => {
    try {
      const res = await fetch('/__dev-bridge/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pb-dev-bridge': '1' },
        body: JSON.stringify({ method, args: args || {} }),
      });
      return await res.json();
    } catch (e) {
      return { error: 'network_error' };
    }
  };
  const bridge = {};
  for (const m of ${JSON.stringify(methods)}) bridge[m] = (args) => call(m, args);
  window.PhotoboothDevice = Object.freeze(bridge);
  console.info('[dev-bridge] simulated native bridge active for kiosk', cfg.kioskId);
})();`;
}

export function devBridgePlugin() {
  let config = { configured: false };
  let supabaseUrl = '';
  let publishableKey = '';
  let credential = '';
  // Admin capability from admin-pin; never sent to the browser.
  let admin = { token: '', expiresAt: 0 };
  // passId -> raw code, as returned once by generatePass.
  const rawCodes = new Map();

  async function callFunction(fn, body, extraHeaders = {}) {
    const upstream = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: publishableKey,
        'x-kiosk-credential': credential,
        ...extraHeaders,
      },
      body: JSON.stringify({ kioskId: config.kioskId, ...body }),
    });
    return upstream.json().catch(() => ({ error: 'bad_upstream_response' }));
  }

  const adminValid = () => admin.token && admin.expiresAt > Date.now();
  const keepCapability = (result) => {
    if (result?.capabilityToken) {
      const expires = Date.parse(result.expiresAt);
      admin = { token: result.capabilityToken, expiresAt: Number.isFinite(expires) ? expires : Date.now() + ADMIN_SESSION_FALLBACK_MS };
    }
  };
  const withAdmin = (body) => (adminValid()
    ? callFunction('admin-redeem', body, { 'x-admin-capability': admin.token })
    : Promise.resolve({ success: false, error: 'admin_capability_required' }));

  const HANDLERS = {
    listPassOffers: () => callFunction('payment-order', { operation: 'offers' }),
    createPaymentOrder: (a) => callFunction('payment-order', { operation: 'create', packageId: a.packageId, quotaKind: a.quotaKind }),
    getPaymentOrder: (a) => callFunction('payment-order', { operation: 'status', orderId: a.orderId }),
    cancelPaymentOrder: (a) => callFunction('payment-order', { operation: 'cancel', orderId: a.orderId }),
    claimPrintPass: (a) => callFunction('redeem-pass', { operation: 'claim', code: a.code, previousToken: a.previousToken ?? null }),
    touchPrintPass: (a) => callFunction('redeem-pass', { operation: 'touch', passId: a.passId, sessionToken: a.sessionToken }),
    reservePrintPass: (a) => callFunction('redeem-pass', {
      operation: 'reserve', passId: a.passId, sessionToken: a.sessionToken, jobId: a.jobId, assetSha256: a.assetSha256,
    }),
    pausePrintPass: (a) => callFunction('redeem-pass', { operation: 'pause', passId: a.passId, sessionToken: a.sessionToken }),
    issueGifUploadTicket: (a) => callFunction('session-gif', {
      operation: 'ticket', sessionId: a.sessionId, mode: a.mode, passId: a.passId ?? null,
      sessionToken: a.sessionToken ?? null, packageId: a.packageId ?? null,
    }),

    adminPinStatus: async () => {
      const status = await callFunction('admin-pin', { operation: 'status' });
      return { ...status, authenticated: !!adminValid(), expiresAt: adminValid() ? admin.expiresAt : null };
    },
    adminEnrollPin: async (a) => {
      const result = await callFunction('admin-pin', { operation: 'enroll', pin: a.pin });
      keepCapability(result);
      return result.success ? { success: true, expiresAt: admin.expiresAt } : { success: false, error: result.error };
    },
    adminVerifyPin: async (a) => {
      const result = await callFunction('admin-pin', { operation: 'verify', pin: a.pin });
      if (!result.valid) return { valid: false, error: result.error, lockedUntil: result.lockedUntil ?? null };
      keepCapability(result);
      return { valid: true, expiresAt: admin.expiresAt };
    },
    adminChangePin: async (a) => {
      const result = await callFunction('admin-pin', { operation: 'change', currentPin: a.currentPin, nextPin: a.nextPin });
      if (result.success) admin = { token: '', expiresAt: 0 };
      return result.success ? { success: true } : { success: false, error: result.error };
    },
    adminLogout: async () => {
      admin = { token: '', expiresAt: 0 };
      return { success: true };
    },
    generatePrintPasses: async (a) => {
      const result = await withAdmin({
        operation: 'generatePass', packageId: a.packageId || config.packageId,
        count: a.count, expiresDays: a.expiresDays, quotaKind: a.quotaKind,
      });
      if (!result.success) return { success: false, codes: [], batchId: null, error: result.error };
      for (const row of result.codes ?? []) rawCodes.set(row.passId, row.code);
      return { success: true, codes: (result.codes ?? []).map((row) => row.code), batchId: null, expiresAt: result.expiresAt };
    },
    listPrintPasses: async () => {
      const result = await withAdmin({ operation: 'listPass' });
      if (!result.success) return { success: false, codes: [], error: result.error };
      return {
        success: true,
        codes: (result.codes ?? []).map((row) => ({
          ...row,
          id: row.pass_id,
          code: rawCodes.get(row.pass_id) ?? null,
          is_used: row.quota_kind !== 'unlimited' && row.print_limit != null && row.used_prints >= row.print_limit,
        })),
      };
    },
  };

  return {
    name: 'dev-native-bridge',
    apply: 'serve',
    configResolved(resolved) {
      const env = loadEnv(resolved.mode, resolved.root, 'PB_DEV_');
      supabaseUrl = (env.PB_DEV_SUPABASE_URL || '').replace(/\/$/, '');
      publishableKey = env.PB_DEV_SUPABASE_PUBLISHABLE_KEY || '';
      credential = env.PB_DEV_DEVICE_CREDENTIAL || '';
      config = {
        kioskId: env.PB_DEV_KIOSK_ID || '',
        packageId: env.PB_DEV_PACKAGE_ID || '',
        configured: !!(supabaseUrl && publishableKey && credential && env.PB_DEV_KIOSK_ID),
      };
    },
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { src: '/__dev-bridge.js' }, injectTo: 'head-prepend' }];
    },
    configureServer(server) {
      const hostAllowed = (req) => {
        const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        return LOCAL_HOSTS.has(host);
      };

      server.middlewares.use('/__dev-bridge.js', (req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(hostAllowed(req) ? clientScript(config, Object.keys(HANDLERS)) : '');
      });

      server.middlewares.use('/__dev-bridge/call', (req, res) => {
        const reply = (status, body) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };
        // Loopback only, and a custom header so other web pages cannot drive it.
        if (req.method !== 'POST' || !hostAllowed(req) || req.headers['x-pb-dev-bridge'] !== '1') {
          return reply(403, { error: 'forbidden' });
        }
        if (!config.configured) return reply(200, { error: 'device_not_provisioned' });

        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 65536) req.destroy();
        });
        req.on('end', async () => {
          let payload;
          try {
            payload = JSON.parse(raw || '{}');
          } catch {
            return reply(400, { error: 'invalid_json' });
          }
          const handler = Object.hasOwn(HANDLERS, payload.method) ? HANDLERS[payload.method] : null;
          if (!handler) return reply(400, { error: 'unknown_method' });
          try {
            reply(200, await handler(payload.args || {}));
          } catch {
            reply(200, { error: 'network_error' });
          }
        });
      });
    },
  };
}
