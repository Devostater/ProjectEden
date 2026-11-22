@echo off
setlocal
cd /d "%~dp0"
node scripts\recover.mjs %*
set "RECOVERY_RESULT=%ERRORLEVEL%"
pause
exit /b %RECOVERY_RESULT%
