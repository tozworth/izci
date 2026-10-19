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

Headless checks (after generating M1 fixtures):

```powershell
cargo test --locked --manifest-path libzci/Cargo.toml -p crude-native
.\libzci\target\release\crude-native.exe --headless-test .local/libzci/media/m1/tone.hvl
```

The first check draws the real egui content without a window/device and runs
independent jobs. The second creates a hidden native eframe window and a real
CPAL device, mutes before Play, and exercises transport/module/probe/disposal.
It times out/fails explicitly if a window/device or transport cannot work.
