# libzci workspace

Independent Rust workspace for the reusable izci engine. The existing izci
frontend, Tauri/Android shells, assets and profiles remain independent.

R1 and R2 are verified; R3's native reference Opus CLI is verified on
`x86_64-pc-windows-msvc`, including real device transport, a full 30-second run
and user-confirmed clean listening. See the [evidence](../docs/libzci/implementation-log.md).
R4 browser output and M1's additional formats/module recovery remain separate work.

- `libzci`: control-only session action machine, source/provider contracts,
  generation-tagged jobs, media consumption clock, bounded PCM preparation.
- `libzci-native`: sequential decoder workers, incremental renders, native files,
  fixed-pool SPSC transport and CPAL format/channel/sample conversion.
- `libzci-codecs`: reference libopusfile/Opus provider by default; optional
  libopenmpt/Hively providers behind `modules`. The historical packet decoder
  exists only in comparison tests.
- `libzci-web`: shared control-machine driver and existing silent browser proof.
  Host tests pass; this is not reference browser audio or an installed PWA.
- `consumers/zci-play`: direct native embedding, without a JS/webview/WASM runtime.

## Native build

Use Rust/Cargo 1.98.1 or a compatible installed release, with the committed
lockfile. On Windows use the x64 MSVC toolchain, C++ Build Tools/Windows SDK,
CMake, Ninja, curl and tar. Acquisition never changes system settings.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File libzci/scripts/acquire-media-deps.ps1
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
cargo build --locked --manifest-path libzci/Cargo.toml -p zci-play --release
libzci/target/release/zci-play track.opus
```

Optional modules need `acquire-module-deps.sh` and `--features modules`; that
acquisition path currently targets GNU/Linux. Windows module archives are not
part of R3's verified Opus target. No module dependency is needed for Opus.

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
cargo test --locked --manifest-path libzci/Cargo.toml --workspace --features libzci-native/provider-tests
cargo test --locked --manifest-path libzci/Cargo.toml -p libzci-native --features provider-tests --test audible -- --ignored --nocapture
python libzci/tests/check-cli.py
```

The last two checks require authorized hardware access. Device absence fails the
explicit hardware check; it is not reported as success. `ZCI_PLAY` can select a
release executable for the process-level CLI check. Real browser/installed-PWA
checks remain R4. Follow [AGENTS.md](../AGENTS.md) for build/runtime authorization.

No SQL/profile, installed PWA, native GUI or FFI implementation exists yet.
Generated outputs stay in `target/` and `.local/libzci/`; ordinary player data and
grants are preserved. The [roadmap](../docs/libzci/phases.md) owns later work.
