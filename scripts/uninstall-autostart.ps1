<#
.SYNOPSIS
  Removes the cmfProductManagement logon autostart: the Startup shortcut and %LOCALAPPDATA%\cmfProductManagement.

.DESCRIPTION
  Does not stop a running server. Use scripts\stop.ps1 for that.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$lnkPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'cmfProductManagement.lnk'
if (Test-Path -LiteralPath $lnkPath) {
    Remove-Item -LiteralPath $lnkPath -Force
    Write-Host "Removed shortcut: $lnkPath"
} else {
    Write-Host "No shortcut found at: $lnkPath"
}

$appDir = Join-Path $env:LOCALAPPDATA 'cmfProductManagement'
if (Test-Path -LiteralPath $appDir) {
    Remove-Item -LiteralPath $appDir -Recurse -Force
    Write-Host "Removed folder: $appDir (launcher copy and logs)"
} else {
    Write-Host "No folder found at: $appDir"
}

Write-Host 'Autostart removed. A running server was NOT stopped; run scripts\stop.ps1 to stop it.'
