# SWRMsync launcher (called by SWRMsync.bat after syncing and preparing the copies).
#  - Protection: starts only AIs that preflight.ps1 says are installed and signed in; refuses to run while another
#    SWRMsync launch is under way (a lock file, cleared after launch or when older than 10 minutes).
#  - Terminal sharing: every AI tab and this launcher write to one shared log, %USERPROFILE%\.eden-swarm\logs\swarm-log.md,
#    shown live in a fourth "Swarm log" tab. When an AI's tab ends, its exit and exit code are written there too.
param([string]$Swarm = "$env:USERPROFILE\.eden-swarm", [string]$PromptFile = 'swarm\AGENT_PROMPT.md', [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$logs = Join-Path $Swarm 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs 'swarm-log.md'
function Log($who, $text) { Add-Content -LiteralPath $log -Value ("- {0} **[{1}]** {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $who, $text) -Encoding utf8 }

# Lock: one launch at a time.
$lock = Join-Path $Swarm 'swarm.lock'
if (Test-Path $lock) {
  $age = (Get-Date) - (Get-Item $lock).LastWriteTime
  if ($age.TotalMinutes -lt 10) {
    Write-Host "SWRMsync is already starting the swarm (since $((Get-Item $lock).LastWriteTime.ToString('HH:mm'))). Wait for it, or delete $lock if it got stuck."
    exit 2
  }
}
Set-Content -LiteralPath $lock -Value $PID
try {
  if (-not (Test-Path $log)) { Set-Content -LiteralPath $log -Value "# Swarm log`r`nShared by every AI in the swarm and by SWRMsync. Newest at the bottom. Read it before taking a task.`r`n" -Encoding utf8 }
  Log 'SWRMsync' 'launch started'

  $ready = @()
  foreach ($line in (& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'preflight.ps1'))) {
    if ($line -match '^READY (\S+)') { $ready += $Matches[1]; Write-Host "  ready:   $($Matches[1])" }
    elseif ($line -match '^SKIP (\S+) (.*)$') { Write-Host "  skipped: $($Matches[1]) - $($Matches[2])"; Log 'SWRMsync' "skipped $($Matches[1]): $($Matches[2])" }
  }
  if (-not $ready.Count) { Write-Host 'No AI is ready to start. Fix the sign-ins above, then run SWRMsync again.'; Log 'SWRMsync' 'nothing started'; exit 1 }

  $cli = @{ claude = 'claude'; codex = 'codex'; gemini = 'gemini -i' }
  $label = @{ claude = 'Claude'; codex = 'Codex'; gemini = 'Gemini' }
  # Each tab runs the AI, then records how it ended in the shared log (so a tab that closes early leaves a reason).
  $tabCmd = {
    param($name)
    $start = "Read $PromptFile and follow it. You are agent: $name. Shared swarm log: $log"
    # Run under cmd /v:on so !date!, !time! and !errorlevel! are read when the AI ends, not when the tab starts.
    "$($cli[$name]) `"$start`" & echo - !date! !time:~0,5! **[$name]** session ended (exit code !errorlevel!) >> `"$log`""
  }
  $viewer = "powershell -NoExit -NoProfile -Command `"`$host.UI.RawUI.WindowTitle='Devostater - Swarm - Log'; Get-Content -LiteralPath '$log' -Tail 40 -Wait`""

  if (Get-Command wt -ErrorAction SilentlyContinue) {
    $parts = @()
    foreach ($n in $ready) {
      $parts += "new-tab --title `"Devostater - Swarm - $($label[$n])`" --suppressApplicationTitle -d `"$Swarm\$n`" cmd /v:on /k $(& $tabCmd $n)"
    }
    $parts += "new-tab --title `"Devostater - Swarm - Log`" --suppressApplicationTitle -d `"$logs`" $viewer"
    $wtArgs = "-w swarm " + ($parts -join ' ; ')
    if ($DryRun) { Write-Host "DRY RUN, would run: wt $wtArgs"; Log 'SWRMsync' 'dry run (nothing started)'; exit 0 }
    Start-Process wt -ArgumentList $wtArgs
  } else {
    foreach ($n in $ready) { Start-Process cmd -WorkingDirectory "$Swarm\$n" -ArgumentList "/v:on /k title Devostater - Swarm - $($label[$n]) & $(& $tabCmd $n)" }
    Start-Process powershell -WorkingDirectory $logs -ArgumentList "-NoExit -NoProfile -Command `"Get-Content -LiteralPath '$log' -Tail 40 -Wait`""
  }
  foreach ($n in $ready) { Log 'SWRMsync' "started $n in $Swarm\$n" }
  Write-Host "Started: $($ready -join ', '). Live log: $log"
} finally {
  Remove-Item -LiteralPath $lock -ErrorAction SilentlyContinue
}
