// Signed self-update for the kiosk agent.
//
// Flow: poll <base>/<channel>/manifest.json -> verify the Ed25519 signature -> download the
// bundle -> check size + sha256 -> unpack into a staging folder -> smoke-test -> mark it
// "pending". The launcher (installer/launcher.ps1) swaps web/, agent/ and bridge/ while the
// agent is NOT running, restarts it, and rolls back if the new version keeps crashing.
// Nothing that is not signed by the publisher's private key is ever unpacked.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const VERSION_RE = /^\d{8}\.\d{6}-[0-9a-f]{7}$/;
const CHANNELS = new Set(['canary', 'stable']);
const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;
const ALLOWED_TOP = new Set(['web', 'agent', 'bridge', 'version.json']);
const REQUIRED_FILES = ['web/home.html', 'agent/server.mjs', 'bridge/core.mjs', 'version.json'];

// Versions are YYYYMMDD.HHMMSS-<sha>, so plain string order is chronological order.
export const compareVersions = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function signedPayload({ version, sha256, size }) {
  return `${version}\n${sha256}\n${size}`;
}

export function verifyManifest(manifest, publicKeyPem) {
  try {
    if (!manifest || !VERSION_RE.test(manifest.version) || !/^[0-9a-f]{64}$/.test(manifest.sha256)
        || !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || manifest.size > MAX_BUNDLE_BYTES
        || typeof manifest.signature !== 'string') return false;
    return verify(null, Buffer.from(signedPayload(manifest)), createPublicKey(publicKeyPem),
      Buffer.from(manifest.signature, 'base64'));
  } catch {
    return false;
  }
}

// Reject anything that could escape the staging folder or touch other parts of the install.
export function validateEntries(entries) {
  if (!entries.length) throw new Error('empty_bundle');
  for (const raw of entries) {
    const entry = raw.replace(/^\.\//, '');
    if (!entry || entry.startsWith('/') || entry.includes('\\') || /^[A-Za-z]:/.test(entry)
        || entry.split('/').includes('..')) throw new Error(`unsafe_entry:${raw}`);
    if (!ALLOWED_TOP.has(entry.split('/')[0])) throw new Error(`unexpected_entry:${raw}`);
  }
}

function tarBinary() {
  return process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
}

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...options }, (error, stdout) =>
      (error ? reject(error) : resolve(String(stdout))));
  });
}

export async function listBundle(file) {
  const out = await run(tarBinary(), ['-tzf', file]);
  return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export async function extractBundle(file, destDir) {
  await mkdir(destDir, { recursive: true });
  await run(tarBinary(), ['-xzf', file, '-C', destDir]);
}

export async function readState(dataDir) {
  // PowerShell 5 writes JSON with a UTF-8 BOM; JSON.parse rejects it.
  try { return JSON.parse((await readFile(join(dataDir, 'update-state.json'), 'utf8')).replace(/^\uFEFF/, '')); } catch { return {}; }
}
export async function writeState(dataDir, state) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'update-state.json'), JSON.stringify(state, null, 2));
}

export async function readInstalledVersion(appRoot) {
  try { return JSON.parse(await readFile(join(appRoot, 'version.json'), 'utf8')).version || 'dev'; } catch { return 'dev'; }
}

export function createUpdater({
  appRoot, dataDir, baseUrl, channel, publicKeyPem, currentVersion, execPath = process.execPath,
  isIdle = () => true, exit = (code) => process.exit(code), log = () => {}, fetchImpl = fetch,
}) {
  const stagingRoot = join(dataDir, 'updates');
  let checking = false;
  let pendingVersion = null;
  let lastError = null;

  async function fetchManifest() {
    const res = await fetchImpl(`${baseUrl}/${channel}/manifest.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`manifest_http_${res.status}`);
    return res.json();
  }

  async function smokeTest(dir) {
    for (const rel of REQUIRED_FILES) await access(join(dir, rel));
    // The new agent must at least parse; a broken bundle is thrown away before it can run.
    await run(execPath, ['--check', join(dir, 'agent', 'server.mjs')]);
  }

  // Returns { status: 'current' | 'staged' | 'skipped', version? } or throws.
  async function check() {
    if (checking || pendingVersion) return { status: pendingVersion ? 'staged' : 'busy', version: pendingVersion };
    checking = true;
    try {
      const manifest = await fetchManifest();
      if (!verifyManifest(manifest, publicKeyPem)) throw new Error('bad_signature');
      if (compareVersions(manifest.version, currentVersion) <= 0) return { status: 'current' };
      const state = await readState(dataDir);
      if ((state.failed || []).includes(manifest.version)) return { status: 'skipped', version: manifest.version };

      const res = await fetchImpl(`${baseUrl}/releases/${manifest.version}.tgz`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`bundle_http_${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length !== manifest.size) throw new Error('bad_size');
      if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('bad_hash');

      const work = join(stagingRoot, 'work');
      await rm(work, { recursive: true, force: true });
      await mkdir(work, { recursive: true });
      const archive = join(work, 'bundle.tgz');
      await writeFile(archive, bytes);
      validateEntries(await listBundle(archive));
      const unpacked = join(work, 'unpacked');
      await extractBundle(archive, unpacked);
      await smokeTest(unpacked);

      const pending = join(stagingRoot, 'pending');
      await rm(pending, { recursive: true, force: true });
      await rename(unpacked, pending);
      await rm(work, { recursive: true, force: true });
      await writeFile(join(pending, 'ready.flag'), manifest.version);
      pendingVersion = manifest.version;
      log(`update ${manifest.version} staged`);
      return { status: 'staged', version: manifest.version };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      log(`update check failed: ${lastError}`);
      throw error;
    } finally {
      checking = false;
    }
  }

  // Once something is staged, restart as soon as the kiosk is idle so the launcher can apply it.
  function restartWhenIdle(everyMs = 15_000) {
    const timer = setInterval(() => {
      if (pendingVersion && isIdle()) {
        clearInterval(timer);
        log(`restarting to apply ${pendingVersion}`);
        exit(0);
      }
    }, everyMs);
    timer.unref?.();
    return timer;
  }

  // The agent proved itself healthy: stop the launcher from rolling this version back.
  async function confirmHealthy() {
    const state = await readState(dataDir);
    if (state.pending && state.version === currentVersion) {
      await writeState(dataDir, { ...state, pending: false, attempts: 0, confirmedAt: new Date().toISOString() });
    }
  }

  return {
    check, restartWhenIdle, confirmHealthy,
    status: () => ({ version: currentVersion, channel, pending: pendingVersion, lastError }),
  };
}

export const isValidChannel = (channel) => CHANNELS.has(channel);
