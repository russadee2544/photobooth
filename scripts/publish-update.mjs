#!/usr/bin/env node
// Publishes a signed kiosk update.
//   node scripts/publish-update.mjs              build, sign, upload to the CANARY channel (main machine)
//   node scripts/publish-update.mjs --promote    copy the canary release to STABLE (all other kiosks)
//   node scripts/publish-update.mjs --status     show what each channel currently points at
//   node scripts/publish-update.mjs --skip-build reuse the existing dist-next
// Kiosks poll <supabase>/storage/v1/object/public/updates/<channel>/manifest.json.
// The service-role key is read from the linked Supabase project at run time and never printed or stored.
import { createPrivateKey, createHash, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeVersion, root, stageAppFiles } from '../installer/payload.mjs';
import { signedPayload, verifyManifest } from '../agent/updater.mjs';

const args = new Set(process.argv.slice(2));
const privateKeyPath = join(homedir(), '.photobooth', 'update-signing-key.pem');
const publicKeyPath = join(root, 'agent', 'update-public-key.pem');

function projectRef() {
  return readFileSync(join(root, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
}
const baseUrl = () => `https://${projectRef()}.supabase.co/storage/v1`;

function serviceKey() {
  const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['supabase', 'projects', 'api-keys', '--project-ref', projectRef(), '-o', 'json'],
    { cwd: root, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const keys = JSON.parse(out.slice(out.indexOf('[')));
  const key = keys.find((k) => k.name === 'service_role')?.api_key;
  if (!key) throw new Error('could not read the service key from the linked project');
  return key;
}

async function upload(key, path, body, contentType) {
  const res = await fetch(`${baseUrl()}/object/updates/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': contentType, 'x-upsert': 'true' },
    body,
  });
  if (!res.ok) throw new Error(`upload ${path} failed: ${res.status} ${await res.text()}`);
}

const publicUrl = (path) => `${baseUrl()}/object/public/updates/${path}`;

async function readPublic(path) {
  const res = await fetch(publicUrl(path), { cache: 'no-store' });
  return res.ok ? res : null;
}

if (args.has('--status')) {
  for (const channel of ['canary', 'stable']) {
    const res = await readPublic(`${channel}/manifest.json`);
    console.log(`${channel.padEnd(7)} ${res ? (await res.json()).version : '(none)'}`);
  }
  process.exit(0);
}

if (args.has('--promote')) {
  const res = await readPublic('canary/manifest.json');
  if (!res) throw new Error('nothing on the canary channel to promote');
  const manifest = await res.json();
  if (!verifyManifest(manifest, readFileSync(publicKeyPath, 'utf8'))) throw new Error('canary manifest signature is invalid');
  if (!(await readPublic(`releases/${manifest.version}.tgz`))) throw new Error('the release file is missing from storage');
  await upload(serviceKey(), 'stable/manifest.json', JSON.stringify(manifest, null, 2), 'application/json');
  console.log(`Promoted ${manifest.version} to STABLE. Other kiosks will pick it up when they are idle.`);
  process.exit(0);
}

// ---- publish to canary
if (!existsSync(privateKeyPath)) throw new Error(`signing key not found at ${privateKeyPath}; run: node scripts/update-keygen.mjs`);
if (!args.has('--skip-build')) {
  console.log('==> npm run build');
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
}

const version = makeVersion();
const work = join(tmpdir(), `pb-update-${version}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
stageAppFiles(join(work, 'bundle'), version);

const archive = join(work, `${version}.tgz`);
execFileSync(process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar',
  ['-czf', archive, '-C', join(work, 'bundle'), 'web', 'agent', 'bridge', 'version.json']);
const bytes = readFileSync(archive);
const manifest = {
  version,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: statSync(archive).size,
};
manifest.signature = sign(null, Buffer.from(signedPayload(manifest)), createPrivateKey(readFileSync(privateKeyPath))).toString('base64');
if (!verifyManifest(manifest, readFileSync(publicKeyPath, 'utf8'))) {
  throw new Error('the signature does not verify with agent/update-public-key.pem (wrong key pair?)');
}

const key = serviceKey();
console.log(`==> uploading ${version} (${(manifest.size / 1048576).toFixed(1)} MB)`);
await upload(key, `releases/${version}.tgz`, bytes, 'application/gzip');
await upload(key, 'canary/manifest.json', JSON.stringify(manifest, null, 2), 'application/json');
rmSync(work, { recursive: true, force: true });
console.log(`Published ${version} to CANARY.`);
console.log('The main (canary) kiosk updates itself when idle. After checking it, run:');
console.log('  node scripts/publish-update.mjs --promote');
