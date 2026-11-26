# Autopilot for this plugin: works through autopilot\TASKS.md with Codex, one task at a time.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File autopilot\run.ps1
#
# A task is marked done [x] only after autopilot\proof.ps1 passed (Fab's rules, build, automation tests and the
# packaging build). Codex cannot run
# Unreal, so this script runs the proof itself after Codex finishes. After 3 failed tries a task is marked [!]
# and the autopilot stops. It also stops when Codex does not answer (out of usage, or signed out).
# Only the files a task changed are saved to git. A task cannot change this script or the proof script.
# PowerShell reads this file once when it starts: a change to it takes effect the next time the autopilot starts.
param(
  [int]$MaxTries = 3,
  [int]$CodexMinutes = 40,
  [int]$ProofMinutes = 240
)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Utf8 = [Text.UTF8Encoding]::new($false)
$Root = Split-Path -Parent $PSScriptRoot
$Tasks = Join-Path $PSScriptRoot 'TASKS.md'
$Runs = Join-Path $PSScriptRoot 'runs'
$Lock = Join-Path $Runs 'runner.lock'
$StatusFile = Join-Path $Runs 'autopilot.txt'
$Protected = @('autopilot/run.ps1', 'autopilot/proof.ps1')
New-Item -ItemType Directory -Force $Runs | Out-Null
Set-Location -LiteralPath $Root
$env:GIT_LITERAL_PATHSPECS = '1' # file names are taken exactly as written

function Write-Status($message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm') $message"
  Write-Output $line
  Add-Content -LiteralPath $StatusFile -Value $line -Encoding utf8
}

# Runs one program hidden with a time limit. Returns its exit code, or $null when it had to be stopped.
function Invoke-Hidden($file, $arguments, $log, $minutes, $inputFile) {
  $options = @{ FilePath = $file; ArgumentList = $arguments; PassThru = $true; WindowStyle = 'Hidden'
    RedirectStandardOutput = $log; RedirectStandardError = "$log.err" }
  if ($inputFile) { $options.RedirectStandardInput = $inputFile }
  $started = Start-Process @options
  $null = $started.Handle # without this line Windows PowerShell can report an empty exit code
  if (-not $started.WaitForExit($minutes * 60000)) {
    & taskkill.exe /PID $started.Id /T /F 2>&1 | Out-Null
    return $null
  }
  $started.WaitForExit()
  return $started.ExitCode
}

# The first task that is still open: "- [ ] T01 What to build", with the indented lines under it as details.
function Get-NextTask {
  $lines = @(Get-Content -LiteralPath $Tasks -Encoding utf8)
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^- \[ \] (\S+)\s+(.+)$') {
      $task = @{ Id = $Matches[1]; Text = $Matches[2].Trim(); Details = @() }
      for ($j = $i + 1; $j -lt $lines.Count -and $lines[$j] -notmatch '^- \[' -and $lines[$j] -notmatch '^#'; $j++) {
        if ($lines[$j].Trim()) { $task.Details += $lines[$j].Trim() }
      }
      return $task
    }
  }
  return $null
}

function Set-TaskMark($id, $mark) {
  $lines = @(Get-Content -LiteralPath $Tasks -Encoding utf8)
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^- \[.\] $([regex]::Escape($id))(\s|$)") { $lines[$i] = $lines[$i] -replace '^- \[.\]', "- [$mark]"; break }
  }
  # Written with plain line feeds, like git keeps this project's files (see .gitattributes).
  [IO.File]::WriteAllText($Tasks, (($lines -join "`n") + "`n"), $Utf8)
}

# Every file git sees as changed, new or deleted, with a fingerprint of its content ('gone' when deleted).
function Get-Changed {
  $map = @{}
  $text = [string]::Join("`n", @(& git -c core.quotepath=off status --porcelain=v1 -z --untracked-files=all))
  $parts = $text.Split([char]0)
  for ($i = 0; $i -lt $parts.Count; $i++) {
    $entry = $parts[$i]
    if ($entry.Length -lt 4) { continue }
    $path = $entry.Substring(3)
    if ($entry[0] -eq 'R' -or $entry[0] -eq 'C') { $i++ } # a renamed file lists its old name next
    $map[$path] = if (Test-Path -LiteralPath (Join-Path $Root $path) -PathType Leaf) { (& git hash-object -- $path) } else { 'gone' }
  }
  return $map
}

function Test-EditorOpen {
  $project = Get-ChildItem -LiteralPath $Root -Filter *.uproject | Select-Object -First 1
  if (-not $project) { return $false }
  $open = @(Get-CimInstance Win32_Process -Filter "Name='UnrealEditor.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($project.FullName.ToLower()) })
  return [bool]$open.Count
}

# One autopilot per project: a second one would write the same files and sweep up the first one's half-made work.
if (Test-Path -LiteralPath $Lock) {
  $held = $null
  try { $held = Get-Content -LiteralPath $Lock -Raw | ConvertFrom-Json } catch {}
  $other = if ($held.pid) { Get-Process -Id $held.pid -ErrorAction SilentlyContinue } else { $null }
  if ($other -and "$($other.ProcessName).exe" -eq $held.image) {
    Write-Status "Another autopilot is already working here (process $($held.pid)). Not starting a second one."
    exit 2
  }
}
$me = Get-Process -Id $PID
[IO.File]::WriteAllText($Lock, (@{ pid = $PID; image = "$($me.ProcessName).exe"; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Compress), $Utf8)

$exitCode = 0
try {
  $plugin = Get-ChildItem -LiteralPath (Join-Path $Root 'Plugins') -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Filter *.uplugin } | Select-Object -First 1
  $pluginName = if ($plugin) { $plugin.BaseName } else { 'the plugin' }
  Write-Status 'Autopilot started.'
  while ($true) {
    $task = Get-NextTask
    if (-not $task) { Write-Status 'No open tasks in autopilot\TASKS.md. Add one and start the autopilot again.'; break }
    if (Test-EditorOpen) {
      Write-Status 'The Unreal editor has this project open, so the proof could not build. Close it and start the autopilot again.'
      $exitCode = 4; break
    }
    $id = $task.Id
    $passed = $false
    $feedback = ''
    for ($try = 1; $try -le $MaxTries -and -not $passed; $try++) {
      Write-Status "$id try $try of ${MaxTries}: $($task.Text)"
      $before = Get-Changed
      $kept = @{}
      foreach ($file in $Protected + 'autopilot/TASKS.md') {
        $full = Join-Path $Root $file
        if (Test-Path -LiteralPath $full) { $kept[$file] = [IO.File]::ReadAllBytes($full) }
      }

      $prompt = @"
You are working on an Unreal Engine 5.8 plugin project in the current folder. Read AGENTS.md first and follow it.

Do this one task from autopilot/TASKS.md:
$id $($task.Text)
$($task.Details -join "`n")

Rules for this run:
- You cannot run Unreal Engine here. Do not try to build the project or start the editor. Write the code and its
  automation test. After you finish, the autopilot runs the build and the tests itself (autopilot/proof.ps1).
- Every behaviour you add needs an automation test whose name starts with "$pluginName." so the proof finds it.
- Do not edit autopilot/run.ps1, autopilot/proof.ps1 or autopilot/TASKS.md, and do not mark the task as done.
- Do not run git add, git commit or anything else that changes git state. The autopilot saves your work.
- Keep the change as small as the task allows.
- The autopilot started you for this task, so its lock file (autopilot/runs/runner.lock) is yours: edit the files.
$feedback
"@
      $promptFile = Join-Path $Runs "$id-try$try-prompt.txt"
      $report = Join-Path $Runs "$id-try$try-report.md"
      [IO.File]::WriteAllText($promptFile, $prompt, $Utf8)
      # The prompt goes in as a file, so its characters reach Codex unchanged.
      $codexExit = Invoke-Hidden 'cmd.exe' "/d /c codex exec --skip-git-repo-check --sandbox workspace-write -o `"$report`" -" `
        (Join-Path $Runs "$id-try$try-codex.txt") $CodexMinutes $promptFile

      # A task may not change the proof, the autopilot or the task list: put them back exactly as they were.
      foreach ($file in $kept.Keys) {
        $full = Join-Path $Root $file
        $now = if (Test-Path -LiteralPath $full) { [IO.File]::ReadAllBytes($full) } else { [byte[]]@() }
        if ([Convert]::ToBase64String($now) -ne [Convert]::ToBase64String($kept[$file])) {
          [IO.File]::WriteAllBytes($full, $kept[$file])
          Write-Status "$id changed $file, which a task may not do. It was put back."
        }
      }
      if ($null -eq $codexExit) { Write-Status "$id Codex was still working after $CodexMinutes minutes and was stopped."; $exitCode = 3; break }
      if ($codexExit -ne 0) {
        Write-Status "$id Codex did not finish (exit code $codexExit). It may be out of usage or signed out. The task stays open."
        $exitCode = 3; break
      }

      $after = Get-Changed
      $mine = @($after.Keys | Where-Object { $_ -notin $Protected -and $_ -ne 'autopilot/TASKS.md' -and (-not $before.ContainsKey($_) -or $before[$_] -ne $after[$_]) })
      if (-not $mine.Count) {
        $feedback = "Last time you changed no files. Make the change by editing files."
        Write-Status "$id try ${try}: Codex changed no files."
        continue
      }

      $proofLog = Join-Path $Runs "$id-try$try-proof.txt"
      $proofArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'proof.ps1')`""
      $proofExit = Invoke-Hidden 'powershell.exe' $proofArgs $proofLog $ProofMinutes $null
      $lastLine = @(Get-Content -LiteralPath $proofLog -ErrorAction SilentlyContinue | Where-Object { $_.Trim() }) | Select-Object -Last 1
      $passed = ($proofExit -eq 0) -and ("$lastLine" -like 'PROOF PASSED*')
      if ($passed) {
        Set-TaskMark $id 'x'
        foreach ($file in $mine + 'autopilot/TASKS.md') { & git add -- $file 2>&1 | Out-Null }
        $title = "Autopilot ${id}: $($task.Text.Substring(0, [Math]::Min(60, $task.Text.Length)))"
        $body = "Built by Codex through the autopilot. Proof passed: autopilot\proof.ps1 (Fab's rules, build, automation tests, packaging build)."
        & git commit -q -m $title -m $body 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { & git -c user.name=Autopilot -c user.email=autopilot@localhost commit -q -m $title -m $body 2>&1 | Out-Null }
        if ($LASTEXITCODE -ne 0) {
          Write-Status "$id passed its proof but could not be saved to git. Its files are still in the folder. Stopping."
          $exitCode = 5; break
        }
        Write-Status "$id done: the proof passed and $($mine.Count) file(s) were saved to git."
      } else {
        $tail = (@(Get-Content -LiteralPath $proofLog -Tail 40 -ErrorAction SilentlyContinue) -join "`n")
        $feedback = "Last time the proof failed. This is the end of its log:`n$tail"
        Write-Status "$id try ${try}: the proof did not pass. $lastLine"
      }
    }
    if ($exitCode -ne 0) { break }
    if (-not $passed) {
      Set-TaskMark $id '!'
      Write-Status "$id failed its proof $MaxTries times and is marked [!]. Its files are still in the folder, not saved to git. Stopping."
      $exitCode = 1; break
    }
  }
} finally {
  Remove-Item -LiteralPath $Lock -Force -ErrorAction SilentlyContinue
  Write-Status 'Autopilot stopped.'
}
exit $exitCode