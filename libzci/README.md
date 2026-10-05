# libzci workspace

Independent Rust workspace for the reusable izci engine. It is separate
from `src-tauri/`; there is no root Cargo workspace, and no root
`package.json` script, Vite input, PWA scope, or current WASM asset
depends on it.

## Current members

- `crates/libzci`: the central engine crate (Phase 1.1: runtime
  sources, provider/session lifecycle, PCM transport).
- `crates/libzci-native`: native file sources and session-serialized
  runtime assembly (Phase 1.1); CPAL device output and the
  decode/process/resample/feed pipeline (Phase 2.1).
- `crates/libzci-codecs`: reference Opus provider over statically
  linked libopus 1.5.2 plus the shared Ogg packet reader (Phase 1.2);
  libopenmpt 0.8.4 and instance-safe Hively providers (Phase 1.4).
- `crates/libzci-web`: browser adapter core — WASM engine facade
  (`engine.rs`: selection, sessions, generations over a feed-driven
  host decoder), shared Ogg demux (`demux.rs`), and wasm-bindgen
  bindings (Phase 1.3).
- `consumers/crude-pwa/`: independent proof page on port 5197 with
  its own Vite config, engine worker, and decode worker (Phase 1.3).

## Planned additions (created by their phases, not scaffolded empty)

- `crates/libzci-codecs`: Opus, libopenmpt, Hively, Symphonia providers
  plus instance-safe C bridges in `c/` (Phases 1–2).
- `crates/libzci-native`: file sources, CPAL output, SQLite binding,
  minimal runtime assembly (Phases 1–3).
- `crates/libzci-web`: Rust WASM control binding, host imports, and
  `js/` worker/worklet glue (Phases 1–3).
- `crates/libzci-ffi`: opaque-handle C boundary over the native runtime
  (Phase 7).
- `consumers/crude-native`: eframe/egui native crude, no webview
  (Phase 3).
- `consumers/crude-pwa/`: independent package.json/TS/Vite/PWA config
  on its own origin/port (Phases 1–3).
- `scripts/`: acquisition/build/asset-verification commands (from 1.2).
- `vendor/dependencies.json`: pinned revisions, digests, licenses.
- `tests/`: cross-target scenario descriptions and checks.

Dependency direction stays one-way: providers depend on the core's
provider contracts, adapters depend on its access/output/SQLite
contracts, consumers assemble them and call the public interface.
It never reverses for one shell's convenience.

## Generated outputs and reserved names

- `libzci/target/`: Cargo build outputs (ignored).
- `.local/libzci/`: ignored acquisition scratch, native builds, and
  generated media (already covered by the root `.local/` ignore).
- The crude PWA keeps its own build directory under
  `libzci/consumers/crude-pwa/`; it never shares the root `dist/`.
- Reserved, not created in Phase 0 (first real storage is Phase 3.2):
  native crude profile `.local/libzci/profiles/crude-native/`;
  browser OPFS directory `/libzci-crude-v1/` with IndexedDB registry
  `libzci-crude-capabilities-v1` on the crude's dedicated origin;
  uniquely named temporary directories/namespaces with explicit
  disposal for tests. No database, profile, service worker, or
  runtime state is introduced here.

## Toolchain

The Rust toolchain pin lands with the first resolved dependency set
in Phase 1, and the workspace lockfile is committed with those
resolutions. Phase 0 intentionally adds no `rust-toolchain.toml` and
no dependencies.
