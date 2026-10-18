# libzci workspace

Independent Rust workspace for the reusable izci engine. It is separate from
`src-tauri/`; the root frontend/PWA build does not depend on it.

Start with the [current plan](../docs/libzci/README.md),
[implementation design](../docs/libzci/scaffolding.md), and
[source review](../docs/libzci/review.md). The attempt at `168874dd` needs output
and transport recovery before feature work. The old Phase 2.2 log is historical.

## Present code

- `crates/libzci`: types, sources/providers, synchronous session implementation,
  audio transport/clock/processing/resampling and format/Ogg helpers.
- `crates/libzci-native`: native files/runtime, CPAL device output and pipeline.
- `crates/libzci-codecs`: raw-libopus/Ogg, libopenmpt 0.8.4 and instance-safe
  Hively wrappers, C bridges, native build linkage.
- `crates/libzci-web`: browser engine/host decoder, Ogg helpers and WASM bindings.
- `consumers/zci-play`: audible CLI and device-free render path needing recovery.
- `consumers/crude-pwa`: silent decode proof page on port 5197 with independent
  Vite config and engine/decode workers; currently uses WebCodecs audio.
- `scripts/`, `vendor/dependencies.json`: GNU/Linux acquisition/build recipes
  and dependency/provenance records. Browser C codec and Windows recipes remain
  work; inspect the plan before treating existing commands as target coverage.

No SQL/profile, installed PWA, native GUI, or FFI implementation exists here yet.
The roadmap adds the GUI in M1, storage/install support in M2, and FFI in M6.
Native and browser share core behavior/SQL/DSP; consumers render/dispatch and
adapters implement mechanisms.

## Outputs and state

`target/` is ignored. Acquisition scratch/builds/generated media stay in root
`.local/libzci/`. The crude PWA has its own generated WASM and build directories;
it does not share the root application's outputs or service worker.

M2 will create native `.local/libzci/profiles/crude-native/`, browser OPFS
`/libzci-crude-v1/`, and real FSA registry `libzci-crude-capabilities-v1` on the
independent origin. CLI stays transient unless given `--profile`. Tests use
unique disposable namespaces. Preserve the ordinary player's data/grants.

Follow [AGENTS.md](../AGENTS.md) for explicit build/runtime authorization. Pin
real Rust/C/Emscripten toolchains when reproducing recovery; the current lockfile
is not evidence that every target recipe or runtime path works.
