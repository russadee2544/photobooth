# "Reset admin PIN" shortcut. Asks first, then removes this kiosk's admin PIN on the server.
# Needs this Windows PC and user account (the device credential is DPAPI-protected to them).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$App = Split-Path $PSScriptRoot -Parent
$Node = Join-Path $App 'runtime\node.exe'
$env:PB_AGENT_DATA = Join-Path $env:LOCALAPPDATA 'Photobooth\data'
Set-Location $env:LOCALAPPDATA

$title = 'Photobooth - รีเซ็ต PIN แอดมิน'
$ask = [System.Windows.Forms.MessageBox]::Show(
  "ต้องการรีเซ็ต PIN แอดมินของตู้นี้ใช่ไหม?`n`nPIN เดิมจะถูกลบ และเมื่อเข้าหน้า Admin ครั้งถัดไป ระบบจะให้ตั้ง PIN ใหม่",
  $title, 'YesNo', 'Question')
if ($ask -ne 'Yes') { exit 0 }

$out = & $Node (Join-Path $App 'agent\reset-pin.mjs') 2>&1 | Select-Object -Last 1
$result = $null
try { $result = $out | ConvertFrom-Json } catch {}
if ($result -and $result.ok) {
  [void][System.Windows.Forms.MessageBox]::Show("รีเซ็ตแล้ว`n`nเปิดหน้า Admin บนตู้นี้ แล้วตั้ง PIN ใหม่ 4 หลัก", $title, 'OK', 'Information')
} else {
  $reason = if ($result) { $result.error } else { "$out" }
  $hint = switch ($reason) {
    'network' { 'ต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบเครือข่ายแล้วลองใหม่' }
    'not_configured' { 'ตู้นี้ยังไม่ได้ตั้งค่า (ยังไม่ได้ใส่ Kiosk ID / รหัสตู้)' }
    default { 'ลองใหม่ หรือรีเซ็ตจากแดชบอร์ดของเจ้าของแทน' }
  }
  [void][System.Windows.Forms.MessageBox]::Show("รีเซ็ตไม่สำเร็จ ($reason)`n`n$hint", $title, 'OK', 'Warning')
}
