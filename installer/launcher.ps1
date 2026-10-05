# Photobooth kiosk launcher (installed copy). Starts the agent, restarts it if it exits,
# and opens Chrome in kiosk mode. Data (config, job journal, logs) lives in
# %LOCALAPPDATA%\Photobooth\data so upgrades never touch it.
$ErrorActionPreference = 'Continue'
$App = $PSScriptRoot
Set-Location $env:LOCALAPPDATA  # never hold the install folder as the working directory
$Node = Join-Path $App 'runtime\node.exe'
$Data = Join-Path $env:LOCALAPPDATA 'Photobooth\data'
New-Item -ItemType Directory -Force -Path $Data | Out-Null

# One launcher per user session.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\PhotoboothKioskLauncher', [ref]$created)
if (-not $created) { exit 0 }

$env:PB_AGENT_DATA = $Data
$env:PB_AGENT_WEB = Join-Path $App 'web'
$port = 8787
$configFile = Join-Path $Data 'config.json'
if (Test-Path $configFile) {
  try { $configured = (Get-Content $configFile -Raw | ConvertFrom-Json).port; if ($configured) { $port = [int]$configured } } catch {}
}

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
  Start-Process 'https://www.google.com/chrome/'
  Add-Content (Join-Path $Data 'agent.log') "$(Get-Date -Format s) Google Chrome is not installed."
  exit 1
}

# Chrome starts once the local server answers; own profile, camera auto-allowed for this kiosk only.
Start-Job -ArgumentList $chrome, $port, $Data -ScriptBlock {
  param($chrome, $port, $data)
  for ($i = 0; $i -lt 60; $i++) {
    try { (New-Object Net.Sockets.TcpClient('127.0.0.1', $port)).Close(); break } catch { Start-Sleep -Seconds 1 }
  }
  & $chrome --kiosk --noerrdialogs --disable-infobars --no-first-run `
    --user-data-dir="$data\chrome-profile" --use-fake-ui-for-media-stream `
    --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 `
    --disable-pinch "http://localhost:$port/home.html"
} | Out-Null

while ($true) {
  & $Node (Join-Path $App 'agent\server.mjs') *>> (Join-Path $Data 'agent.log')
  Start-Sleep -Seconds 3
}
