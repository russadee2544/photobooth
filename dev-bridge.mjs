// Development-only stand-in for the native bridge (window.PhotoboothDevice).
// It runs inside `vite dev` only (apply: 'serve'), so nothing here reaches `vite build`.
//
// Secrets stay in this Node process and never reach the browser (see bridge/core.mjs).
// The bridge is installed only when .env.local is configured. Without it, plain
// localhost keeps the built-in local demo paths. It never changes kiosk settings
// such as the operating mode; it only fills in kiosk_id/package id when unset.
//
// Printing is intentionally not exposed here; the Windows agent (agent/) provides it.
import { loadEnv } from 'vite';
import { createDeviceBridge, clientScript } from './bridge/core.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function devBridgePlugin() {
  let config = { configured: false };
  let handlers = {};

  return {
    name: 'dev-native-bridge',
    apply: 'serve',
    configResolved(resolved) {
      const env = loadEnv(resolved.mode, resolved.root, 'PB_DEV_');
      const supabaseUrl = (env.PB_DEV_SUPABASE_URL || '').replace(/\/$/, '');
      const publishableKey = env.PB_DEV_SUPABASE_PUBLISHABLE_KEY || '';
      const credential = env.PB_DEV_DEVICE_CREDENTIAL || '';
      config = {
        kioskId: env.PB_DEV_KIOSK_ID || '',
        packageId: env.PB_DEV_PACKAGE_ID || '',
        configured: !!(supabaseUrl && publishableKey && credential && env.PB_DEV_KIOSK_ID),
      };
      if (config.configured) {
        handlers = createDeviceBridge({
          supabaseUrl, publishableKey, credential, kioskId: config.kioskId, packageId: config.packageId,
        }).handlers;
      }
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
        if (!hostAllowed(req)) return res.end('');
        if (!config.configured) {
          return res.end("console.info('[dev-bridge] not configured (see .env.example); using the built-in local demo paths');");
        }
        res.end(clientScript({
          endpoint: '/__dev-bridge/call', kioskId: config.kioskId, packageId: config.packageId,
          groups: { PhotoboothDevice: Object.keys(handlers) }, header: 'x-pb-dev-bridge',
        }));
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
          const handler = Object.hasOwn(handlers, payload.method) ? handlers[payload.method] : null;
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
