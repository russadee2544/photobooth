// Builds dist-installer/PhotoboothSetup.exe:
//   node installer/build.mjs [--skip-build]
// 1. production build of the kiosk (dist-next)  2. stage runtime + agent + web
// 3. compile installer/photobooth.iss with Inno Setup (ISCC).
// Inno Setup 6 is a build-time tool only; the installed kiosk does not need it, nor Node.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeVersion, root, stageAppFiles } from './payload.mjs';

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

const iscc = findIscc();
if (!iscc) {
  console.error('Inno Setup 6 (ISCC.exe) not found. Install it (winget install JRSoftware.InnoSetup) or set ISCC_PATH.');
  process.exit(1);
}

if (!skipBuild) {
  console.log('==> npm run build');
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
}

console.log('==> staging');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'runtime'), { recursive: true });
cpSync(process.execPath, join(stage, 'runtime', 'node.exe'));
stageAppFiles(stage, makeVersion());
cpSync(join(root, 'installer', 'launcher.ps1'), join(stage, 'launcher.ps1'));
cpSync(join(root, 'installer', 'apply-update.ps1'), join(stage, 'apply-update.ps1'));

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || '1.0.0';
console.log(`==> compiling installer v${version}`);
execFileSync(iscc, [`/DAppVersion=${version}`, `/DStageDir=${stage}`, join(root, 'installer', 'photobooth.iss')], { stdio: 'inherit' });
console.log(`Done: ${join(root, 'dist-installer', 'PhotoboothSetup.exe')}`);
