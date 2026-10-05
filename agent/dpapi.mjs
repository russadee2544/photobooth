// Protects the device credential with Windows DPAPI (current user scope), so the
// config file alone cannot be copied to another machine/account and used.
import { spawn } from 'node:child_process';

function run(script, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, PB_INPUT: input }, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error('dpapi_failed'))));
    child.on('error', reject);
  });
}

const HEAD = 'Add-Type -AssemblyName System.Security;';
export const protect = (text) => run(
  `${HEAD}[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($env:PB_INPUT),$null,'CurrentUser'))`, text);
export const unprotect = (b64) => run(
  `${HEAD}[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:PB_INPUT),$null,'CurrentUser'))`, b64);
