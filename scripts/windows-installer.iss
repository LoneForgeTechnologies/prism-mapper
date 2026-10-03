; Prism Mapper installer for Windows (64-bit), built with Inno Setup 6.
;
; Do not run this by hand. scripts/build-windows-installer.mjs compiles it after
; scripts/package-release.mjs has staged the portable build. The script puts these
; values in front of this file as #define lines:
;
;   AppVersion         the version from package.json, for example 0.4.1
;   AppNumericVersion  the same as four numbers for the file properties, 0.4.1.0
;   AppCopyright       the copyright line of LICENSE
;   RepoDir            the repository root
;   StageDir           the staged Prism-Mapper-v<version>-Windows-x64 folder
;   LicenseFile        LICENSE with Windows line endings, for the first page
;   OutputDir          where Setup.exe is written
;
; The installer is not code-signed. It installs for the current user without
; administrator rights; the first wizard page offers "all users" for people who
; want that.

#ifndef AppVersion
  #error AppVersion is not defined. Build the installer with: node scripts/build-windows-installer.mjs
#endif
#ifndef AppNumericVersion
  #error AppNumericVersion is not defined. Build the installer with: node scripts/build-windows-installer.mjs
#endif
#ifndef AppCopyright
  #error AppCopyright is not defined. Build the installer with: node scripts/build-windows-installer.mjs
#endif
#ifndef RepoDir
  #error RepoDir is not defined. Build the installer with: node scripts/build-windows-installer.mjs
#endif
#ifndef StageDir
  #error StageDir is not defined. Build the installer with: node scripts/build-windows-installer.mjs
#endif
#ifndef LicenseFile
  #error LicenseFile is not defined. Build the installer with: node scripts/build-windows-installer.mjs
#endif
#ifndef OutputDir
  #error OutputDir is not defined. Build the installer with: node scripts/build-windows-installer.mjs
#endif

#define AppName "Prism Mapper"
#define AppExe "Prism Mapper.exe"
; Windows groups taskbar buttons by this id. electron/main.cjs sets the same one.
#define AppUserModelId "org.prismmapper.desktop"
#define ProjectProgId "PrismMapper.Project"
#define OpenVerb "PrismMapperOpen"
#define Repository "https://github.com/LoneForgeTechnologies/prism-mapper"

[Setup]
; AppId identifies this program to Windows and to later versions of this
; installer. It must never change, or an update would install beside the old copy.
AppId={{B6F0A8D2-3C41-4E7B-9A5D-1F2E6C8D4B73}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Prism Mapper contributors
AppPublisherURL={#Repository}
AppSupportURL={#Repository}/issues
AppUpdatesURL={#Repository}/releases
AppCopyright={#AppCopyright}
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
; The license is the first page.
DisableWelcomePage=yes
LicenseFile={#LicenseFile}
SetupIconFile={#RepoDir}\build\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
OutputDir={#OutputDir}
OutputBaseFilename=Prism-Mapper-v{#AppVersion}-Windows-x64-Setup
; Per user by default, without an administrator prompt. The first page lets the
; person choose all users instead.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
LZMANumBlockThreads=4
ChangesAssociations=yes
; A running copy is closed before its files are replaced, also in silent mode.
CloseApplications=yes
RestartApplications=no
VersionInfoVersion={#AppNumericVersion}
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppNumericVersion}
VersionInfoCompany=Prism Mapper contributors
VersionInfoDescription={#AppName} Setup
VersionInfoCopyright={#AppCopyright}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "openwith"; Description: "Offer Prism Mapper when opening project files (.prism.json)"; GroupDescription: "File types:"

[InstallDelete]
; The application code of an older version, so nothing stale is left behind.
Type: filesandordirs; Name: "{app}\resources\app"

[Files]
Source: "{#StageDir}\Prism Mapper\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\Example projects\*"; DestDir: "{app}\Example projects"; Flags: ignoreversion
Source: "{#StageDir}\LICENSE"; DestDir: "{app}\Licenses"; DestName: "Prism-Mapper-LICENSE.txt"; Flags: ignoreversion
Source: "{#StageDir}\THIRD_PARTY_NOTICES.md"; DestDir: "{app}\Licenses"; Flags: ignoreversion
Source: "{#StageDir}\ELECTRON-LICENSE.txt"; DestDir: "{app}\Licenses"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "{#AppUserModelId}"
Name: "{autoprograms}\{#AppName} example projects"; Filename: "{app}\Example projects"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "{#AppUserModelId}"; Tasks: desktopicon

[Registry]
; Windows decides how to open a file from its last extension, which for a
; project is ".json". Making Prism Mapper the default for every JSON file on the
; computer would be wrong, so projects are offered in two other ways: in the
; "Open with" list for .json files, and as an "Open in Prism Mapper" command that
; appears only for files named *.prism.json. Opening a project from the
; application (Open) or by starting the program with the file needs neither.
; Nothing here sets or replaces the default program of any file type, and the
; uninstaller removes exactly what is written here.
Root: HKA; Subkey: "Software\Classes\{#ProjectProgId}"; ValueType: string; ValueName: ""; ValueData: "Prism Mapper project"; Flags: uninsdeletekey; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\{#ProjectProgId}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppExe},0"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\{#ProjectProgId}\shell\open"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#AppName}"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\{#ProjectProgId}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.json"; Flags: uninsdeletekeyifempty; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.json\OpenWithProgids"; ValueType: string; ValueName: "{#ProjectProgId}"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations"; Flags: uninsdeletekeyifempty; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.json"; Flags: uninsdeletekeyifempty; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.json\shell"; Flags: uninsdeletekeyifempty; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.json\shell\{#OpenVerb}"; ValueType: string; ValueName: ""; ValueData: "Open in {#AppName}"; Flags: uninsdeletekey; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.json\shell\{#OpenVerb}"; ValueType: string; ValueName: "AppliesTo"; ValueData: "System.FileName:""*.prism.json"""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.json\shell\{#OpenVerb}"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.json\shell\{#OpenVerb}\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: openwith

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
