$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$testRoot = Join-Path $projectRoot 'test-output'
$interactiveApps = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Invoice Studio.exe' -and $_.CommandLine -notlike "*$testRoot*" }
if ($interactiveApps) { throw 'An interactive Invoice Studio session is running. Keep it open; defer installer lifecycle tests to avoid interrupting user work.' }
$installRoot = [IO.Path]::GetFullPath((Join-Path $testRoot ('installed app Unicode ' + [char]0x03A9)))
if (-not $installRoot.StartsWith([IO.Path]::GetFullPath($testRoot) + [IO.Path]::DirectorySeparatorChar)) { throw 'Install path is outside the test workspace.' }
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Invoice Studio.lnk'
$menuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Invoice Studio.lnk'
if (Test-Path -LiteralPath $desktopShortcut) {
  $existingTarget = (New-Object -ComObject WScript.Shell).CreateShortcut($desktopShortcut).TargetPath
  if (-not $existingTarget.StartsWith([IO.Path]::GetFullPath($testRoot) + [IO.Path]::DirectorySeparatorChar)) { throw 'An existing user installation shortcut was found; stop to protect it.' }
  if (-not (Test-Path -LiteralPath $existingTarget)) {
    $lastResultFile = Join-Path $testRoot 'packaged-result.json'
    if (Test-Path -LiteralPath $lastResultFile) {
      $candidateTarget = (Get-Content -Raw -Encoding utf8 -LiteralPath $lastResultFile | ConvertFrom-Json).executable
      $unicodeLink = [Text.Encoding]::Unicode.GetString([IO.File]::ReadAllBytes($desktopShortcut))
      if ($candidateTarget.StartsWith([IO.Path]::GetFullPath($testRoot) + [IO.Path]::DirectorySeparatorChar) -and $unicodeLink.Contains($candidateTarget)) { $existingTarget = $candidateTarget }
    }
  }
  $priorUninstaller = Join-Path (Split-Path $existingTarget -Parent) 'Uninstall Invoice Studio.exe'
  if (Test-Path -LiteralPath $priorUninstaller) { Start-Process -FilePath $priorUninstaller -ArgumentList '/S /currentuser' -PassThru -Wait -WindowStyle Hidden | Out-Null }
}
if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $menuShortcut)) { throw 'A shortcut still exists; stop rather than overwrite it.' }
$installer = Join-Path $projectRoot 'release\Invoice-Studio-3.0.1-Setup-x64.exe'
$install = Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$installRoot" -PassThru -Wait -WindowStyle Hidden
if ($install.ExitCode -ne 0) { throw "Installer failed: $($install.ExitCode)" }
$executable = Join-Path $installRoot 'Invoice Studio.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Installed executable is missing.' }
& node (Join-Path $PSScriptRoot 'packaged-smoke.cjs') $executable
if ($LASTEXITCODE -ne 0) { throw 'Installed app smoke test failed.' }
$result = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $testRoot 'packaged-result.json') | ConvertFrom-Json
$dataFolder = $result.restart.folder
$shortcutPresent = Test-Path -LiteralPath $desktopShortcut
if (-not $shortcutPresent) { throw 'Desktop shortcut was not created.' }
$wscript = New-Object -ComObject WScript.Shell
$target = $wscript.CreateShortcut($desktopShortcut).TargetPath
# WScript's ANSI target property can best-fit non-ASCII names. The link itself
# must contain the Unicode target and it must actually launch the correct app.
$unicodeLink = [Text.Encoding]::Unicode.GetString([IO.File]::ReadAllBytes($desktopShortcut))
if (-not $unicodeLink.Contains($executable)) { throw 'Desktop shortcut lacks the expected Unicode target.' }
& node (Join-Path $PSScriptRoot 'shortcut-smoke.cjs') $desktopShortcut $dataFolder
if ($LASTEXITCODE -ne 0) { throw 'Actual desktop shortcut launch failed.' }
$target = $executable
# Reinstall the same release to exercise preservation without changing any user database.
$upgrade = Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$installRoot" -PassThru -Wait -WindowStyle Hidden
if ($upgrade.ExitCode -ne 0) { throw 'Reinstall failed.' }
& node (Join-Path $PSScriptRoot 'packaged-smoke.cjs') $executable $dataFolder
if ($LASTEXITCODE -ne 0) { throw 'Saved data was not preserved through reinstall.' }
$uninstaller = Join-Path $installRoot 'Uninstall Invoice Studio.exe'
if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Uninstaller missing.' }
Start-Process -FilePath $uninstaller -ArgumentList '/S /currentuser' -PassThru -Wait -WindowStyle Hidden | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $dataFolder 'InvoiceStudio.db'))) { throw 'Uninstall removed the test database.' }
@{installer='passed';desktopShortcut=$shortcutPresent;shortcutTarget=$target;reinstallPreservedData=$true;uninstallPreservedData=$true;installRoot=$installRoot;dataFolder=$dataFolder} | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath (Join-Path $testRoot 'installer-result.json')
Write-Output 'Installer, desktop shortcut, reinstall and uninstall data preservation checks passed.'
