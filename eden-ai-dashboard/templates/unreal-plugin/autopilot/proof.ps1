# Proof for this plugin. It passed only when the exit code is 0 and the last line starts with PROOF PASSED.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File autopilot\proof.ps1
#
# The full proof, in this order:
#   1. Fab's rules that can be read from the files (copyright line, file names, .uplugin fields, dependencies).
#   2. Build the host project with the plugin.
#   3. Run the plugin's automation tests.
#   4. Epic's own packaging build (RunUAT BuildPlugin with strict includes). Fab runs this on every upload.
#   5. Write the upload package dist\<Plugin>-<version>.zip from the plugin's files.
#
#   -Quick         steps 1 to 3 only. Faster, but NOT the proof: it ends with QUICK CHECK PASSED.
#   -CheckPackage  builds nothing: checks step 1 and that the zip is there, complete and newer than every plugin
#                  file. Run it right before an upload. It ends with PACKAGE CHECK PASSED.
#
# Close the Unreal editor on THIS project first: an open editor locks the plugin's files and the build fails.
# Another Unreal build may run at the same time: this script waits for its turn.
param(
  [switch]$Quick,
  [switch]$CheckPackage,
  [int]$BuildMinutes = 60,
  [int]$TestMinutes = 20,
  [int]$PackageMinutes = 120
)
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Runs = Join-Path $PSScriptRoot 'runs'
New-Item -ItemType Directory -Force $Runs | Out-Null
$NotShipped = '\\(Binaries|Intermediate|Saved)(\\|$)'

function Stop-Proof($why) {
  Write-Output ''
  Write-Output "PROOF FAILED: $why"
  exit 1
}

# Runs one program hidden, with its output in a log file. Returns '' when it ended with exit code 0,
# otherwise a few words on what went wrong.
function Invoke-Step($file, $arguments, $log, $minutes) {
  $started = Start-Process -FilePath $file -ArgumentList $arguments -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  $null = $started.Handle # without this line Windows PowerShell can report an empty exit code
  if (-not $started.WaitForExit($minutes * 60000)) {
    & taskkill.exe /PID $started.Id /T /F 2>&1 | Out-Null
    return "still running after $minutes minutes, so it was stopped"
  }
  $started.WaitForExit()
  if ($started.ExitCode -ne 0) { return "exit code $($started.ExitCode)" }
  return ''
}

function Get-PackagePath($plugin) {
  $version = (Get-Content -LiteralPath $plugin.FullName -Raw | ConvertFrom-Json).VersionName
  return Join-Path $Root "dist\$($plugin.BaseName)-$version.zip"
}

# The plugin's own files: everything in its folder except what a build makes.
function Get-PluginFiles($plugin) {
  return @(Get-ChildItem -LiteralPath $plugin.DirectoryName -Recurse -File | Where-Object { $_.FullName -notmatch $NotShipped })
}

# Fab's rules that can be read from the files. Returns the problems found, as plain sentences.
function Test-FabRules($plugin, $engine) {
  $problems = @()
  $name = $plugin.BaseName
  $files = Get-PluginFiles $plugin
  foreach ($file in $files | Where-Object { $_.Extension -in '.h', '.hpp', '.inl', '.cpp', '.c', '.cs' }) {
    $first = Get-Content -LiteralPath $file.FullName -TotalCount 1
    if ("$first" -notmatch '^// Copyright \d{4} \S.*') {
      $problems += "$($file.Name) does not start with the copyright line (// Copyright <year> <publisher>. All Rights Reserved.)."
    }
  }
  foreach ($file in $files) {
    $inside = "$name\" + $file.FullName.Substring($plugin.DirectoryName.Length + 1)
    foreach ($part in $inside.Split('\')) {
      if ($part -notmatch '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$') { $problems += "`"$part`" in $inside has a character Fab does not allow. Use English letters, digits and underscores only."; break }
    }
    if ($inside.Length -gt 170) { $problems += "$inside is longer than 170 characters, Fab's limit." }
  }
  $info = $null
  try { $info = Get-Content -LiteralPath $plugin.FullName -Raw | ConvertFrom-Json } catch {}
  if (-not $info) { return $problems + "$($plugin.Name) cannot be read as JSON." }
  $keys = @($info.PSObject.Properties.Name)
  if (-not "$($info.EngineVersion)".Trim()) { $problems += "$($plugin.Name) has no EngineVersion." }
  if (-not "$($info.CreatedBy)".Trim()) { $problems += "$($plugin.Name) has no CreatedBy (the publisher name)." }
  if ('FabURL' -notin $keys) { $problems += "$($plugin.Name) has no FabURL key. Keep it, empty, until the Fab listing exists." }
  elseif ("$($info.FabURL)".Trim() -and "$($info.FabURL)" -notmatch '^com\.epicgames\.launcher://ue/Fab/product/\S+$') {
    $problems += "FabURL in $($plugin.Name) must look like com.epicgames.launcher://ue/Fab/product/<ID>, or stay empty until the listing exists."
  }
  foreach ($module in @($info.Modules)) {
    if (-not @($module.PlatformAllowList).Count) { $problems += "Module $($module.Name) in $($plugin.Name) has no PlatformAllowList." }
  }
  # A plugin for Fab may only depend on plugins that ship with the engine. Plugins installed from Fab into the
  # engine (the Marketplace and Fab folders) are someone else's product and do not count.
  foreach ($needed in @($info.Plugins) | Where-Object { $_ -and $_.Name -and $_.Enabled -ne $false }) {
    if (-not $engine) { $problems += "Cannot check the dependency on $($needed.Name): Unreal Engine was not found."; continue }
    $found = @(Get-ChildItem -LiteralPath (Join-Path $engine 'Engine\Plugins') -Recurse -Filter "$($needed.Name).uplugin" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\Engine\\Plugins\\(Marketplace|Fab)\\' })
    if (-not $found.Count) { $problems += "$($plugin.Name) depends on the plugin $($needed.Name), which does not ship with the engine. Fab does not allow that." }
  }
  return $problems
}

# '' when the package is there, complete and newer than every plugin file. Otherwise what is wrong.
function Test-Package($plugin) {
  $zip = Get-PackagePath $plugin
  $name = $plugin.BaseName
  if (-not (Test-Path -LiteralPath $zip)) { return "there is no package at $zip. Run the proof to build it." }
  $zipTime = (Get-Item -LiteralPath $zip).LastWriteTimeUtc
  $newer = @(Get-PluginFiles $plugin | Where-Object { $_.LastWriteTimeUtc -gt $zipTime })
  if ($newer.Count) { return "the package is older than the source: $($newer[0].Name) changed after $zip was made. Run the proof again to rebuild it." }
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zip)
  try { $entries = @($archive.Entries | ForEach-Object { $_.FullName }) } finally { $archive.Dispose() }
  if ("$name/$name.uplugin" -notin $entries) { return "the package has no $name/$name.uplugin." }
  if (-not @($entries | Where-Object { $_ -like "$name/Source/*" }).Count) { return "the package has no $name/Source folder." }
  $wrong = @($entries | Where-Object { $_ -notlike "$name/*" -or $_ -match '\\' -or $_ -match '/(Binaries|Intermediate|Saved)/' })
  if ($wrong.Count) { return "the package holds something it should not: $($wrong[0])." }
  $missing = @(Get-PluginFiles $plugin | ForEach-Object { "$name/" + $_.FullName.Substring($plugin.DirectoryName.Length + 1).Replace('\', '/') } | Where-Object { $_ -notin $entries })
  if ($missing.Count) { return "the package does not hold $($missing[0]). Run the proof again to rebuild it." }
  return ''
}

$Engine = @($env:UE_ENGINE_DIR, $env:unrealEngineDir, 'C:\Unreal Engine 5\UE_5.8', 'C:\Program Files\Epic Games\UE_5.8') |
  Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'Engine\Build\BatchFiles\Build.bat')) } |
  Select-Object -First 1
$Project = Get-ChildItem -LiteralPath $Root -Filter *.uproject | Select-Object -First 1
if (-not $Project) { Stop-Proof "there is no .uproject file in $Root." }
$Plugins = @(Get-ChildItem -LiteralPath (Join-Path $Root 'Plugins') -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Filter *.uplugin })
if (-not $Plugins.Count) { Stop-Proof 'there is no plugin under Plugins\.' }

Write-Output "== Fab's rules"
foreach ($plugin in $Plugins) {
  $problems = @(Test-FabRules $plugin $Engine)
  foreach ($problem in $problems | Select-Object -First 12) { Write-Output "  $problem" }
  if ($problems.Count) { Stop-Proof "$($problems.Count) of Fab's rules are not met by $($plugin.BaseName). The first: $($problems[0])" }
  Write-Output "  $($plugin.BaseName): copyright lines, file names, .uplugin fields and dependencies are fine."
}

if ($CheckPackage) {
  foreach ($plugin in $Plugins) {
    $problem = Test-Package $plugin
    if ($problem) { Stop-Proof $problem }
    Write-Output "  Package: $(Get-PackagePath $plugin)"
  }
  Write-Output ''
  Write-Output 'PACKAGE CHECK PASSED: the package is complete and newer than every plugin file.'
  exit 0
}

if (-not $Engine) { Stop-Proof 'Unreal Engine 5.8 was not found. Set the UE_ENGINE_DIR environment variable to its folder.' }
$open = @(Get-CimInstance Win32_Process -Filter "Name='UnrealEditor.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($Project.FullName.ToLower()) })
if ($open.Count) { Stop-Proof "the Unreal editor has this project open ($($Project.Name)). Close it and run the proof again." }

$Target = "$($Project.BaseName)Editor"
Write-Output ''
Write-Output "== Build $Target (Win64 Development)"
$buildLog = Join-Path $Runs 'proof-build.txt'
$problem = Invoke-Step (Join-Path $Engine 'Engine\Build\BatchFiles\Build.bat') `
  "$Target Win64 Development `"-Project=$($Project.FullName)`" -WaitMutex" $buildLog $BuildMinutes
Get-Content -LiteralPath $buildLog -Tail 15 -ErrorAction SilentlyContinue
if ($problem) { Stop-Proof "the build did not pass ($problem). Full log: $buildLog" }

foreach ($plugin in $Plugins) {
  $name = $plugin.BaseName
  Write-Output ''
  Write-Output "== Automation tests: $name"
  $testLog = Join-Path $Runs "proof-tests-$name.txt"
  $problem = Invoke-Step (Join-Path $Engine 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe') `
    "`"$($Project.FullName)`" -unattended -nullrhi -nosplash -stdout -FullStdOutLogOutput `"-ExecCmds=Automation RunTests $name`" `"-TestExit=Automation Test Queue Empty`"" `
    $testLog $TestMinutes
  $results = @(Select-String -LiteralPath $testLog -Pattern 'Test Completed\. Result=\{(\w+)\}.*?Path=\{([^}]*)\}' -AllMatches -ErrorAction SilentlyContinue |
    ForEach-Object { $_.Matches })
  foreach ($result in $results) { Write-Output ("  {0}: {1}" -f $result.Groups[1].Value, $result.Groups[2].Value) }
  $failed = @($results | Where-Object { $_.Groups[1].Value -ne 'Success' })
  if ($failed.Count) { Stop-Proof "$($failed.Count) automation test(s) for $name failed. Full log: $testLog" }
  if ($problem) { Stop-Proof "the automation tests for $name did not finish cleanly ($problem). Full log: $testLog" }
  if (-not $results.Count) { Stop-Proof "no automation test ran for $name. The plugin needs at least one test whose name starts with `"$name.`". Full log: $testLog" }
}

if ($Quick) {
  Write-Output ''
  Write-Output "QUICK CHECK PASSED: $Target built and the automation tests passed. This is not the full proof: the packaging build did not run."
  exit 0
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($plugin in $Plugins) {
  $name = $plugin.BaseName
  # A short folder name: the packaging build makes long paths under it.
  $stage = Join-Path $Root 'dist\p'
  $zip = Get-PackagePath $plugin
  Write-Output ''
  Write-Output "== Packaging build: $name (the build Fab runs on an upload)"
  $packageLog = Join-Path $Runs "proof-package-$name.txt"
  # The packaging build does not wait when another Unreal build is running: it stops with "conflicting instance".
  # That says nothing about the plugin, so wait a minute and try again, a few times.
  $try = 0
  do {
    $try++
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    $problem = Invoke-Step (Join-Path $Engine 'Engine\Build\BatchFiles\RunUAT.bat') `
      "BuildPlugin `"-Plugin=$($plugin.FullName)`" `"-Package=$stage`" -TargetPlatforms=Win64 -StrictIncludes -Rocket -WaitForUATMutex" $packageLog $PackageMinutes
    $busy = $problem -and (Select-String -LiteralPath $packageLog -Pattern 'conflicting instance|ConflictingInstance' -Quiet -ErrorAction SilentlyContinue)
    if ($busy -and $try -lt 8) {
      Write-Output "  Unreal is busy with another build. Waiting a minute, then trying again (try $try of 8)."
      Start-Sleep -Seconds 60
    }
  } while ($busy -and $try -lt 8)
  Get-Content -LiteralPath $packageLog -Tail 8 -ErrorAction SilentlyContinue
  # That build was the check. The upload is made from the plugin's own files, not from this PC's build output.
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  if ($problem) {
    if ($busy) { Stop-Proof "Unreal was busy with another build the whole time. Nothing is wrong with the plugin: run the proof again when that build has finished. Full log: $packageLog" }
    Stop-Proof "the packaging build of $name did not pass ($problem). Full log: $packageLog"
  }

  Write-Output ''
  Write-Output "== Package $name"
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
  New-Item -ItemType Directory -Force (Split-Path -Parent $zip) | Out-Null
  # Each entry is added by name with forward slashes. Windows PowerShell's own zip tools write backslashes,
  # and such a zip unpacks into wrongly named files on other systems.
  $archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in Get-PluginFiles $plugin) {
      $entry = "$name/" + $file.FullName.Substring($plugin.DirectoryName.Length + 1).Replace('\', '/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }
  $problem = Test-Package $plugin
  if ($problem) { Stop-Proof $problem }
  Write-Output "  Package: $zip"
}

Write-Output ''
Write-Output "PROOF PASSED: Fab's rules are met, $Target built, the automation tests passed, the packaging build passed and the package was written."
exit 0
