# Implementation design

[Overview](README.md) · [Roadmap](phases.md) · [Boundaries](boundaries.md) ·
[Contracts](contracts.md) · [Review](review.md)

This specifies how the first working player is assembled. Names below describe
replacement interfaces, not APIs already implemented. Add them when their
milestone needs them; later APIs grow from working consumers.

## 1. Starting code and package direction

The branch has a Cargo workspace, core types/session code, native
Opus/OpenMPT/Hively providers, CPAL output, a CLI, and browser workers. It lacks
audible browser output, reference browser codec builds, SQL, and a native GUI.
The old log records native tests/listening; this review has not reproduced them.

| Package | Implement here |
| --- | --- |
| `libzci` | Session machine, job descriptions/results, provider contracts, shared audio renderer, later domain/SQL/DSP/video policy |
| `libzci-codecs` | Native C bindings/providers and reproducible C wrappers, with optional format features |
| `libzci-native` | File access, job execution, queue endpoints, CPAL adapter, later SQL bindings/profile lock |
| `libzci-web` | Core command/result bindings, browser mechanism wiring, worker/worklet entry points |
| `consumers/zci-play` | Arguments, runtime assembly, commands, incremental render bytes, terminal outcome |
| `consumers/crude-native` | eframe/egui controls and observations over the same API; create in M1 |
| `consumers/crude-pwa` | Plain HTML/TS controls and actual browser runtime; grow the existing consumer |
| `libzci-ffi` | Opaque C handles over the mature runtime; create in M6 |

Core imports no CPAL, eframe, browser, Tauri, Svelte, or Go APIs. Bindings implement
mechanisms core requests. Providers implement media operations. Consumers select
configuration, not decoding/transport policy. Audio-only WASM excludes
control/catalog/SQL dependencies.

## 2. Public operations and one session owner

The first consumer must be expressible with these operations:

```text
runtime.register_source(access_reference) -> source_handle
runtime.create_session() -> session
session.submit(Load { source, options: { subsong?, start_time? } }) -> receipt
session.submit(Play | Pause | Stop | Seek(time) | SetVolume | SetMute)
session.snapshot() / subscribe() -> state, position, capabilities, outcomes
runtime.start_render(source, options, processing) -> incremental render_job
runtime.dispose_session(session)
```

Use time with explicit units publicly. Decoder frame positions carry their
rate/layout. Conversion belongs to core; the CLI cannot assume every source is
48 kHz. Load options and module controls are provider-neutral and capability
checked. Consumers never construct decoders or switch media families for subsongs.

One serialized control owner per session accepts commands, job completions,
output acknowledgments, and lifecycle events. Its state machine emits actions:
open/cancel/seek/decode/close a provider, change output generation, publish an
observation. A small `handle(input) -> actions` design suffices; no general actor
framework is needed. Native and browser drive this same machine.

The control owner never waits for file reads, codec work, output space, or a
device. Native jobs run on workers; browser jobs on dedicated workers. One job
owner drives each decoder sequentially. Results carry session, instance,
generation, operation identity, and outcome. A session-map lock covers lookup,
not open/decode/seek/probe/render work.

## 3. Provider work and cancellation

An opened provider reports layout/rate, capabilities, metadata, and the
trims/mandatory gains already applied. Decode distinguishes these outcomes:

```text
Data { buffer, frames, source_start, layout, generation }
Pending { wakeup/job identity }
EndOfStream
Failed { typed error }
```

An empty asynchronous feed is Pending, never EOF. Decoder EOF starts draining;
Ended follows consumption of the final current-generation audio through the
output timing boundary.

Native reads use bounded seekable files. The initial browser C source provider
runs in a worker with FileReaderSync over bounded Blob slices. Modules may read
a complete buffer under a declared byte limit. General source access remains an
asynchronous capability boundary for SAF/ranged providers. Open source handles
are transient, not catalog rows.

Load/seek/stop/dispose invalidate the old generation at command acceptance. Set
the old job's cancellation token without waiting for its owner lock. Jobs check
between bounded units. Browser scans/probes explicitly yield to the event loop
between batches so posted cancellation can be received. Flag checks inside one
long synchronous loop do not make it interruptible. Non-preemptible codec calls
finish off the control/output thread and their late results are released.
Measure cancellation latency with actual providers.

## 4. PCM transport, processing, and output

R1 implements a bounded producer/consumer path with a fixed block pool:

```text
decode job -> pending decoded block -> channel mapping/resampling
           -> bounded prepared-PCM blocks -> shared audio renderer -> device
```

Without downstream credit/capacity, retain the unwritten suffix and stop
requesting decode. Resume when capacity is recycled. Pending and converter-tail
data count toward the same budget. Only cancellation/stale-generation decisions
discard media. EOF passes through pending PCM, converter flush, output, and final
consumption acknowledgment. A slow sink must produce the exact unrestricted
signal with bounded retained memory.

Use [rtrb 0.4.0](https://docs.rs/rtrb/0.4.0/rtrb/) in the native adapter, pinned
in R1, with distinct producer/consumer endpoints. Pass fixed-pool block indices
and descriptors through ready/recycle queues; avoid allocation/deallocation in
the callback. Replace the old mutable Vec ring. Browser starts
with a preallocated transferable-buffer pool and credit/recycle messages. Both
implement the same block/generation contract without conflating native pointers
and browser objects.

The shared renderer runs at the native callback or AudioWorklet boundary. It
consumes prepared PCM and performs bounded shared gain/mute processing; later it
owns mixing, envelopes, ReplayGain, and Raf. Codec/resampling operations requiring
allocation stay in preparation jobs; account for converter delay/tails.
Preallocate renderer memory/control updates. No SQL, blocking I/O, dynamic
allocation, waiting on control locks, or UI callbacks occurs there.

Control never queues behind PCM capacity: native uses a separate latest-request
generation/hold state and an acknowledgment from the consumer; browser uses
control messages outside the credit-limited PCM stream. The non-realtime worker
may wait/back off for recycled capacity, checking cancellation; the callback
never waits. Keep retained blocks owned by the fixed pool until recycled.

Seek sends an output generation change. The consumer discards old blocks and
acknowledges it; the producer never rewrites a live read cursor. Every block is
checked at consumption. Seek completion distinguishes decoder landing from
output readiness. Already submitted OS audio cannot be recalled: measure/report
that latency limit. Pause holds position/consumption. Stop invalidates queued
media and resets to the start. Dispose releases jobs/output.

Master changes apply at the renderer instead of waiting behind seconds of
preprocessed audio. Later mount taps on request and implement the signal graph
in [contracts](contracts.md#5-audio-execution-and-raf): transition/raw-program,
ReplayGain, Raf, analysis, then master/output. Per-source gain and preparation
remain explicit during overlaps. Analysis is before master; video bypasses Auto
Amp. Renders select raw or processed output explicitly so listener DSP is not
applied twice.

## 5. Position, state, and errors

Track decode progress, queued media ranges, device callback progress, and audible
media position separately. Output blocks map output frames to source frames/time
and generation. Only valid media consumption advances that mapping; underrun
silence advances device diagnostics. Position never equals decoder read-ahead
or an unqualified total callback count.

Output reports consumption spans, rate, available clock/latency facts,
suspended/resumed/failed state, and acknowledged generation. Core combines
these with converter/DSP latency and seek origin. Suspension freezes the last
audible position; resume keeps a continuous mapping. Unknown device latency is
an estimate/capability, not invented hardware precision.

Requested Play/Pause/Stop, actual running output, decoder EOF, and drained Ended
are distinct observations. Device failure enters Failed or explicit recoverable
suspension and resolves outstanding operations; stderr alone is insufficient.
Keep terminal results when coalescing telemetry. Dispose cancels jobs/output
and joins outside control ownership. Threads must not retain a runtime forever.

## 6. Reference codecs and browser assembly

Recover native Opus with the pinned libopusfile C API directly. It provides
file read/seek, trim, and chained-stream semantics. Handwritten bindings to the
small used C surface are acceptable. Existing raw-libopus/Ogg tests provide
comparison inputs, not justification for two native/browser timeline policies.
Set header gain with zero additional offset; ReplayGain/R128 policy is core-owned.
See the [opusfile decode API](https://opus-codec.org/docs/opusfile_api-0.12/group__stream__decoding.html).

Start browser with Rust control/audio WASM and separate Emscripten C codecs;
native links those C sources directly. Decode workers hold File snapshots,
C handles, and bounded buffers. The engine worker drives the common machine.
Main document owns gestures, AudioContext/Media Session, and controls. Worklet
runs audio-only shared Rust processing. Prove reference Opus output before
optional WebCodecs audio.

R4 proves C callbacks/reads with the existing Opus fixture and a long source.
On an observed mechanism failure, record the failing input/behavior and stop
that dependency. The scoped alternative is one shared Ogg/timeline implementation
and packet-level reference libopus on both targets. Missing tools or an
inconvenient binding crate are prerequisites, not evidence the callback bridge
failed. A unified Emscripten build is another scoped linking alternative; avoid
an open-ended toolchain comparison.

Later WebCodecs video uses opaque frame handles: core owns transport, timestamps,
retention/drop decisions, and deadlines; adapters retain/present frames. Pixels
need not enter WASM. Native FFmpeg is excluded from browser dependencies/assets.

## 7. Storage when M2 begins

After R1-R4 and M1, add shared schema/SQL/transactions, native rusqlite, and
official SQLite WASM in the engine-owner worker. Start OPFS with `opfs-sahpool`;
verify the selected release's initialization/error policy and ownership using
the [SQLite persistence documentation](https://sqlite.org/wasm/doc/trunk/persistence.md).
Core uses a narrow statement/bind/row/transaction bridge in that same worker.
Adapters do not duplicate queries. Keep SQL out of audio-only WASM.

Acquire a profile owner lock before storage. Auxiliary clients attach through
messages and reconnect from a full revisioned snapshot. Native processes use
separate profiles or explicit ownership. Owner loss may interrupt audio;
re-election restores paused durable state. A service worker is not the player.

First add source-reference, session, settings, and queue-occurrence tables;
catalog/media/root/fact tables follow in M3. Real FSA handles live in separate
IDB: pending insertion, SQL reference commit, completion, orphan recovery.
Plain File input is non-restorable. Restore queries never prompt; explicit
commands obtain grants.

Independent names: native `.local/libzci/profiles/crude-native/`, browser OPFS
`/libzci-crude-v1/`, IDB `libzci-crude-capabilities-v1`, origin/port 5197, and
unique test namespaces. CLI stays transient unless given `--profile`. Schema
mismatch and initialization/quota failures preserve state and fail clearly.

## 8. Tools, inputs, and defaults

Existing acquisition/static linkage are GNU/Linux recipes. Record actual Rust
release and C/Emscripten versions before reproduction; moving `stable` is not
a toolchain pin. R3 explicitly addresses Windows toolchain/linkage. A Linux
build does not establish Windows support. Defaults remain CPAL, eframe/egui,
Symphonia with required ordinary-audio features, and plain HTML/TS PWA controls.
These implementation choices can be replaced with a documented reason.

Use the corpus contract and ignored generated `.local/` outputs. Long signals
need markers revealing drops/duplicates, not only a steady tone. Silent Hively
inputs prove lifecycle, not channel/interpolation sound. Keep generated media,
provider binaries, profiles, and outputs ignored. Preserve old frontend/server
WASM and the ordinary player state/grants.
