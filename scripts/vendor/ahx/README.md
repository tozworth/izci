# HivelyTracker AHX replay core

`public/vendor/hively-replay.wasm` is built from the BSD-3-Clause HivelyTracker
replayer at commit `f393ca7c6416f00bcb574b334a7e8b57dcb19eb2`, using
Emscripten 6.0.12.

The upstream source is <https://github.com/pete-gordon/hivelytracker>. Run
`scripts/vendor/ahx/build.ps1 -EmsdkRoot <path-to-emsdk>` to reproduce the WASM
binary. The script downloads that exact source revision into a temporary folder;
upstream source is not modified or checked into izci.

The wrapper applies tempo to the samples rendered per replay tick and pitch to
the voice and ring-modulator mixer steps. Both factors range from 0.25 to 4 and
survive seeks and subsong changes. Transport, duration, and pattern boundaries
remain in original song seconds. Frame buffers reserve the slowest supported
tempo at load time; rendering carries fractional samples between ticks.

