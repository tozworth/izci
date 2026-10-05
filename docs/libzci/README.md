# libzci implementation plan

Build an embeddable, native izci engine and mature it through independent test
consumers. Native consumers must not require a JavaScript runtime, browser, or
webview. An offline PWA remains a first-class target through a WebAssembly build
and browser capability adapters.

The development sequence is:

```text
zci-play
    -> crude native UI + crude PWA
    -> mature, independently usable libzci
    -> replace izci-server's player/catalog/rendering engine
    -> existing Svelte shells consume libzci piecemeal
```

The crudes are where the engine grows. Reproducing useful existing izci behavior
in them exposes missing APIs, ownership mistakes, and runtime problems. Early
integration into the existing Svelte application is not a completion criterion.

## Read in this order

1. [Ownership boundaries](boundaries.md): settled scope, platform mechanisms,
   presentation state, and the clean break from pre-libzci state.
2. [Runtime contracts](contracts.md): identities, commands/events, providers,
   preparation, real-time processing, SQLite, and external frame ownership.
3. [Initial scaffolding](scaffolding.md): repository shape and the proofs needed
   before committing to the native/WASM integration strategy.

These documents describe the intended new runtime. The current application is
the behavior reference and remains operational while the new consumers develop.
Its current Howler, worklet, video-element, IndexedDB, and localStorage paths do
not become compatibility requirements for libzci.

## Fixed decisions

- Codec implementations are modular providers registered at startup. Open
  independent instances as tracks/jobs need them; consider preload and gapless.
  Runtime loading of arbitrary plugins and uninterrupted decoder replacement
  are not initial requirements.
- Opus is required from the first useful player. Use a proven reference
  implementation, not an unfinished decoder that blocks the user's library.
- SQLite owns durable domain state on native and browser targets. Browser file
  handles remain in a small platform-owned IndexedDB capability registry.
- Artwork and images are fundamental player features. Tag editing, Troubadour,
  conversion, and other workbench ownership remain undecided and much later.
- Raf keeps its effect roles and meaningful controls. Improve implementations
  freely; exact old audio output, algorithms, defaults, and serialization are
  not compatibility requirements.
- Browser video uses browser codecs and rendering surfaces coordinated by
  libzci. Do not bundle software video codecs in the PWA. Native builds may
  register an optional FFmpeg provider.
- No pre-libzci state import, migration, legacy readers, preset conversion, or
  cross-generation backup/restore path. New consumers use distinct profiles.
- Desktop/mobile/Oda shells, themes, visualizers, and backdrop presentation stay
  outside the engine.

## How to execute the plan

Use phase gates and recorded evidence, not elapsed time. Implement small
vertical slices through the public interface; avoid building a speculative API
for all future consumers. Complete each slice's core behavior, adapters, crude
controls, and appropriate verification together.

Follow [AGENTS.md](../../AGENTS.md). This planning task does not authorize builds,
fixture generation that requires additional toolchains, development servers, or
browser inspection. Obtain explicit build/runtime authorization when executing
the relevant proofs unless a user-requested debugging session already covers
them. Keep coherent implementation milestones in separate commits and preserve
unrelated changes and existing app data/grants.

The repository's current backend and storage rules continue to govern the old
runtime. The user-approved libzci architecture deliberately replaces those
boundaries for the new isolated runtime. When implementation establishes a
durable new ownership boundary, update the operating guide concisely; do not
copy this plan into it.

## Decisions to record during implementation

Rust is the starting implementation choice, with existing C/C++ media libraries
where appropriate. Record the native/WASM toolchain, SQLite/VFS integration,
worker ownership, and output-buffer transport after the scaffolding proofs.
Changing those technical choices requires evidence and an update here; it does
not permit dropping PWA support or reintroducing a JS runtime into native
consumers.

Later phases intentionally leave integration detail open. Once the engine passes
the maturity gate, write focused adoption designs for the server and existing
shells using the actual public API rather than predicting it now.
