param([Parameter(Mandatory = $true)][string]$WorkspaceRoot)

$ErrorActionPreference = 'Stop'
$localExecutables = @(
    [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot '.local/desktop/izci.exe')),
    [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot '.local/desktop-next/izci.exe'))
)
$instances = @(Get-CimInstance Win32_Process -Filter "Name = 'izci.exe'" |
    Where-Object { $_.ExecutablePath -and $localExecutables -contains $_.ExecutablePath })

foreach ($instance in $instances) {
    $playerProcess = Get-Process -Id $instance.ProcessId -ErrorAction SilentlyContinue
    if (-not $playerProcess) { continue }
    # Prefer the native close handler, which saves window placement. A stuck
    # player or an independent tool window must not keep the executable locked.
    if ($playerProcess.CloseMainWindow() -and $playerProcess.WaitForExit(1500)) { continue }
    # Recheck identity before force termination in case the original PID exited.
    $remaining = Get-CimInstance Win32_Process -Filter "ProcessId = $($instance.ProcessId)"
    if ($remaining -and $remaining.CreationDate -eq $instance.CreationDate -and
        $localExecutables -contains $remaining.ExecutablePath) {
        Stop-Process -Id $instance.ProcessId -Force
        if (-not $playerProcess.WaitForExit(5000)) { throw 'Local izci did not exit.' }
    }
}

ConvertTo-Json -InputObject @($instances | ForEach-Object { $_.ExecutablePath }) -Compress
