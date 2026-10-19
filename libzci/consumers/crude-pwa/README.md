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
on Play. Failures appear in the snapshot/diagnostics. No manifest, service worker,
SQL, install or offline-launch claim is made before M2. Follow AGENTS.md for
build/server/browser authorization outside an authorized debugging session.

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
