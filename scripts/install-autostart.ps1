<#
.SYNOPSIS
  Installs cmfProductManagement to start at Windows logon for the current user.

.DESCRIPTION
  1. Copies scripts\launcher.ps1 to %LOCALAPPDATA%\cmfProductManagement\
  2. Creates %APPDATA%\...\Startup\cmfProductManagement.lnk that runs the launcher hidden.
  Re-run after editing launcher.ps1 (the C: copy is a snapshot).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -OpenBrowser
#>
[CmdletBinding()]
param(
    [string]$RepoPath,
    [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
# $PSScriptRoot is empty in param defaults on Windows PowerShell 5.1, so default here
if (-not $RepoPath) { $RepoPath = Split-Path -Parent $PSScriptRoot }

$RepoPath    = (Resolve-Path -LiteralPath $RepoPath).Path
$launcherSrc = Join-Path $PSScriptRoot 'launcher.ps1'
if (-not (Test-Path -LiteralPath $launcherSrc)) {
    throw "Launcher not found: $launcherSrc"
}

$appDir = Join-Path $env:LOCALAPPDATA 'cmfProductManagement'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
$launcher = Join-Path $appDir 'launcher.ps1'
Copy-Item -LiteralPath $launcherSrc -Destination $launcher -Force
Write-Host "Copied launcher to: $launcher"

$startupDir = [Environment]::GetFolderPath('Startup')
$lnkPath    = Join-Path $startupDir 'cmfProductManagement.lnk'
$psExe      = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

$argLine = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -RepoPath "{1}"' -f $launcher, $RepoPath
if ($OpenBrowser) { $argLine += ' -OpenBrowser' }

$shell = New-Object -ComObject WScript.Shell
try {
    $sc = $shell.CreateShortcut($lnkPath)
    $sc.TargetPath       = $psExe
    $sc.Arguments        = $argLine
    $sc.WorkingDirectory = $appDir
    $sc.WindowStyle      = 7
    $sc.Description      = 'Starts cmfProductManagement at logon'
    $sc.Save()
} finally {
    [Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
}

Write-Host "Created shortcut: $lnkPath"
Write-Host "  Target:    $psExe"
Write-Host "  Arguments: $argLine"
Write-Host "Autostart installed. The server starts at next logon, once $RepoPath\scripts\start.cmd is reachable (unlock N:)."
Write-Host "Logs: $appDir\launcher.log and $appDir\start.log"
