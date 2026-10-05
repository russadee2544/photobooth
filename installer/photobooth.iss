; Inno Setup script for PhotoboothSetup.exe. Build with: node installer/build.mjs
; Per-user install (no administrator needed): app in %LOCALAPPDATA%\Programs\Photobooth,
; data in %LOCALAPPDATA%\Photobooth\data (kept on uninstall).
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef StageDir
  #define StageDir "stage"
#endif

[Setup]
AppId={{6C1B8D3E-2F4A-4B7E-9A55-3D0E7B1F42C9}
AppName=Photobooth
AppVersion={#AppVersion}
AppPublisher=Photobooth
DefaultDirName={localappdata}\Programs\Photobooth
DefaultGroupName=Photobooth
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/max
SolidCompression=yes
OutputDir=..\dist-installer
OutputBaseFilename=PhotoboothSetup
WizardStyle=modern
UninstallDisplayName=Photobooth
CloseApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "เปิด Photobooth อัตโนมัติเมื่อเข้า Windows"; GroupDescription: "ตัวเลือก:"
Name: "desktopicon"; Description: "สร้างไอคอนบนเดสก์ท็อป"; GroupDescription: "ตัวเลือก:"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userprograms}\Photobooth"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\launcher.ps1"""; \
  WorkingDir: "{userdocs}"; IconFilename: "{app}\runtime\node.exe"
Name: "{userstartup}\Photobooth"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\launcher.ps1"""; \
  WorkingDir: "{userdocs}"; IconFilename: "{app}\runtime\node.exe"; Tasks: autostart
Name: "{userdesktop}\Photobooth"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\launcher.ps1"""; \
  WorkingDir: "{userdocs}"; IconFilename: "{app}\runtime\node.exe"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\launcher.ps1"""; \
  WorkingDir: "{userdocs}"; Flags: nowait postinstall skipifsilent; Description: "เริ่ม Photobooth ตอนนี้"

[Code]
function ChromeInstalled(): Boolean;
begin
  Result := FileExists(ExpandConstant('{pf}\Google\Chrome\Application\chrome.exe'))
    or FileExists(ExpandConstant('{pf32}\Google\Chrome\Application\chrome.exe'))
    or FileExists(ExpandConstant('{localappdata}\Google\Chrome\Application\chrome.exe'));
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not ChromeInstalled() then
    Result := MsgBox('ไม่พบ Google Chrome ในเครื่องนี้ ตู้ต้องใช้ Chrome เปิดหน้าจอ' + #13#10 +
      'ติดตั้งต่อได้ แต่ควรติดตั้ง Chrome ก่อนเปิดใช้งาน (https://www.google.com/chrome)' + #13#10#13#10 +
      'ติดตั้งต่อหรือไม่?', mbConfirmation, MB_YESNO) = IDYES;
end;

// Stops the launcher FIRST (it restarts node every 3 seconds), then node itself, so the
// files in {app} are no longer locked. Used before upgrading and before uninstalling.
procedure StopPhotobooth();
var
  ScriptFile: String;
  Script: String;
  ResultCode: Integer;
begin
  ScriptFile := ExpandConstant('{tmp}\stop-photobooth.ps1');
  Script :=
    'param([string]$App)' + #13#10 +
    '$self = $PID' + #13#10 +
    'Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $self -and $_.CommandLine -and (($_.Name -eq ''powershell.exe'' -and $_.CommandLine.Contains(''launcher.ps1'') -and $_.CommandLine.IndexOf($App, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($_.Name -eq ''chrome.exe'' -and $_.CommandLine.Contains(''Photobooth'') -and $_.CommandLine.Contains(''chrome-profile''))) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }' + #13#10 +
    'for ($i = 0; $i -lt 20; $i++) {' + #13#10 +
    '  $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $self -and $_.Path -and $_.Path.StartsWith($App, [StringComparison]::OrdinalIgnoreCase) }' + #13#10 +
    '  if (-not $p) { break }' + #13#10 +
    '  $p | Stop-Process -Force -ErrorAction SilentlyContinue' + #13#10 +
    '  Start-Sleep -Milliseconds 500' + #13#10 +
    '}' + #13#10;
  SaveStringToFile(ScriptFile, Script, False);
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + ScriptFile + '" -App "' + ExpandConstant('{app}') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopPhotobooth();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopPhotobooth();
  Result := True;
end;
