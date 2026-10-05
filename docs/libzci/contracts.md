# Runtime contracts

[Plan entry point](README.md) · [Ownership boundaries](boundaries.md) ·
[Initial scaffolding](scaffolding.md)

These are invariants for implementation, not a requirement to create every type
in Phase 1. The [roadmap](phases.md) says when each part is introduced: runtime
sources/sessions/providers in Phase 1, audio output in Phase 2, queue/storage in
Phase 3, catalog/assets in Phase 4, Raf/preparation in Phase 5, and video in
Phase 6. Add concrete API types when their operations are implemented.

## 1. Identity and sources

Distinguish catalog item ID, queue occurrence ID, source-reference ID, source
revision, playback session ID, operation generation, and module subsong. Repeated
queue occurrences can reference one catalog item while navigating independently.
Metadata refresh and rescans preserve user facts; source revision invalidates
decoder preparation and derived media caches without becoming a new rating ID.

Model a media record separately from Library/Favorites memberships and ordered
queue occurrences. A queued source need not already belong to Library. Preserve
the useful current distinctions: Library uniqueness, duplicate queue entries,
Favorites membership per item/subsong, half-star ratings following media identity,
and play counts belonging to Library. Bookmark targets include the relevant
media/subsong context. Keep playback options and queues scoped to sessions;
desktop selection is not persisted domain state merely because the old collection
snapshot happened to include it.

Keep one canonical display/catalog path. A platform locator is an access
reference, not a second display-path cache. Identity comparison follows the
platform's rules, including case-sensitive Linux identities. Portable profile
export/rebinding is not part of the clean-break milestone.

Sources expose bounded reads, length/seek capabilities, revision, cancellation,
and typed access failures. They may represent a native file, browser capability,
or SAF URI. The browser bridge supports asynchronous reads; no core synchronous
file call may secretly block the browser main thread. Native source access must
not copy whole ordinary audio/video files merely to start streaming them.
Module providers may require a complete bounded source buffer; declare that
requirement and maximum size instead of implying all providers stream packets.

A runtime source handle and a durable source reference are different objects.
The first decoder can open a native file or browser File with no profile. When
storage lands, persist a stable reference/locator and reopen a runtime source
from it. Persist neither an open pointer nor the claim that a plain browser File
selection can be recovered after reload. Synchronous C codec callbacks may use
a bounded worker-local reader; general browser capability/materialization and
ranged source requests remain asynchronous, without blocking the window thread.

Separate grant-required, unavailable/deleted, corrupt, unsupported, and cancelled
results. Startup scans do not prompt. Explicit commands can return a
grant-required outcome; a shell obtains a gesture/grant and retries. Lost access
must not reconcile an entire remembered folder into deletion.

## 2. Control and observation

Consumers submit typed commands, make queries, and subscribe to snapshots/events.
They cannot mutate engine collections or obtain internal player pointers.

- Commands identify the target session and a request ID. Define acceptance,
  completion/failure, cancellation, and durable commit acknowledgment separately.
- Each session's control executor serializes its state changes. Shared catalog
  changes use the profile's mutation owner and SQLite transactions.
- State snapshots carry revision/sequence information. Initial subscription and
  reconnect obtain an authoritative snapshot; subsequent deltas can be checked
  against that revision. Suppress duplicate commands/events at transport seams.
- Long jobs report bounded progress and terminal outcomes. Coalesce rapidly
  changing telemetry; slow clients cannot accumulate unlimited events.
- Durable events publish after commit. A failed write remains an observable
  failure, not a successful UI update that disappears on restart.
- Position, meters, waveform samples, patterns, and frame handles are transient
  observations. The UI samples them; UI timers never advance playback.

Define a small binding/API version and reject incompatible peers explicitly.
This supports current-version clients and reconnect behavior, not adapters for
old application state or an early promise of a permanent ABI.

## 3. Native bindings and browser bridges

Native Rust consumers embed the library directly. A small C-facing boundary
uses opaque handles, explicit allocation/release, typed errors, and bounded
buffer sizes. Do not let Rust panics or C++ exceptions unwind across it. Exercise
it with a minimal foreign-language caller before the server adoption stage.

Browser bindings export the same operations and semantics. Adapt capabilities,
worker messages, and buffer transport without reimplementing sequencing or SQL
in TypeScript. Control messages may be structured; PCM and video pixels do not
travel through JSON. Serialize neither browser objects nor native addresses into
durable records.

Consumer disconnect cancels its jobs/subscriptions according to explicit
ownership, not necessarily shared playback. Document startup, disposal, orphan
cleanup, and host termination. Closing the final playback host has a defined
outcome; a service worker is not a permanent player process.

## 4. Provider registration and preparation

Register providers at startup with IDs, versions, supported operations/formats,
configuration probes, resource limits, and selection preferences. An extension
is a hint; actual media/configuration support and bounded verification decide
whether a provider can open it. A present API is not proof of codec support.
Keep supported-extension/kind policy centralized. The optional unknown-extension
verification setting invokes a background module probe only for unknown inputs;
metadata inspection is a separate job and never creates an audio output player.

Support both packet-decoder providers and source-decoder providers. libopus,
libopusfile, libopenmpt/Hively, and FFmpeg have different useful boundaries; do
not force all of them into a fake identical demux interface. Normalize their
output/timing/error contracts, and keep provider-specific controls explicit.
Declare which container trims and mandatory header gains a source provider has
already applied, so packet and source providers normalize to the same audible
timeline without doubling trimming or loudness adjustments. ReplayGain tag
policy remains engine-owned.

Each opened instance is independent. The current source, prepared next source,
outgoing transition source, metadata probe, and offline render can coexist within
bounded resource budgets. No mutable singleton decoder. Static immutable tables
can be shared only after proving initialization/thread safety.

Preparation belongs to the session engine. It chooses the next occurrence,
opens/probes a provider, fills bounded buffers, and commits or abandons the
prepared generation. Queue edits, seeks, source changes, and loadout changes
invalidate preparation where relevant. Late provider output carries generation
identity and cannot enter the new timeline.

Gapless joins audible sample ranges after delay/padding/discard handling,
resampling, and decoder draining. Exactly one layer applies each trim/gain rule.
Readiness is distinct from audible start. Test duplicate occurrences, changed
sample rates, short tracks, EOF, module subsongs, failures, and rapid navigation.
Fades/crossfades reuse the preparation mechanism. Do not call a fast second open
"gapless" without measuring the join.

Fallback is bounded and occurs during preparation when possible. Expose the
selected provider and reason; distinguish decoder failure from unavailable file
access. Runtime module loading and uninterrupted mid-track provider replacement
are outside the initial contract.

## 5. Audio execution and Raf

Separate control work, I/O/decode jobs, and the output processing path. The audio
callback/worklet does no database work, UI callbacks, blocking I/O, unbounded
allocation, or waiting on a mutex held by control/decode jobs. Preallocate the
required buffers and bounded transport. Define underrun, suspension, and drain
behavior explicitly.

Use floating-point processing with explicit channel layout and sample rate.
Stereo is the initial output baseline; accepted multichannel sources must map
channels deliberately or fail clearly. Device sample-format/rate conversion is
an adapter boundary, with engine-owned resampling policy. Avoid public APIs
whose correctness depends on one device rate or a fixed worklet block size.

Preserve signal ownership:

```text
source -> transition envelope -> raw program tap
                             -> ReplayGain -> Raf -> analysis -> master -> output
```

Per-source ReplayGain belongs before Raf; volume/mute belongs after it. Video
keeps the existing Auto Amp bypass policy while otherwise using shared DSP.
Rendering profiles select raw or processed output explicitly; background module
inspection does not construct audio players.

Raf effects expose type/instance ID, useful parameters, enable/bypass, dry/wet,
latency/tails, preparation, processing, reset, and disposal. Rack order and
topology changes are engine-owned; prepare replacements away from the audio
thread and transition smoothly. Parameter changes are differential and smoothed
from finite anchored values. Account for latency in dry/wet and A/V timing.

The functional target is EQ/AGC/maximizer/etc. behavior, not old waveform or
browser-node emulation. Improve dusty algorithms and reconsider controls tied
to obsolete internals. Current knobs/units are an inventory of useful control,
not a serialization compatibility promise. Native/WASM share these DSP kernels;
worklets schedule/output them rather than preserving a second JS Raf engine.

## 6. SQLite ownership

The shared storage module owns schema, prepared statements, SQL, validation, and
transactions. Native storage uses SQLite over files; browser storage uses
SQLite over OPFS through a supported VFS. Browser initialization glues the real
SQLite API into the engine boundary. A separate JS catalog implemented with
`sqlite.js` is not the integration proof.

One profile storage owner serves consumer commands/queries and publishes
committed revisions. Browser auxiliary windows attach as clients, not additional
independent SQL owners. Establish lock ownership, crash/reload/reconnect, and
busy/quota/error handling before adding the full catalog. Do not assume native
WAL or multireader behavior is identical under OPFS.

FSA handles reside in the browser capability registry; SQLite stores opaque
reference IDs. Define pending/orphan registry cleanup and crash recovery because
SQLite and IndexedDB cannot share one transaction. Preserve grants through
normal development restarts. SAF grants stay with Android, not a fake registry
of browser handles.

Profiles begin when storage is implemented in Phase 3, not during workspace
setup. Use new profile names and an explicit current schema version. Unsupported schema
versions fail clearly or require an explicitly selected fresh profile; never
wipe user state on initialization failure. Implement no pre-libzci readers or
migration helpers. A disposable test profile is not the ordinary player's data.

## 7. Video and image resources

Decoded visual resources have opaque handles with timing, dimensions, color,
orientation, and ownership metadata. The core chooses retention/presentation/
release; adapters retain browser/native objects and execute those operations.
Handle pixels need not enter WASM. Explicit leases/releases, bounded queues,
surface-detach cleanup, and generation checking prevent exhausted decoder/GPU
resources or stale display after a seek.

For video with audio, map presentation timestamps to the reported audible output
clock, including DSP/output latency. For silent video use a monotonic fallback.
The engine supplies deadlines/drop decisions; the renderer executes locally and
reports presentation/loss. Do not round-trip through Svelte on every frame.

Hidden/detached video can stop presentation and suspend unnecessary video decode
while audio continues. Restore by reopening/seeking/prerolling to the current
timeline. Surface selection is exclusive: switching a shell viewport never
creates a second source/session. Image sessions retain their own captured
navigation sequence and do not control music.

Browser Media Session actions feed engine commands. A transport-anchor audio
element, if required, mirrors authoritative state and never supplies the clock.
Autoplay rejection, background suspension, decoder reclamation, and device loss
are capabilities/events to handle and test, not reasons to invent another player
inside a shell.
