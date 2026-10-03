@echo off
rem Starts Prism Mapper from source on Windows. Double-click this file.
rem It checks Node.js, installs the packages when package-lock.json has
rem changed since the last run, builds the app and opens it.
rem For the ready-to-run app, use the Setup program or the ZIP from
rem https://github.com/LoneForgeTechnologies/prism-mapper/releases/latest
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto neednode
rem Electron 41 needs Node.js 22.12 or newer to build and run from source.
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)" >nul 2>nul
if errorlevel 1 goto neednode

set "LOCK_HASH="
for /f "usebackq delims=" %%H in (`node -e "process.stdout.write(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('package-lock.json')).digest('hex'))"`) do set "LOCK_HASH=%%H"
if not defined LOCK_HASH (
  echo Could not read package-lock.json.
  goto failed
)

set "STAMP=node_modules\.prism-lock-sha256"
set "SAVED_HASH="
if exist "%STAMP%" set /p SAVED_HASH=<"%STAMP%"
set "INSTALL=0"
if not exist "node_modules\electron\dist\electron.exe" set "INSTALL=1"
if not "%SAVED_HASH%"=="%LOCK_HASH%" set "INSTALL=1"
if "%INSTALL%"=="1" (
  echo Installing packages...
  call npm ci
  if errorlevel 1 goto failed
  >"%STAMP%" echo %LOCK_HASH%
)

echo Building Prism Mapper...
call npm run build
if errorlevel 1 goto failed

echo Starting Prism Mapper...
call "node_modules\.bin\electron.cmd" .
exit /b %errorlevel%

:neednode
echo Node.js 22.12 or newer is required for the source launcher.
echo For the ready-to-run app, visit https://github.com/LoneForgeTechnologies/prism-mapper/releases/latest
if not defined CI pause
exit /b 1

:failed
echo.
echo Prism Mapper could not be started. The messages above say why.
if not defined CI pause
exit /b 1
