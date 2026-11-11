
@echo off
title EDEN AI Dashboard Server
color 0B

echo ========================================
echo       EDEN AI DASHBOARD SERVER
echo ========================================
echo.

cd /d "D:\Reginald\eden-ai-dashboard"

if not exist "package.json" (
    echo ERROR: package.json not found!
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 goto error
)

echo.
echo Starting EDEN AI Dashboard...
echo.

echo The hub restarts by itself if it stops. Its log is in .eden-logs\hub.log
echo Close this window to stop the hub.
echo.
node scripts\hub-supervisor.mjs --open
if errorlevel 1 goto error

pause
exit /b 0

:error
echo.
echo ERROR: Server failed to start.
pause
exit /b 1
