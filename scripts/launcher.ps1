<#
.SYNOPSIS
  Logon launcher for cmfProductManagement.

.DESCRIPTION
  Meant to run from %LOCALAPPDATA%\cmfProductManagement (C:), copied there by install-autostart.ps1.
  It does not depend on N: itself: it polls until <RepoPath>\scripts\start.cmd exists (N: is
  BitLocker and is unlocked manually after logon), then runs start.cmd in background mode.
  Writes its own log to %LOCALAPPDATA%\cmfProductManagement\launcher.log.
#>
[CmdletBinding()]
param(
    [string]$RepoPath = 'N:\Product\cmfProductManagement',
    [switch]$OpenBrowser,
    [int]$PollSeconds = 20,
    [int]$MaxHours = 12
)

$ErrorActionPreference = 'Stop'

$AppDir    = Join-Path $env:LOCALAPPDATA 'cmfProductManagement'
$LogFile   = Join-Path $AppDir 'launcher.log'
$StartLog  = Join-Path $AppDir 'start.log'
$HealthUrl = 'http://127.0.0.1:5180/api/health?quick=1'
$CaCert    = 'N:\Product\.claude\cmf-root-ca.pem'

function Write-Log([string]$Message) {
    try {
        if (-not (Test-Path -LiteralPath $AppDir)) {
            New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
        }
        $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message
        Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    } catch {
        # logging must never stop the launcher
    }
}

function Test-Health {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

try {
    Write-Log "Launcher started. RepoPath=$RepoPath OpenBrowser=$([bool]$OpenBrowser)"

    if (Test-Health) {
        Write-Log 'Server already answers on 127.0.0.1:5180. Nothing to do.'
        exit 0
    }

    $start    = Join-Path $RepoPath 'scripts\start.cmd'
    $deadline = (Get-Date).AddHours($MaxHours)
    while (-not (Test-Path -LiteralPath $start)) {
        if ((Get-Date) -gt $deadline) {
            Write-Log "Gave up after $MaxHours h: $start not found (drive still locked?)."
            exit 1
        }
        Start-Sleep -Seconds $PollSeconds
    }
    Write-Log "Found $start"

    if (-not $env:NODE_EXTRA_CA_CERTS -and (Test-Path -LiteralPath $CaCert)) {
        $env:NODE_EXTRA_CA_CERTS = $CaCert
    }

    $startArgs = '--background'
    if (-not $OpenBrowser) { $startArgs += ' --no-browser' }

    # cmd /c with an quoted script path needs the outer quote pair; output goes to start.log
    $cmdArgs = '/c ""{0}" {1} > "{2}" 2>&1"' -f $start, $startArgs, $StartLog
    $cmdExe  = Join-Path $env:SystemRoot 'System32\cmd.exe'
    # Not -Wait: in Windows PowerShell 5.1 it also waits for child processes, i.e. the server itself.
    $p = Start-Process -FilePath $cmdExe -ArgumentList $cmdArgs -WindowStyle Hidden -PassThru
    $p.WaitForExit()
    Write-Log "start.cmd exited with code $($p.ExitCode) (output: $StartLog)"

    if (Test-Health) {
        Write-Log 'Server is up at http://127.0.0.1:5180.'
        exit 0
    }

    Write-Log "Server did not answer the health check. See $StartLog and $RepoPath\logs\server.err.log"
    exit 1
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
