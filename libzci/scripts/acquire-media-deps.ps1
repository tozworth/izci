# Pinned native reference Opus dependencies for x86_64-pc-windows-msvc.
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$manifest = Get-Content (Join-Path $repo 'libzci/vendor/dependencies.json') -Raw | ConvertFrom-Json
$target = 'x86_64-pc-windows-msvc'
if (-not $CheckOnly) { . (Join-Path $PSScriptRoot 'windows-toolchain.ps1') }
function Run([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit $LASTEXITCODE" }
}
$prefixes = @{}
foreach ($id in @('libogg', 'libopus', 'libopusfile')) {
    $pin = $manifest.libraries | Where-Object id -EQ $id
    if ($pin.status -ne 'pinned-release') { throw "Unpinned dependency: $id" }
    $dest = Join-Path $repo ".local/libzci/vendor/$id/$($pin.pinnedRelease)"
    $sourceRoot = Join-Path $dest 'source'
    $prefix = Join-Path $dest "build-$target"
    New-Item -ItemType Directory -Force $sourceRoot, $prefix | Out-Null
    $archive = Join-Path $sourceRoot ([Uri]$pin.archive).Segments[-1]
    if (-not (Test-Path $archive)) { Run 'curl.exe' @('-L','--fail','--retry','3','-o',$archive,$pin.archive) }
    $digest = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
    if ("sha256:$digest" -ne $pin.digest) { throw "SHA256 mismatch for $id at $archive" }
    $folder = switch ($id) { libogg { "libogg-$($pin.pinnedRelease)" } libopus { "opus-$($pin.pinnedRelease)" } libopusfile { "opusfile-$($pin.pinnedRelease)" } }
    $src = Join-Path $sourceRoot $folder
    if (-not (Test-Path $src)) { Run 'tar.exe' @('xzf',$archive,'-C',$sourceRoot) }
    $prefixes[$id] = $prefix
    if ($CheckOnly) { Write-Output "$id digest verified ($digest)"; continue }
    if ($id -ne 'libopusfile') {
        $build = Join-Path $dest "cmake-$target"
        $cmakeArgs = @('-S',$src,'-B',$build,'-G','Ninja',"-DCMAKE_INSTALL_PREFIX=$prefix",'-DCMAKE_BUILD_TYPE=Release','-DCMAKE_POLICY_VERSION_MINIMUM=3.5','-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL','-DBUILD_SHARED_LIBS=OFF','-DBUILD_TESTING=OFF','-DINSTALL_DOCS=OFF','-DOPUS_BUILD_TESTING=OFF','-DOPUS_BUILD_PROGRAMS=OFF')
        Run 'cmake.exe' $cmakeArgs
        Run 'cmake.exe' @('--build',$build,'--parallel','4')
        Run 'cmake.exe' @('--install',$build)
    } else {
        # opusfile 0.12 has no CMake project. Its four core translation units
        # need no generated config when HTTP is disabled. /MD matches Rust MSVC.
        $obj = Join-Path $dest "objects-$target"
        New-Item -ItemType Directory -Force $obj, (Join-Path $prefix 'lib'), (Join-Path $prefix 'include') | Out-Null
        $objects = @()
        foreach ($unit in @('info','internal','opusfile','stream')) {
            $out = Join-Path $obj "$unit.obj"; $objects += $out
            Run 'cl.exe' @('/nologo','/c','/O2','/MD','/DOP_DISABLE_HTTP','/D_CRT_SECURE_NO_WARNINGS',"/I$src/include", "/I$($prefixes.libogg)/include", "/I$($prefixes.libopus)/include/opus", "/Fo$out", (Join-Path $src "src/$unit.c"))
        }
        Run 'lib.exe' (@('/nologo',"/OUT:$prefix/lib/opusfile.lib") + $objects)
        Copy-Item -LiteralPath (Join-Path $src 'include/opusfile.h') -Destination (Join-Path $prefix 'include/opusfile.h')
    }
    $compiler = (& $env:ComSpec /d /c 'cl.exe 2>&1' | Select-Object -First 1).ToString()
    @("target: $target", "library: $id $($pin.pinnedRelease)", "archive: $($pin.archive)", "digest: $($pin.digest)", "compiler: $compiler", 'runtime: /MD (dynamic MSVC CRT)', 'recipe: libzci/scripts/acquire-media-deps.ps1', 'HTTP/TLS: disabled; no opusurl', "built: $([DateTime]::UtcNow.ToString('O'))") | Set-Content (Join-Path $prefix 'BUILD-RECORD.txt')
}
