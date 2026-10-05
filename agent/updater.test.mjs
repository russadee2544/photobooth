import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { clientScript } from '../bridge/core.mjs';
import {
  compareVersions, createUpdater, readState, signedPayload, validateEntries, verifyManifest, writeState,
} from './updater.mjs';

const keys = generateKeyPairSync('ed25519');
const otherKeys = generateKeyPairSync('ed25519');
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
const root = mkdtempSync(join(tmpdir(), 'pb-updater-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const tarBin = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

function makeBundle(version, { badSyntax = false, extraTop = false, missingHome = false } = {}) {
  const src = mkdtempSync(join(root, 'src-'));
  mkdirSync(join(src, 'web'));
  mkdirSync(join(src, 'agent'));
  mkdirSync(join(src, 'bridge'));
  if (!missingHome) writeFileSync(join(src, 'web', 'home.html'), '<html></html>');
  writeFileSync(join(src, 'agent', 'server.mjs'), badSyntax ? 'const = ;' : 'export const ok = true;\n');
  writeFileSync(join(src, 'bridge', 'core.mjs'), 'export {};\n');
  writeFileSync(join(src, 'version.json'), JSON.stringify({ version }));
  const tops = ['web', 'agent', 'bridge', 'version.json'];
  if (extraTop) { mkdirSync(join(src, 'runtime')); writeFileSync(join(src, 'runtime', 'node.exe'), 'x'); tops.push('runtime'); }
  const archive = join(root, `${version}-${Math.random().toString(36).slice(2)}.tgz`);
  execFileSync(tarBin, ['-czf', archive, '-C', src, ...tops]);
  return readFileSync(archive);
}

function makeManifest(version, bytes, privateKey = keys.privateKey, overrides = {}) {
  const manifest = { version, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, ...overrides };
  manifest.signature = sign(null, Buffer.from(signedPayload(manifest)), privateKey).toString('base64');
  return manifest;
}

const fakeFetch = (manifest, bundle) => vi.fn(async (url) => {
  const body = String(url).includes('/manifest.json') ? Buffer.from(JSON.stringify(manifest)) : bundle;
  return { ok: !!body, status: body ? 200 : 404, json: async () => JSON.parse(body.toString()), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
});

function updaterFor(manifest, bundle, extra = {}) {
  const dataDir = mkdtempSync(join(root, 'data-'));
  const updater = createUpdater({
    appRoot: root, dataDir, baseUrl: 'https://x/updates', channel: 'stable', publicKeyPem: publicPem,
    currentVersion: '20260101.000000-aaaaaaa', fetchImpl: fakeFetch(manifest, bundle), ...extra,
  });
  return { updater, dataDir };
}

const NEW = '20261006.010101-bbbbbbb';

describe('version order and signature', () => {
  it('orders versions chronologically', () => {
    expect(compareVersions('20261006.010101-bbbbbbb', '20261005.235959-aaaaaaa')).toBe(1);
    expect(compareVersions('20261005.000000-aaaaaaa', '20261005.000000-aaaaaaa')).toBe(0);
  });

  it('accepts a manifest signed by the publisher key', () => {
    expect(verifyManifest(makeManifest(NEW, Buffer.from('abc')), publicPem)).toBe(true);
  });

  it('rejects a manifest signed by another key, or altered after signing', () => {
    const bytes = Buffer.from('abc');
    expect(verifyManifest(makeManifest(NEW, bytes, otherKeys.privateKey), publicPem)).toBe(false);
    const good = makeManifest(NEW, bytes);
    expect(verifyManifest({ ...good, size: good.size + 1 }, publicPem)).toBe(false);
    expect(verifyManifest({ ...good, version: '20261006.010102-bbbbbbb' }, publicPem)).toBe(false);
  });

  it('rejects malformed manifests', () => {
    expect(verifyManifest(null, publicPem)).toBe(false);
    expect(verifyManifest({ version: '../../evil', sha256: 'x', size: 1, signature: 'x' }, publicPem)).toBe(false);
  });
});

describe('bundle entries', () => {
  it('allows only the app folders', () => {
    expect(() => validateEntries(['web/', 'web/home.html', 'agent/server.mjs', 'bridge/core.mjs', 'version.json'])).not.toThrow();
    expect(() => validateEntries(['./web/home.html'])).not.toThrow();
  });
  it('rejects traversal, absolute paths and foreign folders', () => {
    for (const bad of ['../x', 'web/../../x', '/etc/passwd', 'C:/Windows/x', 'web\\..\\x', 'runtime/node.exe', 'launcher.ps1']) {
      expect(() => validateEntries([bad])).toThrow();
    }
    expect(() => validateEntries([])).toThrow();
  });
});

describe('update check', () => {
  it('stages a newer, correctly signed bundle', async () => {
    const bundle = makeBundle(NEW);
    const { updater, dataDir } = updaterFor(makeManifest(NEW, bundle), bundle);
    expect(await updater.check()).toEqual({ status: 'staged', version: NEW });
    expect(existsSync(join(dataDir, 'updates', 'pending', 'ready.flag'))).toBe(true);
    expect(existsSync(join(dataDir, 'updates', 'pending', 'web', 'home.html'))).toBe(true);
    expect(updater.status().pending).toBe(NEW);
  });

  it('does nothing when already current or newer', async () => {
    const bundle = makeBundle(NEW);
    const { updater } = updaterFor(makeManifest(NEW, bundle), bundle, { currentVersion: NEW });
    expect(await updater.check()).toEqual({ status: 'current' });
  });

  it('refuses a bundle whose bytes do not match the signed hash', async () => {
    const bundle = makeBundle(NEW);
    const manifest = makeManifest(NEW, bundle);
    const tampered = Buffer.concat([bundle, Buffer.from('x')]);
    const { updater, dataDir } = updaterFor({ ...manifest }, tampered);
    await expect(updater.check()).rejects.toThrow(/bad_size|bad_hash/);
    expect(existsSync(join(dataDir, 'updates', 'pending'))).toBe(false);
  });

  it('refuses an unsigned or wrongly signed manifest before downloading anything', async () => {
    const bundle = makeBundle(NEW);
    const { updater } = updaterFor(makeManifest(NEW, bundle, otherKeys.privateKey), bundle);
    await expect(updater.check()).rejects.toThrow('bad_signature');
  });

  it('rejects a signed bundle with unexpected folders', async () => {
    const bundle = makeBundle(NEW, { extraTop: true });
    const { updater } = updaterFor(makeManifest(NEW, bundle), bundle);
    await expect(updater.check()).rejects.toThrow(/unexpected_entry/);
  });

  it('throws away a bundle that fails the smoke test', async () => {
    const broken = makeBundle(NEW, { badSyntax: true });
    const first = updaterFor(makeManifest(NEW, broken), broken);
    await expect(first.updater.check()).rejects.toThrow();
    expect(existsSync(join(first.dataDir, 'updates', 'pending'))).toBe(false);

    const noHome = makeBundle(NEW, { missingHome: true });
    const second = updaterFor(makeManifest(NEW, noHome), noHome);
    await expect(second.updater.check()).rejects.toThrow();
  });

  it('skips a version the launcher already rolled back', async () => {
    const bundle = makeBundle(NEW);
    const { updater, dataDir } = updaterFor(makeManifest(NEW, bundle), bundle);
    await writeState(dataDir, { failed: [NEW] });
    expect(await updater.check()).toEqual({ status: 'skipped', version: NEW });
  });
});

describe('applying and confirming', () => {
  it('reads a state file written by PowerShell (UTF-8 with BOM)', async () => {
    const dataDir = mkdtempSync(join(root, 'bom-'));
    writeFileSync(join(dataDir, 'update-state.json'), '\uFEFF' + JSON.stringify({ pending: true, version: NEW, attempts: 1 }));
    expect(await readState(dataDir)).toMatchObject({ pending: true, version: NEW, attempts: 1 });
  });

  it('restarts only once the kiosk is idle', async () => {
    const bundle = makeBundle(NEW);
    let idle = false;
    const exit = vi.fn();
    const { updater } = updaterFor(makeManifest(NEW, bundle), bundle, { isIdle: () => idle, exit });
    await updater.check();
    const timer = updater.restartWhenIdle(10);
    await new Promise((r) => setTimeout(r, 40));
    expect(exit).not.toHaveBeenCalled();
    idle = true;
    await new Promise((r) => setTimeout(r, 40));
    expect(exit).toHaveBeenCalledWith(0);
    clearInterval(timer);
  });

  it('confirmHealthy clears the pending flag only for the running version', async () => {
    const bundle = makeBundle(NEW);
    const { updater, dataDir } = updaterFor(makeManifest(NEW, bundle), bundle, { currentVersion: NEW });
    await writeState(dataDir, { pending: true, version: NEW, attempts: 2 });
    await updater.confirmHealthy();
    expect(await readState(dataDir)).toMatchObject({ pending: false, attempts: 0 });

    await writeState(dataDir, { pending: true, version: '20270101.000000-ccccccc', attempts: 1 });
    await updater.confirmHealthy();
    expect((await readState(dataDir)).pending).toBe(true);
  });
});

describe('page reload on version change', () => {
  it('only reloads on the welcome page', () => {
    const js = clientScript({ endpoint: '/e', kioskId: 'k', packageId: '', groups: { A: ['x'] }, header: 'h', statusEndpoint: '/s' });
    const match = /\/\\\/\(home\\\.html\)\?\$\//.exec(js) || /(\/\\\/\(home\\\.html\)\?\$\/)/.exec(js);
    expect(match).not.toBeNull();
    const re = new RegExp(match[0].slice(1, -1));
    expect(['/', '/home.html'].every((p) => re.test(p))).toBe(true);
    expect(['/print.html', '/layout.html', '/admin.html'].some((p) => re.test(p))).toBe(false);
  });
});
