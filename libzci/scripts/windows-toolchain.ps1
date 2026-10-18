# Load an x64 MSVC environment in this process only. Does not install tools.
$ErrorActionPreference = 'Stop'
$vswhere = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe"
$install = if (Test-Path $vswhere) { & $vswhere -all -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1 }
if (-not $install) { $install = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/2022/BuildTools" }
$devcmd = Join-Path $install 'Common7/Tools/VsDevCmd.bat'
if (-not (Test-Path $devcmd)) { throw 'Install Visual Studio C++ Build Tools (x64) and the Windows SDK.' }
$vars = & $env:ComSpec /d /c "call `"$devcmd`" -no_logo -arch=x64 -host_arch=x64 >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'MSVC environment initialization failed.' }
foreach ($line in $vars) {
    if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
