# Initial scaffolding

[Plan entry point](README.md) · [Ownership boundaries](boundaries.md) ·
[Implementation steps](phases.md) · [Runtime contracts](contracts.md)

This is the orientation for implementation. The paths under `libzci/` below
are proposed outputs. Create them in the subphase that uses them; there is no
libzci workspace to run today.

## 1. What the checkout actually contains

| Area | Present now | Work needed for libzci |
| --- | --- | --- |
| Rust | [src-tauri/Cargo.toml](../../src-tauri/Cargo.toml), a Tauri shell | Separate Cargo workspace; no Tauri/webview dependency |
| Regular audio | [howler-player.ts](../../src/lib/services/howler-player.ts), HTML5 audio; server FFmpeg | New compiled decoder providers and audio-device output |
| Opus | Fixture recipe and browser/server playback paths | Acquire/build libopus, libopusfile, libogg; no bundled reference provider exists |
| Tracker modules | libopenmpt 0.8.4 WASM/loader and [OpenMptModule](../../src/lib/services/openmpt/module.ts) | Reproducible source build, native binding, browser provider binding |
| Hively | Pinned WASM recipe, C wrapper, worklet | Native build and instance-safe wrapper; audible/concurrent fixtures |
| Database | Frontend IDB/localStorage; Go server SQLite | New shared schema/SQL and native/browser SQLite integration |
| Browser video | [video-player.ts](../../src/lib/services/video-player.ts), literal video element | Core demux/timing and WebCodecs adapter, much later |
| Browser build | Root Vite/Svelte/PWA project | Independent crude PWA configuration, assets, install identity |
| Fixtures | [fixtures/manifest.json](../../fixtures/manifest.json), generators and test helpers | Generate media with pinned tools; extend missing coverage |

Do not call this an extraction of an existing native engine. Some behavior and
C source can be reused, but the shared runtime, ordinary decoders, SQL integration,
native output, and WebCodecs video transport are new implementation work.
Use current services and tests as behavior references, without importing their
Svelte stores into the new consumers.

## 2. Workspace and module placement

Create an independent workspace at `libzci/Cargo.toml`. Do not put it under
the Tauri Cargo project or change the root frontend build to require it.

```text
libzci/
  Cargo.toml / Cargo.lock / rust-toolchain.toml
  crates/
    libzci/
      src/{lib,ids,error,source,provider,session,command,event}.rs
      src/audio/             PCM, mixing, resampling, taps, output clock
      src/storage/           SQLite statements, schema, transactions
      src/catalog/           media, roots, scans, facts, paged queries
      src/metadata/          bounded tag/lyrics readers
      src/assets/            artwork, renditions, image sessions
      src/raf/               settings, rack, shared DSP kernels
      src/video/             demux, timeline, scheduling, frame leases
    libzci-codecs/
      src/{opus,openmpt,hively,symphonia}.rs
      c/                     instance-safe C bridges
    libzci-native/
      src/{source,audio,sqlite,runtime}.rs
    libzci-web/
      src/                   Rust WASM binding and host imports
      js/                    browser mechanisms and worker/worklet glue
    libzci-ffi/
      src/                   C binding over native runtime
      include/libzci.h
  consumers/
    zci-play/                Cargo binary, no UI runtime
    crude-native/            native Rust GUI
    crude-pwa/              its own package.json, TS/Vite/PWA config
  scripts/                  acquisition/build/asset verification commands
  vendor/dependencies.json  revisions, digests, licenses, patch records
  tests/                    scenario descriptions and cross-target checks
```

Phase 0 creates only the workspace and central crate. Phase 1 adds the provider,
native, and web packages as their first functions land. Phase 2 adds the CLI;
Phase 3 adds the native GUI. Do not create empty future feature modules.

The central crate owns behavior and imports no browser, device, Tauri, Svelte,
or server APIs. Codec libraries depend on its provider contracts; adapters depend
on its access/output/SQLite contracts. Consumers assemble adapters/providers and
call its public interface. Dependency direction does not reverse to accommodate
one shell's convenience.

Defaults for later consumers are CPAL for native output and eframe/egui for the
native crude. The crude uses native rendering with ordinary buttons, lists, and
sliders, without a webview. Use plain TypeScript/HTML for the PWA crude. This
avoids pulling in existing stores and lets API deficiencies show up directly.
Pin compatible releases during the relevant implementation step; these are
starting choices, not claims that dependencies are already installed.

## 3. The initial native/browser build strategy

Use Rust for the shared engine and DSP. Start its browser build with
`wasm32-unknown-unknown` and wasm-bindgen. Build C/C++ media providers separately
with Emscripten for browser use, and link native C/C++ libraries into native
providers. Browser provider wrappers translate calls, buffer ownership, and
errors; they do not implement track sequencing or DSP in JavaScript.

This choice avoids assuming that a Rust WASM target automatically links existing
Emscripten libraries. It also lets the first browser proof use the pinned
libopenmpt loader/ABI while its reproducible source recipe is established.
Phase 1 must prove the extra buffer copies and instance lifetimes are acceptable.
If this arrangement fails the stated checks, compare a unified Emscripten build
with the same scenarios and document the selected replacement before proceeding.
Do not spend the first phase comparing every conceivable toolchain.

Native uses real libopus/libopusfile, libopenmpt, and Hively machine code.
It must not embed Node, a webview, or wazero to reuse the server's Hively path.

### Acquisition and C bridges

The new acquisition script reads `vendor/dependencies.json`, downloads exact
source archives/revisions to ignored workspace directories, checks digests, and
builds native/WASM outputs separately. Never run a recipe that overwrites the old
app's checked-in WASM. Record compiler flags, exports, licenses, and the command
that produced each artifact.

- **Opus:** acquire libopus, libopusfile, and libogg. Wrap open/read/seek/metadata/
  close with explicit instance handles and callback ownership. Normalize output
  to float PCM with its audible sample timeline. Declare trimming/header-gain
  already performed by opusfile. Explicitly use header gain with zero additional
  offset; core later decides ReplayGain/R128 tag policy. See the
  [opusfile gain modes](https://opus-codec.org/docs/opusfile_api-0.12/group__stream__decoding.html).
- **libopenmpt:** start at source version 0.8.4, matching the current
  [artifact provenance](../../src/lib/vendor/libopenmpt/README.md). Translate
  [OpenMptCore](../../src/lib/services/openmpt/abi.ts) and
  [OpenMptModule](../../src/lib/services/openmpt/module.ts) operations into the
  provider. The native system loader in
  [openmpt.go](../../izci-server/internal/media/openmpt.go) is API evidence, not a
  bundled source recipe.
- **Hively:** acquire the commit pinned in
  [build.ps1](../../scripts/vendor/ahx/build.ps1). Put a new context wrapper in
  `libzci-codecs/c/`; leave the old wrapper/artifacts intact. Move tune, source
  buffer, decode buffer, subsong, mutes, interpolation, position, and duration
  state out of static globals. Initialize upstream waveform/pan/interpolation
  tables once safely and keep them immutable. Return a pointer-sized native
  handle; do not copy the current wasm32 pointer-to-uint32 assumptions.
  The old wrapper computes duration during load and replays from the beginning
  in a synchronous seek loop. Introduce bounded probe/seek stepping so control
  messages can cancel work between batches; duration discovery must not delay
  the whole engine or audio callback.

The current Hively recipe is a PowerShell WASM build; portable native and browser
commands must be added. Browser/server Hively binaries differ and the server's
source revision is unverified. Neither binary substitutes for new provenance.

### Bounded source access and synchronous C callbacks

The source contract supports requests for a byte range, cancellation, source
revision, and typed access errors. An opened source is a runtime handle; it is
not yet a Library record or durable profile entry.

libopusfile expects synchronous read/seek callbacks. For native decode jobs,
serve them from a seekable native file. For the first browser proof, materialize
a browser File snapshot, send that File to a dedicated decode worker, and test
bounded Blob-slice reads with FileReaderSync in that worker. Do not read the
entire Opus file, block the window thread, or send whole files through JSON.
The File snapshot is separate from the durable FSA handle and its grant.

The browser proof must verify callback reentry, errors, seek, cancellation between
bounded decode calls, and reads on a large file. If this bridge fails, use the
core's Ogg reader with packet-level libopus rather than pretending asynchronous
callbacks are synchronous. Keep that fallback confined to the Opus provider
implementation; ordinary source APIs must remain usable by future SAF/ranged
providers. Modules may request a complete buffer under an explicit size limit.

## 4. First engine and browser execution layout

Implement the first control API before adding persistence:

```text
create runtime -> register provider -> register runtime source -> create session
    -> load source -> decode/play -> pause/seek/stop -> dispose
```

A session has its own generation counter, transport state, decoder, and bounded
PCM buffers. A generation identifies the currently valid load/seek: a later seek
increments it, and output from an older generation is discarded. This is how
rapid seeks avoid playing stale samples. Introduce IDs/types for objects that
actually exist in this slice; Library memberships and queue occurrence IDs come
when those modules are implemented.

Use this starting browser topology:

| Context | Initial job |
| --- | --- |
| Main document | File picker/activation, AudioContext, Media Session, controls |
| Engine worker | Shared Rust control code, snapshots, later SQLite and mutations |
| Dedicated decode worker(s) | Source reads, C provider modules, bounded PCM production |
| AudioWorklet | Bounded output and the shared Rust audio/DSP module |
| Service worker, Phase 3 | Offline assets/update lifecycle; no engine/audio/database authority |

The browser adapter carries requests/results between these contexts. Rust owns
the generation, transport state, and playback policy. The worklet receives a
small audio-only WASM build without SQL/catalog/codec dependencies. Use the same
Rust gain/mute and later Raf kernels as native; JS worklet code schedules buffer
delivery and calls processing exports.

Start PCM transport with a preallocated pool of transferable buffers and explicit
credit/recycle messages. Bound frames in flight, report underruns, and tag them
with the generation. Measure foreground/background results before deciding a
SharedArrayBuffer path is necessary. If isolation headers are introduced, verify
installed/offline responses and attached-window relationships explicitly.

The output adapter reports consumed frames and its best available audible
clock/latency estimate. The core computes media position from that clock plus
the loaded timeline. Wall-clock/UI timers never claim progress while output is
suspended. Diagnostics expose both requested play state and actual output state.

## 5. SQLite integration when storage begins

Storage first appears in Phase 3, after file playback works. Before then the CLI
has no profile and the engine uses only transient state.

Put schema, SQL strings, validation, and transactions in
`crates/libzci/src/storage/`. Start native bindings with rusqlite and a pinned
bundled SQLite build; the browser uses the official
SQLite WASM build with an OPFS VFS in the engine owner worker. Start with
`opfs-sahpool` and one owner; independent concurrent SQL connections are unnecessary.

Keep native SQLite/device/C-linking dependencies target-specific. The core's
audio-only WASM build excludes catalog/SQL/provider code; its control build uses
the browser SQLite host bridge. A compile-time dependency check should make
these boundaries visible rather than relying on dead-code elimination.

Use a narrow SQLite binding interface: prepare/execute, bind typed values, read
rows, finalize, and report SQLite errors. Native and browser adapters execute the
same statements. This is SQLite plumbing, not an intermediate storage dialect or
a JS Library implementation. In the browser, initialize SQLite and Rust WASM in
the same worker so synchronous SQLite host calls do not require a cross-worker
round trip. Long scans perform short transactions between asynchronous reads.

First prove one settings row committed by Rust and reopened through both adapters.
Then add the domain schema. Select a SQLite/VFS version or audited patch that
preserves stored files on initialization failure; the SAH-pool default must not
wipe data while handling an error.

Profile names reserved in Phase 0 become actual storage here:

- Native default crude profile: `.local/libzci/profiles/crude-native/`.
  `zci-play` stays transient unless given an explicit `--profile`.
- Browser: independent origin at a dedicated port, manifest ID, OPFS directory
  `/libzci-crude-v1/`, and IndexedDB registry `libzci-crude-capabilities-v1`.
- Tests: uniquely named temporary directories/OPFS namespaces with explicit
  disposal. Do not remove ordinary profiles on startup, failure, or rebuild.

An owner lock precedes opening the pool/database. Auxiliary windows attach as
clients; they cannot acquire a second database/player. Phase 3 spells out attach,
owner loss, and re-election. FSA capabilities live in IndexedDB with pending/
committed references because SQL and IDB cannot transact together.

## 6. Fixtures available to start

The checked-in corpus is a manifest and generator, not checked-in media.
Generation writes `.local/verification-fixtures/v1/` and requires the exact
FFmpeg/FFprobe pin in [fixtures/README.md](../../fixtures/README.md).

First decoder inputs are `audio-opus` (`media/audio/tone.opus`) and
`module-mod` (`media/modules/tone.mod`). They are only 0.25 seconds and 7.68
seconds respectively; add longer synthetic Opus for audible/seek/background
checks. Keep private-library listening separate from redistributable fixtures.

Two existing helpers can seed tests without claiming complete format coverage:

- [toneModule()](../../src/lib/services/openmpt/test-fixtures.ts) constructs MOD
  data and an optional two-subsong example.
- [ahx-worklet.test.ts](../../src/lib/services/ahx-worklet.test.ts) constructs blank
  AHX/HVL tunes for real-WASM load/EOF/restart/seek. These silent lifecycle inputs
  do not prove instrument audio, interpolation, channel muting, or reentrancy.

The corpus still lacks audible/pinned XM, S3M, IT, MO3, AHX, and HVL samples.
Acquisition or a deterministic generator is explicit work in Phase 2.

## 7. Technical references

These support the proposed mechanisms, not a claim that the new wiring works:

- [Rust WASM constraints](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)
  and [C interoperability](https://doc.rust-lang.org/stable/embedded-book/interoperability/rust-with-c.html).
- [opusfile callbacks](https://opus-codec.org/docs/opusfile_api-0.12/group__stream__open__close.html)
  and [libopenmpt C API](https://lib.openmpt.org/doc/libopenmpt_c_overview.html).
- [File API and synchronous worker reads](https://www.w3.org/TR/FileAPI/).
- [SQLite persistence/VFS](https://sqlite.org/wasm/doc/trunk/persistence.md).
- [rusqlite native bindings and bundled SQLite](https://github.com/rusqlite/rusqlite)
  and [wasm-bindgen](https://rustwasm.github.io/docs/wasm-bindgen/introduction.html).
- [CPAL](https://github.com/RustAudio/cpal),
  [eframe](https://github.com/emilk/egui/tree/main/crates/eframe),
  [Symphonia](https://github.com/pdeljanov/Symphonia).

Recheck exact upstream versions/target support when pinning dependencies. Use
[phases.md](phases.md) for the ordered code changes and completion checks.
