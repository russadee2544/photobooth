// iPad (or any tablet) as the customer screen of this PC kiosk, over the shop's Wi-Fi.
//
//   http://<pc>.local:8080/          how to trust this PC's certificate + the certificate itself
//   https://<pc>.local:8443/pair?... one-time code from the admin page -> long-lived screen cookie
//   https://<pc>.local:8443/*        the kiosk pages and bridge, exactly as on the PC itself
//
// Only private-network addresses get an answer, and every HTTPS request needs a paired screen's
// cookie, so another phone on the same Wi-Fi cannot print or reach the bridge. The device
// credential never leaves the agent; a paired screen is one more browser in front of it.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { hostname as osHostname, networkInterfaces } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCa, derOf, issueServerCert, SERVER_DAYS } from './certs.mjs';

export const HTTPS_PORT = 8443;
export const HTTP_PORT = 8080;
export const COOKIE = 'pb_screen';
const DAY = 24 * 60 * 60 * 1000;
const PAIR_TTL_MS = 5 * 60 * 1000;
const PAIR_MAX_FAILURES = 5;

// ---- who may connect ----------------------------------------------------------------------
export function isLanAddress(address) {
  const ip = String(address || '').replace(/^::ffff:/i, '');
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || /^fe[89ab][0-9a-f]:/.test(lower) || /^f[cd][0-9a-f]{2}:/.test(lower);
}

// This PC's names on the shop network: <host>.local (found by iPads through mDNS), <host>, LAN IPv4s.
export function localNames({ host = osHostname(), interfaces = networkInterfaces() } = {}) {
  const name = String(host).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'photobooth';
  const ips = [];
  for (const list of Object.values(interfaces || {})) {
    for (const entry of list || []) {
      if ((entry.family === 'IPv4' || entry.family === 4) && !entry.internal && isLanAddress(entry.address)) ips.push(entry.address);
    }
  }
  return { host: name, dnsNames: [`${name}.local`, name], ips: [...new Set(ips)].sort() };
}

export function hostAllowed(hostHeader, names) {
  const host = String(hostHeader || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return names.dnsNames.includes(host) || names.ips.includes(host);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---- pairing --------------------------------------------------------------------------------
// One six-digit code at a time, valid 5 minutes, used once; five wrong tries end it.
export function createPairings({ now = Date.now } = {}) {
  let current = null;
  return {
    start() {
      current = { code: String(randomInt(0, 1_000_000)).padStart(6, '0'), expiresAt: now() + PAIR_TTL_MS, failures: 0 };
      return { code: current.code, expiresAt: new Date(current.expiresAt).toISOString() };
    },
    redeem(code) {
      if (!current || now() > current.expiresAt) { current = null; return false; }
      const given = String(code || '');
      if (/^\d{6}$/.test(given) && timingSafeEqual(Buffer.from(given), Buffer.from(current.code))) { current = null; return true; }
      if (++current.failures >= PAIR_MAX_FAILURES) current = null;
      return false;
    },
  };
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// Paired screens, kept in the agent config (only token hashes are stored). `save` persists the list.
export function createScreenRegistry({ devices = [], save = async () => {}, now = Date.now } = {}) {
  let list = devices.filter((d) => d && typeof d.id === 'string' && /^[0-9a-f]{64}$/.test(d.tokenHash || ''));
  const lastSeen = new Map();
  const persist = () => save(list.map((d) => ({ ...d })));
  return {
    async pair(name) {
      const token = randomBytes(32).toString('base64url');
      const device = { id: randomBytes(8).toString('hex'), name: String(name || 'iPad').slice(0, 60), tokenHash: hashToken(token), pairedAt: new Date(now()).toISOString() };
      list = [...list, device];
      await persist();
      return { id: device.id, token };
    },
    find(token) {
      if (!token) return null;
      const wanted = Buffer.from(hashToken(token), 'hex');
      const device = list.find((d) => timingSafeEqual(Buffer.from(d.tokenHash, 'hex'), wanted)) || null;
      if (device) lastSeen.set(device.id, new Date(now()).toISOString());
      return device;
    },
    async revoke(id) {
      const before = list.length;
      list = list.filter((d) => d.id !== id);
      if (list.length !== before) await persist();
      return list.length !== before;
    },
    list: () => list.map(({ id, name, pairedAt }) => ({ id, name, pairedAt, lastSeen: lastSeen.get(id) || null })),
  };
}

// ---- certificates --------------------------------------------------------------------------
// The CA is made once and kept (the iPad trusts it); the HTTPS certificate is re-issued when this
// PC's names/IPs change or it is 100 days from expiring. Private keys are stored DPAPI-protected.
export async function ensureCertificates({ dir, names, protect, unprotect, now = Date.now }) {
  await mkdir(dir, { recursive: true });
  const read = (file) => readFile(join(dir, file), 'utf8').catch(() => null);
  let caPem = await read('ca.pem');
  let caKeyPem = caPem ? await read('ca-key.enc').then((b) => (b ? unprotect(b.trim()) : null)) : null;
  let caLabel = caPem ? (await read('ca.json').then((t) => JSON.parse(t || '{}')).catch(() => ({}))).label : null;
  if (!caPem || !caKeyPem || !caLabel) {
    caLabel = names.host;
    const ca = createCa(caLabel);
    caPem = ca.certPem;
    caKeyPem = ca.keyPem;
    await writeFile(join(dir, 'ca-key.enc'), await protect(caKeyPem));
    await writeFile(join(dir, 'ca.pem'), caPem);
    await writeFile(join(dir, 'ca.json'), JSON.stringify({ label: caLabel, createdAt: new Date(now()).toISOString() }, null, 2));
  }

  const meta = await read('server.json').then((t) => JSON.parse(t || 'null')).catch(() => null);
  let certPem = await read('server.pem');
  let keyPem = certPem && meta ? await read('server-key.enc').then((b) => (b ? unprotect(b.trim()) : null)) : null;
  const sameNames = meta && JSON.stringify(meta.dnsNames) === JSON.stringify(names.dnsNames) && JSON.stringify(meta.ips) === JSON.stringify(names.ips);
  const fresh = meta && now() - Date.parse(meta.issuedAt) < (SERVER_DAYS - 100) * DAY;
  if (!certPem || !keyPem || !sameNames || !fresh || meta.caLabel !== caLabel) {
    const server = issueServerCert({ caKeyPem, caLabel, dnsNames: names.dnsNames, ips: names.ips });
    certPem = server.certPem;
    keyPem = server.keyPem;
    await writeFile(join(dir, 'server-key.enc'), await protect(keyPem));
    await writeFile(join(dir, 'server.pem'), certPem);
    await writeFile(join(dir, 'server.json'), JSON.stringify({ dnsNames: names.dnsNames, ips: names.ips, caLabel, issuedAt: new Date(now()).toISOString() }, null, 2));
  }
  return { key: keyPem, cert: certPem + caPem, caDer: derOf(caPem) };
}

// ---- pages for the iPad before it is paired ---------------------------------------------------
const page = (title, body) => `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;padding:32px 20px;font:18px/1.6 system-ui,sans-serif;background:#f6f4ee;color:#1b1a17}
main{max-width:560px;margin:auto}h1{font-size:1.5rem}ol{padding-left:1.2em}li{margin:10px 0}
a.button{display:block;margin:20px 0;padding:16px;border-radius:12px;background:#1b1a17;color:#f6f4ee;text-align:center;text-decoration:none;font-weight:700}
small{color:#6b675d}</style></head><body><main>${body}</main></body></html>`;

function setupPage(names) {
  const https = `https://${names.dnsNames[0]}:${HTTPS_PORT}/home.html`;
  return page('เชื่อมต่อ iPad กับตู้ Photobooth', `<h1>เชื่อมต่อ iPad กับตู้ Photobooth</h1>
<p>ทำครั้งเดียวต่อ iPad (ใช้ Safari)</p>
<ol>
<li>กดปุ่มด้านล่าง แล้วเลือก <b>อนุญาต</b> เพื่อดาวน์โหลดโปรไฟล์</li>
<li>เปิด <b>การตั้งค่า</b> → <b>ดาวน์โหลดโปรไฟล์แล้ว</b> → <b>ติดตั้ง</b></li>
<li><b>การตั้งค่า</b> → <b>ทั่วไป</b> → <b>เกี่ยวกับ</b> → <b>การตั้งค่าความเชื่อถือใบรับรอง</b> → เปิดสวิตช์ของ <b>${names.host} (Photobooth CA)</b></li>
<li>กลับมาที่หน้าแอดมินบน PC กด <b>สร้าง QR จับคู่</b> แล้วสแกนด้วยกล้อง iPad</li>
</ol>
<a class="button" href="/ca.cer">ดาวน์โหลดใบรับรองของ PC เครื่องนี้</a>
<small>หลังจับคู่แล้ว หน้าตู้อยู่ที่ ${https}</small>`);
}

const notPairedPage = () => page('ยังไม่ได้จับคู่', `<h1>iPad เครื่องนี้ยังไม่ได้จับคู่กับตู้</h1>
<p>ที่ PC: หน้าแอดมิน → <b>เชื่อมต่อ iPad</b> → <b>สร้าง QR จับคู่</b> แล้วสแกน QR ด้วยกล้อง iPad</p>`);

const badCodePage = () => page('จับคู่ไม่สำเร็จ', `<h1>รหัสจับคู่ไม่ถูกต้องหรือหมดอายุ</h1>
<p>ที่ PC กด <b>สร้าง QR จับคู่</b> ใหม่ แล้วสแกนอีกครั้ง (รหัสใช้ได้ 5 นาที ครั้งเดียว)</p>`);

function screenName(userAgent) {
  const ua = String(userAgent || '');
  const kind = /iPad|Macintosh/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'จอเสริม';
  return `${kind} ${new Date().toLocaleDateString('th-TH')}`;
}

// ---- servers --------------------------------------------------------------------------------
// `handle(req, res, screenId)` is the agent's normal router (the same one the PC screen uses).
export function startRemoteScreen({ handle, registry, pairings, certs, names, log = () => {}, httpsPort = HTTPS_PORT, httpPort = HTTP_PORT, listenHost = '0.0.0.0' }) {
  const send = (res, status, type, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };
  const html = (res, status, body) => send(res, status, 'text/html; charset=utf-8', body);
  const refuse = (req, res) => {
    if (!isLanAddress(req.socket.remoteAddress)) { req.socket.destroy(); return true; }
    if (!hostAllowed(req.headers.host, names)) { send(res, 421, 'text/plain', 'wrong host'); return true; }
    return false;
  };

  const secure = createHttpsServer({ key: certs.key, cert: certs.cert }, async (req, res) => {
    if (refuse(req, res)) return;
    const url = new URL(req.url, 'https://screen.local');
    if (url.pathname === '/pair') {
      if (!pairings.redeem(url.searchParams.get('code'))) return html(res, 403, badCodePage());
      const { id, token } = await registry.pair(screenName(req.headers['user-agent']));
      log(`screen paired: ${id}`);
      res.writeHead(302, {
        Location: '/home.html', 'Cache-Control': 'no-store',
        'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=${5 * 365 * 24 * 3600}; Secure; HttpOnly; SameSite=Strict`,
      });
      return res.end();
    }
    const device = registry.find(parseCookies(req.headers.cookie)[COOKIE]);
    if (!device) {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname.endsWith('.html'))) return html(res, 401, notPairedPage());
      return send(res, 401, 'application/json; charset=utf-8', JSON.stringify({ error: 'screen_not_paired' }));
    }
    try {
      await handle(req, res, device.id);
    } catch {
      if (!res.headersSent) send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'agent_error' }));
    }
  });

  // Plain HTTP only hands out the certificate and the instructions; nothing else lives here.
  const plain = createHttpServer((req, res) => {
    if (refuse(req, res)) return;
    const { pathname } = new URL(req.url, 'http://screen.local');
    if (pathname === '/ca.cer') {
      return send(res, 200, 'application/x-x509-ca-cert', certs.caDer, { 'Content-Disposition': 'attachment; filename="photobooth-pc.cer"' });
    }
    if (pathname === '/') return html(res, 200, setupPage(names));
    res.writeHead(302, { Location: '/' });
    res.end();
  });

  const listen = (server, port) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, listenHost, () => { server.off('error', reject); resolve(); });
  });

  return {
    ready: Promise.all([listen(secure, httpsPort), listen(plain, httpPort)]),
    ports: () => ({ https: secure.address()?.port, http: plain.address()?.port }),
    urls: {
      setup: names.dnsNames.slice(0, 1).concat(names.ips).map((h) => `http://${h}:${httpPort}/`),
      pair: (code) => names.dnsNames.slice(0, 1).concat(names.ips).map((h) => `https://${h}:${httpsPort}/pair?code=${code}`),
    },
    close() {
      secure.closeAllConnections?.();
      plain.closeAllConnections?.();
      return Promise.all([new Promise((r) => secure.close(() => r())), new Promise((r) => plain.close(() => r()))]);
    },
  };
}
