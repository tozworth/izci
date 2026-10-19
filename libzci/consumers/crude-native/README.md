# Native crude

Dense egui/eframe file player, using `NativeRuntime` public commands, snapshots,
independent probe and streaming raw render jobs. No database, webview or JS.

Windows (configured Rust/MSVC environment):

```powershell
. ./libzci/scripts/windows-toolchain.ps1
python libzci/scripts/build-module-deps.py
cargo run --locked --manifest-path libzci/Cargo.toml -p crude-native
```

Reference Opus archives must also be acquired with `acquire-media-deps.ps1`.
GNU/Linux uses `acquire-media-deps.sh` and `acquire-module-deps.sh`, plus the
system development packages required by CPAL/eframe/rfd. Linux is unverified.

Open a path or use Browse, then Play. The session loads paused. Seek uses seconds;
volume is linear 0..1. Controls are disabled from provider capabilities. The
pattern window follows the decoder position, which can lead audible output.
Independent probe/render never changes playback. Raw render exports stereo
float32 little-endian at 48000 Hz. Cancel jobs and Dispose release their work.
Unknown-extension verification defaults off and affects only independent probing.
