# Native crude

Dense egui/eframe file player, using `NativeRuntime` public commands, snapshots,
independent probe and streaming raw render jobs. M2 adds the shared Rust queue
and native SQLite profile, without a webview or JS runtime.

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

The default profile is `.local/libzci/profiles/crude-native-v3/` relative to the
launch directory. `--profile DIR` selects another independent libzci profile.
The file lock is acquired before SQL/output ownership; a second process using
the same profile fails visibly. Queue duplicates, moves, remove/play, up-next,
next/previous, shuffle/repeat, previous restart seconds, master settings and
position/subsong survive reopen. Restore never autoplays. Append files adds a
batch without selecting it; queue Play selects an occurrence. Unavailable paths
preserve the saved queue and resume position. Playback checkpoints at two-second
intervals and on orderly close; abrupt termination can lose the last interval.
The hidden test uses a transient profile.

ReplayGain / R128 offers Off/Track/Album, fallback, tagged preamp, missing-tag
gain, R128 target and peak-tag clipping prevention. Core sessions resolve the
effective gain; normalization precedes Raf/master and does not alter raw renders.
The default is off. R128 defaults to -18 LUFS (+5 dB from its tag reference).
Per-link optional normalization for chained Opus is still under development.

Expand Library / managed folders for catalog queries, Library/Favorites,
ratings, bookmarks, queue append and root settings. Add folder starts bounded
background enumeration/probing; rescan reconciles only that root after success.
Cancel, corrupt files and missing/denied roots preserve prior membership/facts.
Recursion, scan at launch, unknown verification and probe concurrency are stored
per root. Scans do not open audio output. Catalog metadata is normalized in Rust;
artwork/images and continuous-play count accrual remain M3 work.

Lyrics offers independent on-demand embedded reads and UTF-8 text/LRC sidecars,
shared Rust timing/cue lookup, follow/seek controls and display delay. Reading
lyrics creates no decoder or audio output and leaves the current music alone.
Documents remain transient. Readers support ID3 USLT/lyric TXXX and FLAC/Vorbis/
Opus comments; compressed/encrypted lyric frames are unsupported. Jobs can be
cancelled, text/packet/cue expansion is bounded, and ordinary metadata facts omit
embedded payloads. The native source-job tests require no codec libraries.

Headless checks (after generating M1 fixtures):

```powershell
cargo test --locked --manifest-path libzci/Cargo.toml -p crude-native
.\libzci\target\release\crude-native.exe --headless-test .local/libzci/media/m1/tone.hvl
```

The first check draws the real egui content without a window/device and runs
independent jobs. The second creates a hidden native eframe window and a real
CPAL device, mutes before Play, and exercises transport/module/probe/disposal.
It times out/fails explicitly if a window/device or transport cannot work.
