@echo off
rem cmfProductManagement - start the local server (Windows).
rem Usage: scripts\start.cmd [--no-browser] [--background]
rem   --no-browser  do not open the browser once the server answers
rem   --background  start node hidden, output to logs\server.log and logs\server.err.log
rem                 (used by launcher.ps1 at logon; does not pause on error)
setlocal

set "ROOT=%~dp0.."
cd /d "%ROOT%" || goto :fail_nocd
set "ROOT=%CD%"
set "APP_URL=http://127.0.0.1:5180"

set "NO_BROWSER="
set "BACKGROUND="
for %%A in (%*) do if /i "%%~A"=="--no-browser" set "NO_BROWSER=1"
for %%A in (%*) do if /i "%%~A"=="--background" set "BACKGROUND=1"

if not defined NODE_EXTRA_CA_CERTS set "NODE_EXTRA_CA_CERTS=N:\Product\.claude\cmf-root-ca.pem"

rem --- Node: prefer D:\Node\nodejs, fall back to PATH ---
set "NODE_EXE="
if exist "D:\Node\nodejs\node.exe" set "NODE_EXE=D:\Node\nodejs\node.exe"
if not defined NODE_EXE for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE echo [start] ERROR: node.exe not found in D:\Node\nodejs or on PATH.& goto :fail
for %%I in ("%NODE_EXE%") do set "NODE_DIR=%%~dpI"
set "PATH=%NODE_DIR%;%PATH%"

rem --- Already running? Just open the browser. ---
call :health
if not errorlevel 1 goto :already_running

rem --- Dependencies ---
if not exist "node_modules\" (
  echo [start] node_modules missing, running npm ci
  call npm ci
  if errorlevel 1 goto :fail
)

rem --- Build when dist is missing or sources are newer than it ---
call :need_build
if errorlevel 1 (
  echo [start] Build missing or stale, running npm run build
  call npm run build
  if errorlevel 1 goto :fail
)

rem --- Start server ---
if not exist "logs\" mkdir "logs"
if defined BACKGROUND goto :start_background

echo [start] Starting server in a minimized window
start "cmfProductManagement" /min "%NODE_EXE%" server\dist\index.js
goto :wait_health

:start_background
echo [start] Starting server hidden, output in logs\server.log
if exist "logs\server.log" move /y "logs\server.log" "logs\server.prev.log" >nul 2>&1
if exist "logs\server.err.log" move /y "logs\server.err.log" "logs\server.err.prev.log" >nul 2>&1
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath '%NODE_EXE%' -ArgumentList 'server\dist\index.js' -WorkingDirectory '%ROOT%' -RedirectStandardOutput '%ROOT%\logs\server.log' -RedirectStandardError '%ROOT%\logs\server.err.log'"
if errorlevel 1 goto :fail

rem --- Wait for health (max about 30 s) ---
:wait_health
set /a TRIES=0
:wait_loop
call :health
if not errorlevel 1 goto :ready
set /a TRIES+=1
if %TRIES% GEQ 30 goto :fail_timeout
ping -n 2 127.0.0.1 >nul
goto :wait_loop

:ready
echo [start] Server is up at %APP_URL%
if not defined NO_BROWSER start "" "%APP_URL%"
exit /b 0

:already_running
echo [start] Server already running at %APP_URL%
if not defined NO_BROWSER start "" "%APP_URL%"
exit /b 0

:fail_timeout
echo [start] ERROR: server did not answer /api/health within 30 s. Check logs\server.err.log or the minimized window.
goto :fail

:fail_nocd
echo [start] ERROR: cannot change to %ROOT%
exit /b 1

:fail
echo [start] FAILED.
if not defined BACKGROUND pause
exit /b 1

rem --- Subroutine: exit 0 if the health endpoint answers, 1 otherwise ---
:health
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5180/api/health?quick=1 -TimeoutSec 3)|Out-Null;exit 0}catch{exit 1}"
exit /b %ERRORLEVEL%

rem --- Subroutine: exit 1 if dist is missing or any file under server\src or web\src is newer than the oldest dist output ---
:need_build
powershell -NoProfile -Command "$out=@(Get-Item -LiteralPath 'server\dist\index.js','web\dist\index.html' -ErrorAction SilentlyContinue); if($out.Count -lt 2){exit 1}; $min=($out|Measure-Object -Property LastWriteTime -Minimum).Minimum; $newer=Get-ChildItem -LiteralPath 'server\src','web\src' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $min } | Select-Object -First 1; if($newer){exit 1}; exit 0"
exit /b %ERRORLEVEL%
