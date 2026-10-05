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
  WorkingDir: "{app}"; IconFilename: "{app}\runtime\node.exe"
Name: "{userstartup}\Photobooth"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\launcher.ps1"""; \
  WorkingDir: "{app}"; IconFilename: "{app}\runtime\node.exe"; Tasks: autostart
Name: "{userdesktop}\Photobooth"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\launcher.ps1"""; \
  WorkingDir: "{app}"; IconFilename: "{app}\runtime\node.exe"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\launcher.ps1"""; \
  WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent; Description: "เริ่ม Photobooth ตอนนี้"

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Get-Process node -ErrorAction SilentlyContinue | Where-Object {{ $_.Path -like '{app}\*' }} | Stop-Process -Force"""; \
  Flags: runhidden; RunOnceId: "StopAgent"

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

// Upgrades: stop the running agent so its files can be replaced.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''' +
    ExpandConstant('{app}') + '\*'' } | Stop-Process -Force"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
