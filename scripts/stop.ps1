<#
.SYNOPSIS
  Stops the cmfProductManagement server (node.exe processes running server\dist\index.js).

.DESCRIPTION
  Matches on the command line, so it also finds servers started by start.cmd or the launcher.
  Does not stop "npm run dev" (tsx watch) processes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$procs = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*server\dist\index.js*' })

if ($procs.Count -eq 0) {
    Write-Host 'No cmfProductManagement server process found.'
    exit 0
}

foreach ($p in $procs) {
    try {
        Stop-Process -Id $p.ProcessId -Force
        Write-Host "Stopped node.exe PID $($p.ProcessId)"
    } catch {
        Write-Warning "Could not stop PID $($p.ProcessId): $($_.Exception.Message)"
    }
}
exit 0
