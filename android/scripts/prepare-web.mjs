// Copies the kiosk pages (`vite build` output, dist-next) and the bridge scripts into the
// Android app's assets. Run by build-apk.mjs; the assets folder is generated, never committed.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { bridgeClientTemplate, bridgeShim } from './bridge-client.mjs';

const root = join(import.meta.dirname, '..', '..');
const web = join(root, 'dist-next');
const assets = join(root, 'android', 'app', 'src', 'main', 'assets');

// A git worktree has no supabase/.temp of its own: borrow the main checkout's linked project.
function linkProjectFromMainCheckout() {
  if (process.env.PB_DEV_SUPABASE_URL || existsSync(join(root, '.env.local')) || existsSync(join(root, 'supabase', '.temp', 'project-ref'))) return;
  try {
    const list = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
    const main = /^worktree (.+)$/m.exec(list)?.[1];
    const ref = main && readFileSync(join(main, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
    if (ref) process.env.PB_DEV_SUPABASE_URL = `https://${ref}.supabase.co`;
  } catch { /* publicSupabaseDefaults explains what is missing */ }
}

export async function prepareWeb() {
  if (!existsSync(join(web, 'home.html'))) throw new Error('dist-next/home.html missing: run `npm run build` first');
  linkProjectFromMainCheckout();
  const { publicSupabaseDefaults } = await import('../../installer/payload.mjs');
  const defaults = publicSupabaseDefaults();

  rmSync(assets, { recursive: true, force: true });
  mkdirSync(join(assets, 'pb'), { recursive: true });
  cpSync(web, join(assets, 'www'), { recursive: true });
  writeFileSync(join(assets, 'pb', 'bridge-shim.js'), bridgeShim());
  writeFileSync(join(assets, 'pb', 'bridge-client.js'), bridgeClientTemplate());
  cpSync(join(root, 'android', 'web', 'setup.html'), join(assets, 'pb', 'setup.html'));
  // URL + publishable key are public by design; no secret ever goes into the APK.
  writeFileSync(join(assets, 'pb', 'defaults.json'), JSON.stringify(defaults, null, 2));
  return defaults;
}

if (process.argv[1]?.endsWith('prepare-web.mjs')) {
  const defaults = await prepareWeb();
  console.log(`assets ready (${defaults.supabaseUrl})`);
}
