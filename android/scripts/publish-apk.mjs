#!/usr/bin/env node
// Publishes the Android app for self-update (Updater.kt), like scripts/publish-update.mjs for Windows.
//   npm run android:publish                build the APK, upload it to the CANARY channel (main kiosk)
//   npm run android:publish -- --skip-build  upload the APK from the last `npm run android:build`
//   npm run android:promote                copy the canary release to STABLE (all other Android kiosks)
//   node android/scripts/publish-apk.mjs --status
// Phones poll <supabase>/storage/v1/object/public/updates/android/<channel>.json.
// The service-role key is read from the linked Supabase project at run time and never printed or stored.
// Trust: Android only installs an update signed with the same key as the installed app
// (%USERPROFILE%\.photobooth\android-release.jks), so the APK carries its own proof.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const args = new Set(process.argv.slice(2));
const isWindows = process.platform === 'win32';

// A git worktree has no supabase/.temp of its own: use the main checkout's linked project.
function projectDir() {
  if (existsSync(join(root, 'supabase', '.temp', 'project-ref'))) return root;
  const list = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const main = /^worktree (.+)$/m.exec(list)?.[1];
  if (main && existsSync(join(main, 'supabase', '.temp', 'project-ref'))) return main;
  throw new Error('no linked Supabase project (run `npx supabase link` in the main checkout)');
}
const projectRef = () => readFileSync(join(projectDir(), 'supabase', '.temp', 'project-ref'), 'utf8').trim();
const baseUrl = () => `https://${projectRef()}.supabase.co/storage/v1`;

function serviceKey() {
  const out = execFileSync(isWindows ? 'npx.cmd' : 'npx',
    ['supabase', 'projects', 'api-keys', '--project-ref', projectRef(), '-o', 'json'],
    { cwd: projectDir(), encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
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

// Unique query string: the CDN may otherwise return a stale manifest.
async function readPublic(path) {
  const res = await fetch(`${baseUrl()}/object/public/updates/${path}?t=${Date.now()}`, { cache: 'no-store' });
  return res.ok ? res : null;
}

if (args.has('--status')) {
  for (const channel of ['canary', 'stable']) {
    const res = await readPublic(`android/${channel}.json`);
    const m = res ? await res.json() : null;
    console.log(`${channel.padEnd(7)} ${m ? `${m.versionName} (code ${m.versionCode})` : '(none)'}`);
  }
  process.exit(0);
}

if (args.has('--promote')) {
  const res = await readPublic('android/canary.json');
  if (!res) throw new Error('nothing on the Android canary channel to promote');
  const manifest = await res.json();
  if (!(await readPublic(manifest.path))) throw new Error('the release APK is missing from storage');
  await upload(serviceKey(), 'android/stable.json', JSON.stringify(manifest, null, 2), 'application/json');
  console.log(`Promoted ${manifest.versionName} to STABLE. Other Android kiosks install it when they are idle.`);
  process.exit(0);
}

// ---- publish to canary
if (!args.has('--skip-build')) {
  execFileSync('npm', ['run', 'android:build'], { cwd: root, stdio: 'inherit', shell: isWindows });
}
const latestFile = join(root, 'dist-android', 'latest.json');
if (!existsSync(latestFile)) throw new Error('no APK built yet: run `npm run android:build`');
const latest = JSON.parse(readFileSync(latestFile, 'utf8'));
const bytes = readFileSync(latest.file);
const manifest = {
  versionCode: latest.versionCode,
  versionName: latest.versionName,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.length,
  path: `android/releases/${latest.versionCode}.apk`,
};

const key = serviceKey();
console.log(`==> uploading ${manifest.versionName} (code ${manifest.versionCode}, ${(manifest.size / 1048576).toFixed(1)} MB)`);
// The bucket accepts octet-stream (not the APK media type); phones only read the bytes.
await upload(key, manifest.path, bytes, 'application/octet-stream');
await upload(key, 'android/canary.json', JSON.stringify(manifest, null, 2), 'application/json');
console.log(`Published ${manifest.versionName} to the Android CANARY channel.`);
console.log('The main (canary) phone updates itself when idle. After checking it, run:');
console.log('  npm run android:promote');
