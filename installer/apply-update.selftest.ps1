# Self-test for apply-update.ps1 (run:  powershell -ExecutionPolicy Bypass -File installer\apply-update.selftest.ps1)
# Uses a throw-away folder; exits non-zero on the first failed check.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'apply-update.ps1')

$root = Join-Path $env:TEMP ("pb-apply-test-" + [guid]::NewGuid().ToString('N'))
$failures = 0
function Check([string]$name, [bool]$ok) {
  if ($ok) { Write-Host "ok   $name" } else { Write-Host "FAIL $name" -ForegroundColor Red; $script:failures++ }
}
function Write-Tree([string]$base, [string]$tag, [bool]$withAgent = $true) {
  $dirs = @('web', 'bridge'); if ($withAgent) { $dirs += 'agent' }
  foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path (Join-Path $base $d) | Out-Null; Set-Content (Join-Path $base "$d\marker.txt") $tag }
}
function Marker([string]$base, [string]$d) { (Get-Content (Join-Path $base "$d\marker.txt") -Raw).Trim() }
function Stage-Pending([string]$data, [string]$tag, [string]$version, [bool]$withAgent = $true) {
  $p = Join-Path $data 'updates\pending'
  Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
  Write-Tree $p $tag $withAgent
  Set-Content (Join-Path $p 'version.json') ('{"version":"' + $version + '"}')
  Set-Content (Join-Path $p 'ready.flag') $version
}
function Fresh() {
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
  $app = Join-Path $root 'app'; $data = Join-Path $root 'data'
  Write-Tree $app 'old'; New-Item -ItemType Directory -Force -Path $data | Out-Null
  Set-Content (Join-Path $app 'version.json') '{"version":"20260101.000000-aaaaaaa"}'
  return @($app, $data)
}
$NEW = '20261006.010101-bbbbbbb'

# A. a staged update is applied
$app, $data = Fresh
Stage-Pending $data 'new' $NEW
Check 'apply returns applied' ((Invoke-PendingUpdate $app $data) -eq 'applied')
Check 'web is new' ((Marker $app 'web') -eq 'new')
Check 'agent is new' ((Marker $app 'agent') -eq 'new')
Check 'old kept as .prev' ((Marker $app 'web.prev') -eq 'old')
Check 'version.json is new' ((Get-Content (Join-Path $app 'version.json') -Raw) -match 'bbbbbbb')
Check 'pending folder removed' (-not (Test-Path (Join-Path $data 'updates\pending')))
$state = Read-UpdateState $data
Check 'state pending, first start counted' ($state.pending -and $state.attempts -eq 1 -and $state.version -eq $NEW)

# B. never confirmed healthy: starts 2 and 3 are allowed, the 4th rolls back
Invoke-PendingUpdate $app $data | Out-Null
Invoke-PendingUpdate $app $data | Out-Null
Check 'three starts counted' ((Read-UpdateState $data).attempts -eq 3)
Check 'rollback result' ((Invoke-PendingUpdate $app $data) -eq 'rolled-back')
Check 'web restored' ((Marker $app 'web') -eq 'old')
Check 'agent restored' ((Marker $app 'agent') -eq 'old')
Check 'version restored' ((Get-Content (Join-Path $app 'version.json') -Raw) -match 'aaaaaaa')
$state = Read-UpdateState $data
Check 'failed version recorded, not pending' ((-not $state.pending) -and ($state.failed -contains $NEW))

# C. a confirmed version is never counted or rolled back
$app, $data = Fresh
Stage-Pending $data 'new' $NEW
Invoke-PendingUpdate $app $data | Out-Null
Save-UpdateState $data ([ordered]@{ pending = $false; version = $NEW; attempts = 0; failed = @() })
1..5 | ForEach-Object { Invoke-PendingUpdate $app $data | Out-Null }
Check 'confirmed version stays' ((Marker $app 'web') -eq 'new' -and -not (Read-UpdateState $data).pending)

# D. an incomplete bundle leaves the install untouched and is never retried
$app, $data = Fresh
Stage-Pending $data 'new' $NEW $false
Check 'incomplete bundle reported' ((Invoke-PendingUpdate $app $data) -eq 'apply-failed')
Check 'web unchanged' ((Marker $app 'web') -eq 'old')
Check 'agent unchanged' ((Marker $app 'agent') -eq 'old')
Check 'version unchanged' ((Get-Content (Join-Path $app 'version.json') -Raw) -match 'aaaaaaa')
Check 'failed recorded' ((Read-UpdateState $data).failed -contains $NEW)

Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
if ($failures -gt 0) { Write-Host "$failures check(s) failed" -ForegroundColor Red; exit 1 }
Write-Host 'all checks passed'
