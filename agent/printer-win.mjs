// Windows printing through PowerShell + System.Drawing. Values reach the script
// through environment variables, never through string interpolation.
import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const PRINT_TIMEOUT_MS = 90_000;

// Exit 2 = provably nothing was sent to a printer; 3 = failed after sending began.
const PRINT_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Drawing
  $target = $env:PB_PRINTER
  if (-not $target) {
    $def = Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1
    if ($def) { $target = $def.Name }
  }
  if (-not $target) { exit 2 }
  $img = [System.Drawing.Image]::FromFile($env:PB_FILE)
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $target
  if (-not $doc.PrinterSettings.IsValid) { exit 2 }
  $doc.PrinterSettings.Copies = [int]$env:PB_COPIES
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.add_PrintPage({
    param($sender, $e)
    $pw = $e.PageBounds.Width; if ($pw -le 0) { $pw = 200 }
    $ph = [int]($img.Height * ($pw / $img.Width))
    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $e.Graphics.DrawImage($img, 0, 0, $pw, $ph)
    $e.HasMorePages = $false
  })
} catch { exit 2 }
try {
  $doc.Print()
  Write-Output "PRINT_SUCCESS:$target"
} catch { exit 3 }
`;

function runPowerShell(script, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...env }, windowsHide: true });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    const timer = setTimeout(() => { child.kill(); resolve({ code: 'timeout', stdout }); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve({ code: 2, stdout }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout }); });
  });
}

export async function listPrinters() {
  const { stdout } = await runPowerShell(
    'Get-CimInstance Win32_Printer | Select-Object Name, Default, PortName, DriverName | ConvertTo-Json -Compress',
    {}, 15_000);
  try {
    const raw = JSON.parse(stdout.trim() || '[]');
    const list = Array.isArray(raw) ? raw : [raw];
    const printers = list.map((p) => ({ name: p.Name, isDefault: !!p.Default, port: p.PortName, driver: p.DriverName }));
    return { printers, defaultPrinter: printers.find((p) => p.isDefault)?.name || printers[0]?.name || '' };
  } catch {
    return { printers: [], defaultPrinter: '' };
  }
}

// Resolves { spooled: true, printer } once Windows accepted the job. Rejects with
// err.notPrinted === true only when nothing could have been sent to the printer;
// every other failure (including a timeout) is ambiguous by design.
export async function printImage({ bytes, ext = 'png', printerName = '', copies = 1 }) {
  const file = join(tmpdir(), `pb_print_${randomUUID()}.${ext}`);
  await writeFile(file, bytes);
  try {
    const { code, stdout } = await runPowerShell(PRINT_SCRIPT,
      { PB_FILE: file, PB_PRINTER: printerName, PB_COPIES: String(copies) }, PRINT_TIMEOUT_MS);
    const match = stdout.match(/PRINT_SUCCESS:(.+)/);
    if (code === 0 && match) return { spooled: true, printer: match[1].trim() };
    const err = new Error(code === 2 ? 'printer_unavailable' : 'print_unconfirmed');
    err.notPrinted = code === 2;
    throw err;
  } finally {
    unlink(file).catch(() => {});
  }
}

// ---- printer health for the dashboard -------------------------------------------------
// Windows only reports what the driver tells it; many USB thermal printers say little.
export function mapPrinterHealth(raw) {
  if (!raw) return { state: 'unknown', detail: 'printer_not_found' };
  const error = Number(raw.DetectedErrorState);
  const status = Number(raw.PrinterStatus);
  if (raw.WorkOffline === true || error === 10 || status === 7) return { state: 'offline', detail: 'offline' };
  const errorNames = { 4: 'no_paper', 6: 'no_toner', 8: 'door_open', 9: 'paper_jam', 11: 'service_requested' };
  if (errorNames[error]) return { state: 'error', detail: errorNames[error] };
  if (error === 3) return { state: 'ready', detail: 'low_paper' };
  if (error === 5) return { state: 'ready', detail: 'low_toner' };
  if (status === 4 || status === 5) return { state: 'busy', detail: status === 5 ? 'warming_up' : 'printing' };
  if (status === 1 || status === 2) return { state: 'unknown', detail: 'status_unknown' };
  return { state: 'ready', detail: '' };
}

export async function printerHealth(printerName = '') {
  const { stdout } = await runPowerShell(
    `$n = $env:PB_PRINTER
     $p = if ($n) { Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $n } | Select-Object -First 1 }
          else { Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1 }
     if ($p) { $p | Select-Object Name, PrinterStatus, WorkOffline, DetectedErrorState | ConvertTo-Json -Compress }`,
    { PB_PRINTER: printerName }, 15_000);
  let raw = null;
  try { raw = JSON.parse(stdout.trim() || 'null'); } catch { raw = null; }
  return { name: raw?.Name || printerName || '', ...mapPrinterHealth(raw) };
}

// ---- ESC/POS raw printing (receipt printers) ------------------------------------------
// The image is turned into ESC/POS raster data and handed to the spooler as RAW bytes, so the
// driver's picture handling (blank slips on some receipt drivers) is bypassed. Every copy is cut.
const ESCPOS_CS = join(import.meta.dirname, 'escpos-raw.cs');
const ESCPOS_SCRIPT = `
$ErrorActionPreference = 'Stop'
try { Add-Type -ReferencedAssemblies System.Drawing -Path $env:PB_CS } catch { exit 2 }
$target = $env:PB_PRINTER
if (-not $target) {
  $def = Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1
  if ($def) { $target = $def.Name }
}
if (-not $target) { exit 2 }
if ($env:PB_GAMMA) { [EscPosRaw]::Gamma = [double]::Parse($env:PB_GAMMA, [Globalization.CultureInfo]::InvariantCulture) }
try { $payload = [EscPosRaw]::Build($env:PB_FILE, [int]$env:PB_DOTS, [int]$env:PB_COPIES, $true) } catch { exit 2 }
$code = [EscPosRaw]::Send($target, $payload)
if ($code -eq 0) { Write-Output "PRINT_SUCCESS:$target" }
exit $code
`;
export const RECEIPT_DOTS = { thermal58: 384, thermal80: 576, thermal100: 832 };

// Lightness levels for the admin page: 0 = as the image is ... 6 = lightest. Default 2.
export const RECEIPT_LIGHTNESS = [1, 0.85, 0.72, 0.6, 0.5, 0.42, 0.35];
const gammaOf = (level) => String(RECEIPT_LIGHTNESS[Number.isInteger(level) ? level : 2] ?? 0.72);

export async function printImageEscPos({ bytes, ext = 'png', printerName = '', copies = 1, dots = 576, lightness }) {
  const file = join(tmpdir(), `pb_print_${randomUUID()}.${ext}`);
  await writeFile(file, bytes);
  try {
    const { code, stdout } = await runPowerShell(ESCPOS_SCRIPT,
      { PB_CS: ESCPOS_CS, PB_FILE: file, PB_PRINTER: printerName, PB_COPIES: String(copies), PB_DOTS: String(dots), PB_GAMMA: gammaOf(lightness) }, PRINT_TIMEOUT_MS);
    const match = stdout.match(/PRINT_SUCCESS:(.+)/);
    if (code === 0 && match) return { spooled: true, printer: match[1].trim() };
    const err = new Error(code === 2 ? 'printer_unavailable' : 'print_unconfirmed');
    err.notPrinted = code === 2;
    throw err;
  } finally {
    unlink(file).catch(() => {});
  }
}

// Several slips in one print job, each one cut (redeem code slips).
const ESCPOS_MANY_SCRIPT = ESCPOS_SCRIPT.replace('[EscPosRaw]::Build($env:PB_FILE, [int]$env:PB_DOTS, [int]$env:PB_COPIES, $true)',
  '[EscPosRaw]::BuildMany($env:PB_FILES, [int]$env:PB_DOTS, $true)');
export async function printImagesEscPos({ images, printerName = '', dots = 576, lightness }) {
  const files = [];
  try {
    for (const image of images) {
      const file = join(tmpdir(), `pb_slip_${randomUUID()}.${image.ext || 'png'}`);
      await writeFile(file, image.bytes);
      files.push(file);
    }
    const { code, stdout } = await runPowerShell(ESCPOS_MANY_SCRIPT,
      { PB_CS: ESCPOS_CS, PB_FILES: files.join('|'), PB_PRINTER: printerName, PB_DOTS: String(dots), PB_GAMMA: gammaOf(lightness) }, PRINT_TIMEOUT_MS);
    const match = stdout.match(/PRINT_SUCCESS:(.+)/);
    if (code === 0 && match) return { spooled: true, printer: match[1].trim() };
    const err = new Error(code === 2 ? 'printer_unavailable' : 'print_unconfirmed');
    err.notPrinted = code === 2;
    throw err;
  } finally {
    for (const f of files) unlink(f).catch(() => {});
  }
}
