# Phases and acceptance gates

[Plan entry point](README.md) · [Boundaries](boundaries.md) ·
[Scaffolding](scaffolding.md) · [Crudes](crudes.md) ·
[Validation](validation.md) · [Codebase reference](reference.md)

This is a dependency sequence, not a calendar or a claim of completed work.
Native and PWA proofs accompany each relevant slice. Update evidence as work
lands; a later phase can refine APIs without carrying old-state compatibility.

## Phase 0: establish the execution boundary

### 0.1 Confirm ownership and isolate the new runtime

Read the linked boundaries/contracts and current repository operating guide.
Use a fresh libzci profile and isolated consumer outputs. Keep the old player
working; do not route it into the engine during scaffolding.

### 0.2 Select proof inputs and record unresolved technical choices

Inventory pinned decoder sources and fixtures. Identify the Opus corpus,
libopenmpt/Hively inputs, and synthetic audio needed for initial tests. Record
fixture gaps honestly. Schedule toolchain, SQLite/VFS, worker ownership, and
audio-buffer transport proofs from [scaffolding](scaffolding.md).

**Exit:** ownership is explicit, profiles/artifacts cannot collide, and the first
proofs have concrete inputs and pass/fail criteria. Builds/runtime checks still
follow the existing explicit authorization rule.

## Phase 1: portable foundation and first vertical proofs

### 1.1 Engine lifetime and control surface

Create the small workspace, target dependency boundaries, engine/session handles,
source IDs, typed errors, generations, disposal, and observation. Add an injected
clock/test source and a minimal foreign-boundary ownership check. No global player.

### 1.2 Native and WASM media integration

Prove reference Opus through the same core contracts on both targets. Establish
the libopenmpt build/ABI and a tiny native/WASM MOD decode. Refactor Hively state
to instance contexts and prove independent native contexts and reproducible
browser builds; audit shared initialization. Do not grow UI breadth around an
unresolved dependency strategy.

### 1.3 Shared SQL with real browser persistence

Prove an engine-owned record/transaction against native SQLite and browser OPFS.
Establish the database-owner/client and FSA registry boundaries, reopen/reload,
failure behavior, and profile names. Finalize VFS/toolchain decisions from actual
evidence. No JS-side duplicate catalog or generic storage dialect.

### 1.4 Audio execution and browser proof page

Wire native output and WASM DSP/AudioWorklet output with volume/mute, bounded
buffers, EOF/drain, seek generations, and output-clock diagnostics. Measure the
initial browser buffer transport. Evolve this thin proof page into the crude PWA
instead of retaining a disconnected browser demo.

**Exit:** the [scaffolding proofs](scaffolding.md) pass, native consumers require
no JS runtime, Opus works, provider/source/SQL ownership is exercised, and PWA
support is demonstrated beyond compilation.

## Phase 2: useful zci-play

### 2.1 Aplay-style consumer

Implement source/device/volume/start-position handling through public APIs.
Play to EOF, interrupt cleanly, report meaningful failures, and release all
resources. Add explicit subsong selection. Keep the default profile isolated.

### 2.2 Ordinary audio coverage

Add MP3, WAV, FLAC, Ogg Vorbis, and Ogg Opus through proven modular providers.
Handle device rates/formats and explicit channel mapping. Verify streaming reads,
corrupt input, duration/trim/gain interpretation, and seeks on actual Opus files.
Probe a browser audio provider where available; it is optional, not the only
working Opus implementation.

### 2.3 Module and render coverage

Exercise libopenmpt and Hively playback controls, inspection without output,
subsong/EOF behavior, and simultaneous opened instances. Add a bounded raw-PCM
render sink for device-independent tests and future host use. Missing licensed
fixtures are acquisition work, not permission to mark formats verified.

**Exit:** the CLI is a useful independent player for the declared baseline;
matching WASM provider/source smoke tests remain passing. Queue/catalog/UI
development has not become necessary just to play a file.

## Phase 3: establish both crudes as maintained consumers

### 3.1 Native transport workbench

Add the native UI's file opening, transport/seek, metadata/state display, bounded
diagnostics, and basic sequential queue interactions. All actions use public
commands. No webview and no alternate UI-owned player.

### 3.2 PWA transport workbench

Expose the corresponding browser controls, real file/capability access,
WebCodecs audio probes, output buffering, and seek diagnostics. Add Media Session
and the adapter-owned transport anchor if required.

### 3.3 Install, offline, lifecycle, and client ownership

Test installation/offline assets/update coherence, background/screen-off and
interruption recovery, and attached-client behavior. Record browser/device
results separately from emulator/foreground results. Exercise storage ownership
and disposal without erasing profiles or grants.

**Exit:** [consumer discipline](crudes.md) holds, both crudes can reproduce a
transport problem with useful evidence, and the supported browser runtime has
real playback/lifecycle evidence. An unproven background path remains an open
gate, not a promise based on working lockscreen buttons.

## Phase 4: catalog, user facts, and visual assets

### 4.1 Domain schema and authoritative mutations

Implement media/source records, collection memberships, session queues and
occurrences, favorites/subsongs, ratings, bookmarks, Library counts/last-played,
and normalized domain settings. Add paged/indexed queries and committed revision
events. No cloned ratings/user facts spread across collection rows.

### 4.2 Managed sources and reconciliation

Implement folder registration, scans/progress/cancel, bounded metadata jobs,
stable IDs/source revisions, and owner-scoped reconciliation. Preserve Linux
case, genuine FSA capabilities, and ranged SAF access. Startup scans never
prompt; denied/unavailable roots retain recoverable catalog/user state.

### 4.3 Metadata, lyrics, and modules

Add player metadata and on-demand lyrics/pattern information, module settings,
subsongs/channel mutes, and source-revision cache invalidation. Expose basic
inspection in the crudes. Tag writing and Troubadour remain deferred.

### 4.4 Artwork and independent image viewing

Add extraction, provider-based image decoding, bounded rendition caches, and
captured-sequence image navigation. Native crude and PWA display artwork/images;
neither puts blobs in catalog rows or lets image navigation affect music. Keep
palette/backdrop presentation outside the engine.

**Exit:** the crudes can operate and reopen a useful Library/queue/user-state
profile through public APIs; scans and access failures preserve correct facts;
artwork/images function independently of playback. SQLite is the only domain
storage implementation on both targets.

## Phase 5: Raf, contextual settings, and prepared playback

### 5.1 Rack execution and simple effects

Implement shared native/WASM rack ordering, bypass/dry-wet, smooth parameter
updates, topology replacement, latency/tails/reset, and finite processing. Add
EQ, Auto Amp, stereo width, and the essential gain/ReplayGain chain. Expose their
meaningful controls and diagnostics in both crudes.

### 5.2 Complete useful Raf effects

Implement Crystalizer, Sloptimizer, Reverb, Pitch, and Heat. Improve algorithms
where useful; validate effect properties rather than old browser sound. Add
controls as capabilities land. Remove obsolete algorithm-specific knobs only
with a recorded rationale and a useful replacement when needed.

### 5.3 Presets, loadouts, and effective state

Persist current Raf presets/domain settings and contextual playback/Raf matching.
Declare a bounded matching syntax rather than emulating JavaScript RegExp by
default. Crudes show matched context, overrides, and effective settings. Keep
appearance payloads owned by presentation; emit match identity for consumers.
No pre-libzci preset import or cross-generation backup/restore implementation.

### 5.4 Preparation, gapless, and transitions

Complete next-track preparation and invalidation against actual queue/loadout
changes. Exercise gapless audible joins, fades/crossfades, duplicate occurrences,
provider resource limits, seeks, rate changes, and EOF/failure. Include Hively
and browser output timing; prove no accidental global decoder/rack.

**Exit:** useful Raf and prepared playback run independently of any settings UI;
native/WASM use the same DSP code; latency and real-time bounds are measured.
The native crude can exercise current playback/Raf depth without repairing core
state or copying application rules.

## Phase 6: browser-owned video codecs, core-owned video transport

### 6.1 Container/decoder contracts

Implement the necessary video container/stream reading, timestamp/configuration
handling, bounded provider queues, opaque frame resources, and seek/preroll.
Browser uses WebCodecs with actual configuration probes. Native may add an
optional FFmpeg provider; software video codecs are excluded from PWA assets.

### 6.2 Minimal native and PWA viewports

Add one plain viewport to each crude. Exercise audio-led synchronization with
DSP/output latency, silent-video timing, rapid seek, surface handoff, drop policy,
color/orientation metadata, and cleanup. Rendering executes deadlines locally;
the UI does not schedule every frame.

### 6.3 Efficiency and recovery

Measure decode/presentation cost, frame queues, dropped frames, hidden-surface
audio continuation, decoder reclamation and reopen/preroll, and screen-off
recovery. Media Session/OS controls remain a separate adapter capability. Record
unsupported configurations without adding software video codecs to the webpage.

**Exit:** useful video playback is proven through the core/provider boundary;
the PWA uses browser decoding and surfaces without a primary `<video>` player;
native optional providers can expand coverage independently. Foreground-only
decode success does not close lifecycle/efficiency gates.

## Phase 7: independent-core maturity gate

### 7.1 Consumer and contract audit

Run the [maturity checklist](validation.md#core-maturity-gate) against both
crudes. Exercise multiple sessions, device-free rendering, restart/access/job
failure, cancellation, and resource bounds. Remove business rules accidentally
implemented in consumers and resolve API gaps revealed by replicated behavior.

### 7.2 Declare supported capability coverage

Record platform/provider/format coverage, browser/device lifecycle results,
toolchains, known limitations, and reproducible checks. Ensure missing target
coverage is explicit. Freeze only the current integration contract needed for
the next consumer, not a perpetual public plugin ABI.

**Exit:** libzci is independently useful and mature enough for adoption. It does
not need to emulate all UI features or settle future workbench ownership. All
mandatory core/browser gates must be passed or have an explicitly agreed scope
change; do not silently waive them to reach Svelte sooner.

## Phase 8: replace izci-server's engine

### 8.1 Design against the mature API

Write a focused server adoption design using the proven foreign binding and
device-free render/session model. Replace overlapping media, catalog, and session
behavior while retaining Go signaling, admission, Pion transport, permission,
pairing, and delivery orchestration. The existing PCMProducer seam is a useful
starting reference, not a requirement to preserve its implementation.

### 8.2 Verify hosting behavior

Verify shared and independent Freeplay sessions, source-file and buffered Opus
delivery, bounded rendering/cache ownership, and listener-owned DSP. Maintain
protocol fixtures/version separation and sensitive-data rules. No live RTP and
no migration from old server state. Follow required Go formatting/vet/race tests
when this phase changes server source.

**Exit:** the server consumes libzci rather than sustaining a competing player
engine. Implementation details belong in the later adoption design.

## Phase 9: existing Svelte shells consume libzci piecemeal

### 9.1 Define adoption slices

Write the frontend adoption design only after the maturity/host stages, using
actual contracts. Select coherent ownership slices and adapters for PWA, desktop,
and Android. Existing desktop/mobile/Oda presentation remains outside libzci.

### 9.2 Replace runtime owners progressively

Svelte stores become observation/binding facades and components dispatch commands.
Move coherent slices without two authorities for the same state or dual-writing
old/new persistence. Start new libzci-backed versions with fresh state; retain no
cross-generation import or compatibility bridge. Keep PWA offline behavior and
platform source/grant boundaries intact.

**Endgame:** the existing shells consume the mature engine while themes,
visualizers, backdrops, workspace, mobile, and Oda presentation remain their own
code. Detailed frontend migration work is intentionally outside this initial
plan. Tag editing/Troubadour and other workbench adoption require separate later
scope decisions.
