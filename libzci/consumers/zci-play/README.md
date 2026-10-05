# zci-play (Phase 2.2)

aplay-style native CLI over libzci: open one media source, play it,
report failures, terminate cleanly on EOF or interruption. Opus is the
first useful path; MOD/Hively ride the registered providers. No
database, no profile (`--profile` arrives with storage in Phase 3.2);
the ordinary player's profile is never touched.

## Build and run

```sh
cargo run --manifest-path libzci/Cargo.toml -p zci-play -- <path>
cargo run --manifest-path libzci/Cargo.toml -p zci-play -- --diagnostics --volume 0.2 <path>
cargo run --manifest-path libzci/Cargo.toml -p zci-play -- --render-pcm out.pcm <path>
```

The reference media libraries must be built first (once):

```sh
libzci/scripts/acquire-media-deps.sh
libzci/scripts/acquire-module-deps.sh
```

## Options

`--device NAME` (default device), `--volume V` linear 0.0–1.0,
`--start SECONDS`, `--subsong N` (module content only),
`--diagnostics` (stderr), `--render-pcm FILE` (stereo float32 LE PCM
at 48000 Hz, no device opened). Parsing only converts arguments to
core commands; selection, transport, and DSP stay in libzci.

A rendered file plays back with, for example:

```sh
aplay -f FLOAT_LE -c 2 -r 48000 out.pcm
```

## Exit status

0 on EOF success, 2 on usage/media/device failures (each with an
actionable stderr hint), 130 on Ctrl-C interruption.

## Native independence

The binary links libc/libm/ALSA/libstdc++ only — no JS engine,
webview, or WASM interpreter (`ldd` verified). It embeds the native
library directly; it never shells out to FFmpeg or a browser player.
