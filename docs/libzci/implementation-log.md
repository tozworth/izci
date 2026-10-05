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


### 1.2 Acquire reference Opus and implement the native provider — implemented, verification pending

Pins resolved (see `libzci/vendor/dependencies.json`):

- `libogg` 1.3.5 (`sha256:0eb4b4b…799b664`), `libopus` 1.5.2
  (`sha256:65c1d2f7…f9a7ce1`), `libopusfile` 0.12
  (`sha256:118d8601…ae3550b6`) — all BSD-3-Clause (Xiph.Org); notice
  entry added to `docs/THIRD-PARTY-NOTICES.md` reusing L042 (COPYING.Xiph).
- Toolchain: local `rustc 1.99.0 (b940084d7 2026-09-28)` via
  `stable-x86_64-unknown-linux-gnu`, recorded in
  `dependencies.json#toolchain` with the workspace `Cargo.lock`
  committed. No `rust-toolchain.toml`: the reported version has no
  matching versioned rustup channel here, so a channel file would break
  builds; re-evaluate when a real channel exists.

Created:

- `libzci/scripts/acquire-media-deps.sh`: reads the pins, downloads to
  ignored `.local/libzci/vendor/<id>/<release>/`, verifies digests,
  builds native static libs (`--disable-shared`, `-O2 -fPIC`;
  opusfile additionally `--disable-http` against the just-built
  ogg/opus prefixes), writes per-library `BUILD-RECORD.txt`. Touches
  nothing under `public/vendor/`, `src/lib/vendor/`, or `izci-server/`.
  Emscripten `build-wasm/` is explicitly pending (no `emcc` here).
- `libzci/crates/libzci-codecs/` (`opus_ffi.rs`, `opus.rs`,
  `build.rs` linking the prebuilt `libopus.a`): the reference Opus
  provider. Native decode path is the scoped packet-level fallback
  from scaffolding §3 — shared Ogg reader (page/lacing/continued
  packets, CRC, granule index) plus reference libopus 1.5.2 packets —
  chosen over the `opusfile-sys` 0.2 stack (stale `opus-sys` 0.2 era
  bindings) so native and browser share one provider with identical
  timeline/gain semantics. opusfile semantics are mirrored exactly
  once: OpusHead output gain applied, zero additional offset,
  pre-skip/end-trim on the normalized timeline (`AppliedAdjustments`
  all true); ReplayGain/R128 tags parsed for diagnostics, never
  applied. Mono/stereo mapping family 0 only; family 1+, >stereo,
  and chained Ogg fail explicitly as named gaps.
- `libzci/tests/synth-opus-30s.sh`: checked-in recipe for the longer
  synthetic Opus (30 s stereo L440/R660, CC0-1.0) in ignored
  `.local/libzci/media/` with a `.provenance.txt` record.
- `libzci/Cargo.toml`: added `crates/libzci-codecs`. `ogg = "0.9"`
  (pure-Rust demux) locked in the committed `Cargo.lock`.

Evidence (all native, profile `none`):

- Acquisition: `libzci/scripts/acquire-media-deps.sh` → `libogg.a`,
  `libopus.a`, `libopusfile.a` (+`libopusurl.a`) under
  `.local/libzci/vendor/*/build-native/lib/` with BUILD-RECORDs.
- Corpus: `node fixtures/generate.mjs` → 21 fixtures;
  `tone.opus`/`tone.mod` digests match the manifest.
- `cargo test -p libzci-codecs` → 8 passed: linked version asserts
  `libopus 1.5.2`; `tone.opus` opens with finite total 12000 frames
  (0.25 s @48 kHz), decodes to exactly 12000 finite samples with
  nonzero content; seek lands mid-stream with exact tail length;
  reopen reproduces the total; truncated input reports
  Corrupt/Unsupported (never success); two handles interleave and one
  survives the other's dispose; single reads stay ≤ 64.5 KiB;
  oversized sources refused observably. The 30 s stereo synth
  (1,440,000 frames, 33 pages, continued packets) decodes exactly and
  seeks mid-stream, near-EOF (end-trim exact), and back to zero.
- Two real bugs found and fixed by these tests (header-skip dropping
  audio packets when headers occupy own pages; seek preroll ignoring
  end-trim); see the provider module docs.
- Disposing one native handle leaves the other usable (covered).
- Pending: browser worker proof (1.3), module/Hively providers (1.4),
  audible output (Phase 2). No database, profile, or JS/WASM runtime
  involved natively.

Next work item: Phase 1.4 — instance-safe libopenmpt and Hively
providers (`openmpt.rs`, `hively.rs`, the new C context wrapper in
`libzci-codecs/c/`, reproducible source recipes).

### 1.3 Implement the same Opus operation in the browser worker — implemented, verification pending

Groundwork (shared with native, no duplication):

- `libzci/src/ogg_reader.rs`: page entries, CRC, continued-packet
  splits, bounded `PageScanner`, and `validate_ogg_index` (BOS/serial/
  sequence/chained rules) — one implementation for `libzci-codecs`
  and the browser (native provider refactored onto it; all tests stay
  green).
- `libzci/src/format.rs`: centralized Opus identification
  (`sniff_opus_head_page`, `parse_opus_head_packet` with the
  mono/stereo family-0 policy, `parse_opus_tags_packet`,
  `OPUS_EXTENSIONS` hints). Both factories probe through it.

Created:

- `libzci/crates/libzci-web/` (`engine.rs`, `demux.rs`,
  `bindings.rs`): the engine owns provider selection (real sniff via
  the same registry/probe types), per-session core `Session`
  transport, and generation fencing over a feed-driven
  `HostDecoder`. The decode worker owns File bytes and platform
  decode; PCM crosses tagged with generations and stale results are
  refused (never queued). Seek plans (`plan_opus_seek`, mirroring the
  native seek math) are pure engine decisions; the worker executes
  `{start_page, skip_packets, skip_samples}` with no granule math of
  its own. Commit cross-checks the worker's header parse against
  core's (mismatch is `DecoderFailure`). Granule-absent serializes as
  `-1` across JSON (raw `u64::MAX` would lose precision); WASM `u64`
  ids cross as BigInt with range-checked conversion at the boundary.
- `libzci/consumers/crude-pwa/` (own `package.json` + lockfile,
  Vite config on port 5197, `index.html`, `src/main.ts`,
  `src/protocol.ts`, `src/generation.ts`, `src/opus-packet.ts`,
  engine/decode workers, vitest suites, `scripts/build-wasm.sh`,
  README): file-open, decode, seek, cancel/dispose, and diagnostics
  through `BrowserHost`-equivalent worker messages — no demo
  decoder, no SQL, no transport policy in `main.ts`. Decode proves
  via PCM stats (frames/peak/RMS/read bounds), not audio output
  (output arrives in 2.4). Opus TOC durations verified against the
  reference `opus_packet_get_samples_per_frame` source.
- `libzci/Cargo.toml`: added `crates/libzci-web` (`wasm-bindgen`
  0.2.129, `js-sys`, `serde`/`serde_json` locked). `.gitignore`:
  `libzci/consumers/crude-pwa/src/generated/`.

Evidence (profile `none` throughout):

- `cargo test -p libzci-web` → 8 passed: stale ingest refused after
  seek, noncontiguous ingest is `DecoderFailure`, stale EOF ignored,
  dispose drops the session, seek plans match native math on
  `tone.opus` pages (312 preskip, 12000 total, EOF plan), commit
  round-trip with header-mismatch refusal, demux header/split.
- `cargo check -p libzci-web --target wasm32-unknown-unknown` → clean
  (0 errors); release WASM built (`libzci_web_bg.wasm` 257 KiB) with
  the pinned `wasm-bindgen-cli` 0.2.129 via `scripts/build-wasm.sh`.
- Crude PWA: `npm test` → 8 passed (generation fencing, TOC/head
  math); `npm run typecheck` → clean; `npm run build` → production
  bundle in its own `dist/` (engine/decode workers + WASM asset).
- Pending (explicit): real-browser File decode/seek vs native
  timing/channel metadata, bounded reads on the 30 s synth in a
  worker, worker error/cancel/reopen, and the Opus `AudioDecoder`
  description shape — all require browser-inspection authorization
  per the repo operating guide, so no browser was launched. The page
  remains an ordinary proof page (no manifest/SW/install until 3.4).

### 1.4 Add instance-safe libopenmpt and Hively providers — implemented, verification pending

Pins (`libzci/vendor/dependencies.json`, archives verified):

- `libopenmpt` 0.8.4 (`sha256:97530b25…afa76f`), BSD-3-Clause.
- `hivelytracker-replay` `f393ca7…` (`sha256:523de29e…5ad01d5`),
  BSD-3-Clause. Both revisions already had notice entries; no new
  third-party text was needed.

Created:

- `libzci/scripts/acquire-module-deps.sh`: downloads/verifies both
  archives to ignored `.local/libzci/vendor/`, builds native
  `libopenmpt.a` (upstream GNU Makefile, static only, bundled
  miniz/minimp3/stb_vorbis, no mpg123 — the same feature set the
  checked-in browser WASM reports) and `libhivelycontext.a`
  (upstream `hvl2wav/replay.c` unmodified plus the new wrapper;
  rebuilds when the wrapper changes). Touches nothing under
  `public/vendor/`, `src/lib/vendor/`, or `izci-server/`.
  Emscripten `build-wasm/` pending (no `emcc`).
- `libzci-codecs/c/hively_context.{c,h}`: per-instance source/tune/
  probe-tune/buffer/position/duration/subsong/mutes/interpolation,
  pointer-sized native handles, sub-frame spill, order/row and
  subsong/mute getters for isolation tests. Duration/seek are bounded
  steps (`probe_step`/`seek_step`) with cancellation between batches
  on decode jobs — never one uncancellable call, never on audio
  callbacks. `lz_hively_init_tables` fills upstream waveform/pan plus
  interpolation tables; the Rust owner calls it under `Once`, after
  which tables are immutable.
- `libzci-codecs` (`openmpt_ffi.rs`/`openmpt.rs`,
  `hively_ffi.rs`/`hively.rs`, `test_helpers.rs`, extended
  `build.rs` linking `openmpt`/`hivelycontext`/`stdc++`): MOD/XM/
  S3M/IT/MO3 sniff→open through libopenmpt (repeat 0 for finite EOF,
  stereo 48 kHz, subsong clamp+rewind, interpolation control,
  interactive mutes reapplied after seeks, inspection without
  output); AHX/HVL through the new wrapper (bounded cancellable
  duration probe, sample-exact seeks, per-instance mutes).
  `format.rs` centralizes MOD/XM/S3M/IT/MO3/AHX/HVL magics and
  extension lists for both targets.
- `libzci-web`: `BrowserModuleFactory`/`BrowserHivelyFactory` probe
  with the same sniff; opens report explicit `Unsupported`
  (pending Emscripten modules) instead of a demo decoder.

Upstream audit (Hively): playback (`hvl_play_irq`,
`hvl_DecodeFrame`, `hvl_mixchunk`) writes no global state — all
replay state is per-`hvl_tune`. Only `waves`/`waves2`/`panning_*`
(plus the wrapper's interpolation tables) are shared, written solely
by the once-synchronized init. Two live native contexts were
exercised with interleaved seeks/mutes/dispose (see below).

Evidence (all native, profile `none`):

- `cargo test -p libzci-codecs` module suites: `tone.mod`
  renders exactly 368640 finite stereo frames (7.68 s @48 kHz,
  nonzero content, 4 ch, 1 subsong, title/type metadata);
  libopenmpt's 0.1 s trailing-silence past its own duration estimate
  is measured and end-trimmed (documented in-provider). Two-subsong
  helper: count 2, select/clamp/rewind, exact seeks. Mutes apply,
  survive seeks, reject out-of-range channels. Two interleaved MOD
  instances stay independent; one survives the other's dispose.
- Blank AHX/HVL (ported construction): open, finite probed EOF,
  render-to-EOF matches the probe, play-after-end restart, seek to
  duration ends, sub-frame seek lands exactly, order/row advance.
  Interleaved AHX contexts: mute/seek/subsong on A leave B alone;
  survivor reaches EOF after sibling dispose. Magic-less input is
  `Unsupported`; zero-duration tunes are `Corrupt`.
- Recorded leniency (not concealed): magic-claiming structural
  garbage can still "load" through the lenient upstream parser; the
  provider then renders bounded finite silence to a clean EOF rather
  than audible success. Audible AHX/HVL plus XM/S3M/IT/MO3 corpus
  inputs remain explicit acquisition work; Hively DSP/mute sonics are
  unverified by design (blank tunes are silent).
- Missing audible/module coverage is a named Phase 2 concern, per the
  roadmap's allowance — not hidden by these tests.
- Pending: browser module execution (same authorization as 1.3),
  Emscripten provider builds.

## Phase 1 completion

The shared source/provider/session API drives real Opus and MOD
decode natively, Hively lifetime hazards are addressed, recipes are
reproducible, and native uses compiled media code directly. Browser
worker/module execution is pending (authorization), with the code
structured for it. No step depends on an existing frontend
controller or persisted profile.

Next work item: Phase 2.1 — shared audio processing and native
device output (`audio/{processor,buffer,clock,resampler}.rs`, native
`audio.rs`, CPAL output in the native runtime).
