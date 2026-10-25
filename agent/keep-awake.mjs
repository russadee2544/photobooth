// Keeps the booth's screen on and the PC out of idle sleep while the agent runs.
// A small PowerShell child asks Windows for it with SetThreadExecutionState (the same request a video
// player makes); it changes no power settings and ends with the agent. The kiosk pages also take a
// screen wake lock, but that one depends on the browser.
import { spawn } from 'node:child_process';

const SCRIPT = `
Add-Type -Name Power -Namespace Booth -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
# ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED, renewed every minute while the agent lives
while ($true) { [Booth.Power]::SetThreadExecutionState([uint32]2147483651) | Out-Null; Start-Sleep -Seconds 60 }
`;

export function keepAwake({ log = () => {} } = {}) {
  if (process.platform !== 'win32') return () => {};
  let child = null;
  let stopped = false;
  const start = () => {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { windowsHide: true, stdio: 'ignore' });
    child.on('exit', () => {
      child = null;
      if (!stopped) setTimeout(start, 30_000);   // restart if it ever dies
    });
    child.on('error', (e) => log(`keep-awake failed: ${e.message}`));
  };
  start();
  const stop = () => { stopped = true; if (child) child.kill(); };
  process.on('exit', stop);
  return stop;
}
