import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COOKIE, createPairings, createScreenRegistry, ensureCertificates, hostAllowed, isLanAddress, localNames,
  parseCookies, startRemoteScreen,
} from './remote-screen.mjs';

// Stand-in for DPAPI: the tests only need protect/unprotect to round-trip.
const protect = async (text) => Buffer.from(text).toString('base64');
const unprotect = async (b64) => Buffer.from(b64, 'base64').toString();

describe('who may connect', () => {
  it('answers only private network addresses', () => {
    for (const ip of ['192.168.1.20', '10.0.0.5', '172.20.1.1', '127.0.0.1', '::ffff:192.168.0.9', 'fe80::1', 'fd12::1']) expect(isLanAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '::ffff:1.1.1.1', '2001:db8::1', '']) expect(isLanAddress(ip)).toBe(false);
  });

  it('knows this PC by <host>.local, <host> and its LAN IPs', () => {
    const names = localNames({ host: 'BOOTH_PC', interfaces: {
      wifi: [{ family: 'IPv4', address: '192.168.1.20', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
      loop: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      vpn: [{ family: 'IPv4', address: '100.70.1.2', internal: false }],
    } });
    expect(names).toEqual({ host: 'booth-pc', dnsNames: ['booth-pc.local', 'booth-pc'], ips: ['192.168.1.20'] });
    expect(hostAllowed('booth-pc.local:8443', names)).toBe(true);
    expect(hostAllowed('192.168.1.20:8443', names)).toBe(true);
    expect(hostAllowed('evil.example', names)).toBe(false);
  });

  it('reads cookies', () => {
    expect(parseCookies('a=1; pb_screen=abc%3D; b=2')).toEqual({ a: '1', pb_screen: 'abc=', b: '2' });
  });
});

describe('pairing', () => {
  it('accepts a code once, before it expires', () => {
    let now = 0;
    const pairings = createPairings({ now: () => now });
    const { code } = pairings.start();
    expect(code).toMatch(/^\d{6}$/);
    expect(pairings.redeem(code)).toBe(true);
    expect(pairings.redeem(code)).toBe(false);
    const second = pairings.start().code;
    now = 6 * 60 * 1000;
    expect(pairings.redeem(second)).toBe(false);
  });

  it('ends a code after five wrong tries', () => {
    const pairings = createPairings();
    const { code } = pairings.start();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect(pairings.redeem(wrong)).toBe(false);
    expect(pairings.redeem(code)).toBe(false);
    expect(pairings.redeem('ไทย')).toBe(false);
  });

  it('stores only token hashes and can revoke a screen', async () => {
    let saved = [];
    const registry = createScreenRegistry({ save: async (list) => { saved = list; } });
    const { id, token } = await registry.pair('iPad test');
    expect(JSON.stringify(saved)).not.toContain(token);
    expect(registry.find(token)?.id).toBe(id);
    expect(registry.find('nope')).toBeNull();
    expect(await registry.revoke(id)).toBe(true);
    expect(registry.find(token)).toBeNull();
    expect(saved).toEqual([]);
  });
});

describe('certificates on disk', () => {
  let dir;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'pb-remote-')); });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('keeps the CA and re-issues the HTTPS certificate when the IP changes', async () => {
    const first = await ensureCertificates({ dir, names: { host: 'pc', dnsNames: ['pc.local', 'pc'], ips: ['192.168.1.20'] }, protect, unprotect });
    const again = await ensureCertificates({ dir, names: { host: 'pc', dnsNames: ['pc.local', 'pc'], ips: ['192.168.1.20'] }, protect, unprotect });
    expect(again.cert).toBe(first.cert);
    const moved = await ensureCertificates({ dir, names: { host: 'pc', dnsNames: ['pc.local', 'pc'], ips: ['192.168.1.77'] }, protect, unprotect });
    expect(moved.caDer.equals(first.caDer)).toBe(true);
    expect(new X509Certificate(moved.cert).checkIP('192.168.1.77')).toBe('192.168.1.77');
  });
});

describe('the iPad servers', () => {
  const names = { host: 'test-pc', dnsNames: ['test-pc.local', 'test-pc'], ips: ['127.0.0.1'] };
  let dir, remote, certs, ca, pairings, seen;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pb-remote-srv-'));
    certs = await ensureCertificates({ dir, names, protect, unprotect });
    ca = new X509Certificate(certs.caDer).toString();
    pairings = createPairings();
    seen = [];
    remote = startRemoteScreen({
      handle: async (req, res, screen) => { seen.push(screen); res.end(`ok ${screen}`); },
      registry: createScreenRegistry(), pairings, certs, names, httpsPort: 0, httpPort: 0, listenHost: '127.0.0.1',
    });
    await remote.ready;
  });
  afterAll(async () => { await remote.close(); await rm(dir, { recursive: true, force: true }); });

  const get = (path, { cookie, host = 'test-pc.local' } = {}) => new Promise((resolve, reject) => {
    const req = httpsRequest({ host: '127.0.0.1', port: remote.ports().https, path, servername: 'test-pc.local', ca,
      headers: { host, ...(cookie ? { cookie } : {}) } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });

  it('serves HTTPS that verifies against the PC certificate', async () => {
    expect((await get('/home.html')).status).toBe(401);
  });

  it('refuses pages and bridge calls from a screen that is not paired', async () => {
    expect((await get('/home.html')).body).toContain('ยังไม่ได้จับคู่');
    expect((await get('/__bridge/call')).body).toContain('screen_not_paired');
    expect(seen).toEqual([]);
  });

  it('refuses a wrong host name', async () => {
    expect((await get('/home.html', { host: 'evil.example' })).status).toBe(421);
  });

  it('pairs with a one-time code and then lets the screen through as itself', async () => {
    expect((await get('/pair?code=999999x')).status).toBe(403);
    const { code } = pairings.start();
    const paired = await get(`/pair?code=${code}`);
    expect(paired.status).toBe(302);
    const cookie = paired.headers['set-cookie'][0];
    expect(cookie).toMatch(/Secure; HttpOnly; SameSite=Strict/);
    const token = cookie.split(';')[0];
    const res = await get('/home.html', { cookie: token });
    expect(res.body).toMatch(/^ok [0-9a-f]{16}$/);
    expect(seen[0]).not.toBe('local');
    expect((await get(`/pair?code=${code}`)).status).toBe(403);   // used once
    expect(token.startsWith(`${COOKIE}=`)).toBe(true);
  });

  it('hands out the CA certificate over plain HTTP, and nothing else', async () => {
    const plain = (path) => new Promise((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port: remote.ports().http, path, headers: { host: 'test-pc.local' } }, (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject).end();
    });
    const cer = await plain('/ca.cer');
    expect(cer.headers['content-type']).toBe('application/x-x509-ca-cert');
    expect(cer.body.equals(certs.caDer)).toBe(true);
    expect((await plain('/')).body.toString()).toContain('ดาวน์โหลดใบรับรอง');
    expect((await plain('/home.html')).status).toBe(302);
  });
});
