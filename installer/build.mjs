// Builds dist-installer/PhotoboothSetup.exe:
//   node installer/build.mjs [--skip-build]
// 1. production build of the kiosk (dist-next)  2. stage runtime + agent + web
// 3. compile installer/photobooth.iss with Inno Setup (ISCC).
// Inno Setup 6 is a build-time tool only; the installed kiosk does not need it, nor Node.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const stage = join(root, 'installer', 'stage');
const skipBuild = process.argv.includes('--skip-build');

function findIscc() {
  const candidates = [
    process.env.ISCC_PATH,
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6', 'ISCC.exe'),
    join(process.env.ProgramFiles || '', 'Inno Setup 6', 'ISCC.exe'),
  ];
  return candidates.find((p) => p && existsSync(p));
}

// URL + publishable key are public by design. Never reads or prints any secret key.
function publicSupabaseDefaults() {
  let url = process.env.PB_DEV_SUPABASE_URL || "";
  let key = process.env.PB_PUBLISHABLE_KEY || process.env.PB_DEV_SUPABASE_PUBLISHABLE_KEY || "";
  const envFile = join(root, ".env.local");
  if (existsSync(envFile)) {
    const text = readFileSync(envFile, "utf8");
    url = url || /^PB_DEV_SUPABASE_URL=(.+)$/m.exec(text)?.[1]?.trim() || "";
    if (!key.startsWith("sb_publishable_")) key = /^PB_DEV_SUPABASE_PUBLISHABLE_KEY=(sb_publishable_\S+)$/m.exec(text)?.[1] ?? "";
  }
  if (!url) {
    const ref = readFileSync(join(root, "supabase", ".temp", "project-ref"), "utf8").trim();
    url = `https://${ref}.supabase.co`;
  }
  if (!key.startsWith("sb_publishable_")) {
    // Fall back to the linked project: keep only the publishable key from the CLI output.
    const ref = url.replace(/^https:\/\/([^.]+)\..*$/, "$1");
    const out = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["supabase", "projects", "api-keys", "--project-ref", ref, "-o", "json"],
      { cwd: root, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "ignore"] });
    const keys = JSON.parse(out.slice(out.indexOf("[")));
    key = keys.map((k) => k.api_key).find((k) => typeof k === "string" && k.startsWith("sb_publishable_")) ?? "";
  }
  if (!key) { console.error("No sb_publishable_ key found (set PB_PUBLISHABLE_KEY)."); process.exit(1); }
  return { supabaseUrl: url, publishableKey: key };
}

const iscc = findIscc();
if (!iscc) {
  console.error('Inno Setup 6 (ISCC.exe) not found. Install it (winget install JRSoftware.InnoSetup) or set ISCC_PATH.');
  process.exit(1);
}

if (!skipBuild) {
  console.log('==> npm run build');
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
}
if (!existsSync(join(root, 'dist-next', 'home.html'))) {
  console.error('dist-next/home.html is missing; run without --skip-build.');
  process.exit(1);
}

console.log('==> staging');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'runtime'), { recursive: true });
cpSync(process.execPath, join(stage, 'runtime', 'node.exe'));

mkdirSync(join(stage, 'agent'), { recursive: true });
for (const file of readdirSync(join(root, 'agent'))) {
  if (/\.(mjs|html)$/.test(file) && !/\.test\.mjs$/.test(file) && file !== 'setup.mjs') {
    cpSync(join(root, 'agent', file), join(stage, 'agent', file));
  }
}
cpSync(join(root, 'bridge'), join(stage, 'bridge'), { recursive: true });
cpSync(join(root, 'dist-next'), join(stage, 'web'), { recursive: true });
cpSync(join(root, 'installer', 'launcher.ps1'), join(stage, 'launcher.ps1'));
writeFileSync(join(stage, 'agent', 'defaults.json'), JSON.stringify(publicSupabaseDefaults(), null, 2));

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || '1.0.0';
console.log(`==> compiling installer v${version}`);
execFileSync(iscc, [`/DAppVersion=${version}`, `/DStageDir=${stage}`, join(root, 'installer', 'photobooth.iss')], { stdio: 'inherit' });
console.log(`Done: ${join(root, 'dist-installer', 'PhotoboothSetup.exe')}`);
