@echo off
title EDEN AI Dashboard Server
color 0B

echo ========================================
echo       EDEN AI DASHBOARD SERVER
echo ========================================
echo.

rem Run from the folder this file is in, wherever the repo was cloned.
cd /d "%~dp0"
echo Folder: %CD%

if not exist "package.json" (
    echo ERROR: package.json not found in this folder.
    goto fail
)

rem ---- Desktop shortcut: added once, points at this file ----
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d=[Environment]::GetFolderPath('Desktop'); $l=Join-Path $d 'Start Eden.lnk'; $t='%~f0';" ^
  "$s=(New-Object -ComObject WScript.Shell); $ok=$false; if(Test-Path $l){$ok=($s.CreateShortcut($l).TargetPath -eq $t)};" ^
  "if(-not $ok){$k=$s.CreateShortcut($l); $k.TargetPath=$t; $k.WorkingDirectory='%~dp0'; $k.Save(); Write-Host 'Added a Start Eden shortcut to your desktop.'}"

rem ---- Check 1: Node.js ----
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is not installed. Install the LTS version from nodejs.org.
    goto fail
)
for /f "delims=" %%v in ('node -v') do echo Node: %%v

rem ---- Check 2: which code version is this (only if git is available) ----
where git >nul 2>nul
if not errorlevel 1 (
    for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do echo Branch: %%b
    for /f "delims=" %%c in ('git log -1 --format^="%%h %%s" 2^>nul') do echo Commit: %%c
    git status --porcelain 2>nul | findstr /r "." >nul && echo NOTE: this folder has local changes that are not on GitHub.
)

rem ---- Check 3: dependencies ----
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 goto fail
)

rem ---- Check 4: code check, so a broken file is named here instead of the hub failing to start ----
echo Checking the code...
call node_modules\.bin\tsc --noEmit --pretty false > "%TEMP%\eden-check.txt" 2>&1
if errorlevel 1 (
    rem TS1xxx are syntax errors: the hub cannot load that file. Other errors are warnings; it may still run.
    findstr /c:"error TS1" "%TEMP%\eden-check.txt" >nul
    if not errorlevel 1 (
        echo.
        echo ERROR: a code file is broken, so the hub cannot start:
        echo.
        findstr /c:"error TS1" "%TEMP%\eden-check.txt"
        echo.
        echo Fix or undo the file named above, then run Start Eden again.
        goto fail
    )
    echo WARNING: the code check found problems. Starting anyway:
    type "%TEMP%\eden-check.txt"
) else (
    echo Code OK.
)

echo.
echo Starting EDEN AI Dashboard...
echo The hub restarts by itself if it stops. Its log is in .eden-logs\hub.log
echo Close this window to stop the hub.
echo.
node scripts\hub-supervisor.mjs --open
if errorlevel 1 goto fail

pause
exit /b 0

:fail
echo.
echo Eden did not start. The details are above.
pause
exit /b 1
