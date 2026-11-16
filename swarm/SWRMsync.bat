@echo off
setlocal EnableExtensions
title SWRMsync - sync AZI and start the AI swarm
REM One button: sync every AZI repo, give each AI a fresh copy of ProjectEden, and start Claude, Codex (ChatGPT)
REM and Gemini/Antigravity on their GitHub tasks. Tasks = open issues in Devostater/ProjectEden tagged [claude],
REM [codex], [gemini] or [all]. Instructions every AI reads: swarm\AGENT_PROMPT.md. Source of this file:
REM C:\AZI\ProjectEden\swarm\SWRMsync.bat (copy to the Desktop after changes).

set "EDEN=C:\AZI\ProjectEden"
set "SWARM=%USERPROFILE%\.eden-swarm"
set "PROMPT_FILE=swarm\AGENT_PROMPT.md"

echo.
echo === 1/4  Syncing AZI repos ===
curl -s -m 5 -o nul http://localhost:3000/api/models
if errorlevel 1 (
  echo Eden is not running: pulling each repo with git instead.
  for %%R in ("%EDEN%" "C:\AZI\NOVA" "C:\AZI\Dead-Z-Outbreak" "C:\AZI\Forge" "C:\AZI\NOTES_26") do (
    if exist "%%~R\.git" (
      echo   %%~nxR
      git -C "%%~R" pull --ff-only -q
    )
  )
) else (
  echo Eden is running: using its Sync all.
  curl -s -m 600 -X POST -H "Origin: http://localhost:3000" -H "Content-Type: application/json" -d "{}" http://localhost:3000/api/azi/sync-all > "%TEMP%\swrm-sync.json"
  powershell -NoProfile -Command "$r = Get-Content -Raw '%TEMP%\swrm-sync.json' | ConvertFrom-Json; foreach ($x in $r.results) { '  {0,-18} {1}' -f $x.name, $(if ($x.ok) { 'OK' } else { $x.hint }) }"
)

echo.
echo === 2/4  Fresh copies of ProjectEden for each AI ===
git -C "%EDEN%" fetch -q origin
if errorlevel 1 (
  echo Could not reach GitHub. Check the internet, then run SWRMsync again.
  pause
  exit /b 1
)
for %%A in (claude codex gemini) do call :prepare %%A

if /i "%~1"=="check" (
  echo.
  echo Check only: synced and prepared, no AI started.
  exit /b 0
)

echo.
echo === 3/4  Starting the AIs ===
set "START_CLAUDE=Read %PROMPT_FILE% and follow it. You are agent: claude."
set "START_CODEX=Read %PROMPT_FILE% and follow it. You are agent: codex."
set "START_GEMINI=Read %PROMPT_FILE% and follow it. You are agent: gemini."
where wt >nul 2>nul
if errorlevel 1 (
  start "Claude"  /D "%SWARM%\claude" cmd /k claude "%START_CLAUDE%"
  start "Codex"   /D "%SWARM%\codex"  cmd /k codex "%START_CODEX%"
  start "Gemini"  /D "%SWARM%\gemini" cmd /k gemini -i "%START_GEMINI%"
) else (
  wt -w swarm new-tab --title Claude -d "%SWARM%\claude" cmd /k claude "%START_CLAUDE%" ; new-tab --title Codex -d "%SWARM%\codex" cmd /k codex "%START_CODEX%" ; new-tab --title Gemini -d "%SWARM%\gemini" cmd /k gemini -i "%START_GEMINI%"
)
if exist "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" start "" "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" "%SWARM%\gemini"

echo.
echo === 4/4  Task board ===
start "" "https://github.com/Devostater/ProjectEden/issues"
echo Give work by opening an issue titled [claude] ..., [codex] ..., [gemini] ... or [all] ...
echo Each AI opens draft PRs; nothing is merged without you.
echo.
pause
exit /b 0

REM Make or refresh one AI's copy. A copy with unsaved work is left alone (that AI may be mid-task).
:prepare
set "DIR=%SWARM%\%1"
if not exist "%DIR%\.git" (
  if not exist "%SWARM%" mkdir "%SWARM%"
  git -C "%EDEN%" worktree add -q --detach "%DIR%" origin/main
  echo   %1: new copy at %DIR%
) else (
  for /f %%S in ('git -C "%DIR%" status --porcelain ^| find /c /v ""') do set "DIRTY=%%S"
  call :refresh %1
)
if not exist "%DIR%\eden-ai-dashboard\node_modules" if exist "%EDEN%\eden-ai-dashboard\node_modules" mklink /J "%DIR%\eden-ai-dashboard\node_modules" "%EDEN%\eden-ai-dashboard\node_modules" >nul
exit /b 0

:refresh
if "%DIRTY%"=="0" (
  git -C "%DIR%" checkout -q --detach origin/main
  echo   %1: refreshed to the latest main
) else (
  echo   %1: has unsaved work, left as it is
)
exit /b 0
