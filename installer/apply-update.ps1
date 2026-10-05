# Applies a staged update and rolls back a version that keeps failing.
# Dot-sourced by launcher.ps1 and called before every start of the agent, i.e. while the
# agent is NOT running, so the folders can be swapped without file locks.
#   <Data>\updates\pending\{web,agent,bridge,version.json,ready.flag}  staged by the agent (signed + verified)
#   <Data>\update-state.json  { pending, version, attempts, failed[] }  ('pending' = not yet proven healthy)
# The agent clears 'pending' after 60 s of healthy running; three starts without that = roll back.

$script:UpdateDirs = @('web', 'agent', 'bridge')

function Read-UpdateState([string]$Data) {
  $file = Join-Path $Data 'update-state.json'
  $state = [ordered]@{ pending = $false; version = ''; attempts = 0; failed = @() }
  if (Test-Path $file) {
    try {
      $json = Get-Content $file -Raw | ConvertFrom-Json
      if ($null -ne $json.pending) { $state.pending = [bool]$json.pending }
      if ($json.version) { $state.version = [string]$json.version }
      if ($json.attempts) { $state.attempts = [int]$json.attempts }
      if ($json.failed) { $state.failed = @($json.failed) }
    } catch { }
  }
  return $state
}

function Save-UpdateState([string]$Data, $state) {
  New-Item -ItemType Directory -Force -Path $Data | Out-Null
  # UTF-8 without BOM (PowerShell 5 Set-Content -Encoding UTF8 adds one, which the agent cannot parse)
  [System.IO.File]::WriteAllText((Join-Path $Data 'update-state.json'), ($state | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
}

function Restore-PreviousVersion([string]$App, [string[]]$Dirs = $script:UpdateDirs, [bool]$WithVersionFile = $true) {
  foreach ($d in $Dirs) {
    $prev = Join-Path $App "$d.prev"
    if (Test-Path $prev) {
      $cur = Join-Path $App $d
      if (Test-Path $cur) { Remove-Item -Recurse -Force $cur }
      Move-Item $prev $cur
    }
  }
  $prevVersion = Join-Path $App 'version.prev.json'
  if ($WithVersionFile -and (Test-Path $prevVersion)) { Move-Item -Force $prevVersion (Join-Path $App 'version.json') }
}

function Invoke-PendingUpdate([string]$App, [string]$Data) {
  $state = Read-UpdateState $Data

  # 1. A version that never became healthy: go back to the previous one and never try it again.
  if ($state.pending -and $state.attempts -ge 3) {
    try { Restore-PreviousVersion $App } catch { }
    $state.failed = @($state.failed) + @($state.version)
    $state.pending = $false
    $state.attempts = 0
    Save-UpdateState $Data $state
    return 'rolled-back'
  }

  # 2. Swap in a staged update.
  $pending = Join-Path $Data 'updates\pending'
  $flag = Join-Path $pending 'ready.flag'
  $result = 'none'
  if (Test-Path $flag) {
    $version = (Get-Content $flag -Raw).Trim()
    $touched = @()
    try {
      foreach ($d in $script:UpdateDirs) {
        $cur = Join-Path $App $d
        $prev = Join-Path $App "$d.prev"
        if (Test-Path $prev) { Remove-Item -Recurse -Force $prev }
        $touched += $d
        if (Test-Path $cur) { Move-Item $cur $prev }
        Move-Item (Join-Path $pending $d) $cur
      }
      $versionFile = Join-Path $App 'version.json'
      if (Test-Path $versionFile) { Copy-Item -Force $versionFile (Join-Path $App 'version.prev.json') }
      Move-Item -Force (Join-Path $pending 'version.json') $versionFile
      Remove-Item -Recurse -Force $pending -ErrorAction SilentlyContinue
      $state.pending = $true
      $state.version = $version
      $state.attempts = 0
      $result = 'applied'
    } catch {
      # Half-swapped: put back only what this swap touched (older .prev folders are not ours), and never retry it.
      try { Restore-PreviousVersion $App $touched $false } catch { }
      $state.failed = @($state.failed) + @($version)
      $state.pending = $false
      Remove-Item -Recurse -Force $pending -ErrorAction SilentlyContinue
      $result = 'apply-failed'
    }
    Save-UpdateState $Data $state
  }

  # 3. Count this start while the running version is still unproven.
  if ($state.pending) {
    $state.attempts = [int]$state.attempts + 1
    Save-UpdateState $Data $state
  }
  return $result
}
