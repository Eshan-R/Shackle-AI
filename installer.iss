[Setup]
AppName=Shackle AI
AppVersion=1.0.0
AppPublisher=Eshan R
DefaultDirName={autopf}\Shackle AI
DefaultGroupName=Shackle AI
OutputDir=dist_installer
OutputBaseFilename=Shackle-AI-Setup-v1.0.0
SetupIconFile=logo.ico
UninstallDisplayIcon={app}\Shackle-AI.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Source the single compiled executable directly from dist/
Source: "dist\ShackleAI.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Shackle AI"; Filename: "{app}\Shackle-AI.exe"; IconFilename: "{app}\logo.ico"
Name: "{autodesktop}\Shackle AI"; Filename: "{app}\Shackle-AI.exe"; Tasks: desktopicon; IconFilename: "{app}\logo.ico"

[Run]
Filename: "{app}\Shackle-AI.exe"; Description: "{cm:LaunchProgram,Shackle AI}"; Flags: nowait postinstall skipifsilent