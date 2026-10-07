// Files that make up an installed kiosk (everything except node.exe and the launcher).
// Shared by the installer build and the signed-update publisher so both ship the same thing.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const root = join(import.meta.dirname, '..');

// YYYYMMDD.HHMMSS-<git sha>: sorts chronologically as a plain string.
export function makeVersion(now = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}.${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  let sha = '0000000';
  try {
    sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch { /* not a git checkout: keep the placeholder */ }
  return `${stamp}-${sha}`;
}

// URL + publishable key are public by design. Never reads or prints any secret key.
export function publicSupabaseDefaults() {
  let url = process.env.PB_DEV_SUPABASE_URL || '';
  let key = process.env.PB_PUBLISHABLE_KEY || process.env.PB_DEV_SUPABASE_PUBLISHABLE_KEY || '';
  const envFile = join(root, '.env.local');
  if (existsSync(envFile)) {
    const text = readFileSync(envFile, 'utf8');
    url = url || /^PB_DEV_SUPABASE_URL=(.+)$/m.exec(text)?.[1]?.trim() || '';
    if (!key.startsWith('sb_publishable_')) key = /^PB_DEV_SUPABASE_PUBLISHABLE_KEY=(sb_publishable_\S+)$/m.exec(text)?.[1] ?? '';
  }
  if (!url) {
    const ref = readFileSync(join(root, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
    url = `https://${ref}.supabase.co`;
  }
  if (!key.startsWith('sb_publishable_')) {
    // Fall back to the linked project: keep only the publishable key from the CLI output.
    const ref = url.replace(/^https:\/\/([^.]+)\..*$/, '$1');
    const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['supabase', 'projects', 'api-keys', '--project-ref', ref, '-o', 'json'],
      { cwd: root, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const keys = JSON.parse(out.slice(out.indexOf('[')));
    key = keys.map((k) => k.api_key).find((k) => typeof k === 'string' && k.startsWith('sb_publishable_')) ?? '';
  }
  if (!key) {
    console.error('No sb_publishable_ key found (set PB_PUBLISHABLE_KEY).');
    process.exit(1);
  }
  return { supabaseUrl: url, publishableKey: key };
}

// Copies agent/, bridge/, web/ (the production build) and version.json into `dest`.
export function stageAppFiles(dest, version) {
  if (!existsSync(join(root, 'dist-next', 'home.html'))) throw new Error('dist-next/home.html is missing; build first');
  if (!existsSync(join(root, 'agent', 'update-public-key.pem'))) {
    throw new Error('agent/update-public-key.pem is missing; run: node scripts/update-keygen.mjs');
  }
  mkdirSync(join(dest, 'agent'), { recursive: true });
  for (const file of readdirSync(join(root, 'agent'))) {
    if (/\.(mjs|html|pem)$/.test(file) && !/\.test\.mjs$/.test(file) && file !== 'setup.mjs' || file === 'reset-admin-pin.ps1') {
      cpSync(join(root, 'agent', file), join(dest, 'agent', file));
    }
  }
  writeFileSync(join(dest, 'agent', 'defaults.json'), JSON.stringify(publicSupabaseDefaults(), null, 2));
  cpSync(join(root, 'bridge'), join(dest, 'bridge'), { recursive: true });
  cpSync(join(root, 'dist-next'), join(dest, 'web'), { recursive: true });
  // The owner dashboard is a website, not part of the kiosk.
  rmSync(join(dest, 'web', 'dashboard.html'), { force: true });
  writeFileSync(join(dest, 'version.json'), JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2));
}
