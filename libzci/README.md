# libzci workspace

Independent Rust workspace for the reusable izci engine. The existing izci
frontend, Tauri/Android shells, assets and profiles remain independent.

R1 and R2 are verified; R3's native reference Opus CLI is verified on
`x86_64-pc-windows-msvc`, including real device transport, a full 30-second run
and user-confirmed clean listening. See the [evidence](../docs/libzci/implementation-log.md).
R4 now has working reference browser output and headless end-to-end checks;
hidden-tab/screen-off and physical-device checks remain pending. M1 adds ordinary
audio, modules, inspection/jobs and both crudes on Windows/headless Chromium.
The M1 validation pass also verifies Android 16 emulator Chrome and fixes source
rate clocks, unknown-duration seeks, short reads and export cancellation; see
the [review evidence](../docs/libzci/implementation-log.md#2026-10-23-m1-validation-and-cleanup).

- `libzci`: control-only session action machine, source/provider contracts,
  generation-tagged jobs, media consumption clock, bounded PCM preparation.
- `libzci-native`: sequential decoder workers, incremental renders, native files,
  fixed-pool SPSC transport and CPAL format/channel/sample conversion.
- `libzci-codecs`: reference libopusfile/Opus provider by default; optional
  libopenmpt/Hively providers behind `modules`. The historical packet decoder
  exists only in comparison tests.
- `libzci-symphonia`: shared native/WASM WAV/PCM, MP3, FLAC and Vorbis provider;
  bounded range reads and exact cancellable restart/discard seeks.
- `libzci-web`: shared Session bindings and bounded output preparation for workers.
- `libzci-audio-web`: import-free, audio-only shared Rust worklet renderer.
- `consumers/crude-pwa`: ordinary audio/modules/reference Opus and optional
  WebCodecs Opus; [build/run/checks](consumers/crude-pwa/README.md).
- `consumers/crude-native`: egui file player; [build/run/checks](consumers/crude-native/README.md).
- `consumers/zci-play`: direct native embedding, without a JS/webview/WASM runtime.

## Native build

Use Rust/Cargo 1.98.1 or a compatible installed release, with the committed
lockfile. On Windows use the x64 MSVC toolchain, C++ Build Tools/Windows SDK,
CMake, Ninja, curl and tar. Acquisition never changes system settings.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File libzci/scripts/acquire-media-deps.ps1
. ./libzci/scripts/windows-toolchain.ps1
python libzci/scripts/build-module-deps.py
cargo build --locked --manifest-path libzci/Cargo.toml -p zci-play --release
.\libzci\target\release\zci-play.exe C:\Music\track.opus
```

If using this checkout's project-local Rust rather than system Cargo, initialize
it in the current PowerShell process before the Cargo command:

```powershell
$env:CARGO_HOME = "$PWD/.local/desktop-toolchain/cargo"
$env:RUSTUP_HOME = "$PWD/.local/desktop-toolchain/rustup"
$env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
```

The GNU/Linux recipe requires Rust, GCC, make, pkg-config, Python 3, curl, tar,
and ALSA development headers. It retains the original autotools path, with
explicit target-specific archives. Its R3 build/run has not been reproduced in
this Windows environment; Windows success does not verify Linux.

```sh
libzci/scripts/acquire-media-deps.sh
libzci/scripts/acquire-module-deps.sh
cargo build --locked --manifest-path libzci/Cargo.toml -p zci-play --release
libzci/target/release/zci-play track.opus
```

The CLI enables modules by default. `--no-default-features` builds a lighter
Opus/ordinary-audio CLI without module archives. Native GUI builds always include
modules. The Windows recipe builds pinned OpenMPT/Hively with MSVC `/MD`;
GNU/Linux retains its target-specific recipe and remains unverified here.

Archives and BUILD-RECORDs live under ignored
`.local/libzci/vendor/<library>/<release>/build-<Rust-target>/`. GNU `.a` archives
are never accepted as MSVC `.lib` inputs. HTTP/TLS support is disabled in opusfile.
MSVC builds use `/MD` and require the normal Microsoft C runtime.

## Checks

Pure core/native checks need no C libraries, fixtures, audio device or browser:

```sh
cargo test --locked --manifest-path libzci/Cargo.toml -p libzci -p libzci-native
```

Reference integration uses separate, ignored CC0 synthetic R3 media, generated
with FFmpeg 8.1.1. The generator records exact commands, binary hash and media
hashes; it does not replace the existing frontend corpus or its pins.

```sh
python libzci/tests/generate-r3-media.py
python libzci/tests/generate-m1-media.py
cargo test --locked --manifest-path libzci/Cargo.toml --workspace --features libzci-native/provider-tests
cargo test --locked --manifest-path libzci/Cargo.toml -p libzci-native --features provider-tests --test audible -- --ignored --nocapture
python libzci/tests/check-cli.py
```

The last two checks require authorized hardware access and use silent master
output, preserving actual device transport without audible playback. Device absence fails the
explicit hardware check; it is not reported as success. `ZCI_PLAY` can select a
release executable for the process-level CLI check. Browser checks are documented in the crude README. Installed-PWA checks begin in M2. Follow [AGENTS.md](../AGENTS.md) for build/runtime authorization.

No SQL/profile, installed PWA or FFI implementation exists yet.
Generated outputs stay in `target/` and `.local/libzci/`; ordinary player data and
grants are preserved. The [roadmap](../docs/libzci/phases.md) owns later work.
