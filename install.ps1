<#
.SYNOPSIS
  Installs the Photobooth kiosk on this Windows PC.

.DESCRIPTION
  1. Checks Node.js and installs dependencies, builds the kiosk (dist-next).
  2. Runs the one-time provisioning (agent:setup) if agent/data/config.json is missing.
  3. Registers a Scheduled Task that starts the agent and Chrome in kiosk mode at logon.

  Run from the project folder in PowerShell:
    powershell -ExecutionPolicy Bypass -File .\install.ps1
  Update later (git pull first):  .\install.ps1 -SkipSetup
  Remove autostart:               .\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [switch]$SkipSetup,   # do not prompt for provisioning even if config is missing
  [switch]$NoAutostart, # build/provision only
  [switch]$Uninstall    # remove the Scheduled Task and exit
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$TaskName = 'PhotoboothKiosk'
$ConfigFile = Join-Path $Root 'agent\data\config.json'
$Launcher = Join-Path $Root 'agent\start-kiosk.ps1'

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "ERROR: $text" -ForegroundColor Red; exit 1 }

if ($Uninstall) {
  Step "Removing Scheduled Task '$TaskName'"
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host 'Removed. Config and job history in agent\data were kept.'
  } else {
    Write-Host 'Task was not installed.'
  }
  exit 0
}

Step 'Checking prerequisites'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js is not installed. Install the LTS version from https://nodejs.org then run this script again.' }
$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { Fail "Node.js 20 or newer is required (found $(& node --version))." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm was not found next to Node.js.' }

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Fail 'Google Chrome was not found. Install Chrome, then run this script again.' }

Step 'Installing dependencies (npm ci)'
Push-Location $Root
try {
  & npm ci
  if ($LASTEXITCODE -ne 0) { Fail 'npm ci failed.' }

  Step 'Building the kiosk (npm run build)'
  & npm run build
  if ($LASTEXITCODE -ne 0) { Fail 'Build failed.' }
  if (-not (Test-Path (Join-Path $Root 'dist-next\home.html'))) { Fail 'dist-next\home.html is missing after the build.' }

  if (-not (Test-Path $ConfigFile)) {
    if ($SkipSetup) {
      Write-Host 'No agent config yet. Run "npm run agent:setup" before starting the kiosk.' -ForegroundColor Yellow
    } else {
      Step 'First-time provisioning (values come from: node scripts/create-kiosk.mjs --name "Booth 1")'
      & npm run agent:setup
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ConfigFile)) { Fail 'Provisioning did not complete.' }
    }
  }
} finally {
  Pop-Location
}

Step 'Writing the launcher'
$launcherText = @'
# Starts the Photobooth agent (restarting it if it exits) and opens Chrome in kiosk mode.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$ConfigFile = Join-Path $Root 'agent\data\config.json'
$config = Get-Content $ConfigFile -Raw | ConvertFrom-Json
$port = if ($config.port) { [int]$config.port } else { 8787 }
$logDir = Join-Path $Root 'agent\data'
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

# Chrome in its own profile; camera is auto-allowed for this local kiosk only.
Start-Job -ArgumentList $chrome, $port, $logDir -ScriptBlock {
  param($chrome, $port, $logDir)
  for ($i = 0; $i -lt 60; $i++) {
    try { (New-Object Net.Sockets.TcpClient('127.0.0.1', $port)).Close(); break } catch { Start-Sleep -Seconds 1 }
  }
  & $chrome --kiosk --noerrdialogs --disable-infobars --no-first-run `
    --user-data-dir="$logDir\chrome-profile" --use-fake-ui-for-media-stream `
    --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 `
    --disable-pinch "http://localhost:$port/home.html"
} | Out-Null

while ($true) {
  Set-Location $Root
  & node agent\server.mjs *>> (Join-Path $logDir 'agent.log')
  Start-Sleep -Seconds 3
}
'@
Set-Content -Path $Launcher -Value $launcherText -Encoding UTF8

if ($NoAutostart) {
  Step 'Done (autostart skipped)'
  Write-Host "Start manually:  powershell -ExecutionPolicy Bypass -File `"$Launcher`""
  exit 0
}

Step "Registering Scheduled Task '$TaskName' (runs at logon of $env:USERNAME)"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Force | Out-Null

Step 'Installed'
Write-Host @"

Next:
  - Start now (without rebooting):  Start-ScheduledTask -TaskName $TaskName
  - It also starts automatically each time $env:USERNAME logs in. Enable Windows auto sign-in
    for a kiosk PC (netplwiz) so the booth recovers after a power cut.
  - Agent log: $Root\agent\data\agent.log
  - Remove autostart: .\install.ps1 -Uninstall
"@
