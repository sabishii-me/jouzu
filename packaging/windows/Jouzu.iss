#ifndef Payload
#error Payload is required
#endif
#ifndef ReleaseId
#error ReleaseId is required
#endif
#ifndef ProductVersion
#error ProductVersion is required
#endif
[Setup]
AppId={{4F9CE159-24E4-4C48-8F05-70E9DAF39BC3}
AppName=Jouzu (unsigned preview)
AppVersion={#ProductVersion}
AppPublisher=Shisa AI
AppPublisherURL=https://shisa.ai
DefaultDirName={localappdata}\Programs\Jouzu
DefaultGroupName=Jouzu
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#Output}
OutputBaseFilename=JouzuSetup-{#ReleaseId}-x64-unsigned
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\Jouzu.exe
AppMutex=Local\JouzuDesktop
CloseApplications=no
[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: checkedonce
[Files]
Source: "{#Payload}\versions\{#ReleaseId}\*"; DestDir: "{app}\versions\{#ReleaseId}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Payload}\Jouzu.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Payload}\JouzuConsole.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Payload}\Jouzu.exe.config"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Payload}\JouzuConsole.exe.config"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{group}\Jouzu"; Filename: "{app}\Jouzu.exe"
Name: "{group}\Restore previous Jouzu version"; Filename: "{app}\Jouzu.exe"; Parameters: "--rollback"
Name: "{autodesktop}\Jouzu"; Filename: "{app}\Jouzu.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\Jouzu.exe"; Description: "Open Jouzu"; Flags: nowait postinstall skipifsilent
[UninstallDelete]
Type: filesandordirs; Name: "{app}\versions"
Type: files; Name: "{app}\current.json"
Type: files; Name: "{app}\activation.lock"
[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var ExitCode: Integer;
begin
  if CurStep = ssPostInstall then begin
    if not Exec(ExpandConstant('{app}\JouzuConsole.exe'), '--activate {#ReleaseId}', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      RaiseException('Jouzu could not verify its installation. Run the installer again to repair it.');
    if ExitCode <> 0 then
      RaiseException('Jouzu verification failed. The active version was preserved. Run the installer again to repair it.');
  end;
end;
