[Setup]
AppName=Shackle AI
AppVersion=1.0.1
AppPublisher=Eshan R
DefaultDirName={autopf}\Shackle AI
DefaultGroupName=Shackle AI
OutputDir=dist_installer
OutputBaseFilename=Shackle-AI-Setup-v1.0.1
SetupIconFile=logo.ico
UninstallDisplayIcon={app}\ShackleAI.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "logo.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Shackle AI"; Filename: "{app}\ShackleAI.exe"; IconFilename: "{app}\logo.ico"
Name: "{autodesktop}\Shackle AI"; Filename: "{app}\ShackleAI.exe"; Tasks: desktopicon; IconFilename: "{app}\logo.ico"

[Registry]
; Configure Windows Compatibility Layer so ShackleAI.exe is always launched with Administrator privileges
Root: HKLM; Subkey: "SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers"; ValueType: string; ValueName: "{app}\ShackleAI.exe"; ValueData: "~ RUNASADMIN"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers"; ValueType: string; ValueName: "{app}\ShackleAI.exe"; ValueData: "~ RUNASADMIN"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\ShackleAI.exe"; Description: "{cm:LaunchProgram,Shackle AI}"; Flags: nowait postinstall skipifsilent