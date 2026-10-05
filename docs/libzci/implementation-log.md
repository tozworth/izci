# libzci implementation log

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

Next work item: Phase 1.2 — reference Opus acquisition and native
provider (`libzci-codecs`, `opus.rs`, scripts under `libzci/scripts/`).

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
