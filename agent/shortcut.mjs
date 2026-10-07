// Keeps a Start Menu shortcut "Photobooth - Reset Admin PIN" pointing at the installed script.
// Created from here (not only by the installer) so kiosks that update in place get it too.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ROOT } from './paths.mjs';

export function ensureResetShortcut() {
  if (process.platform !== 'win32') return;
  const script = join(APP_ROOT, 'agent', 'reset-admin-pin.ps1');
  if (!existsSync(script) || !existsSync(join(APP_ROOT, 'runtime', 'node.exe'))) return;  // installed copies only
  const ps = `
    $dir = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'
    $link = Join-Path $dir 'Photobooth - Reset Admin PIN.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $s = $shell.CreateShortcut($link)
    $s.TargetPath = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    $s.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $env:PB_RESET_SCRIPT + '"'
    $s.WorkingDirectory = $env:LOCALAPPDATA
    $s.IconLocation = (Join-Path $env:PB_RESET_APP 'runtime\\node.exe')
    $s.Description = 'Reset the Photobooth admin PIN'
    $s.Save()`;
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { env: { ...process.env, PB_RESET_SCRIPT: script, PB_RESET_APP: APP_ROOT }, windowsHide: true, stdio: 'ignore' });
    child.on('error', () => {});
  } catch { /* the shortcut is a convenience */ }
}
