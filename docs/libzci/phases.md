# Implementation phases

[Entry point](README.md) · [Start with scaffolding](scaffolding.md) ·
[Ownership](boundaries.md) · [Contracts](contracts.md) ·
[Crudes](crudes.md) · [Validation](validation.md) · [Repo references](reference.md)

**Starting state:** these docs are the only libzci work. No workspace, provider,
consumer, database, or profile exists yet. Every step below is unstarted. Paths
under `libzci/` name files to create; links into `src/`, `scripts/`,
`fixtures/`, and `izci-server/` refer to existing files.

Implement the numbered subphases in order. Each describes code to add, references
to inspect, and checks to complete. Later features may adjust a proven API; they
must update both crudes rather than repairing behavior in one UI. Phases 0–3
specify the initial implementation in most detail. Phases 4–7 specify the modules,
behavior, and crude interactions needed to grow a useful core. Phases 8–9 outline
adoption after that core works.

Create `docs/libzci/implementation-log.md` during 0.1. For each subphase record
`not started / implemented, verification pending / verified`, the commit, exact
checks and results, and unresolved failures. A completion check requires evidence,
not an agent's declaration. Missing build authorization or hardware leaves the
relevant check pending. Follow the build/runtime rules in [README](README.md#execution-rules).

## Phase 0: create the starting workspace and enumerate inputs

**Result:** an isolated, almost empty Rust workspace and a precise inventory.
There is no player to launch and no profile to initialize in this phase.

### 0.1 Record the checkout baseline and the work boundary

**Read:** [AGENTS.md](../../AGENTS.md), [scaffolding](scaffolding.md),
[boundaries](boundaries.md), [package.json](../../package.json),
[src-tauri/Cargo.toml](../../src-tauri/Cargo.toml).

1. Record the starting commit and pre-existing changes in the implementation log.
2. Confirm the baseline described in scaffolding: Tauri is the only Rust project;
   the frontend uses Howler/worklets/video elements; server rendering is Go plus
   external/native/WASM media implementations.
3. Record allowed changes for these initial phases: new `libzci/`, these docs,
   narrowly scoped ignore entries, and fixture additions. Existing frontend/
   desktop/Android/server runtime owners stay independent until adoption.
4. Reserve output locations: `libzci/target/`, ignored `.local/libzci/`,
   and the crude PWA's own build directory. Reserve future profile/OPFS/IDB names
   from scaffolding without creating any database or user state.
5. List verification requiring authorization or unavailable tools separately from
   implementation work. Do not launch the current player as a discovery step.

**Check:** the log names the actual baseline, intended outputs, and first work
item. No copied profile, state reader, service worker, or runtime is introduced.

### 0.2 Add the minimum Cargo workspace

**Create:** `libzci/Cargo.toml`, `libzci/crates/libzci/Cargo.toml`,
`libzci/crates/libzci/src/lib.rs`, `libzci/README.md`; update `.gitignore`
only for new generated directories.

1. Add a workspace with the central `libzci` crate as its only initial member.
   Keep it separate from `src-tauri/`; do not create a root Cargo workspace.
2. Make the crate a library, with documentation identifying the core/adapter/
   consumer boundary. It has no browser, device, Tauri, Svelte, or Go dependency.
3. Document the planned package additions and generated-output paths in its README.
   Do not create empty codec, GUI, database, or video modules.
4. Pin the Rust toolchain when the first dependency set is resolved in Phase 1.
   Commit the workspace lockfile with those resolutions.
5. Keep root `package.json`, Vite inputs, PWA scope, and current WASM assets
   unchanged. No root build now depends on libzci.

**Check:** inspect workspace membership and dependency direction; a manifest-only
`cargo metadata --manifest-path libzci/Cargo.toml --no-deps` check may validate
the structure when Cargo is available. No native/media build is required to
finish the directory setup.

### 0.3 Identify fixture bytes and missing coverage

**Read:** [fixtures/README.md](../../fixtures/README.md),
[manifest](../../fixtures/manifest.json),
[toneModule()](../../src/lib/services/openmpt/test-fixtures.ts),
[Hively worklet tests](../../src/lib/services/ahx-worklet.test.ts).

1. Record fixture IDs and expected generated paths: `audio-opus` at
   `.local/verification-fixtures/v1/media/audio/tone.opus` and `module-mod`
   at the corresponding `media/modules/tone.mod`.
2. Check whether generated files are actually present. A manifest entry is not
   a file available to an executable.
3. Record the generator's exact FFmpeg/FFprobe pin and Node requirement. Generate
   the existing corpus only with that toolchain and the required authorization;
   otherwise leave generation pending with the exact missing input.
4. Plan a longer synthetic Opus source for audible playback, seeks, background
   tests, and buffering. Keep it in ignored generated media with a checked-in
   recipe/provenance record. Do not replace the existing corpus digests.
5. Translate the MOD helper and blank AHX/HVL construction into new test helpers
   when providers are implemented. Record that blank Hively tunes prove lifecycle
   only; audible AHX/HVL and XM/S3M/IT/MO3 corpus inputs remain acquisition work.
6. List needed later Opus cases: stereo/mono, gain tags, pre-skip/end trim, chained
   Ogg, truncated data, and differing sample/input lengths. Use synthetic or
   permissively licensed media for committed fixtures.

**Check:** the log distinguishes available bytes, recipes needing execution, and
missing samples. No private music is checked in; no ungenerated file is marked
as a passed decode test.

### 0.4 Specify dependency acquisition and the first build experiment

**Read:** [libopenmpt provenance](../../src/lib/vendor/libopenmpt/README.md),
[Hively recipe](../../scripts/vendor/ahx/README.md),
[build.ps1](../../scripts/vendor/ahx/build.ps1),
[notices](../THIRD-PARTY-NOTICES.md).

1. Add `libzci/vendor/dependencies.json` describing required libraries:
   libopus/libopusfile/libogg, libopenmpt source 0.8.4, and the existing pinned
   Hively commit. Pin new upstream releases/digests before acquiring them;
   unresolved pins are explicitly pending, not floating download URLs.
2. Define the recipe outputs and commands to add in 1.2. Downloads/builds go
   into ignored new locations and must not overwrite current browser/server assets.
3. Record the default experiment from scaffolding: Rust WASM core plus separate
   Emscripten codec modules; native links compiled libraries directly.
4. List the first experiment's input and success condition: the same Opus fixture
   opens, decodes finite PCM, seeks, and closes through the core on native/browser;
   native execution has no JS/WASM runtime dependency.
5. Record that SQLite/browser glue and native device output are separate later
   steps. Do not block workspace creation on their design.

**Phase 0 completion:** the workspace exists, acquisition/fixture inputs are
named, and 1.1 has an actual place to add code. Runtime proofs may still be pending;
there is still no reason to open a libzci profile.

## Phase 1: sources, provider instances, and cross-target decode

**Result:** a source can produce inspectable PCM through core-owned provider
selection on native and browser. Output-device playback comes in Phase 2.

### 1.1 Implement runtime sources and decoder lifecycle

**Read:** [platform-files-types.ts](../../src/lib/services/platform-files-types.ts),
[file-access.ts](../../src/lib/services/file-access.ts),
[OpenMptModule](../../src/lib/services/openmpt/module.ts),
[contracts §§1–4](contracts.md#1-identity-and-sources).

**Create:** core `ids.rs`, `error.rs`, `source.rs`, `provider.rs`,
`session.rs`, `command.rs`, `event.rs`, `audio/pcm.rs`; add
`libzci-native` with file sources and a minimal runtime.

1. Define runtime source/session/provider IDs, typed errors, sample/channel layout,
   source revision, cancellation, and load/seek generation. No Library/queue schema.
2. Implement an in-memory test source and bounded seekable native-file source.
   Report missing/deleted, unsupported, corrupt, cancelled, and access-required
   separately. Preserve native path case.
3. Define provider registration, probe/open, decode, seek, drain, metadata, and
   close. A registry contains factories; each open returns an independent instance.
   Allow both whole-source and packet providers without a fake common demux layer.
4. Define minimum transport states: idle, loading, ready/paused, playing, ended,
   failed, and output-suspended. Commands carry request/session IDs; snapshots
   carry revision/generation and selected-provider facts.
5. Serialize one session's commands. Cancellation/close prevents late results
   becoming authoritative. Observers receive bounded/coalesced data.
6. Add a device-free PCM collector through the public runtime API. A fake provider
   exists only in tests; no production command reports success using it.

**Check:** delayed open/decode followed by seek/stop/dispose cannot publish stale
PCM; two sessions hold separate fake-provider state; errors do not collapse into
"unsupported"; ordinary file reads are bounded rather than whole-file copies.

### 1.2 Acquire reference Opus and implement the native provider

**Create:** `libzci-codecs`, its `opus.rs` and C bridge, and acquisition/build
scripts under `libzci/scripts/`.

1. Resolve/pin dependency versions and Rust toolchain. Build reference libogg,
   libopus, and libopusfile from the manifest inputs; commit reproducible recipes
   and required licenses/notices.
2. Wrap `op_open_callbacks`, PCM read, PCM seek, comments, errors, and close in
   an instance owned by the provider. Native read/seek callbacks access only
   their opened source, on a decode job rather than the audio callback.
3. Normalize output to float PCM, audible duration/position, and declared channel
   layout. Set opusfile header-gain mode explicitly, with zero additional offset;
   document the trims/gain it applies. ReplayGain/R128 tag selection is a later
   core operation, so the provider must not independently select those gains.
4. Register the provider by ID/version and exercise it through a core session.
   Make bounded reads/temporary buffers and resource limits observable.
5. Add provider tests for open/read-to-EOF/seek/reopen, corrupt input, and two
   simultaneous handles. Extend synthetic fixtures where the short tone cannot
   expose the failure.

**Check:** real reference decode produces finite nonempty PCM and expected audible
length; seeks land on the normalized timeline; disposing one handle leaves the
other usable. Record an actual fixture result, not only successful C linking.

### 1.3 Implement the same Opus operation in the browser worker

**Create:** `libzci-web` Rust exports/host imports, browser worker/source/provider
glue in its `js/` directory, and the first `consumers/crude-pwa/` page/config.

1. Compile the Rust control binding and separate Emscripten Opus module. Add
   a typed host bridge for the same provider operations/results used natively.
   Register/open/seek/dispose decisions remain in core.
2. Create one engine worker and a dedicated decode worker. The document sends
   a selected File; it renders snapshots and decode-test results, with no SQL
   or transport policy in `main.ts`.
3. Implement and test the bounded File/Blob synchronous-callback bridge described
   in [scaffolding §3](scaffolding.md#bounded-source-access-and-synchronous-c-callbacks).
   Do not assume a C read callback can await a main-thread Promise.
4. Tag worker requests/PCM with session/generation; return cancelled/stale
   results safely and release their buffers.
5. Use a dedicated origin/port and independent Vite config. Initially this is an
   ordinary proof page; manifest/SW/install support is implemented in 3.4.
6. Give the page file-open, decode, seek, cancel, dispose, and diagnostics controls.
   It must call BrowserHost/public bindings rather than a demonstration decoder
   bypassing the engine.

**Check:** real browser File decode/seek matches native timing/channel metadata
within recorded tolerances; reads remain bounded for a large synthetic source;
worker error/cancel/reopen is correct. Record extra copies/memory. Resolve this
experiment before enlarging the UI; use the scoped fallback in scaffolding if
the callback bridge cannot work.

### 1.4 Add instance-safe libopenmpt and Hively providers

**Read:** [openmpt ABI](../../src/lib/services/openmpt/abi.ts),
[decoder](../../src/lib/services/openmpt/decoder.ts),
[Hively C wrapper](../../scripts/vendor/ahx/ahx-wrapper.c),
[Hively tests](../../src/lib/services/ahx-worklet.test.ts).

1. Add a reproducible native/Emscripten source recipe for libopenmpt 0.8.4.
   The checked-in browser artifact may bootstrap ABI verification; completion
   requires the new source build and matching loader/export list.
2. Implement OpenMPT handle ownership, float decode, seek/subsong, finite EOF,
   basic metadata, interpolation/render controls, and interactive channel mutes.
   Inspect/probe without creating audio output.
3. Add a new Hively C context wrapper: per-instance source/tune/buffer/position/
   duration/subsong/mutes/interpolation; pointer-sized handles on native.
   Audit upstream shared initialization and make tables immutable after one
   synchronized initialization.
4. Add native and browser bindings to the same context API. Do not alter the
   old static wrapper or its users during these phases.
5. Use MOD/two-subsong helpers and blank AHX/HVL inputs for initial lifecycle
   tests. Interleave two instances, seek/select/mute one, and keep the other
   independent. Add audible Hively fixtures before claiming DSP/mute verification.

**Check:** MOD PCM and subsong/seek behavior work on both targets; blank Hively
lifecycle works; native interleaved handles show no singleton state. Any missing
audible/module coverage is a named Phase 2 task, not concealed by these tests.

**Phase 1 completion:** the shared source/provider/session API drives real Opus
and MOD decode on both targets, Hively lifetime hazards are addressed, recipes
are reproducible, and native uses compiled media code directly. None of these
steps depends on an existing frontend controller or persisted profile.

## Phase 2: audible zci-play and browser audio output

**Result:** an aplay-style CLI and an audible browser transport page. An engine
can play a file without having a Library, database, native GUI, or local JS service.

### 2.1 Add shared audio processing and native device output

**Read:** [audio-bus.ts](../../src/lib/services/audio-bus.ts),
[volume.ts](../../src/lib/services/volume.ts); use
[scaffolding §4](scaffolding.md#4-first-engine-and-browser-execution-layout).

**Create:** core `audio/{processor,buffer,clock,resampler}.rs`, native
`audio.rs`; register CPAL output in the native runtime.

1. Split session control, decode work, and the bounded audio-processing path.
   Preallocate PCM transport; device callbacks perform no SQL, file I/O, waiting
   on control locks, or unbounded allocations.
2. Implement float processing, explicit mono-to-stereo/channel mapping, gain/
   mute ramps, resampling to the chosen device rate, and EOF/drain accounting.
   Choose/pin a maintained resampler against these actual tests.
3. Put master volume/mute after the future Raf stage; expose a raw-program tap
   before future ReplayGain/Raf. Do not attach an unused tap consumer.
4. Open default/selected output devices, handle sample formats/rates, report clock/
   latency estimates and underruns, and stop/release on failure or shutdown.
5. Distinguish requested play from output actually running. Pause/seek flushes or
   fences old-generation buffers; stop does not emit queued stale audio.

**Check:** Opus plays audibly; mono and changed-rate sources render correctly;
pause/seek/EOF have measured output behavior. Device-free render tests inspect
sample counts and gain/mute ramps; unavailable devices produce typed failures.

### 2.2 Implement zci-play as the first useful consumer

**Create:** `libzci/consumers/zci-play/`, binary package `zci-play`.

1. Implement `zci-play <path>` using native runtime assembly, source registration,
   session load/play, terminal events, and disposal. No database/profile by default.
2. Add `--device`, `--volume`, `--start`, `--subsong`, and `--diagnostics`.
   Define units/ranges in help; CLI parsing only converts arguments to core commands.
3. Return success on EOF, a documented interruption outcome on Ctrl-C, and
   actionable failures for missing access, unsupported/corrupt media, decoder
   failure, and output-device loss. Diagnostics go to stderr.
4. Add explicit `--render-pcm <file>` for stereo float PCM without opening a
   device. Do not expose implicit render mode or call an FFmpeg subprocess to
   stand in for the library's player.
5. Document exact build/run commands once implemented. For example, the intended
   Cargo entry is `cargo run --manifest-path libzci/Cargo.toml -p zci-play -- <path>`;
   this command is not available before this subphase.

**Check:** actual CLI plays Opus/MOD/Hively lifecycle inputs, seeks from a supplied
start position, handles EOF/interruption, and frees resources. Inspect native
dependencies to confirm no JS engine, webview, or WASM interpreter is required.

### 2.3 Broaden ordinary/module coverage without changing the CLI

**Read:** supported-kind/extension definitions in [types.ts](../../src/lib/types.ts),
[files.ts](../../src/lib/utils/files.ts), the [fixture manifest](../../fixtures/manifest.json).

1. Add a Symphonia-backed provider as the starting choice for WAV/MP3/FLAC/Vorbis,
   enabling only required format features. Keep Opus on the reference provider;
   provider modularity must not depend on Symphonia's unfinished Opus support.
2. Implement centralized extension/kind hints and probe selection. Unknown-extension
   verification optionally invokes the module probe only for unknown files;
   inspection never creates a player.
3. Acquire/generate licensed audible AHX/HVL and XM/S3M/IT/MO3 test inputs with
   provenance. Extend Opus coverage for trimming, gains, chain boundaries,
   corruption, stereo, large sources, and seek near EOF.
4. Exercise full module options, subsongs, loop/repeat limits, interpolation,
   channel mutes, and inspection in CLI/render tests. No second settings owner.
5. Test active playback plus a separate probe/render, and multiple device-free
   sessions. Decoder versions and render settings identify generated PCM results.

**Check:** the declared baseline regular formats and module families decode/play
through registered providers on native and browser. Missing fixtures/capabilities
stay explicit; broader CLI support is achieved by registry changes, not dispatch
logic added to the CLI.

### 2.4 Wire AudioWorklet output and optional browser audio codecs

**Read:** [openmpt worklet](../../src/lib/services/openmpt/playback.worklet.ts),
[protocol](../../src/lib/services/openmpt/protocol.ts) for operational lessons.

1. Build an audio-only WASM module from shared Rust processing code. Instantiate
   it in a thin worklet with preallocated output buffers and no dynamic imports.
2. Connect engine/decode workers to that output through transferable-buffer credit/
   recycling messages. Bound in-flight frames and expose fill/underrun statistics.
3. Report consumed frames, AudioContext state, latency estimates, and generation
   acknowledgment. Core transport uses these observations for its position.
4. Add play/pause/stop/seek/volume/mute to the browser page using engine commands.
   User activation/unlock belongs to the adapter; failed activation remains visible.
5. Probe WebCodecs AudioDecoder with actual configurations. Add its packet provider
   for a proved configuration. Add a focused shared Ogg packet reader for the
   initial Opus proof (or reuse the 1.3 fallback reader), including continuation,
   granule/timestamp mapping, header config, trim, and seek/preroll. Feed packets
   from core; the JS adapter does not take over demux or transport. Keep reference
   Opus available and compare the providers' audible timeline/gain handling.
6. Measure sustained playback and rapid seek with the longer Opus input. Decide
   whether transferable buffers suffice; add a shared-memory path only if measured
   failures justify it and document/test hosting implications.

**Check:** reference Opus and modules are audibly playable in the actual browser;
native/browser gain/mute use the same processing kernels; seek does not leak old
PCM. Optional platform decode support/failure is visible. This remains a page,
not yet evidence of installed/offline/background PWA behavior.

**Phase 2 completion:** zci-play is independently useful with Opus mandatory;
the browser uses the same control/audio semantics and a real output worklet.
Source/provider APIs do not require queue/catalog/UI machinery to play a file.

## Phase 3: add both crudes, persistence, and a real PWA

**Result:** native and browser consumers that can expose core problems through
ordinary interactions, plus actual SQLite storage and installation/lifecycle checks.

### 3.1 Add the crude native UI and transient queue

**Read:** [queue-navigation.ts](../../src/lib/stores/queue-navigation.ts),
[its tests](../../src/lib/stores/queue-navigation.test.ts),
[playback-commands.ts](../../src/lib/services/playback-commands.ts).

**Create:** `consumers/crude-native/`; core `queue.rs` and focused navigation
helpers. Use eframe/egui; no Tauri/webview.

1. Add a simple source-open field/file picker, transport buttons, seek/volume
   sliders, current metadata/provider state, and a bounded diagnostics panel.
2. Introduce queue occurrence IDs separate from source/media identity. Implement
   append duplicates, remove/move, play occurrence, next/previous, repeat/shuffle,
   and up-next through session commands.
3. Port navigation outcomes from current tests, including previous restart
   threshold, active occurrence removal, duplicates, and shuffle bookkeeping.
   The core decides the next occurrence; the UI never indexes a local array to play.
4. Add an equally plain queue list to the PWA. Both display snapshots/revisions
   and pending/error command outcomes.
5. Keep row selection/window geometry local. Closing the UI does not become the
   definition of a setting or transport operation.

**Check:** both crudes reproduce the same queue command scenarios and remain
correct after external command updates. Queue is transient here; persistence is
the next subphase, not secretly localStorage or UI-owned JSON.

### 3.2 Implement shared SQLite and create the first profiles

**Read:** [queue-persistence.ts](../../src/lib/stores/queue-persistence.ts) for the
old boundary, [server store](../../izci-server/internal/persistence/store.go) for
a SQLite precedent, [scaffolding §5](scaffolding.md#5-sqlite-integration-when-storage-begins).

**Create:** core `storage/{mod,schema,settings,sqlite}.rs`, native `sqlite.rs`,
web SQLite bridge/owner initialization.

1. Add the narrow SQLite execution/binding interface and shared SQL statements.
   Native uses SQLite directly; Rust WASM issues the same statements to official
   SQLite WASM in its engine worker. No intermediate dialect or JS domain queries.
2. Prove one normalized settings row: commit through a public command, publish
   its revision after commit, query, close, reopen, and read the same value.
3. Implement schema-version validation and explicit read/write/storage errors.
   Pin/audit OPFS initialization so an error never deletes stored files.
   Acquire a native profile lock or browser owner lock before opening durable
   storage; reject a second owner until client attachment is implemented in 3.3.
4. Create the reserved native/browser namespaces now. Add explicit
   `zci-play --profile <directory>`; retain transient CLI default. Crudes show
   profile identity and whether persistence is available.
5. Add stable source-reference and session rows, then persist queue occurrences/
   options and current domain settings against them. A runtime source handle
   never becomes a durable pointer. Native locators can reopen; browser plain
   File selections remain visibly unavailable after restart until capability
   restoration is added in 3.3. Restart restores a paused session and never
   autoplays or prompts for access.
6. Unsupported schema/storage/quota/busy failures are reported; optional
   in-memory mode is explicitly chosen and labeled. Do not silently fall back.

**Check:** native and real browser OPFS commit/reopen the same scenario; failed
writes publish no successful durable event; schema/init failure preserves data;
queue duplication/order survives reopen. Old izci databases/grants are untouched.

### 3.3 Implement browser capability registry and attached clients

**Read:** [filesystem-folders.ts](../../src/lib/services/filesystem-folders.ts),
[platform PWA adapter](../../src/platform/pwa/platform.ts),
[settings sync](../../src/lib/stores/persistent-store.ts).

1. Add actual FSA file/folder picker adapters and a separate IndexedDB capability
   registry. SQL stores registry reference IDs; selected File snapshots remain
   transient opened sources. Plain file-input sources are labeled non-restorable.
2. Define pending registry insert -> SQL reference commit -> registry completion;
   recover unreferenced/pending entries after a crash without clearing valid grants.
3. Query access on restore without prompting. An explicit open/regrant gesture
   can request access, then retry the same public core command.
4. Acquire an owner lock before opening OPFS. The first main window owns the
   engine/storage worker; a second window discovers it and attaches via messages/
   MessagePort. It never opens another player or SQL pool for that profile.
5. Reconnecting clients request a full snapshot and then revision-checked events.
   Bound messages, deduplicate request IDs, and coalesce telemetry. Closing a
   client disposes its subscriptions/jobs according to their ownership.
6. On owner loss, clients show unavailable state. A remaining window may acquire
   the released owner lock and reopen durable state paused; do not promise
   uninterrupted output or a service-worker-resident player.

**Check:** two real windows share queue/settings updates without a second decoder/
device/SQL owner; disconnect/reconnect/owner loss are observable. Restart preserves
capability IDs and grant-required outcomes, and registry/SQL crash cases reconcile
without fabricated FSA handles.

### 3.4 Turn the browser consumer into an installed offline PWA

**Read:** [vite.config.ts](../../vite.config.ts),
[pwa-updates.ts](../../src/lib/services/pwa-updates.ts),
[media-session.ts](../../src/lib/services/media-session.ts),
[Android notes](../../src/android/README.md).

1. Add the crude's own manifest ID/start URL/scope/icons, production-only SW
   registration, asset manifest, and independent cache names. Use a dedicated
   origin/port; do not register the old app's root service worker.
2. Precache the exact core/audio/provider/SQLite WASM, loaders, workers, and
   worklets. Check actual emitted sizes instead of inheriting the old 4 MiB limit.
   All assets are local; no startup CDN/toolchain service is required.
3. Pin a running engine to a coherent API/assets version. Offer controlled update/
   restart and test offline reopen; do not swap a loader beneath live WASM.
4. Translate Media Session actions to commands and metadata/position from snapshots.
   Test whether the existing low-amplitude transport anchor is needed; if used,
   keep it adapter-owned and never use its HTMLAudioElement clock as media time.
5. Add diagnostics for requested/running output, activation, suspension, decode
   buffer fill, and storage access. Add reproducible background/screen-off tests.
6. Verify Chromium desktop tab/installed PWA and Android Chrome installed PWA.
   Record physical-device results separately from emulator/foreground results;
   APK/WebView support is a later adapter, not proof of PWA behavior.

**Check:** a production-built installed crude launches offline and plays all required
local assets; update/reload preserves its state; background/screen-off output and
lockscreen actions have separate evidence. A failing lifecycle test is unresolved
core/adapter work, not a reason to implement another player in the page.

**Phase 3 completion:** both crudes run through public APIs, SQLite/OPFS and access/
client ownership are real, and the crude PWA has installed/offline/lifecycle
evidence. This is the foundation for replicating the useful depth of current izci.

## Phase 4: grow catalog, user facts, metadata, and visual assets

**Result:** both crudes can build/reopen a useful library and exercise core user
state. They remain simple lists/forms; this phase implements behavior, not shell design.

### 4.1 Add media records and collection/query operations

**Read:** [TrackItem/types](../../src/lib/types.ts),
[queue.ts](../../src/lib/stores/queue.ts),
[dedupe](../../src/lib/stores/queue-dedupe.ts),
[ratings](../../src/lib/services/track-ratings.ts),
[workspace collections](../../src/lib/services/workspace-collections.ts).

**Create:** core `catalog/{media,collections,queries,facts}.rs`, shared schema/
indexes in `storage/`; extend bindings and both crude tables.

1. Add stable media IDs, canonical display path, source locator/revision, Library
   membership, Favorites membership per media/subsong, and queue references.
   A queued source need not be in Library; images cannot be queued as playback.
2. Start with source-identity deduplication, following platform path rules.
   Equal bytes at different paths do not automatically merge. Keep user facts
   on media identity rather than duplicated row snapshots.
3. Add Library add/remove and indexed paged queries with sort/filter inputs.
   Queue occurrence order/duplicates remain separate from Library uniqueness.
4. Implement half-star ratings, favorites, bookmarks with media/subsong/time,
   and updates visible in all memberships after the SQL transaction commits.
5. Native/PWA get Library/Queue/Favorites lists and favorite/rating/bookmark
   controls. UI filtering/sorting that affects catalog results calls core queries.

**Check:** queue duplicates survive, Library duplicates do not multiply, images
cannot play, facts agree across all views/reopen, and failed transactions preserve
previous snapshots. Use existing dedupe/rating/bookmark tests as outcome references.

### 4.2 Register roots and implement bounded folder scans

**Read:** [library-folder-scanner.ts](../../src/lib/services/library-folder-scanner.ts),
[scan tests](../../src/lib/services/library-folder-scanner.test.ts),
[folder reconciliation tests](../../src/lib/stores/queue-folder-reconciliation.test.ts),
[native filesystem references](../../src/lib/utils/native-media-files.ts).

1. Add root records/settings and adapter enumeration/read operations. Native
   uses real paths; browser uses FSA capability IDs. Preserve Linux case.
2. Implement scan jobs with progress/cancel, bounded concurrency, source revision
   comparison, stable IDs, and metadata-probe scheduling away from playback.
3. Reconcile only records owned by the successfully scanned root. Denied,
   unavailable, partial, or cancelled scans must not delete the root's catalog.
4. Preserve ratings/bookmarks/counts across revision changes at a stable identity;
   invalidate derived metadata/artwork/renders by source revision.
5. Startup scan policy queries access without prompting. Add meaningful knobs for
   launch scans, recursion, verification, and scan/probe concurrency.
6. Both crudes expose roots, permissions, rescan/cancel, and scan diagnostics.
   Add an adapter contract test for ranged SAF/native references; actual Android
   runtime integration is later and remains explicitly unverified.

**Check:** nested/duplicate/stable-revision fixture scenarios reconcile correctly;
two roots do not erase one another's records; denied/cancelled scans preserve facts;
large scans remain bounded while playback continues.

### 4.3 Implement player metadata, lyrics, module detail, and play counts

**Read:** [stream metadata IO](../../src/lib/services/stream-meta-io.ts),
[MP3](../../src/lib/services/stream-meta-mp3.ts),
[FLAC](../../src/lib/services/stream-meta-flac.ts),
[Ogg/Opus](../../src/lib/services/stream-meta-ogg.ts),
[ReplayGain](../../src/lib/services/stream-meta-replaygain.ts),
[lyrics](../../src/lib/services/lyrics.ts),
[play count](../../src/lib/services/play-count.ts).

1. Map current useful metadata fields/precedence into normalized core types.
   Use provider/container metadata where reliable; implement bounded supplemental
   readers for missing tags, artwork references, ReplayGain, and lyrics. Do not
   port Mediabunny/tool writers into the runtime.
2. Keep embedded lyrics/artwork bodies on-demand; SQL contains appropriate text
   metadata/facts and revision information, not large blobs or pattern snapshots.
3. Add LRC/plain lyric parsing, timeline lookup, module metadata/subsong labels,
   compact pattern information, current pattern position, and channel controls.
4. Implement continuous-play counting from authoritative output progression with
   configured threshold, reset/seek/pause semantics, and Library-only commits.
   Port the intended outcomes in current play-count tests.
5. Both crudes expose details, lyrics text/current line, a plain pattern table,
   subsong/channel controls, count threshold, and counts/last-played.

**Check:** metadata inspection has no AudioContext/device player; counts accrue
once through the service rules, independently of UI lifetime; changing revision
invalidates stale data; malformed/oversized tags/lyrics remain bounded.

### 4.4 Implement artwork, image providers, and independent viewing

**Read:** [stream-artwork-reader](../../src/lib/services/stream-artwork-reader.ts),
[artwork cache](../../src/lib/services/artwork-cache.ts),
[thumbnail cache](../../src/lib/services/visual-thumbnail-cache.ts),
[image-session](../../src/lib/services/image-session.ts),
[its tests](../../src/lib/services/image-session.test.ts).

1. Add embedded/external asset identities and on-demand extraction, with negative
   cache results only after successful source reads. Cache by source revision.
2. Register image providers like other media providers. Start with ordinary
   JPEG/PNG/WebP support via compiled native providers and browser image capabilities;
   declare orientation/color/dimensions/ownership. Keep room for optional libjxl.
3. Implement bounded rebuildable renditions and eviction, with native files and
   browser OPFS blobs behind asset storage mechanisms. Keep binary image data
   out of catalog/queue rows. Expose byte/dimension budgets as core settings.
4. Add transient image-session creation from a captured media-ID sequence,
   next/previous/shuffle/repeat, release, and generation-safe asset jobs.
5. Both crudes show artwork/thumbnails and a basic independent image viewer.
   Widget zoom/pan/layout and palette/backdrop work remain presentation behavior.

**Check:** viewing/navigating images leaves music transport untouched; captured
navigation remains stable if the originating list changes; missing grants do not
become false no-art results; cancellation/eviction bounds resources on both targets.

**Phase 4 completion:** both crudes import, scan, query, edit user facts, reopen
state, inspect media, and display artwork/images through libzci. There is one
domain SQL implementation, and no UI owns reconciliation/counting/navigation policy.

## Phase 5: shared Raf, contextual settings, and prepared playback

**Result:** both crudes expose useful playback/Raf depth and improve core behavior
without preserving old audio implementations or old serialized state.

### 5.1 Implement rack processing and the first effects

**Read:** [raf-engine](../../src/lib/services/raf-engine.ts),
[registry](../../src/lib/services/raf-effect-registry.ts),
[settings](../../src/lib/stores/raf-settings.ts),
[effects/tests](../../src/lib/services/raf-effects/).

1. Separate effect capability/parameter data from labels/icons/widgets. Core
   descriptors contain IDs, units, bounds/defaults, enum choices, and normalization.
2. Add `raf/{rack,parameters,smoothing}.rs` plus processing modules for Graphic
   EQ, Auto Amp, and Stereo Width. Keep master gain/mute after the rack and
   ReplayGain before it; preserve the video Auto Amp bypass policy.
3. Implement ordered instance IDs, enabled/rack power, dry/wet, finite anchored
   parameter ramps, reset/dispose, declared latency/tails, and latency-aligned mixes.
4. Prepare topology changes off the audio thread and transition safely. Keep the
   same DSP kernels in native output, worklet WASM, and explicit processed rendering.
5. Both crudes get add/remove/reorder/bypass controls, descriptor-driven parameter
   editors, gain-reduction/level diagnostics, and persistence of normalized settings.

**Check:** EQ frequency response, Auto Amp gain/limits/recovery, width channel
behavior, smooth parameter changes, and bypass/latency are tested on synthetic
signals. Compare native/WASM shared code results, not old browser-node waveforms.

### 5.2 Complete the useful effect inventory

1. Add Crystalizer, Sloptimizer, Reverb, Pitch, and Heat as individual effect
   modules, each with property tests and controls in both crudes.
2. Use the current registry/effect files to inventory meaningful controls:
   multiband intensity/mute/bypass; lift/crossovers/upward compression/ceiling;
   reverb mix/decay/predelay/damping; pitch shift/quality; drive/output/color.
3. Choose maintainable algorithms for each role; record changed obsolete controls
   and the practical replacement. No golden-ear equivalence or preset conversion.
4. Measure worst-case rack CPU, allocations, reported latency, tails, sample-rate
   changes, silence, extreme inputs, and repeated topology edits. Fix violations
   in shared processing instead of adding consumer-specific DSP.

**Check:** all eight useful roles work natively and in the PWA. Individual and
combined racks remain finite/bounded, parameters function without an Options
window, and effect implementations have stated latency/reset behavior.

### 5.3 Add presets, contextual loadouts, and effective settings

**Read:** [loadouts service](../../src/lib/services/loadouts.ts),
[store](../../src/lib/stores/loadouts.ts),
[tests](../../src/lib/services/loadouts.test.ts),
[Raf presets](../../src/lib/stores/raf-presets.ts).

1. Add SQL-backed current-version rack presets and playback/Raf settings bundles.
   Keep matching priority, manual override, baseline restoration, and effective
   settings in core.
2. Implement exact file identity, folder context, recognized media type, and tag
   matching. Use a bounded Rust regex implementation/syntax for tag patterns;
   do not reproduce JavaScript RegExp or import old expressions/settings.
3. Emit matched loadout identity/context and effective playback/Raf settings.
   Presentation consumers may associate appearance payloads with that identity;
   core owns neither themes nor backdrop/visualizer settings.
4. Both crudes expose preset CRUD, target editing, manual overrides, and effective
   values/reasons. Controls dispatch commands; closing the editor changes no policy.

**Check:** current loadout outcome scenarios cover matching/order/restore/override;
metadata or queue context changes re-evaluate correctly; SQL/reopen preserves
new settings. No old-state reader or backup/restore feature is added.

### 5.4 Implement next-track preparation, gapless, and transitions

**Read:** [player-controller](../../src/lib/services/player-controller.ts),
[characterization tests](../../src/lib/services/player-controller.characterization.test.ts),
[playback commands](../../src/lib/services/playback-commands.ts).

1. Add focused preparation/transition modules to the session. Resolve next
   occurrence/settings, open an independent provider, prefill bounded PCM, and
   expose prepared identity/readiness/error.
2. Invalidate stale preparation after relevant queue/settings/source/seek changes.
   Keep current, prepared, outgoing, probes, and renders distinct; enforce budgets.
3. Join normalized audible ranges after trim/drain/resampling. Measure the actual
   sample join before declaring gapless; no delayed UI "play next" sequencing.
4. Add fades/crossfades, manual/automatic policy, failed-next behavior, repeat/
   shuffle/duplicate occurrences, short sources, and rate/provider changes.
5. Both crudes expose preparation diagnostics, transition settings, and controls
   that provoke rapid edits/seeks while decoding. Include Opus and Hively cases.

**Check:** sample-level join tests, invalidation scenarios, and real native/browser
output demonstrate no stale next track, singleton decoder, or unbounded retention.
Record supported gapless behavior per provider and limits honestly.

**Phase 5 completion:** useful Raf/loadouts/prepared playback are core operations,
both crudes exercise them, and shared realtime/audio latency behavior is measured.

## Phase 6: core video transport with browser codec execution

**Result:** video works through the shared engine with browser codecs, then a plain
viewport. A native optional FFmpeg provider may extend coverage independently.

### 6.1 Implement demux/timestamps and browser provider contracts

**Read:** [video-player](../../src/lib/services/video-player.ts) for current behavior,
[video fixture definitions](../../fixtures/manifest.json),
[visual resource contract](contracts.md#7-video-and-image-resources).

1. Add core `video/{demux,timeline,frames,scheduler}.rs`. Start WebM/Matroska with
   the Opus/VP8 fixture, then MP4 with H.264/AAC; use maintained container readers
   behind core contracts where possible rather than porting a JS player.
2. Extract stream configurations, codec initialization data, timestamps, durations,
   keyframe/decode order, audio/video tracks, and seek/preroll. Keep codec-delay/
   discard/header-gain interpretation explicit and applied exactly once.
3. Add the browser VideoDecoder adapter in a supported worker context. Query
   actual configurations; track asynchronous decode/flush/reset failures and limits.
4. Keep VideoFrames in an adapter handle table. Rust sees timing/format/lease IDs,
   requests release/presentation, and rejects stale generations. Do not copy pixels
   into WASM or JSON merely to display frames.
5. Add bounded decode-without-display controls to the PWA to prove configuration,
   seek, handle release, and recovery before adding the viewport.
6. Add optional native FFmpeg as a linked provider if needed for the native viewport.
   Feature-gate it completely out of the browser dependency/assets graph.

**Check:** demux/seek/preroll and packet configuration work on actual fixture bytes;
unsupported configurations fail explicitly; repeated seeks release stale frames;
browser assets contain no software video decoder.

### 6.2 Add plain viewports and synchronize to audible output

1. Add one native viewport and one PWA canvas/surface. Shell mounts/selects it;
   adapter rendering executes core deadlines without a frame-by-frame Svelte/
   UI control round trip.
2. Map media timestamps to the audible audio-output clock, including buffered
   frames and Raf/output latency. Silent video uses a monotonic core timeline.
3. Implement core frame retention/drop policy and exclusive surface ownership.
   Detaching/reattaching changes a surface, not the playback session/source.
4. Both crudes show stream selection, transport/seek, dimensions/timestamps,
   frame-queue/drop/presentation statistics, and A/V latency diagnostics.

**Check:** visible A/V sync, silent video, repeated seek, DSP-latency changes,
surface handoff, orientation/color handling, and cleanup work on declared targets.

### 6.3 Verify efficiency and hidden/background recovery

1. Suspend unnecessary hidden video decode/presentation while audio continues.
   Reopen/seek/preroll video to the current timeline when visible again.
2. Handle decoder reclamation, device/output interruption, and provider/resource
   errors through the existing generation/command model.
3. Measure decoder CPU/queue/GPU-resource behavior and visible timing on
   representative longer/larger media, not only tiny fixture clips.
4. Repeat tab/installed-PWA background and physical Android screen-off scenarios.
   Media Session/anchor controls and continued audio remain separate results.

**Phase 6 completion:** browser WebCodecs and surfaces serve core-owned transport;
no primary video-element backend or bundled software video decoder is needed.
Efficiency/recovery have actual evidence. Unsupported codecs are reported rather
than silently delegated to a second player.

## Phase 7: establish that the core is good enough for adoption

### 7.1 Close gaps found through the crudes

1. Run the [maturity checklist](validation.md#core-maturity-gate) against native,
   browser, installed PWA, and physical-device evidence.
2. Compare the crudes' available operations with current playback/library/Raf/
   source/artwork/video behavior references. Fix missing core functionality or
   erroneous consumer ownership before integrating existing Svelte.
3. Exercise multiple independent sessions, a session without a device, active+
   prepared+outgoing providers, probe/render concurrency, cancellation, restart,
   access loss, database failures, and bounded resources.
4. Audit consumer code for direct SQL, UI-owned shuffle/count/reconciliation/
   loadout logic, old store imports, and JS-only DSP. Move discovered rules back
   into core and expose necessary public observations.

**Check:** each required operation can be driven without the consumer that first
implemented its control. No native JS/runtime dependency or PWA escape hatch exists.

### 7.2 Exercise a real foreign caller and document supported behavior

1. Add/complete `libzci-ffi` with opaque runtime/session/job handles, explicit
   buffer allocation/release, typed errors, version check, and bounded events.
   Panics/C++ exceptions cannot unwind across the boundary.
2. Compile/run a tiny C caller that opens/renders/seeks/closes two sessions with
   native files and no audio device. Verify cancellation and cleanup.
3. Record current API version, dependency/build recipes, provider/format/platform
   matrix, lifecycle evidence, known limits, and reproduction commands. Choose
   realistic resource budgets from measurements and rerun unresolved scenarios.

**Phase 7 completion:** the core is independently useful, exercised deeply by
both crudes, and its required browser/native checks pass. Required checks can
change only by an explicitly agreed scope change, never to reach Svelte sooner.
The API is stable enough for the next integration, not a perpetual plugin ABI.

## Phase 8: replace izci-server's overlapping engine

### 8.1 Design and implement against the mature core

Write a focused adoption plan using actual libzci APIs. Start from
[PCMProducer](../../izci-server/internal/media/render.go),
[render jobs](../../izci-server/internal/media/render_job.go),
[host session](../../izci-server/internal/host/session.go), and
[SQLite store](../../izci-server/internal/persistence/store.go).

Replace overlapping decoding, catalog/queue/user state, session/timeline, and
device-free rendering with libzci. Keep Go signaling, admission, pairing,
permissions, Pion transport, and delivery orchestration in their present owners.
The later design must resolve exact handle/thread/job ownership rather than
keeping a competing Go player as a permanent facade.

### 8.2 Verify dedicated hosting

Prove shared playback and independent Freeplay sessions, source-file and buffered
Opus/WebM delivery, bounded renders/cache invalidation, and listener-owned
ReplayGain/Raf/master processing. Preserve protocol fixtures/version separation
and sensitive-data handling. No live RTP or old-state migration. Run required
Go formatting, vet, and race tests after server source changes.

**Phase 8 completion:** dedicated hosting consumes the core for its player
behavior. Detailed server implementation tasks are written after Phase 7, using
the proven API rather than invented foreign-binding assumptions.

## Phase 9: migrate existing Svelte runtime owners piecemeal

### 9.1 Write the adoption plan after the core and host are mature

Use the actual API to define coherent ownership slices for browser PWA, desktop,
and Android. Account for current
[player-controller](../../src/lib/services/player-controller.ts),
[queue facade](../../src/lib/stores/queue.ts),
[platform adapters](../../src/platform/README.md), and separate settings/windows.
Desktop, mobile, and Oda remain presentations of one runtime.

### 9.2 Replace each selected owner while keeping one authority

Svelte stores become observation/binding facades; components render and dispatch.
Migrate complete ownership slices without two players, two authorities for the
same state, or dual-writing old/new persistence. The new versions create fresh
libzci state with no pre-libzci migration/backup/restore path. Preserve offline/
install/update, source/grant, and listener-DSP behavior through the appropriate
adapters.

**Endgame:** existing shells consume a core already shaped by the CLI and crudes.
Themes, visualizers, backdrops, workspace layout, mobile interaction, and Oda
remain shell code. Detailed Svelte migration and workbench/tag-writing adoption
are separate later plans; they are not tasks to begin while developing the core.
