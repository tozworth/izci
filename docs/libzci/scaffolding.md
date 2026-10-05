# Initial scaffolding and feasibility proofs

[Plan entry point](README.md) · [Ownership boundaries](boundaries.md) ·
[Runtime contracts](contracts.md)

This document gives detail for the first implementation work. Later feature
designs must grow from exercised contracts rather than empty framework code.
All builds and live browser/device checks require the authorization described in
the [entry point](README.md#how-to-execute-the-plan).

## 1. Repository shape

Start with an isolated `libzci/` workspace in this repository. Leave `src-tauri/`,
`izci-server/`, and the current frontend dependency/build graph independent.
Ordinary PWA work must continue to work without Go or native decoder toolchains.

Suggested ownership layout (create packages only as their slices need them):

```text
libzci/
  Cargo.toml                 workspace, separate from src-tauri
  crates/
    libzci/                  domain, sessions, DSP, SQL, provider contracts
    libzci-codecs/           portable compiled media implementations
    libzci-native/           native sources/devices/runtime wiring
    libzci-web/              WASM exports and browser runtime wiring
    libzci-ffi/              small C-facing binding
  consumers/
    zci-play/                native CLI
    crude-native/            native test UI, no webview
    crude-pwa/               isolated browser app/manifest/service worker
  tests/                     cross-target contract scenarios
  vendor/                    pinned source acquisition/patch manifests
```

The central crate must not import native device APIs, browser APIs, Tauri, Svelte,
or server transport code. Keep modules focused; split crates only when dependency
or build ownership benefits. Do not introduce a crate for every future feature.
The crudes may share presentation-only resources; they do not share a second
application controller outside libzci.

Choose a lightweight native widget toolkit when the native crude begins. For the
PWA crude, plain TypeScript/HTML is sufficient; Svelte is acceptable for rendering
if it does not pull in current application stores/controllers. The PWA requires
no local native service. Give it a distinct origin or scoped asset/SW/profile
namespace so it cannot replace the installed old player's service worker/data.

## 2. Native/WASM dependency proof

Start with Rust, reference Opus decoding, libopenmpt, the pinned Hively replay
source, and SQLite. Browser video codecs are imported capabilities, never part
of this compiled set. Other ordinary-audio decoders are selected by coverage and
actual test results; a "pure Rust" dependency is not itself a selection criterion.

Prove the following with tiny public-API consumers before growing the engine:

1. Native library produces audible/inspectable PCM for an Opus file and a MOD.
2. The WASM build invokes the same engine/provider contracts for those sources.
3. Native Hively replay loads and produces frames through an instance handle;
   browser replay uses the same source/profile with independent instances.
4. Engine-owned SQL commits and reopens the same small domain record natively
   and through browser OPFS.
5. Native consumption needs no JavaScript/WASM runtime or browser. Browser
   exports/glue do not pull native bridges or software video codecs into assets.

Do not select `wasm32-unknown-unknown` and assume C/C++ dependencies or ordinary
filesystem/thread APIs will link and behave automatically. Evaluate a coherent
Rust/C toolchain (including Emscripten where appropriate), host imports, memory
ownership, and any separate decoder instances. Record exact commands, pinned
versions, required exports, and artifact ownership after successful execution.

Separate WASM media modules are acceptable when required by toolchains, provided
libzci owns their instance lifetimes and normalized behavior. They are not an
excuse to retain the old JS player controller or run WASM on native as a shortcut.

### Critical Hively issue

`scripts/vendor/ahx/ahx-wrapper.c` currently holds tune, buffers, subsong, channel
mutes, and playback position in static mutable globals. Separate WASM instances
isolate these today. Direct native linking would create a singleton. Introduce
per-instance replay contexts and audit upstream initialization/shared data before
claiming concurrent preload, probing, Freeplay, or offline renders work. Preserve
the existing interpolation/channel/pattern capabilities while changing ownership.
The pinned upstream replayer also generates shared waveform/panning tables;
initialize them once with synchronization and then freeze them, or own them in
an immutable shared runtime. Test two live contexts with interleaved decoding,
seeking, subsong changes, and mutes; sequential WASM lifecycle tests do not prove
native reentrancy.

### Dependency acquisition

Record pinned upstream revisions, licenses/notices, build flags, patches, and
how to reproduce artifacts on each target. Hively already has a pinned source
recipe; libopenmpt has checked-in WASM/runtime assets and an ABI wrapper. Reuse
provenance where useful, not opaque binaries as substitutes for native source.
Optional FFmpeg remains absent from default browser builds and is not necessary
to establish basic Opus playback.
The server and browser currently contain different Hively WASM artifacts, and
the server artifact's upstream revision is unverified in the notices. Establish
new reproducible source provenance rather than asserting they already match.

## 3. Browser storage proof

Keep schema/transactions inside shared engine code. Prove that actual code against
SQLite/OPFS; a standalone JS SQLite demo proves only the VFS.

Default toward one browser storage owner and attached clients. Evaluate
`opfs-sahpool` for a single owner without isolation headers; choose another
supported VFS if the tested ownership model needs it. Do not choose by a desktop
concurrency assumption. Pin the selected SQLite/VFS implementation and establish
non-destructive initialization failure behavior.

Exercise commit, close/reopen, reload, simultaneous attached clients, owner loss,
busy/quota failures, and unsupported storage. Distinguish "unavailable persistence"
from a usable in-memory test mode; never silently claim durable success.

FSA references use a small IndexedDB capability registry. Prove handle restoration
and denied/prompt outcomes separately from SQL reopening. No fake handle
serialization and no duplicate catalog stored there.

## 4. Browser execution and output proof

WASM compilation is not browser playback evidence. Wire a real source reader,
bounded decode queues, shared DSP with at least gain/mute, and an AudioWorklet
output path. Prove transport, seek generation cancellation, EOF/drain, and output
timing with reference Opus. Probe WebCodecs audio as an optional platform provider
through the same contract, with reference Opus available when appropriate.

Choose buffer transport after measuring transferred-buffer and shared-memory
approaches. An initial path without SharedArrayBuffer may reduce hosting
constraints; require actual underrun/CPU evidence before selecting it. If shared
memory/isolation headers are required, document and test their effects on popup
opener relationships, asset loading, installed/offline launch, and service-worker
responses. Do not accidentally require those headers just by adopting a sample.

Define the context topology: control/storage owner, dedicated decoder workers,
audio worklet, rendering context, main-thread integration. WebCodecs APIs are not
universally exposed in every worker type. A shared storage host need not host
decoding or audio. Keep consumer-window attach/detach separate from playback-host
and database lifetimes; record restart/reconnect semantics.

## 5. Minimal API to exercise first

Implement just enough to create/dispose an engine/session, register/open sources,
load/play/pause/seek/stop, observe state/capabilities/errors, produce PCM, and use
the initial SQL record. Include cancellation/generation identity, explicit
resource release, and injected clock/test-source support immediately.

Expose provider ID/version, source format, sample rate/channels, queue depth,
position, underruns, and preparation failures as bounded diagnostics. These
observations help the crudes improve the engine; they are not persisted or baked
into its catalog API. Prevent paths/secrets from leaking through future remote
diagnostics.

## 6. Proof records and stop conditions

For each proof, record target, toolchain/browser/device version, profile, scenario,
observed result, limitations, and the resulting technical choice. Keep artifact
locations separate from the current app. A build failure or missing fixture is
not a passed gate.

Resolve toolchain incompatibility, singleton decoding, SQL ownership, or broken
Opus before adding library/UI breadth. Do not solve a failed proof by dropping
the PWA, requiring a JS runtime natively, bundling browser video decoders, or
reimplementing domain behavior in a crude.

## Primary technical references

- [Rust WASM target constraints](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html).
- [libopenmpt C API](https://lib.openmpt.org/doc/libopenmpt_c_overview.html).
- [Reference Ogg Opus decoding and custom I/O](https://opus-codec.org/docs/opusfile_api-0.12/index.html).
- [SQLite browser persistence/VFS options](https://sqlite.org/wasm/doc/trunk/persistence.md).
- [WebCodecs](https://www.w3.org/TR/webcodecs/).

Recheck relevant upstream documentation when executing these proofs. These links
describe mechanisms; they do not establish that izci's chosen wiring works.
