# libzci browser file player

The crude opens real Files and plays through pinned libopusfile/Opus, the shared
Rust Session and shared Rust audio processing. WebCodecs is not required.
It also plays WAV/MP3/FLAC/Vorbis through the same native/WASM Symphonia provider,
and MOD/XM/S3M/IT/MO3/AHX/HVL through pinned OpenMPT/Hively. Controls include
Open, Play/Pause, Stop, seek seconds, volume/mute, supported module parameters,
metadata and a bounded decoder pattern window, independent probe/raw render,
job cancellation and Dispose. A new Open after Dispose creates a fresh runtime.

## Build and run

Requires Python 3.12+, CMake, Ninja, Rust 1.98.1 (or a compatible release),
`wasm32-unknown-unknown`, and wasm-bindgen-cli **0.2.129**, matching Cargo.lock.
Use Emscripten **4.0.10**; install the SDK inside the ignored local directory:

```sh
# Repository root; activate without permanent/global environment changes.
git clone --depth 1 --branch 4.0.10 https://github.com/emscripten-core/emsdk.git .local/libzci/emsdk
python .local/libzci/emsdk/emsdk.py install 4.0.10
python .local/libzci/emsdk/emsdk.py activate 4.0.10
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
python libzci/scripts/build-browser-codecs.py
python libzci/scripts/build-browser-modules.py
python libzci/consumers/crude-pwa/scripts/build-wasm.py
npm ci --prefix libzci/consumers/crude-pwa
npm run build --prefix libzci/consumers/crude-pwa
npm run preview --prefix libzci/consumers/crude-pwa
```

`EMSDK` may select another SDK directory containing the pinned release.
Rust/Cargo/wasm-bindgen must be on PATH. Windows native reference builds also
need the MSVC environment described in the workspace README; WASM builds do not.
The shell `scripts/build-wasm.sh` delegates to the same Python recipe.
Use localhost:5197 and click Open/Play to activate audio. Suspended audio resumes
on Play. Failures appear in the snapshot/diagnostics. M2's manifest, service worker,
SQL and offline assets are independent of the ordinary izci PWA. Follow AGENTS.md for
build/server/browser authorization outside an authorized debugging session.

## Durable queue and offline installation (M2)

Open profile selects a named namespace (also `?profile=NAME`; default `default`).
Shared Rust owns occurrence IDs, duplicate append/order/remove/play, up-next,
shuffle cycles/history, repeat, previous restart threshold, settings and SQL.
Native SQLite and official SQLite WASM 3.54.1-build1 execute those same bound
statements. Browser SQL uses `opfs-sahpool` at `/libzci-crude-v1/NAME/` with
`preserveOnInitFailure: true`; no initialization/reset path deletes domain data.
Schema mismatch, quota/busy/commit failures publish no durable success.

Open restorable files uses the genuine FSA picker. Real handles are kept in IDB
`libzci-crude-capabilities-v1-NAME`, separate from SQL. The pending → SQL commit →
completion protocol recovers referenced pending entries and removes orphaned
registry entries. It preserves entries involved in concurrent imports. Startup
only queries permission; Grant access and retry is an explicit user action.
Plain File inputs are labeled non-restorable and never store media bytes in SQL,
IDB or OPFS. All sources stay queued when access is denied or a file disappears.

Web Locks enclose storage, decoder/output and Media Session ownership. Other
windows attach over BroadcastChannel and create no player/SQL worker. Snapshots
use per-client acknowledgments; request/result budgets and durable hashed
receipts suppress duplicate mutations across owner loss. Expired requests fail
instead of replaying. Re-election restores paused and can interrupt audio.
Play still requires browser audio activation. Position checkpoints every two
seconds and on Pause/Stop/Seek; no UI timer drives playback progression.

Production builds emit a separate manifest, icons, asset/API identity and SW.
The inventory includes HTML, nested workers, audio/control/provider/SQL WASM and
loaders. Install verifies every local response/size before completion. Updates
wait for Restart with update; active and old documents retain coherent caches,
and obsolete caches are reclaimed when all remaining clients identify their
version. The SW owns neither SQL nor playback. Install appears when Chromium
offers `beforeinstallprompt`; browser installation UI also works.

After the build, run these sequentially (they share port 5197):

```sh
npm run test:storage --prefix libzci/consumers/crude-pwa
npm run test:m2 --prefix libzci/consumers/crude-pwa
npm run test:update --prefix libzci/consumers/crude-pwa
npm run test:installed --prefix libzci/consumers/crude-pwa
python libzci/tests/check-m2-cli.py
```

The storage check uses real OPFS SQLite, injected busy/commit faults and a real
SQLite page quota. Capability/reopen checks use real OPFS file handles, not
synthetic FSA objects; external picker permission denial/regrant remains an
interactive check. Installed tests use a temporary persistent Chromium profile,
install/launch the app in standalone mode offline, then uninstall it. Set
`ZCI_PWA_HEADED=1` to repeat with a real offscreen browser window. Minimized
windows here still reported `visible`; background/screen-off/OS media controls
and physical Android are explicitly pending, not inferred from these checks.

## Runtime and bounds

The engine worker owns commands, generation invalidation and snapshots. A
sequential decode worker owns File snapshots and reference C handles. C reads
use FileReaderSync Blob slices capped at 32 KiB. Asyncify yields through a task
MessageChannel every 16 reads, and decode yields between blocks, allowing
cancellation during actual scan/seek work without background timer scheduling.
Stop/Seek/Load invalidate immediately; new PCM waits for worklet generation ack.
The landed position is acknowledged by the worklet before PCM begins, including
seeks producing no PCM at EOF. Late blocks are recycled. The same libopusfile policies apply trim and mandatory
header gain once; seek to the exact trimmed end uses native's explicit EOF rule.

Eight 4,096-frame stereo transferable buffers occupy 262,144 bytes. The worklet
also has eight fixed Rust PCM slots, a fixed clock-span table and fixed scratch;
its complete WASM heap is reported as audioHeapBytes. Decode preparation reports
its fixed staging/converter storage separately. The C heap is fixed at 32 MiB;
source size is capped at 1 GiB, chains at 1,024 links, comments at 64 KiB.
No queue scales with file duration. Decoder PCM goes directly to the worklet,
never through document state. UI and output reports use one in-flight message
and acknowledgment; terminal failures also travel as explicit outcomes.

Symphonia supports mono/stereo at 8–192 kHz and reads at most 32 KiB. Exact
restart/discard seeks yield every bounded chunk; they trade seek speed for
deterministic codec priming. Modules require a declared full-buffer copy capped
at 64 MiB. OpenMPT's source duration must be finite and under 12 hours; Hively's
duration scan yields every 256 ticks and refuses songs exceeding 30 minutes.
The module heap starts at 128 MiB and is capped at 256 MiB. Diagnostics report
the reference heap, provider heap and Rust memory separately.

Module subsongs/interpolation/channel mutes are available for both providers.
OpenMPT additionally exposes ramping, independent speed/pitch and a finite
0–16 repeat limit. Hively declines those controls with visible capability state;
its current song ends once. Pattern observations are at most 16 rows × 32
channels and follow decoder position. They are transient.

Independent probes create no AudioContext and never decode into playback.
Unknown-extension verification defaults off, applies only to probe jobs, and
may open the background module provider when enabled. Normal playback still
classifies bytes. Independent raw renders use bounded output chunks; the UI
offers a File System Access export (stereo f32 LE / 48 kHz) when available and
otherwise displays render analysis. Job cancellation/disposal releases workers.

Optional WebCodecs Opus is off by default, for single-link mapping-family-0
mono/stereo only. It uses the shared Rust Ogg CRC/lacing/header reader and Rust
pre-skip/end-trim/header-gain timeline. Configure without an OpusHead description
to avoid applying those adjustments twice. Seeks restart/discard and match a
sequential reference suffix; optimized opusfile seek can have a short preroll
transient. Unavailable configurations/chains use reference Opus. No ordinary
audio or module support depends on WebCodecs.

Output consumption spans and latency estimates drive position; starvation is
silence/Pending, not EOF. Ended requires decoder EOF and final audible drain.
The audio-only WASM is built separately with no JS imports, control machine,
codec or database. Document Media Session actions issue commands and positions
come from snapshots. OS action exposure and physical background survival require
separate device checks; the document contains no silent transport anchor yet.

## Validation

Generate R3 inputs with pinned FFmpeg 8.1.1 and build the native reference CLI
first (workspace README), then:

```sh
python libzci/tests/generate-r4-media.py
python libzci/tests/generate-m1-media.py
npm exec --prefix libzci/consumers/crude-pwa -- playwright install chromium
npm run typecheck --prefix libzci/consumers/crude-pwa
npm test --prefix libzci/consumers/crude-pwa
npm run test:callbacks --prefix libzci/consumers/crude-pwa
npm run test:browser --prefix libzci/consumers/crude-pwa
npm run test:m1 --prefix libzci/consumers/crude-pwa
npm run test:webcodecs --prefix libzci/consumers/crude-pwa
```

Android Chrome checks use the dedicated Android 16 emulator, started without
a window or host audio. Generate R3/R4/M1 media and build the native CLI/WASM
as above, then run these sequentially (the browser suites share port 5197):

```sh
npm run android:emulator -- start
npm run test:android --prefix libzci/consumers/crude-pwa
npm run android:emulator -- stop
```

The Android runner verifies the AVD identity, uses ADB reverse for a temporary
loopback server, sends File bytes over the debugging connection, and closes
Chrome/server/forwarding afterward. It tests actual worklet transport, pause,
seek, independent probes, module controls, unknown-duration FLAC and final
drain; every sample is compared with the native renderer under delayed buffer
recycling. Inputs include Opus header gain/chains, all M1 formats and 96/192 kHz
WAV. Evidence is `.local/libzci/review-android-evidence.json`. This validates
Chrome in the emulator; libzci is not integrated into the separate APK yet.

Callback tests start a temporary development server; browser tests use the
production build on a temporary preview server. Both close their server/browser.
Fresh profiles, dedicated port 5197 and ignored fixture/output paths preserve
ordinary izci data/grants. Native reference renders include seeks (Opus preroll
can differ from slicing a continuous render). Tests compare every decoded sample,
exercise long backpressure, 44.1 kHz tails, gain/chain/corrupt cases, cancel a
1,000-link scan, and use actual AudioContext/worklet output with AudioDecoder
disabled. Production tests cover full 30-second output, pause/seek/stop/mute,
source access loss, missing codec assets, suspension, a debugger-paused decoder,
and a stalled UI. Raw WASM tests verify exact marked samples and fixed memory.

Evidence lives in `.local/libzci/r4-*-evidence.json` and the implementation log.
Headless foreground/output success does not establish hidden-tab, screen-off,
physical Android, hardware listening or installed/offline behavior. Record each
of those separately; no physical device result is inferred from emulation.
