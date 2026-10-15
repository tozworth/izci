param(
  [Parameter(Mandatory = $true)]
  [string]$EmsdkRoot
)

$ErrorActionPreference = 'Stop'
$sourceRevision = 'f393ca7c6416f00bcb574b334a7e8b57dcb19eb2'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('izci-ahx-build-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $scratch 'hivelytracker'
$emcc = Join-Path $EmsdkRoot 'upstream\emscripten\emcc.exe'

if (-not (Test-Path -LiteralPath $emcc)) {
  throw "Emscripten compiler not found at $emcc"
}

New-Item -ItemType Directory -Path $scratch | Out-Null
git clone --quiet https://github.com/pete-gordon/hivelytracker.git $source
git -C $source checkout --quiet $sourceRevision

$replayer = Join-Path $source 'hvl2wav'
$outputDirectory = Join-Path $repoRoot 'public\vendor'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

& $emcc `
  (Join-Path $replayer 'replay.c') `
  (Join-Path $PSScriptRoot 'ahx-wrapper.c') `
  "-I$replayer" `
  -O3 `
  --no-entry `
  -s STANDALONE_WASM=1 `
  -s FILESYSTEM=0 `
  -s ALLOW_MEMORY_GROWTH=1 `
  -s EXPORTED_FUNCTIONS=_malloc,_free,_ahx_init,_ahx_load,_ahx_unload,_ahx_select_subsong,_ahx_decode_frame,_ahx_set_interpolation,_ahx_set_ramping,_ahx_set_playback_factors,_ahx_set_channel_mute,_ahx_seek_frame,_ahx_ended,_ahx_mix_buffer,_ahx_frame_samples,_ahx_current_frame,_ahx_duration_frames,_ahx_subsong_count,_ahx_channel_count,_ahx_instrument_count,_ahx_order_count,_ahx_title,_ahx_track_length,_ahx_track_count,_ahx_current_order,_ahx_current_row,_ahx_position_track,_ahx_position_transpose,_ahx_step_note,_ahx_step_instrument,_ahx_step_effect,_ahx_step_effect_param,_ahx_instrument_name `
  -o (Join-Path $outputDirectory 'hively-replay.wasm')

if ($LASTEXITCODE -ne 0) {
  throw "Emscripten failed with exit code $LASTEXITCODE"
}

Write-Output (Join-Path $outputDirectory 'hively-replay.wasm')
