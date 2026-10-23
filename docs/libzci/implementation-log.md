# libzci implementation log

## Historical log notice: 2026-10-18 plan revision

The entries below record the first attempt through `168874dd`. They are retained
as history, including their claims and pending checks. The [source review](review.md)
found execution/output defects that those reported checks do not close.
The [replacement roadmap](phases.md) starts at R1; its R1-R4 and M1-M6 milestones
are all open. No build, test, listening, or browser result was newly produced by
this documentation revision. Append future results under the new milestone IDs.
The old phase labels and next-step statements below do not direct current work.

## 2026-10-23: M1 validation and cleanup

Baseline `1de4e2e6` on `libzci-codex`, initially clean. User authorized review,
fixes, builds and headless/emulator tests. No library/profile/grant changes.
This pass covers R1-R4 and M1; it adds no M2 domain/storage behavior.

Review fixes (each reproduced by a failing regression before correction):

- Worklet ABI discarded the descriptor's source rate and reconstructed every
  block as 48 kHz. A 44.1 kHz source reported 128 instead of 117 frames after
  one output quantum; high-rate sources could also end short. Pass the actual
  source rate into the shared renderer; test each quantum and final drain at
  44.1/96/192 kHz and actual browser output at 96/192 kHz.
- A FLAC STREAMINFO with an unspecified sample count was accepted but browser
  seek clamped every target to zero. Preserve null duration and seek to the
  requested frame when no finite total is known. A new CC0 FLAC variant proves
  native/browser exact suffixes, a 24,000-frame seek, and final consumption.
- Provider selection treated the first short source read as the complete
  header. Fill the bounded probe prefix through partial reads until EOF or the
  byte budget; a two-byte-at-a-time source now selects the same provider.
- Cancelling an export with a blocked sink still wrote all eight queued chunks
  after cancellation. Queued continuations now check job completion before
  touching the sink. The blocked-sink regression now observes one write.

Validation cleanup:

- Main Vitest discovery now stays inside the main application's source/test
  trees. It previously collected libzci's Node test and downloaded Emscripten's
  tests, producing false failures. Windows path assertions normalize paths;
  architecture checks cache parsed imports instead of repeatedly timing out.
- The formerly skipped corpus integration now runs on Windows with separately
  pinned Gyan FFmpeg/FFprobe 8.1.1 versions, byte counts and SHA-256 values.
  Both complete generations match and pass the existing media-fact checks.
  Ubuntu 6.1.1 pins remain separate; neither toolchain check was weakened.
- `libzci-codecs --no-default-features` previously linked unrequested Opus and
  failed on `opus.lib`. Gate raw FFI, examples and integration tests on their
  actual features. Codec-free and module-only checks now pass independently.
- OpenMPT allocated-string helpers now require unsafe callers and document
  ownership correctly. Remove an unenforced instance-budget field and an
  unnecessary leaked static string. Name render stepping `next_step` and Opus
  packet reads `next_packet`. Native and WASM Clippy both pass with warnings
  denied; workspace formatting and Rust documentation also pass.
- Browser launches mute host audio. Explicit hardware transport/CLI tests use
  silent master output; native GUI validation stays in hidden eframe windows.
- Add the repeatable `test:android` runner using the dedicated headless AVD,
  Android Chrome, ADB reverse and host-supplied File bytes. It closes its Chrome
  context/server/forward afterward and preserves the APK's profile and grants.

Results (Windows x64 MSVC; Rust/Cargo 1.98.1; FFmpeg 8.1.1; Chromium 149;
Android 16/API 36 `izci_android16`, Google APIs x86_64, Chrome 133):

| Check | Result |
| --- | --- |
| Main `npm test -- --maxWorkers=4 --reporter=dot` | 221 files, **1,339 passed, zero failed/skipped** |
| `npm run check` | Zero errors/warnings |
| Windows fixture integration | Five passed, including two complete deterministic generations |
| Rust workspace + `libzci-native/provider-tests` | **91 passed**, zero failed; two opt-in hardware tests run separately and both passed silently |
| Native/WASM `cargo clippy ... -- -D warnings`, `cargo fmt --check`, `cargo doc --no-deps` | Passed |
| Codec-free / module-only feature tests; minimal CLI check | Passed |
| Audio-only WASM Node tests | Three passed, including source-rate ABI regression |
| PWA `typecheck`, WASM builds, production build | Passed |
| PWA `test:m1` | **46 scenarios passed**, 18 every-sample comparisons |
| PWA `test:webcodecs`, `test:callbacks`, `test:browser` | **8 / 15 / 5 scenarios passed**, including 30-second production drain/starvation/suspension |
| `test:android` | **44 scenarios passed**: 21 transports/probes, unknown-duration seek/drain, 22 every-sample comparisons |
| Hidden native release GUI | HVL, MOD, 192 kHz WAV and unknown-duration FLAC transport/control/probe/disposal passed |
| Release CLI process checks | Eight passed, including silent playback interruption and render cancellation |
| Android Kotlin `testDebugUnitTest --rerun-tasks` | Six passed, zero failed/skipped; all 27 Gradle tasks executed |
| Android CDP/transport Node tests | Five passed |
| Main PWA production build | Passed, 166 precache entries; existing chunk-size warning remains |
| Native release CLI/crude builds | Passed |

Maximum native/browser sample error on desktop and Android: **1.4901161e-7**,
against **3e-5** acceptance. Recycling high-water remains **8**. The seven module
families match native samples exactly. Added media remains ignored and records
recipe/tool/file hashes in M1 provenance; no third-party music was added.

Milestones: `4a4ef6ce` test isolation/Windows fixtures; `dee99a66` runtime/source/job
fixes; `bbf6b1a6` codec feature gates and API/lint cleanup. Evidence is in ignored
`.local/libzci/review-*.log`, `review-android-evidence.json`,
`m1-browser-evidence.json`, `m1-webcodecs-evidence.json`, and
`r4-{callback,browser}-evidence.json`. Reproduction commands are in the workspace
and crude-PWA READMEs. The dedicated emulator is stopped after validation.

Limits remain explicit: emulator Chrome is not physical-device, installed-PWA,
screen-off/background or OEM SAF acceptance. Optional WebCodecs is verified on
desktop Chromium; Android coverage uses the reference path. Libzci is not yet
adopted by the separate APK. Linux recovery remains unverified. No installed/
offline-libzci behavior is claimed before M2; the ordinary izci PWA build does
not establish that later milestone. Existing packaged M1 artifact manifests
remain historical; current review builds live in the usual ignored outputs.

## M1: file players, modules and both crudes

2026-10-19, Windows x64 MSVC and headless Chromium. User authorized builds and
headless tests; profile: none. Initial checkout was clean. Status: **verified
for these targets/checks**, with physical/background and other-platform limits
below. The existing izci shells, assets, profiles and grants were preserved.

Implementation milestones:

- `879e6bd8`: ordinary audio provider, module controls/observations, independent
  probe jobs, generated audible fixtures and the native crude.
- `cecdf19e`: ordinary/module browser providers, shared Session integration,
  independent jobs and optional WebCodecs Opus.
- `b2850425`: hidden native transport validation, audible module controls,
  source/cancellation checks, exact EOF anchoring and final codec limits.

Symphonia **0.5.5**, with only WAV/PCM, MP3, FLAC, Ogg and Vorbis features,
implements one native/WASM provider over bounded source reads. Opus retains
the pinned reference path. Selection/classification remains core/provider-owned;
neither crude nor the CLI chooses a media family. Unknown-extension verification
defaults off and affects only independent inspection; enabled verification can
open the module provider without constructing output.

Pinned OpenMPT **0.8.4** and Hively **f393ca7** now build reproducibly for MSVC
(`/MD`) and Emscripten **4.0.10**, with input digest checks and build records.
Native Hively initialization uses Rust `Once`; browser module instances have
separate heaps and immutable initialized tables. Hively duration/seek work is
stepped and cancellable. Both providers expose subsongs, interpolation, channel
mutes, metadata and bounded transient patterns. OpenMPT also exposes ramping,
speed/pitch and finite repeat limits. Unsupported Hively controls are disabled
with an explanation. Allocated OpenMPT strings are copied/freed.

Both crudes issue public operations for transport, volume/mute, module controls,
inspection and separate raw rendering. The native crude uses eframe/egui
**0.32.3**; no JS/webview/WASM interpreter is linked. Browser render export writes
bounded chunks to a user-selected FSA destination when available. Probe jobs
construct no AudioContext. Stop/dispose/cancel remain independent of PCM credits.
The worklet acknowledges the provider's actual landed frame before new PCM,
including empty EOF seeks; earlier unanchored reports cannot replace that frame.

Optional WebCodecs Opus is off by default, only for proved single-link family-0
mono/stereo configurations. Shared Rust Ogg CRC/lacing/header and TOC-duration
policy feed the platform decoder; Rust applies pre-skip, seek discard, mandatory
header gain and end trim once. Restart/discard seeks match the sequential native
reference suffix exactly. The optimized opusfile seek can have a short preroll
transient, so it is not the golden for restart/discard. Chained content and
unavailable AudioDecoder configurations fall back to reference. Pending platform
decodes can be interrupted before their callback returns.

Validation (Rust/Cargo **1.98.1**, wasm-bindgen **0.2.129**, MSVC **19.44.35229**,
FFmpeg **8.1.1**, Playwright **1.61.1** / Chromium **149.0.7827.55**):

- `python libzci/scripts/build-module-deps.py`,
  `python libzci/scripts/build-browser-codecs.py`,
  `python libzci/scripts/build-browser-modules.py`, and
  `python libzci/consumers/crude-pwa/scripts/build-wasm.py`: **passed**. All
  generated output remains isolated/ignored; ordinary izci WASM was untouched.
- `python libzci/tests/generate-m1-media.py`: **15 generated CC0 inputs**,
  exact recipe/tool binary/file hashes in `.local/libzci/media/m1/provenance.json`.
  Mono 44.1 kHz and stereo 48 kHz ordinary formats; audible MOD/XM/S3M/IT/MO3
  PCM-sample modules and synthesized AHX/HVL instruments. No external music.
- `cargo test --locked --manifest-path libzci/Cargo.toml --workspace
  --features libzci-native/provider-tests`: **89 passed, 0 failed, 2 explicit
  hardware opt-in tests ignored**. Includes exact seek/rewind/EOF, bounded reads,
  revoked source access, replacement cancellation tokens, two contexts, audible
  channel mutes/interpolation, speed/repeat lengths and independent probe/render.
- `cargo build --locked --manifest-path libzci/Cargo.toml -p zci-play
  -p crude-native --release`: **passed**. CLI modules are enabled by default;
  `--no-default-features` retains the lighter ordinary/reference-only build.
- `crude-native.exe --headless-test <fixture>` on HVL, MOD and 44.1 kHz FLAC:
  **passed** using a real hidden eframe window and muted CPAL output. Tests
  play/pause/seek, available module control, independent probe, stop and dispose.
  The separate egui test draws the actual UI and runs independent jobs without
  creating a window/device. PE dependency inspection confirms no JS/webview/WASM
  runtime in either native executable.
- PWA `typecheck`, production `build` and audio-only WASM tests: **passed**.
  Import-free output WASM keeps its fixed heap under long marked input.
- PWA `test:m1`: **39 scenarios passed**, including real File/worklet transport
  across all 15 inputs, module controls, independent jobs, unknown verification,
  cancellation, live ordinary-source loss and every-sample native comparison.
  All seven module outputs match exactly. Ordinary-audio maximum sample error:
  **1.49e-7**; acceptance tolerance **3e-5**. Recycling high-water stays at **8**.
- PWA `test:webcodecs`: **8 scenarios passed**, including actual optional
  worklet output, rapid seeks/stop/EOF, five sample/timeline comparisons, chained
  fallback and AudioDecoder disabled **inside the decode worker**. Optional PCM
  matches the sequential reference exactly on the proved fixtures.
- PWA `test:callbacks` and `test:browser`: **passed** after M1 integration.
  Existing long reference output, starvation, delayed recycling, cancellation,
  rate-conversion tails, suspension, rapid seeks, source loss, missing codec
  assets, a stalled document and final consumption remain covered.

Raw evidence: `.local/libzci/m1-workspace-tests.log`, `m1-browser-evidence.json`,
`m1-webcodecs-evidence.json`, `m1-production-regression.log`,
`m1-reference-regression.log`, `m1-native-hidden.log`, native dependency reports
and the acquisition/build logs. Packaged outputs and SHA-256 values are in
`artifacts/libzci/m1-artifacts.json`: `zci-play.exe`, `crude-native.exe` and
`crude-pwa.zip`, with dependency notices.

Limits: ordinary audio is mono/stereo, 8–192 kHz; modules are capped at 64 MiB.
OpenMPT source duration must be finite and under 12 hours, repeats 0–16; Hively
scan limit is 30 minutes and unsupported controls remain named. The MO3 fixture
proves its uncompressed PCM-sample path, not every compressed-sample variant.
Linux recipes are retained but unverified. New-format hardware listening,
physical Android and R4's true background/screen-off checks remain pending.
No SQLite/profile, installation, service worker or offline-launch behavior is
claimed before M2.

## Recovery R4: reference browser player — implemented; checks pending

2026-10-19, Windows x64. Baseline `3b5fc39b`; initial dirty files: none.
Builds and headless tests explicitly authorized. Profile: none.

Reference libopusfile 0.12 / libopus 1.5.2 / libogg 1.3.5 use the existing
source digests with Emscripten 4.0.10 (emsdk tag commit
`62a853cd3b3134398ce85cde8bb5cbb2ef0194cb`). Bounded FileReaderSync C callbacks
use Asyncify task yields for cancellation during open/seek scans. The engine
worker drives the same Rust Session as native; separate import-free audio WASM
uses shared processing/clock code. Eight transferable PCM blocks (262,144 bytes)
travel directly from decoder to worklet, with recycle credits and explicit
consumer generation acknowledgment. No PCM traverses the document.

Implementation milestone: `5caa0a7c` ("Play reference Opus through shared Rust
browser transport and worklet"); followed by the browser verification/recovery
commit in this session. Public seek seconds are converted in Rust. The C wrapper
matches native's explicit seek-to-trimmed-EOF behavior. Decoder jobs use a
MessageChannel task yield rather than timers, preserving cancellation delivery
without depending on background timer budgets. Missing codec assets and live
File access loss resolve Loading/Playing as typed failures.

Toolchain: Rust 1.98.1 / Cargo 1.98.1, wasm-bindgen-cli 0.2.129, Emscripten
4.0.10, Python 3.13, Node 24.16.0, Playwright 1.61.1,
Chromium 149.0.7827.55 headless, Windows x64. Profile: none.

Validation (passed unless explicitly noted):

- `python libzci/scripts/build-browser-codecs.py`: digest-verified pinned static
  libraries and reference browser module; separate ignored target outputs.
- `python libzci/consumers/crude-pwa/scripts/build-wasm.py`: separate release
  Rust control and audio-only builds, locked dependencies and matching CLI.
- `cargo test --locked --manifest-path libzci/Cargo.toml --workspace
  --features libzci-native/provider-tests`: **70 passed, 0 failed**, two explicit
  hardware tests ignored. Native output/transport and reference provider tests
  remain working. No new native hardware/listening claim.
- `npm run typecheck`, `npm test`, `npm run build` in the crude: passed. Two raw
  WASM tests establish no JS imports/control/catalog exports and exact marked
  samples over more than twelve pool capacities, variable/full/empty schedules,
  final tail/latency drain, pause/starvation/reset, and unchanged heap length.
- `python libzci/tests/generate-r4-media.py`: native CLI reference renders,
  including each tested seek, derived from R3's CC0 inputs. R4 provenance records
  native executable/media hashes, -6 dB header-gain and distinct-serial mixed
  chains, a 1,000-link scan source and corrupt/truncated/channel-map cases.
- `npm run test:callbacks`: **15 real-browser cases**. Mono/stereo/long/gain/chain
  PCM and seek tails match native sample by sample; maximum absolute error
  **7.450580596923828e-8** (asserted tolerance 3e-5). Seek comparison uses native
  seek renders rather than slices, preserving Opus preroll semantics. The full
  long source produces **1,440,006 frames in 1,501 blocks** under delayed recycle,
  with eight outstanding buffers maximum. 44.1 kHz conversion drains **55,131**
  frames for the short source. Independent workers remain isolated. A posted
  replacement/seek during a real 1,000-link C scan lands at frame 2,400 and closes
  in **12.6 ms** on the recorded run; corrupt inputs fail explicitly.
- `npm run test:browser`: **five production-bundle scenarios** with AudioDecoder
  removed and normal user activation (no autoplay override). Real File/worklet
  playback covers pause, rapid seeks, Stop, volume/mute, suspension/resume,
  full-pool disposal/reopen, mono trim, corrupt/recover, File snapshot invalidation
  and missing codec WASM. A CDP-paused production decoder drains to Pending
  silence without EOF/media-time advance and recovers after resume. A 750 ms
  stalled document leaves audio progression independent. The full long run
  consumes **1,440,006 frames exactly**, ends at the same source position and
  has output energy **26577.508522098527** vs native **26577.508491770233**;
  peak agrees at **0.15791523456573486**.

Bounds observed: C heap **33,554,432 bytes**, audio-only WASM heap **1,572,864
bytes**, transferable pool **262,144 bytes** (plus the worklet's fixed Rust pool),
48 kHz preparation/scratch **98,304 bytes**; largest actual File read **2,048
bytes**, below the hard 32 KiB callback bound. All active/pending PCM queues and
UI/worker telemetry have fixed credits or one-in-flight acknowledgment.

Limits / acceptance still open:

- Headless tab switching (including disabling focus emulation/background timer
  overrides) kept `document.visibilityState` **visible**. This is not actual
  hidden-tab/background evidence. Hidden desktop tabs and physical screen-off
  playback/OS control exposure require a real-device check; none is claimed.
- No physical Android Chrome device was available in this session. Hardware
  listening and physical Android/screen-off remain unverified. Media Session
  actions/position are wired; an anchor prototype awaits demonstrated need.
- GNU/Linux build/run recovery was not re-run. Installed/offline launch belongs
  to M2 and is not claimed. Optional WebCodecs and additional formats remain M1.

R4 is **implemented; checks pending**, not fully verified. Ordinary izci assets,
profiles, databases and grants were preserved. All temporary test servers and
browser profiles were closed. Local raw evidence: `.local/libzci/r4-regressions.log`,
`r4-browser.log`, `r4-callbacks.log`, `r4-browser-evidence.json`,
`r4-callback-evidence.json`, and `media/r4/provenance.json`. Reproduction commands
are in the crude README.

## Recovery R1: bounded, lossless output — verified

2026-10-18. Baseline `8c6dfe0a111b250619b8938fdfcdae62ee9d5772`,
branch `libzci-codex` tracking `origin/libzci-codex`; dirty files: none.
Available toolchain: project-local Rust `1.98.1 (48a229cea 2026-09-01)`,
Cargo `1.98.1 (797e8a9bc 2026-08-05)`, `x86_64-pc-windows-msvc`.
Profile: none. No product build, device, browser, or ordinary-player launch.

- Replaced the mutable-Vec ring with native `rtrb = "=0.4.0"` ready/recycle
  queues carrying indices into a fixed 256-frame stereo block pool. Unique
  endpoint ownership and queue handoffs guard private UnsafeCell slots.
- Added shared generation/source-range/rate/layout/valid-length descriptors and
  bounded preparation with short-write suffix retention, decode credits,
  distinct source EOF, converter drain, and consumer completion observations.
- Fixed converter delay/tail loss, including block-aligned EOF; output has
  ceil(input frames * output rate / input rate) frames after delay removal.
  Input, FIFO, scratch, and pending storage are bounded independently of duration.
- Native output now uses this path, applies shared master smoothing at callback
  consumption, and acknowledges generations from the consumer. Reset cannot
  rewrite a read cursor; stop/dispose bypass full PCM queues. Existing session
  command authority, clocks, provider Pending, and job locking remain R2 work.
- Pure native tests no longer pull C codecs: real-provider suites require
  `--features provider-tests`; the device unit smoke is explicitly ignored.
  A pre-existing Unix-only `File::read_at` call blocked Windows tests; Windows
  now uses its positional `seek_read` counterpart, retaining bounded reads.
- Initial checks: core 29 unit + 5 output-pipeline tests, native 9 unit + 5
  output-pipeline tests passed; one device test intentionally ignored. Coverage
  includes 50,003 numbered frames, zero/partial writes, extreme conversion
  ratios, final impulses, fixed capacity, reset during pop, full/held queues,
  20,000 concurrent marked blocks, 2,000 generation changes, and actual worker
  stop/session disposal without consumer progress. No sleep-based assertions.
- Selected upstream rtrb 0.4.0 suites `lib` and `write_and_read`: 12 passed,
  including parallel handoff and drop tests, in an ignored `.local/libzci/` copy.
  Miri/sanitizers are unavailable in the installed stable Windows toolchain;
  this is concurrency-test evidence, not a dynamic soundness proof.

Implementation milestone: `f0ecbd2e` ("Make libzci PCM output bounded and lossless
under backpressure"). Follow-up commit "Verify libzci output allocation budgets
and worker continuity" adds allocator instrumentation and final acceptance checks.

Final evidence (same target/toolchain, profile none):

- `cargo test --manifest-path libzci/Cargo.toml -p libzci -p libzci-native`:
  **55 passed, 0 failed, 1 ignored** (the explicitly gated device unit test).
  Includes all existing device-free native pipeline tests and doc tests. The
  production worker exactly matches independent session renders at 48,000,
  44,100, and 96,000 Hz through a two-slot pool under variable sink consumption.
- `cargo test --manifest-path libzci/Cargo.toml -p libzci-native
  --test output_allocations -- --nocapture`: **2 passed**. Thread-local system
  allocator instrumentation includes pool, descriptors, queues, preparation,
  converter staging/tail/output, and private FFT plans/workspace. Sources and
  sinks use fixed stack scratch. For 10,003 versus 100,003 input frames:

  | Output rate | Peak heap bytes | Setup allocations (both lengths) |
  | --- | ---: | ---: |
  | 48,000 Hz | 9,216 | 9 |
  | 44,100 Hz | 180,610 | 51 |
  | 96,000 Hz | 256,426 | 43 |

  Both lengths have identical peak bytes and allocation counts; every tracked
  allocation is released on teardown. Callback render, partial-block handling,
  master updates, stale recycling, underrun, and stop perform **zero allocations
  and zero deallocations**. These are allocator-requested heap bytes, not RSS or
  provider/device allocations; production additionally owns its fixed 4,096-sample
  decode scratch and a bounded session decoder chunk. Other pool/block/rate
  configurations have their own fixed budgets, rather than these exact numbers.
- `cargo test --manifest-path .local/libzci/rtrb-0.4.0-checks/Cargo.toml
  --test lib --test write_and_read`: **12 passed** against an unmodified ignored
  copy of the pinned crate. No dependency code was added to browser mechanisms.
- Scoped `rustfmt --check` and `git diff --check`: passed.
- Additional, non-gating web host-test attempt using `-p libzci-web`: 3 passed,
  6 failed before media operations because `tone.opus` is absent from the existing
  `.local/verification-fixtures/v1` corpus. No fixture generation was performed.
  This does not establish browser runtime/WASM/reference-codec behavior.
- Clippy was attempted but unavailable: the installed toolchain has Rustfmt but
  no Clippy component. Miri/sanitizers, real C providers, product builds, devices,
  browser inspection and installed-PWA checks were not run. R1's acceptance is
  device-free; the corresponding R2-R4 integration checks remain open.

## Recovery R2/R3: transport and native reference implementation

2026-10-18. Baseline `a551ea92f9617a801914ed0b77ff2aff6fc2a557`,
branch `libzci-codex`; initial dirty files: none. Builds authorized by the user.
First implementation milestone; final acceptance/target audit follows separately.

- Core Session is a control-only action machine with explicit source/options,
  seconds-based time, volume/mute/module controls and instance/operation/generation
  tags. Native sequential decoder workers perform open/seek/decode outside control
  and map locks. Cancellation bypasses capacity and held codec work.
- Native output and incremental render jobs use the same commands and bounded R1
  preparation. The callback maps consumption spans to source time, including
  underrun silence, generation changes and device latency. EOF is separate from
  final consumption. No runtime/output thread Arc cycle remains.
- CLI no longer constructs decoders or collects whole renders. Native production
  Opus now owns libopusfile callback contexts/handles, applies header gain with
  zero additional offset and reports tags/trim facts. Historical packet decoding
  is confined to comparison tests. Modules are an explicit optional feature.
- Acquired digest-checked libogg 1.3.5, libopus 1.5.2 and opusfile 0.12 with MSVC
  19.44.35229, /MD, target-specific archives. Built `zci-play` on Windows MSVC
  using project-local Rust/Cargo 1.98.1. Ordinary player assets/profiles untouched.
- First checks: core/native/codecs device-free suites pass, including held
  open/seek/decode cancellation, Pending, a 50,003-frame production-worker output
  through two pool slots at 48/44.1/96 kHz, fixed memory and zero callback allocation.
  Separate generated R3 Opus fixtures use FFmpeg 8.1.1 and CC0 synthetic chirps.
  Mono/stereo/30-second frame counts and seek tails match; raw packet comparison
  agrees with libopusfile. Reference FFmpeg PCM maximum difference <0.00003.
- CLI rendered 1,440,006 stereo frames (11,520,048 bytes) for the long fixture;
  a start-at-29-second Windows device run reached exactly frame 1,440,006.
  Automated device consumption is evidence, not a human listening claim.
- Existing browser proof facade compiles against the shared machine; it does not
  claim decoder read-ahead is audible. Actual reference browser output is R4.

## Recovery R2/R3: final acceptance — verified on Windows MSVC

2026-10-18. Implementation commit `d878d9b8` (transport workers, reference Opus
and streaming CLI), followed by "Verify libzci native transport and reference CLI
end to end" (acceptance, lifecycle/race hardening, recipes and documentation).
Target: `x86_64-pc-windows-msvc`; Rust/Cargo 1.98.1; MSVC 19.44.35229, `/MD`.
No ordinary izci profile/grants/assets, frontend, desktop or Android build changed.

R2 is verified through the native harness and CLI. R3 is verified for Windows
reference Opus. GNU/Linux acquisition recipes were retained with target-aware
paths and syntax checked, but no Linux recovery build/run was reproduced here
(WSL is not installed). Browser/reference-WASM output remains R4, and additional
formats/module recovery remain M1. Windows success does not verify those targets.

Final checks (run from the repository root):

- `cargo test --locked --manifest-path libzci/Cargo.toml --workspace
  --features libzci-native/provider-tests`: **76 passed, 0 failed**; two explicit
  hardware tests ignored in this ordinary run. The MSVC web cdylib link prints an
  informational import-library message; no source diagnostic or failing check.
- `cargo test --locked --manifest-path libzci/Cargo.toml -p libzci-native
  --features provider-tests -- --ignored --nocapture`: **2 hardware tests passed**.
  `Headphone (Realtek(R) Audio)`, F32 stereo, 48,000 Hz. Commands alone exercised
  Play/Pause/Seek/Stop, volume/mute, resume, final drain and disposal. Paused media
  time stayed frozen; a seek while paused landed at 480,000; final consumption
  reached 1,440,006 with an empty pool. Observed device latency was about 1,530
  frames (32 ms); already submitted OS audio cannot be recalled.
- Full CLI device run of the 30-second changing stereo chirp, at volume 0.08:
  exit **0**, final media position **1,440,006**. The human user separately
  confirmed: "Yes, it sounds clean". This listening evidence is distinct from
  callback/frame accounting.
- Real Opus through the production preparation/output worker and a deliberately
  slow **two-slot pool** matches an unrestricted reference render sample for
  sample at 48,000 and 44,100 Hz, including the final tail. The pure marked-source
  checks also cover 96,000 Hz. No dropped/duplicate media or early Ended.
- Reference Opus tests cover mono/stereo, fractional end trim, pre-skip,
  zero/middle/last-frame/EOF seeks, mandatory header gain exactly once,
  R128/ReplayGain reporting without applying tags, mixed-layout chained Ogg,
  corrupt/truncated headers, unsupported channel maps, two live handles,
  callback cancellation during open/seek/decode, bounded reads and preserved
  source access errors. Historical raw packet decoding agrees with the reference
  PCM and frame count and is now test-only.
- Held open/seek/decode jobs cannot block another session or Stop/Dispose.
  Rapid seeks/new loads reject late results, including after decode and before
  callback consumption. Pending is not EOF. Duplicate old commands cannot cancel
  newer jobs, even after source release. An output survives a decoder failure and
  recovers on a new Load. Event drains include loss counters and a recovery
  snapshot. Closed sessions/workers and render jobs have no retained runtime cycle.
- `python libzci/tests/generate-r3-media.py`: separate ignored CC0 R3 signals,
  FFmpeg **8.1.1**, exact commands, binary hash and output digests recorded in
  `.local/libzci/media/r3/provenance.json`. It does not overwrite the existing
  frontend fixture corpus or relax its generation pins. Long source SHA256:
  `8f8567613bd7b481611c5a6c0cd4a2833ce1cb688d30214a98e3eb93c7572ab6`.
  Reference FFmpeg decode and native output have identical lengths; maximum
  sample difference is **0.00001531** (different libopus builds), within 0.00003.
- Native long render: **1,440,006 stereo frames / 11,520,048 bytes** at 48 kHz.
  Start 15.5 s: **696,006 frames**. Start at EOF: **0 frames**. Converted long
  render at 44.1 kHz: **1,323,006 frames**. Rendering is incremental, explicitly
  raw or fixed-master processed, with bounded chunks and cancellation.
- `ZCI_PLAY=<release executable> python libzci/tests/check-cli.py`: **8 process
  checks passed**, including missing/corrupt/usage/device failures (exit 2), help
  and completed render (0), and playback/render interruption (130). Final packaged
  executable returned 130 about **28 ms** after playback interruption and **2 ms**
  after render interruption. Source-callback tests separately prove real provider
  cancellation. These timings are local observations, not OS-wide guarantees.
- `cargo test --locked --manifest-path libzci/Cargo.toml -p libzci-native
  --test output_allocations -- --nocapture`: fixed test-pipeline peak heap is
  140,312 / 311,706 / 387,522 bytes at 48 / 44.1 / 96 kHz, with respectively
  10 / 52 / 44 setup allocations. The 10,003- and 100,003-frame runs have identical
  peaks/counts and release all allocations. Includes the preallocated consumption
  clock and private FFT storage; excludes providers/devices. Callback render,
  gain/mute updates, reset/recycling, underrun and stop allocate/deallocate **zero**.
- Acquisition `-CheckOnly` re-verified all three pinned archive digests. MSVC
  archives and per-library BUILD-RECORDs are in `build-x86_64-pc-windows-msvc/`;
  GNU archives use their own Rust-target directories. HTTP/TLS is disabled.
  `bash -n` passed for both retained GNU/Linux acquisition scripts.
- `cargo build --locked --manifest-path libzci/Cargo.toml -p zci-play --release`:
  **passed**. Packaged executable: `artifacts/libzci/zci-play.exe`, **1,896,448
  bytes**, SHA256 `9221edfbea2db2a120d12b78b4b734d2cf7384b4ad6f837657da012f6dae7801`.
  `dumpbin /DEPENDENTS` shows Windows system/API-set libraries and the Microsoft
  CRT only; no JS, browser/webview, WASM, FFmpeg, codec DLL or C++ runtime dependency.
  The native media libraries are static; the ordinary MSVC CRT remains dynamic.
- Scoped Rustfmt and `git diff --check` passed. No browser/server/installed-PWA
  launch or frontend/desktop/Android build is claimed by these native results.

Local raw evidence: `.local/libzci/final-tests.log`, `final-hardware.log`,
`final-allocations.log`, `playback-long-windows.log`, `cli-evidence.json`,
`dependencies-release-windows.txt`, and media provenance above. Reproduction
commands are in `libzci/README.md` and the CLI README.

Historical entries follow unchanged.

---

Status values per `docs/libzci/phases.md`: `not started /
implemented, verification pending / verified`. A check needs evidence,
not a declaration. Missing build authorization or hardware leaves the
relevant check pending. Profile is `none` before storage (Phase 3.2).

## Phase 0: create the starting workspace and enumerate inputs

### 0.1 Record the checkout baseline and the work boundary — verified

- Starting commit: `c4486e212dc1e64c2f6fca2d4a1133f16f212763`
  ("Ground libzci validation in existing fixtures and runtime behavior").
- Pre-existing changes at Phase 0 start: none (`git status --short`
  clean on `main`).
- Baseline confirmation (inspected, no player launched):
  - Rust: `src-tauri/Cargo.toml` is the only Rust project (package
    `izci` 0.4.0, Tauri shell). No root `Cargo.toml`, no `libzci/`
    tree before this phase.
  - Frontend: regular audio through `src/lib/services/howler-player.ts`
    (Howler, HTML5 audio); tracker modules through the libopenmpt WASM
    controller/worklet (`src/lib/services/openmpt/`) and the Hively
    worklet/player; video through a literal video element
    (`src/lib/services/video-player.ts`).
  - Server rendering: Go plus external/native/WASM media
    implementations (`izci-server/internal/media/render.go`,
    `openmpt.go`, Hively replay path); Go SQLite precedent in
    `izci-server/internal/persistence/store.go` (not the new core schema).
  - Root `package.json` (`izci` 0.4.0) builds only the existing app;
    no script depends on libzci.
- Allowed changes for these initial phases: new `libzci/`, these
  `docs/libzci/` planning/log files, narrowly scoped ignore entries for
  new generated directories, and fixture additions. Existing
  frontend/desktop/Android/server runtime owners stay independent
  until the adoption phases. No pre-libzci import, migration, legacy
  readers, or cross-generation backup/restore path.
- Reserved output locations (no database or user state created):
  - `libzci/target/` (Cargo outputs; added to `.gitignore` in 0.2).
  - `.local/libzci/` (acquisition scratch, native builds, generated
    media; already covered by the root `.local/` ignore).
  - The crude PWA's own build directory under
    `libzci/consumers/crude-pwa/` (lands with the consumer; never the
    root `dist/`).
- Reserved profile/storage names (Phase 3.2 work, not created here):
  native crude profile `.local/libzci/profiles/crude-native/`;
  browser OPFS directory `/libzci-crude-v1/` with IndexedDB registry
  `libzci-crude-capabilities-v1` on the crude's dedicated origin/port;
  uniquely named temporary directories/OPFS namespaces with explicit
  disposal for tests. `zci-play` stays transient unless given an
  explicit `--profile` (Phase 3.2).
- Verification kept separate from implementation work (authorization
  or unavailable inputs; recorded pending, not claimed):
  - `node fixtures/generate.mjs` corpus generation: requires the exact
    pinned FFmpeg/FFprobe toolchain (present locally, see 0.3) *and*
    the explicit build/generation authorization from AGENTS.md. Left
    pending; not run as a discovery step.
  - Native/media builds (`cargo build/check`), PWA/dev-server runs,
    and browser inspection: require an explicit user request outside a
    debugging session. Not run. The only Cargo invocation in Phase 0
    is the manifest-only `cargo metadata --no-deps` structure check
    named by the roadmap (0.2 evidence below).
  - Longer synthetic Opus and missing module fixtures: acquisition
    work in Phases 1–2, not executed here.

Check: this log names the actual baseline, intended outputs, reserved
names, and the first work item (0.2 workspace, then 1.1 sources).
No copied profile, state reader, service worker, or runtime introduced.

### 0.2 Add the minimum Cargo workspace — verified

Created:

- `libzci/Cargo.toml`: workspace with the central `libzci` crate as
  its only initial member (`resolver = "2"`). Separate from
  `src-tauri/`; no root Cargo workspace.
- `libzci/crates/libzci/Cargo.toml`: library package `libzci` 0.1.0,
  edition 2021, MIT, zero dependencies.
- `libzci/crates/libzci/src/lib.rs`: crate docs identifying the
  core/adapter/consumer boundary; no browser, device, Tauri, Svelte,
  or Go dependency. No codec, GUI, database, or video modules.
- `libzci/README.md`: planned package additions, dependency
  direction, generated-output paths, reserved profile names, and the
  deferred toolchain-pin policy.
- `.gitignore`: added only `libzci/target/`. `.local/libzci/` needs
  no entry (covered by `.local/`).

Not created by design: `rust-toolchain.toml` (pins with the first
resolved dependency set in Phase 1.2), `Cargo.lock` (committed with
those Phase 1 resolutions; none exists yet — the metadata check below
created none), empty future modules, any `package.json`/Vite/PWA
change, any current WASM asset change.

Evidence:

- Command: `cargo metadata --manifest-path libzci/Cargo.toml --no-deps`
- Toolchain: local cargo 1.99.0 / rustc 1.99.0 (informational only;
  not the pinned toolchain).
- Result: pass (exit 0). One workspace member
  (`path+.../libzci/crates/libzci#0.1.0`), crate `dependencies: []`,
  `target_directory .../libzci/target`. Dependency direction holds:
  nothing for a browser/device/Tauri/Svelte/Go edge to reverse.
- No native/media build was run or is required for this check.

### 0.3 Identify fixture bytes and missing coverage — verified

Fixture contract: `fixtures/manifest.json` (`corpusVersion stage-1-v1`,
`defaultOutputDirectory .local/verification-fixtures/v1`). The corpus
is a manifest plus generator, not checked-in media.

First decoder inputs named by the roadmap:

| Fixture ID | Expected generated path | Manifest bytes / digest | Present locally |
| --- | --- | --- | --- |
| `audio-opus` | `.local/verification-fixtures/v1/media/audio/tone.opus` | 1201 bytes, `sha256 b468897f…4d3a77f7a`, 0.2565 s mono 48 kHz Opus | no |
| `module-mod` | `.local/verification-fixtures/v1/media/modules/tone.mod` | 3132 bytes, `sha256 bbfc0a22…6fedc433`, 7.68 s 4-ch ProTracker MOD | no |

Presence check: `.local/verification-fixtures/` does not exist. No
manifest entry is treated as bytes available to an executable. Nothing
was generated in Phase 0 (requires the authorization listed in 0.1).

Generator pins (recorded, not executed):

- FFmpeg first line: `ffmpeg version 6.1.1-3ubuntu5 ...` with
  `requiredEncoders` aac, flac, libmp3lame, libopus, libvorbis,
  libvpx, libx264, pcm_s16le, png.
- FFprobe first line: `ffprobe version 6.1.1-3ubuntu5 ...` with
  `requiredDemuxers` flac, libopenmpt, matroska/webm, mov/mp4/m4a,
  mp3, ogg, wav.
- Node `minimumMajor` 22 (local `v22.22.2` satisfies the version gate;
  generation itself stays pending on authorization).
- Local `ffmpeg`/`ffprobe --version` first lines match the pinned
  strings; encoder/demuxer inventory was not re-audited here because
  generation is pending either way.

Plans recorded for provider phases (no bytes added, no digests changed):

- Longer synthetic Opus for audible playback, seeks, background
  tests, and buffering: generate with the pinned FFmpeg recipe into
  ignored generated media (e.g. under `.local/libzci/`), with a
  checked-in recipe/provenance record. Must not replace the existing
  corpus digests.
- `toneModule()` (`src/lib/services/openmpt/test-fixtures.ts`, 1- and
  2-subsong MOD construction) and the blank AHX/HVL construction in
  `src/lib/services/ahx-worklet.test.ts` become new test helpers when
  providers land (1.4). Blank Hively tunes prove lifecycle only;
  audible AHX/HVL plus XM/S3M/IT/MO3 corpus inputs remain explicit
  acquisition work (manifest `requiredCoverage` already marks
  xm/s3m/it/mo3/ahx/hvl as gaps).
- Later Opus cases still needed: stereo/mono layouts, gain tags,
  pre-skip/end trim, chained Ogg, truncated data, differing
  sample/input lengths. Synthetic or permissively licensed media only.

Check: available bytes (none generated yet), recipes needing execution
(corpus generation + longer Opus + audible module fixtures), and
missing samples (xm/s3m/it/mo3/ahx/hvl audible coverage) are
distinguished above. No private music checked in; no ungenerated file
is marked as a passed decode test.

### 0.4 Specify dependency acquisition and the first build experiment — verified

Created `libzci/vendor/dependencies.json` (schemaVersion 1):

- `libogg` / `libopus` / `libopusfile`: `pending-pin`. No pinned
  release exists in this checkout; exact release plus digest must land
  in 1.2 before acquisition. No floating URL is recorded as an input.
- `libopenmpt` source `0.8.4`: `pinned-source`
  (`https://github.com/OpenMPT/openmpt/tree/libopenmpt-0.8.4`,
  BSD-3-Clause). Evidence: `src/lib/vendor/libopenmpt/README.md` —
  checked-in `libopenmpt.wasm` is byte-for-byte 0.8.4 with a matching
  loader. The reproducible native/Emscripten source recipe is 1.4
  work, not present.
- `hivelytracker-replay` commit
  `f393ca7c6416f00bcb574b334a7e8b57dcb19eb2`: `pinned-source`
  (`https://github.com/pete-gordon/hivelytracker`), BSD-3-Clause.
  Evidence: `scripts/vendor/ahx/README.md` + `build.ps1` (PowerShell
  Emscripten recipe). Portable native/browser commands and the new
  instance-safe C wrapper in `libzci-codecs/c/` are 1.4 work; the old
  wrapper/artifacts stay intact. The server's separately stored Hively
  binary is not byte-identical and is not provenance for the new build.

Recipe outputs/commands for 1.2 (defined, not added yet):

- Command to add: `libzci/scripts/acquire-media-deps.sh`, reading this
  manifest, downloading exact sources to ignored
  `.local/libzci/vendor/<library>/<pinned-release>/`, checking
  digests, and building native/WASM outputs separately with recorded
  compiler flags, exports, licenses, and producing commands.
- Constraint: must not overwrite `public/vendor/*`,
  `src/lib/vendor/*`, or any `izci-server` asset.

Experiment defaults recorded:

- Default: Rust WASM core plus separate Emscripten codec modules;
  native links compiled libraries directly. Scoped fallback if the
  synchronous callback bridge fails: core Ogg reader with
  packet-level libopus confined to the Opus provider (scaffolding §3).
- First experiment input/success: fixture `audio-opus`
  (`.local/verification-fixtures/v1/media/audio/tone.opus`) opens,
  decodes finite nonempty PCM, seeks on the normalized timeline, and
  closes through the core session/provider API on native and browser;
  native uses compiled media code with no JS/WASM runtime, webview, or
  Node dependency.
- SQLite/browser glue (3.2) and native device output (2.1) are
  separate later steps; workspace creation is not blocked on them.

## Phase 0 completion

The workspace exists, acquisition/fixture inputs are named with pins
and pending items explicit, and Phase 1.1 has an actual place to add
code (`libzci/crates/libzci/src/` plus the planned `libzci-native`
package). Runtime decode/playback proofs are pending by design. There
is still no reason to open a libzci profile.

## Phase 1: sources, provider instances, and cross-target decode

### 1.1 Implement runtime sources and decoder lifecycle — implemented, verification pending

Created (all new, no existing runtime owners touched):

- `libzci/crates/libzci/src/ids.rs`: `SourceId`/`SessionId`/`RequestId`
  plus `Generation` (stale-output fence) and `Revision` (snapshot
  versions). No Library/queue schema.
- `error.rs`: `AccessRequired` / `Unavailable` / `Unsupported` /
  `Corrupt` / `Cancelled` / `DecoderFailure` / `DeviceUnavailable` /
  `InvalidArgument` / `ResourceExhausted` with stable `kind()` labels.
- `source.rs`: `RuntimeSource` (bounded `read_at`, `revision`,
  `cancellation`), `SourceCaps`, `CancelFlag`, in-memory `MemSource`.
- `provider.rs`: `ProviderRegistry` (factories, magic-outranks-hint
  selection, duplicate-ID rejection), `DecoderInstance` (independent
  per-open position), `ProbeScore`, `AppliedAdjustments` trim/gain
  declarations, `decode_chunk` validation. Test-only `FakeFactory` /
  `FakeInstance` / `HintOnlyFactory`; no production command uses them.
- `session.rs`: `TransportState`
  (Idle/Loading/Ready/Playing/Ended/Failed/OutputSuspended),
  per-session serialized `Session::apply` / `load_source`, generation
  fence (`is_current`), `PcmCollector` device-free render that drops
  stale generations.
- `command.rs`: typed `Load`/`Play`/`Pause`/`Seek`/`Stop`/`Dispose`
  with request/session IDs plus `CommandAccept`.
- `event.rs`: `Snapshot` + `Event` with bounded `EventQueue`
  (progress coalescing, completion/error protection).
- `audio/pcm.rs` (+ `audio/mod.rs`): interleaved finite `f32`
  `PcmChunk` with layout/rate validation.
- `libzci/crates/libzci-native/`: `NativeFileSource` (verbatim case,
  `Unavailable` vs `AccessRequired`, clamped bounded reads, no
  whole-file copy) and `NativeRuntime` (registry/sources/serialized
  sessions, `load`/`submit`/`snapshot`/`render_to_collector`/
  `dispose_session`).
- `libzci/Cargo.toml`: workspace members
  `crates/libzci`, `crates/libzci-native`.

Evidence:

- Command: `cargo test --manifest-path libzci/Cargo.toml -p libzci -p libzci-native`
- Toolchain: local cargo 1.99.0 / rustc 1.99.0 (informational; formal
  pin lands in 1.2).
- Result: pass — `libzci` 16 passed, `libzci-native` 4 passed.
  Covers: delayed decode then seek/stop/dispose rejects stale PCM;
  two sessions hold separate fake-provider state; error kinds stay
  distinct; ordinary file reads are bounded slices; magic outranks
  extension hints; duplicate providers rejected; progress coalesces.
- Profile: `none` (no storage in this phase, by design).
- Pending: real codec providers (1.2 Opus, 1.4 modules/Hively),
  browser worker proof (1.3), audible output (Phase 2). No profile,
  service worker, or runtime beyond the above.


### 1.2 Acquire reference Opus and implement the native provider — implemented, verification pending

Pins resolved (see `libzci/vendor/dependencies.json`):

- `libogg` 1.3.5 (`sha256:0eb4b4b…799b664`), `libopus` 1.5.2
  (`sha256:65c1d2f7…f9a7ce1`), `libopusfile` 0.12
  (`sha256:118d8601…ae3550b6`) — all BSD-3-Clause (Xiph.Org); notice
  entry added to `docs/THIRD-PARTY-NOTICES.md` reusing L042 (COPYING.Xiph).
- Toolchain: local `rustc 1.99.0 (b940084d7 2026-09-28)` via
  `stable-x86_64-unknown-linux-gnu`, recorded in
  `dependencies.json#toolchain` with the workspace `Cargo.lock`
  committed. No `rust-toolchain.toml`: the reported version has no
  matching versioned rustup channel here, so a channel file would break
  builds; re-evaluate when a real channel exists.

Created:

- `libzci/scripts/acquire-media-deps.sh`: reads the pins, downloads to
  ignored `.local/libzci/vendor/<id>/<release>/`, verifies digests,
  builds native static libs (`--disable-shared`, `-O2 -fPIC`;
  opusfile additionally `--disable-http` against the just-built
  ogg/opus prefixes), writes per-library `BUILD-RECORD.txt`. Touches
  nothing under `public/vendor/`, `src/lib/vendor/`, or `izci-server/`.
  Emscripten `build-wasm/` is explicitly pending (no `emcc` here).
- `libzci/crates/libzci-codecs/` (`opus_ffi.rs`, `opus.rs`,
  `build.rs` linking the prebuilt `libopus.a`): the reference Opus
  provider. Native decode path is the scoped packet-level fallback
  from scaffolding §3 — shared Ogg reader (page/lacing/continued
  packets, CRC, granule index) plus reference libopus 1.5.2 packets —
  chosen over the `opusfile-sys` 0.2 stack (stale `opus-sys` 0.2 era
  bindings) so native and browser share one provider with identical
  timeline/gain semantics. opusfile semantics are mirrored exactly
  once: OpusHead output gain applied, zero additional offset,
  pre-skip/end-trim on the normalized timeline (`AppliedAdjustments`
  all true); ReplayGain/R128 tags parsed for diagnostics, never
  applied. Mono/stereo mapping family 0 only; family 1+, >stereo,
  and chained Ogg fail explicitly as named gaps.
- `libzci/tests/synth-opus-30s.sh`: checked-in recipe for the longer
  synthetic Opus (30 s stereo L440/R660, CC0-1.0) in ignored
  `.local/libzci/media/` with a `.provenance.txt` record.
- `libzci/Cargo.toml`: added `crates/libzci-codecs`. `ogg = "0.9"`
  (pure-Rust demux) locked in the committed `Cargo.lock`.

Evidence (all native, profile `none`):

- Acquisition: `libzci/scripts/acquire-media-deps.sh` → `libogg.a`,
  `libopus.a`, `libopusfile.a` (+`libopusurl.a`) under
  `.local/libzci/vendor/*/build-native/lib/` with BUILD-RECORDs.
- Corpus: `node fixtures/generate.mjs` → 21 fixtures;
  `tone.opus`/`tone.mod` digests match the manifest.
- `cargo test -p libzci-codecs` → 8 passed: linked version asserts
  `libopus 1.5.2`; `tone.opus` opens with finite total 12000 frames
  (0.25 s @48 kHz), decodes to exactly 12000 finite samples with
  nonzero content; seek lands mid-stream with exact tail length;
  reopen reproduces the total; truncated input reports
  Corrupt/Unsupported (never success); two handles interleave and one
  survives the other's dispose; single reads stay ≤ 64.5 KiB;
  oversized sources refused observably. The 30 s stereo synth
  (1,440,000 frames, 33 pages, continued packets) decodes exactly and
  seeks mid-stream, near-EOF (end-trim exact), and back to zero.
- Two real bugs found and fixed by these tests (header-skip dropping
  audio packets when headers occupy own pages; seek preroll ignoring
  end-trim); see the provider module docs.
- Disposing one native handle leaves the other usable (covered).
- Pending: browser worker proof (1.3), module/Hively providers (1.4),
  audible output (Phase 2). No database, profile, or JS/WASM runtime
  involved natively.

Next work item: Phase 1.4 — instance-safe libopenmpt and Hively
providers (`openmpt.rs`, `hively.rs`, the new C context wrapper in
`libzci-codecs/c/`, reproducible source recipes).

### 1.3 Implement the same Opus operation in the browser worker — implemented, verification pending

Groundwork (shared with native, no duplication):

- `libzci/src/ogg_reader.rs`: page entries, CRC, continued-packet
  splits, bounded `PageScanner`, and `validate_ogg_index` (BOS/serial/
  sequence/chained rules) — one implementation for `libzci-codecs`
  and the browser (native provider refactored onto it; all tests stay
  green).
- `libzci/src/format.rs`: centralized Opus identification
  (`sniff_opus_head_page`, `parse_opus_head_packet` with the
  mono/stereo family-0 policy, `parse_opus_tags_packet`,
  `OPUS_EXTENSIONS` hints). Both factories probe through it.

Created:

- `libzci/crates/libzci-web/` (`engine.rs`, `demux.rs`,
  `bindings.rs`): the engine owns provider selection (real sniff via
  the same registry/probe types), per-session core `Session`
  transport, and generation fencing over a feed-driven
  `HostDecoder`. The decode worker owns File bytes and platform
  decode; PCM crosses tagged with generations and stale results are
  refused (never queued). Seek plans (`plan_opus_seek`, mirroring the
  native seek math) are pure engine decisions; the worker executes
  `{start_page, skip_packets, skip_samples}` with no granule math of
  its own. Commit cross-checks the worker's header parse against
  core's (mismatch is `DecoderFailure`). Granule-absent serializes as
  `-1` across JSON (raw `u64::MAX` would lose precision); WASM `u64`
  ids cross as BigInt with range-checked conversion at the boundary.
- `libzci/consumers/crude-pwa/` (own `package.json` + lockfile,
  Vite config on port 5197, `index.html`, `src/main.ts`,
  `src/protocol.ts`, `src/generation.ts`, `src/opus-packet.ts`,
  engine/decode workers, vitest suites, `scripts/build-wasm.sh`,
  README): file-open, decode, seek, cancel/dispose, and diagnostics
  through `BrowserHost`-equivalent worker messages — no demo
  decoder, no SQL, no transport policy in `main.ts`. Decode proves
  via PCM stats (frames/peak/RMS/read bounds), not audio output
  (output arrives in 2.4). Opus TOC durations verified against the
  reference `opus_packet_get_samples_per_frame` source.
- `libzci/Cargo.toml`: added `crates/libzci-web` (`wasm-bindgen`
  0.2.129, `js-sys`, `serde`/`serde_json` locked). `.gitignore`:
  `libzci/consumers/crude-pwa/src/generated/`.

Evidence (profile `none` throughout):

- `cargo test -p libzci-web` → 8 passed: stale ingest refused after
  seek, noncontiguous ingest is `DecoderFailure`, stale EOF ignored,
  dispose drops the session, seek plans match native math on
  `tone.opus` pages (312 preskip, 12000 total, EOF plan), commit
  round-trip with header-mismatch refusal, demux header/split.
- `cargo check -p libzci-web --target wasm32-unknown-unknown` → clean
  (0 errors); release WASM built (`libzci_web_bg.wasm` 257 KiB) with
  the pinned `wasm-bindgen-cli` 0.2.129 via `scripts/build-wasm.sh`.
- Crude PWA: `npm test` → 8 passed (generation fencing, TOC/head
  math); `npm run typecheck` → clean; `npm run build` → production
  bundle in its own `dist/` (engine/decode workers + WASM asset).
- Pending (explicit): real-browser File decode/seek vs native
  timing/channel metadata, bounded reads on the 30 s synth in a
  worker, worker error/cancel/reopen, and the Opus `AudioDecoder`
  description shape — all require browser-inspection authorization
  per the repo operating guide, so no browser was launched. The page
  remains an ordinary proof page (no manifest/SW/install until 3.4).

### 1.4 Add instance-safe libopenmpt and Hively providers — implemented, verification pending

Pins (`libzci/vendor/dependencies.json`, archives verified):

- `libopenmpt` 0.8.4 (`sha256:97530b25…afa76f`), BSD-3-Clause.
- `hivelytracker-replay` `f393ca7…` (`sha256:523de29e…5ad01d5`),
  BSD-3-Clause. Both revisions already had notice entries; no new
  third-party text was needed.

Created:

- `libzci/scripts/acquire-module-deps.sh`: downloads/verifies both
  archives to ignored `.local/libzci/vendor/`, builds native
  `libopenmpt.a` (upstream GNU Makefile, static only, bundled
  miniz/minimp3/stb_vorbis, no mpg123 — the same feature set the
  checked-in browser WASM reports) and `libhivelycontext.a`
  (upstream `hvl2wav/replay.c` unmodified plus the new wrapper;
  rebuilds when the wrapper changes). Touches nothing under
  `public/vendor/`, `src/lib/vendor/`, or `izci-server/`.
  Emscripten `build-wasm/` pending (no `emcc`).
- `libzci-codecs/c/hively_context.{c,h}`: per-instance source/tune/
  probe-tune/buffer/position/duration/subsong/mutes/interpolation,
  pointer-sized native handles, sub-frame spill, order/row and
  subsong/mute getters for isolation tests. Duration/seek are bounded
  steps (`probe_step`/`seek_step`) with cancellation between batches
  on decode jobs — never one uncancellable call, never on audio
  callbacks. `lz_hively_init_tables` fills upstream waveform/pan plus
  interpolation tables; the Rust owner calls it under `Once`, after
  which tables are immutable.
- `libzci-codecs` (`openmpt_ffi.rs`/`openmpt.rs`,
  `hively_ffi.rs`/`hively.rs`, `test_helpers.rs`, extended
  `build.rs` linking `openmpt`/`hivelycontext`/`stdc++`): MOD/XM/
  S3M/IT/MO3 sniff→open through libopenmpt (repeat 0 for finite EOF,
  stereo 48 kHz, subsong clamp+rewind, interpolation control,
  interactive mutes reapplied after seeks, inspection without
  output); AHX/HVL through the new wrapper (bounded cancellable
  duration probe, sample-exact seeks, per-instance mutes).
  `format.rs` centralizes MOD/XM/S3M/IT/MO3/AHX/HVL magics and
  extension lists for both targets.
- `libzci-web`: `BrowserModuleFactory`/`BrowserHivelyFactory` probe
  with the same sniff; opens report explicit `Unsupported`
  (pending Emscripten modules) instead of a demo decoder.

Upstream audit (Hively): playback (`hvl_play_irq`,
`hvl_DecodeFrame`, `hvl_mixchunk`) writes no global state — all
replay state is per-`hvl_tune`. Only `waves`/`waves2`/`panning_*`
(plus the wrapper's interpolation tables) are shared, written solely
by the once-synchronized init. Two live native contexts were
exercised with interleaved seeks/mutes/dispose (see below).

Evidence (all native, profile `none`):

- `cargo test -p libzci-codecs` module suites: `tone.mod`
  renders exactly 368640 finite stereo frames (7.68 s @48 kHz,
  nonzero content, 4 ch, 1 subsong, title/type metadata);
  libopenmpt's 0.1 s trailing-silence past its own duration estimate
  is measured and end-trimmed (documented in-provider). Two-subsong
  helper: count 2, select/clamp/rewind, exact seeks. Mutes apply,
  survive seeks, reject out-of-range channels. Two interleaved MOD
  instances stay independent; one survives the other's dispose.
- Blank AHX/HVL (ported construction): open, finite probed EOF,
  render-to-EOF matches the probe, play-after-end restart, seek to
  duration ends, sub-frame seek lands exactly, order/row advance.
  Interleaved AHX contexts: mute/seek/subsong on A leave B alone;
  survivor reaches EOF after sibling dispose. Magic-less input is
  `Unsupported`; zero-duration tunes are `Corrupt`.
- Recorded leniency (not concealed): magic-claiming structural
  garbage can still "load" through the lenient upstream parser; the
  provider then renders bounded finite silence to a clean EOF rather
  than audible success. Audible AHX/HVL plus XM/S3M/IT/MO3 corpus
  inputs remain explicit acquisition work; Hively DSP/mute sonics are
  unverified by design (blank tunes are silent).
- Missing audible/module coverage is a named Phase 2 concern, per the
  roadmap's allowance — not hidden by these tests.
- Pending: browser module execution (same authorization as 1.3),
  Emscripten provider builds.

## Phase 1 completion

The shared source/provider/session API drives real Opus and MOD
decode natively, Hively lifetime hazards are addressed, recipes are
reproducible, and native uses compiled media code directly. Browser
worker/module execution is pending (authorization), with the code
structured for it. No step depends on an existing frontend
controller or persisted profile.

Next work item: Phase 2.1 — shared audio processing and native
device output (`audio/{processor,buffer,clock,resampler}.rs`, native
`audio.rs`, CPAL output in the native runtime).

## Phase 2: audible zci-play and browser audio output

### 2.1 Add shared audio processing and native device output — implemented, verification pending

Created:

- `libzci/src/audio/` (`buffer.rs`, `clock.rs`, `resampler.rs`,
  `processor.rs`): preallocated lock-free SPSC stereo ring (no
  alloc/lock/SQL in the callback path; under/overruns counted);
  `OutputClock` with requested-vs-running states and
  latency-adjusted media time (never wall-clock); `RateConverter`
  over pinned `rubato` 5 FFT sinc (arbitrary chunks in, fixed blocks
  through, FIFO out; matched rates bypass for bit-exact renders;
  flush pads one tail block — the delay is a leading transient);
  `AudioProcessor` with explicit mono→stereo upmix, finite anchored
  gain/mute ramps, and the raw-program tap point (no consumer
  attached). Master sits after the future Raf slot, per the signal
  graph.
- `libzci-native/src/audio.rs`: CPAL `DeviceOutput` (F32 stereo
  required, anything else a typed failure; preallocated ~2 s ring;
  latency estimate; pause/resume the stream; drop releases the
  device). No device, unknown name, or stream failure is a typed
  `DeviceUnavailable`.
- `libzci-native/src/playback.rs`: one worker thread per output —
  decode through the public session path, explicit channel mapping,
  shared master processor, device-rate conversion, ring feed.
  Generation changes (seek/stop/load) flush the ring and reset
  conversion; pause holds decode and the stream; stop joins the
  thread and drops queued stale audio with it. `render_to_vec`
  reuses the same stages device-free for tests and `--render-pcm`.

Evidence (native, profile `none`):

- `cargo test -p libzci` audio suites: ring bounds/under/overrun,
  clock requested-vs-running + suspend behavior, identity resample
  (delay-compensated correlation > 0.999), exact 2:1 downsample,
  mute/volume ramp shape (monotonic, ends silent, no full-scale
  steps), mono upmix.
- `cargo test -p libzci-native`: device outcome typed either way;
  fake pipeline renders exact provider totals with identical channel
  pairs; zero volume renders silence; 48k→44.1k converts within
  block tolerance; Opus/MOD fixtures render exact audible totals
  (12000 / 368640 stereo frames, finite, nonzero); Hively lifecycle
  renders to EOF.
- Audible smoke (`tests/audible.rs`, real hardware): Default Audio
  Device @48000 Hz consumed 15360 device frames for the 0.25 s Opus
  fixture (audible total plus ring play-out; 7 startup hungry pops),
  pause held the consumed clock exactly across 300 ms, resume
  drained to `drained + finished`. Requested/running, clock,
  underruns, and device label all observed.
- Pending: browser AudioWorklet output and optional platform codecs
  (2.4); gapless/preparation semantics (Phase 5).

### 2.2 Implement zci-play as the first useful consumer — implemented, verification pending

Created (`libzci/consumers/zci-play/`, binary package `zci-play`):

- `src/main.rs`: `zci-play <path>` over native runtime assembly
  (provider registration, source registration, session load/play,
  terminal events, disposal). Flags `--device`, `--volume`
  (linear 0..1), `--start` (seconds), `--subsong` (module content),
  `--diagnostics` (all stderr; stdout stays clean). Parsing only
  converts arguments to core commands.
- Subsong path opens the concrete module instance, applies
  `select_subsong`, and hands it over via the new
  `Session::load_opened` (same generation/state/event discipline as
  registry opens; also mirrored by `NativeRuntime::load_opened`).
  `--subsong` on non-module content is an actionable failure.
- `--render-pcm <file>`: explicit stereo float32-LE @48 kHz render
  without opening any device (playable via
  `aplay -f FLOAT_LE -c 2 -r 48000`). No implicit render mode, no
  FFmpeg subprocess anywhere.
- Exit status: 0 EOF success · 2 usage/media/device failure with an
  actionable stderr hint per error kind · 130 Ctrl-C interruption.
- `README.md`: exact build/run commands, `aplay` playback recipe,
  exit codes, and the native-independence statement.

Evidence (all native, profile `none`):

- `zci-play --help` → exit 0 with units/ranges.
- Audible Opus (`tone.opus --diagnostics`): exit 0; decoded 12000,
  device consumed through `finished`; provider/device/clock lines on
  stderr. Audible MOD (`tone.mod`): played to EOF, exit 0.
- Renders: MOD → exactly 368640 stereo frames (2,949,120 bytes, peak
  0.281); Opus `--start 0.1` → exactly 7200 frames (12000 − 4800);
  blank AHX → 5760 frames (total matches the lifecycle probe).
  Content verified finite/nonzero (MOD/Opus) via sample inspection.
- Failures: missing path (`Unavailable`), garbage bytes
  (`Unsupported`), `--subsong` on Opus (`InvalidArgument`) → exit 2
  with hints. Ctrl-C during the 30 s synth → exit 130
  ("interrupted"); `--start 15` seeks from the supplied position
  (start_frame 720000 in diagnostics).
- `ldd`: libc/libm/ALSA/libstdc++ only — no JS engine, webview, or
  WASM interpreter. The CLI embeds the native library directly.
- Pending: browser AudioWorklet output and optional platform codecs
  (2.4). No database/profile opened (deferred to 3.2 by design).

## Phase 2 status (task scope ends at 2.2)

`zci-play` is independently useful with Opus mandatory: it plays
Opus/MOD/Hively-lifecycle inputs audibly, seeks from a supplied
start, selects module subsongs, renders explicit PCM, handles
EOF/interruption, and frees resources. Registry changes (not CLI
dispatch) decide format support. Deliberately out of scope here:
2.3 (Symphonia-backed ordinary formats, unknown-extension
verification, audible module-fixture broadening) and 2.4
(AudioWorklet output, optional WebCodecs providers) — the browser
audible path. No database/profile opened (deferred to 3.2).
