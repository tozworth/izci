# libzci implementation log

## 2026-11-09: A2 twenty-first slice — owner-client image sequence channel

Status: **implemented; check/focused-test evidence passed**. No worker file
yet; sequence capture, rendition jobs, image facades, and materialization
remain open. This slice does not close A2.

- Extended `owner-client.ts` with `queryImageSequence(query)` posting
  `{type:'image_sequence', query, request}` through the shared 32-request
  table and validating the returned captured sequence. No image facade
  exists yet; callers render from the returned sequence.
- Extended `owner-client.test.ts` with image-sequence multiplexing and
  invalid-sequence rejection coverage.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`owner-client/image-sequence`): 11 passed.

## 2026-11-09: A2 twentieth slice — owner-client bookmarks query channel

Status: **implemented; check/focused-test evidence passed**. No worker file
yet; bookmark execution, groups/image facades, and materialization remain
open. This slice does not close A2.

- Extended `owner-client.ts` with `queryBookmarks(media, subsong)` posting
  `{type:'bookmarks', media, subsong, request}` through the shared 32-request
  table and validating/sorting the returned rows in core order
  (`ORDER BY position_seconds, id`).
- Extended `owner-client.test.ts` with bookmarks multiplexing, ordering,
  target validation, and invalid-row rejection coverage.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`owner-client/bookmarks`): 10 passed.

## 2026-11-09: A2 nineteenth slice — captured image sequence boundary

Status: **implemented; check/focused-test evidence passed**. No live owner
worker yet; sequence capture, rendition jobs, viewer wiring, and
materialization remain open. This slice does not close A2.

- New `image-sequence.ts` pins `ImageSequence`/`ImageNavigation` with Rust
  bounds (sequence `1..100000` unique ids, revision `0..MAX_ID`) and helpers
  (`indexOf`, wrap-aware stepping, serialization). Neither sequence nor viewer
  state is persisted or routed through music transport.
- New `image-sequence.test.ts` pins validation, navigation validation/
  serialization, and stepping with wrap on/off.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`image-sequence/bookmarks`): 6 passed.

## 2026-11-09: A2 eighteenth slice — core bookmarks boundary

Status: **implemented; check/focused-test evidence passed**. No live owner
worker yet; bookmark queries/execution, groups facades, and materialization
remain open. This slice does not close A2.

- New `bookmarks.ts` pins the core `Bookmark` shape and the Svelte mapping
  used by future `WebProfile.bookmarks(media, subsong)` pages: validation for
  rows/targets (`id`/`media` `1..MAX_ID`, subsong u32, finite
  `position_seconds`, label `0..4096` without NUL), core-to-Svelte mapping
  (u64 id → string, empty label → `Bookmark`), Svelte-to-core fields, and
  core-order sorting (`ORDER BY position_seconds, id`).
- New `bookmarks.test.ts` pins validation, mapping round-trips, and sorting.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`bookmarks/catalog-commands`): 6 passed.

## 2026-11-09: A2 seventeenth slice — managed scan roots boundary

Status: **implemented; check/focused-test evidence passed**. No live owner
worker yet; enumeration, probing, staging, reconciliation, and groups
facades remain open. This slice does not close A2.

- New `scan-roots.ts` pins `ScanSettings`/`RootInput`/`ManagedRoot`/
  `ScanPlan`/`ScanSummary` with Rust defaults (`recursive`, `verify_unknown`,
  concurrency 2) and bounds (concurrency `1..8`, token `1..128`, batch 256,
  entries 100k, bytes 128/256 MiB). Managed roots reject `ephemeral`
  sources; Svelte `launch` folders map to `scan_on_launch` while recursion
  stays on (shell depth limit) and verification follows `verifyAddedFiles`.
- New `scan-roots.test.ts` pins defaults, folder mapping, ephemeral
  rejection, and plan/summary validation.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`scan-roots/catalog-groups`): 6 passed.

## 2026-11-09: A2 sixteenth slice — owner-client catalog groups channel

Status: **implemented; check/focused-test evidence passed**. No worker file
yet; groups execution, groups facades, and materialization remain open. This
slice does not close A2.

- Extended `owner-client.ts` with `queryGroups(by, query)` posting
  `{type:'catalog_groups', by, query, request}` through the shared 32-request
  table and validating the returned group page. No groups facade exists yet;
  callers render from the returned page.
- Extended `owner-client.test.ts` with groups multiplexing and invalid-page
  rejection coverage.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`owner-client/catalog-groups`): 8 passed.

## 2026-11-09: A2 fifteenth slice — catalog groups boundary

Status: **implemented; check/focused-test evidence passed**. No live owner
worker yet; groups execution, years/folders groupings, and materialization
remain open. This slice does not close A2.

- New `catalog-groups.ts` pins the core `CatalogGroupBy` wire values and the
  `CatalogGroupPage` shape plus the Svelte library-view mapping: artists,
  albums, genres map directly, formats maps to core `kind`, while years and
  folders stay shell-side with no core equivalent. Includes a revision stale
  guard, page validation, and group-by serialization.
- New `catalog-groups.test.ts` pins the view mapping, wire value, page
  validation, and stale-guard behavior.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`catalog-groups/catalog-query`): 5 passed.

## 2026-11-09: A2 fourteenth slice — QueueLoad to playback resolution

Status: **implemented; check/focused-test evidence passed**. No owner worker
or transport wiring yet; capability/native materialization, checkpoints, and
image routing remain open. This slice does not close A2.

- New `queue-playback.ts` resolves a core `QueueLoad` to a playback request
  through the `CoreSourceRegistry`: live `File` plus occurrence, normalized
  position/subsong/autoplay, inferred extension/kind, and display path.
  Missing files report `access-required`; null/image kinds report
  `unsupported` via `describeQueueLoadIssue`. Nothing posts commands or
  starts audio.
- New `queue-playback.test.ts` covers ephemeral resolution, access-required
  vs unsupported classification, and defensive position/subson
  normalization.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`queue-playback/source-registry`): 8 passed.

## 2026-11-09: A2 thirteenth slice — owner-client catalog query channel

Status: **implemented; check/focused-test evidence passed**. No worker file
yet; query execution, scans, groups, and materialization remain open. This
slice does not close A2.

- Extended `owner-client.ts` with `queryCatalog(query)` posting
  `{type:'catalog_query', query, request}` through the shared 32-request
  table and feeding the returned page into the catalog facade (newer
  revisions win). Full rows are projected to the facade's
  title/artist/album/duration subset for MVP observation.
- Extended `owner-client.test.ts` with query multiplexing plus stale-page
  guard coverage through the facade.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`owner-client/catalog-query`): 8 passed.

## 2026-11-09: A2 twelfth slice — catalog query boundary

Status: **implemented; check/focused-test evidence passed**. No live owner
worker yet; query execution, scans, groups, and materialization remain open.
This slice does not close A2.

- New `catalog-query.ts` pins the core `CatalogQuery` JSON contract
  (`collection`, `kind`, `root`/`media`/`source_key`/`subsong`, `search`,
  `artist`/`album`/`genre`, `sort`, `descending`, `offset`, `limit`,
  `revision`) with Rust `filtered()` bounds (`limit 1..500`, `search 0..1024`,
  filter text `0..4096`, ids `1..MAX_ID`) and Rust defaults (library/title/
  limit 100). Groups stay open.
- New `catalog-query.test.ts` pins defaults, the snake_case wire shape
  (`source_key`, `play_count`, `descending`), and bounds/failure cases.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`catalog-query/catalog-commands`): 6 passed.

## 2026-11-09: A2 eleventh slice — owner-client catalog mutate channel

Status: **implemented; check/focused-test evidence passed**. No worker file
yet; catalog queries, scans, OPFS/SQLite, and materialization remain open.
This slice does not close A2.

- Extended `owner-client.ts` with `catalog(command)` posting
  `{type:'catalog', command, request}` through the same 32-request
  `EngineRequestTable` as the queue channel. Covers core catalog mutations
  (favorite/rate/bookmark/remove); scan/probe-owned commands still have no
  helper. Queue and catalog share one budget; `close()` rejects both.
- Extended `owner-client.test.ts` with catalog result multiplexing and a
  mixed queue/catalog budget-overflow case.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`owner-client/catalog-commands`): 7 passed.

## 2026-11-09: A2 tenth slice — Svelte to core settings mapping

Status: **implemented; check/focused-test evidence passed**. No live owner
worker yet; settings persistence, reverse observation, and transport wiring
remain open. This slice does not close A2.

- New `settings-mapping.ts` maps Svelte snapshots (queue `shuffle`/`repeatMode`,
  `restartCurrentTrackOnPrevious`, `playerVolume`, mute, `replayGainMode`/
  preamp, play-count threshold) to the core `QueueSettings` row through the
  existing `coreQueueSettingsForInput` validation. Enabled Previous-restart
  maps to 3 s; disabled maps to 600 s (effectively never) with Svelte keeping
  its gate until Previous moves to core. Play-count `enabled` is always true
  (Svelte has no disable flag); mute defaults to false (transient controller
  state).
- New `settings-mapping.test.ts` pins the forward mapping, the disabled
  restart threshold, and core validation failures.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`settings-mapping/queue-commands`): 10 passed.

## 2026-11-09: A2 ninth slice — catalog user-facts command boundary

Status: **implemented; check/focused-test evidence passed**. No live owner
worker yet; catalog persistence, scans, Add/Root commands, and materialization
remain open. This slice does not close A2.

- New `catalog-commands.ts` pins the core catalog user-facts JSON contract
  (`favorite`/`rate`/`bookmark`/`remove_bookmark`/`remove`, plus wire-only
  `add`/`root`/`remove_root`/`finish_scan` for completeness) and maps the
  Svelte rating domain (0.5..5, undefined clears) to core half-star steps
  (0..10, 0 clears). Builders validate media ids (`1..MAX_ID`), subsongs,
  `position_seconds`, and bookmark labels (`0..4096` chars, no NUL).
- New `catalog-commands.test.ts` pins the wire shapes, rating round-trips
  with `toSvelteRating`, and bounds/failure cases. Scan/probe-owned commands
  have types but no builders; they belong to the future probe/scan slice.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`catalog-commands/catalog-snapshot`): 6 passed.

## 2026-11-09: A2 eighth slice — Svelte owner-client wire

Status: **implemented; check/focused-test evidence passed**. No worker file
yet; OPFS/SQLite, Web-Lock election, ingest/restore, and transport wiring
remain open. This slice does not close A2.

- New `owner-client.ts` pins the document-side owner protocol before any
  worker exists: `queue(command)` posts `{type:'queue', command, request}`
  with a bounded `${uuid}/${scope}` id, multiplexes `result` through the
  shared `EngineRequestTable`, and routes `snapshot` into the read-only
  queue facade (newer revisions win). At most 32 in-flight queue requests;
  unknown result ids stay harmless and `close()` rejects all pending work
  (owner loss/teardown).
- New `owner-client.test.ts` covers result multiplexing plus facade revision
  guarding, error results, the 32-request budget, and close rejection with
  a mocked post function. No Worker/OPFS/locks/WASM are needed.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`owner-client/queue-commands/source-registry/catalog`): 17 passed.

## 2026-11-09: A2 seventh slice — source registry and catalog observation

Status: **implemented; check/focused-test evidence passed**. No live owner
worker yet; queue persistence, owner election, scans, and materialization
remain open. This slice does not close A2.

- New `source-registry.ts` keeps live `File` objects for core source keys
  (`ephemeral` plus staged `browser_handle`/`native_path`) without persisting
  handles, blobs, or URLs. `registerTrack` reuses the command-boundary
  reference mapping; `resolveLoad` returns `null` for capability/native loads
  (`access-required` through the future owner worker); `retain` drops keys no
  longer referenced by core (mirrors `references_source` GC).
- New `catalog-snapshot.ts`/`catalog-facade.ts` mirror the queue observation
  path for library/catalog: core `catalog_query` page shape, render rows with
  restorable flags, core `0..10` rating to Svelte half-star mapping, and a
  newer-revision-wins facade. Mutations, scans, and persistence stay open.
- New `source-registry.test.ts` and `catalog-snapshot.test.ts` (facade cases
  included) pin ephemeral/handle-only resolution, GC retention, rating and
  restorable mapping, and revision guards.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`source-registry/catalog/queue-commands`): 14 passed.

## 2026-11-09: A2 sixth slice — explicit video/Raf compatibility bridges

Status: **implemented; check/focused-test evidence passed**. The native
`<video>` path and shell-side Raf graph remain the MVP bridges outside the
migrated domain authority; core video (M5) and full Raf parity (M4) stay
deferred. This slice does not close A2.

- New `compat-bridges.ts` pins the video bridge (native element via
  `VideoPlayerService`, single-element PiP guard), the Raf bridge
  (shell-side graph with explicit `auto-amp` video bypass), the known
  playback gaps (stream speed, module separation/pan, Hively tempo/pitch/
  repeat, ReplayGain shell bridge), and the mobile/Oda/window consumer
  contract that queue adoption must preserve.
- New `compat-bridges.test.ts` guards the bridge identities and gap list so
  future slices cannot silently widen them.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`compat-bridges/queue-commands`): 11 passed.

## 2026-11-09: A2 fifth slice — core queue command boundary

Status: **implemented; check/full-test/build evidence passed**. No live owner
worker yet; queue persistence, owner election, catalog, and materialization
remain open. This slice does not close A2.

- New `queue-commands.ts` pins the shared core queue JSON contract
  (`QueueCommand` snake_case envelope, `SourceReference`, `QueueSettings`
  with replay-gain/play-count defaults) and maps Svelte `TrackItem`s to
  core references without persisting handles, blobs, or URLs. Builders cover
  append/play/remove/move/up_next/next/previous/clear_up_next/settings/
  checkpoint/volume/mute plus settings mapping, durable `${uuid}/${scope}`
  request ids, and validation mirroring `SourceReference::validate`,
  `QueueSettings::validate`, and the `1..10000` queue bound.
- New `queue-commands.test.ts` pins the wire shapes, source-kind mapping
  (`native_path`/`browser_handle`/`ephemeral`), settings defaults, request-id
  bounds, and failure cases. The existing read-only `queue-facade` remains
  the observation path; commands will flow through the future owner worker.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 234 files / 1,474 tests passed.
- `npm run build`: passed; PWA precache 172 entries, unchanged.
- Focused vitest (`queue-commands/facade/snapshot/runtime/snapshot`): 20 passed.

## 2026-11-09: A2 next slice — read-only core queue facade

Status: **implemented; check/focused-test evidence passed**. The facade is
not yet fed by a live owner worker; queue commands, persistence and owner
election remain open.

- New `queue-facade.ts` exposes the core queue snapshot as Svelte readable
  stores (`view`, `revision`) behind `pushObservation`. First observations
  apply; duplicates and out-of-order revisions are ignored so late owner
  handoff deliveries stay harmless. Components can render from `view`
  without a mutation path through this module.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Focused vitest (`queue-facade/snapshot/runtime`): 8 passed.

## 2026-11-09: A2 headstart — shared runtime relocation and queue-snapshot probe

Status: **implemented; check/focused-test evidence passed**. Clean-checkout
WASM regeneration, `npm run build`, and any browser evidence remain pending
(no build or browser run authorized in this session).

- The three browser recipes (`build-wasm.py`, `build-browser-codecs.py`,
  `build-browser-modules.py`) now emit to the workspace-ignored
  `libzci/generated/`. The Svelte bridge (`runtime.ts`, `playback.worker.ts`)
  and the five crude importers reference the shared directory; the crude is
  no longer the production shell's build-output owner. No transport,
  protocol, or emitted bytes change, and the single-import-site test still
  passes unmodified.
- New read-only `queue-snapshot.ts` probe pins the core queue JSON shape
  (revision, source references, occurrence items, current/up_next, position)
  and maps it to render rows with restorable flags plus a revision render
  guard mirroring the crude view. No Svelte store is touched.

Evidence on Windows x64 (no browser, no device):

- `npm run check`: 0 errors, 0 warnings.
- Full `npm test`: 232 files / 1,464 tests passed.
- `npm run build`: passed; PWA precache 172 entries, unchanged. `dist/`
  contains the shared control/audio/opus/modules WASM plus the worker and
  output worklet emitted from `libzci/generated/` (byte-identical sizes to
  the previous crude-owned output).
- The new ignored `libzci/generated/` was populated locally by copying the
  previous recipe output so typecheck/tests resolve; a clean checkout must
  run the three recipes before `npm run build` (handoff setup order).

## 2026-11-09: A2 fourth slice — shared Svelte engine runtime

Status: **implemented; unit/build/headless-bridge checks passed**.
Queue/library/catalog persistence, full ReplayGain ownership, playback-rate,
mobile/Oda and native/SAF adoption remain open. This slice does not close A2.

The two production Svelte transports (`LibzciStreamPlayerService`,
`LibzciModulePlayerService`) now share one engine-link owner in
`src/lib/services/libzci/runtime.ts` instead of duplicating worker/worklet
bootstrap (~250 lines removed across both services). The shared link owns the
single generated-asset import site (crude-pwa `generated/` control/audio/codec
WASM, worklet chunk), per-`AudioContext` worklet registration, decode/control
port assembly, ready/result/snapshot/error multiplexing and teardown; the
services keep only metadata/pattern/settings mapping. Request/response routing
is covered by a new `runtime.test.ts` (`EngineRequestTable` resolve/reject/
reject-all). No transport, worker, worklet or protocol bytes changed.

Verification on Windows x64 (muted/headless where browser runs):

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 231 files, 1,462 tests — one unrelated
  `multiplayer-server-integration` file failed on a server-startup timeout in
  the full run and passed alone on retry; everything else passed.
- `npm run build`: passed; PWA precache 172 entries, unchanged.
- Temporary scratch page driving the refactored services through vite dev in
  muted headless Chromium (deleted after the run; production `dist/` behavior
  is unchanged): `44100-1.mp3` (0.24 s -> held, seek to 1 s landed, resume to
  1.24 s, backend `stream`), `tone.mod` (0.27 s -> held, seek landed, resume
  to 1.25 s, backend `module`), `tone.ahx` (0.29 s -> held, seek landed,
  resume to 1.23 s, backend `module`); no page/console errors in two
  consecutive runs. Only one engine stays live at a time, mirroring the
  production bundle switch (`loadIntoBundle` destroys the idle service).

Not yet evidenced/implemented: queue/library/catalog and persistence adoption,
full normalization ownership, stream/module playback-rate, mobile/Oda wiring,
real FSA/native/SAF checks through the adopted bridge. The generated assets
still build into `libzci/consumers/crude-pwa/src/generated/`; relocating that
build output to a shared runtime directory remains follow-up work. Physical
Android/background and GNU/Linux remain post-MVP evidence.

## 2026-11-09: A2 third slice — Hively playback in the Svelte shell

Status: **implemented; unit/build/headless-UI checks passed**. Queue/library/
catalog persistence, full ReplayGain ownership, playback-rate, mobile/Oda and
native/SAF adoption remain open. This slice does not close A2.

The production main window now routes Hively tracker modules (`ahx`, `hvl`)
through the libzci `WebEngine` alongside ordinary streams and OpenMPT modules:

- `LibzciModulePlayerService` accepts `ahx`/`hvl` through the shared
  modules-reference provider in the existing `playback.worker.ts` bridge
  (stepped probe, 64 MiB cap, cancellable 32 KiB reads, generation-scoped
  `WebPreparation`, subsong selection before initial seek). The legacy
  `HivelyPlayerService` audio transport is superseded; `player-controller.ts`
  routes every `module` kind through the libzci service and no longer owns a
  second Hively worklet path.
- Hively settings are capability-gated: interpolation, subsongs and channel
  mutes go to core; ramping/tempo/pitch/loop counts log explicit one-time gaps
  instead of spamming per-command rejections (the shared provider reports
  `ramping`/`speed`/`pitch`/`loop_limit` false for Hively). Stereo
  separation/pan remain explicit shell-side gaps as before.
- Hively pattern songs come from new output-free replay-core inspection
  (`hively-pattern-inspect.ts` + worker over `public/vendor/hively-replay.wasm`,
  bounded 32-channel/1024-position/1024-track/256-row limits, 15 s timeout,
  abortable) instead of a second audio worklet. Transport metadata carries only
  the title; inspection upgrades it with instruments/orders/duration. Live
  order/pattern/row continues to come from core observations. OpenMPT pattern
  songs still use the legacy inspection worker.
- `player-controller.characterization.test.ts` now models three services per
  bundle (stream/module/video); `hively` tracks map to the `module` service
  role. `snapshot.test.ts` asserts Hively subsong mapping. New
  `hively-pattern-inspect.test.ts` covers the NUL-terminated string reader.

Verification on Windows x64 (muted/headless where browser runs):

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 230 files / 1,459 tests passed (was 229 / 1,457).
- `npm run build`: passed; PWA precache 172 entries, including the new
  `hively-pattern-inspect.worker` chunk alongside `libzci_web_bg`,
  `libzci_audio_web`, `opus-reference` and `modules-reference` WASM.
- Production `dist/` preview on a temporary local port in muted headless
  Chromium with real file-input imports (no page/console errors):
  - `tone.ahx`: 0.20 s -> 1.04 s advanced; pause held 1.04 s; seek to 1 s
    landed at 1.00 s; resume reached 1.92 s.
  - `tone.hvl`: 0.21 s -> 1.05 s advanced; pause held 1.11 s; seek landed at
    1.00 s; resume reached 1.92 s.
  - `tone.mod` (OpenMPT regression): 0.17 s -> 1.01 s; pause held; seek
    landed at 1.08 s (module seek granularity); resume reached 2.47 s.
  - `44100-1.mp3` (stream regression): 0.27 s -> 1.11 s; pause held; seek
    landed at 1.00 s; resume reached 2.35 s.
- The Patterns workspace tab is absent from the default headless layout for
  all module fixtures (including OpenMPT), so pattern-grid UI visibility was
  not re-evidenced here; pattern data flows through the inspection/unit path
  and live position through core observations.

Not yet evidenced/implemented: queue/library/catalog and persistence adoption,
full normalization ownership, stream/module playback-rate, mobile/Oda wiring,
real FSA/native/SAF checks through the adopted bridge, and shared-runtime
extraction from the crude consumer. Physical Android/background and GNU/Linux
remain post-MVP evidence.

Status: **implemented; unit/build/smoke checks passed, full UI playback pending**.
Hively (`ahx`, `hvl`), queue/library/catalog persistence, full ReplayGain
ownership, playback-rate, mobile/Oda and native/SAF adoption remain open.
This slice does not close A2.

The production main window now routes OpenMPT tracker modules (`mod`, `xm`,
`s3m`, `it`, `mo3` and other libopenmpt extensions) through the libzci
`WebEngine`, the shared modules-reference provider, the bounded decode worker
and the shared audio-only worklet:

- `playback.worker.ts` now opens `module`/`hively` kinds via a new
  `moduleBackend` modeled on the crude `browser-providers` assembly
  (64 MiB cap, stepped probe, retained interpolation/ramping/speed/pitch/
  loops/channel controls, seek reapply, cancellable 32 KiB reads). Subsong
  selection applies before the initial seek. Module `control` actions rebuild
  the generation-scoped `WebPreparation`, refresh `opened_facts`/`observed`
  and re-anchor the worklet, so retained PCM cannot cross the control boundary.
  Live order/pattern/row observations refresh on each published snapshot.
- `protocol.ts`/`snapshot.ts` carry the core `subsong`, `capabilities` and
  `module` observation into the Svelte facade. `mapCoreSnapshot` now reports
  `backend: 'module'` for `org.openmpt.libopenmpt`/`hivelytracker.replay`
  providers with `subsong`/`subsongCount`; `mapModulePosition` exposes the
  live order/pattern/row.
- New `LibzciModulePlayerService` owns OpenMPT transport in the Svelte shell.
  It drives the shared worker/worklet through the existing audio-bus route
  (transition gain, visualizer analyser, Media Session anchor preserved),
  maps module comments/capabilities to `TrackMetadata` (title/artist/tracker/
  message, subsongs, channels, duration), steps subsongs via core `subsong`
  commands, applies interpolation/ramping/tempo/pitch/loops/channel-mute
  settings with capability-gated warnings, and loads full pattern songs via
  the legacy inspection worker (no second audio player) while live position
  comes from core. Infinite repeat maps to 16 loops and stereo
  separation/pan remain explicit shell-side gaps with warnings.
- `player-controller.ts` routes `module` kinds through the new libzci service;
  `hively` kinds remain on the legacy `HivelyPlayerService` in this slice and
  video stays on the native `<video>` path. The old `ModulePlayerService`
  transport is superseded for OpenMPT but its inspection utilities remain for
  pattern songs.

Verification on Windows x64 (muted/headless where browser runs):

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 229 files / 1,457 tests passed (includes new module snapshot
  mapping and updated controller characterization for the libzci module path).
- `npm run build`: passed; PWA precache 172 entries (was 171), including
  emitted `modules-reference` WASM alongside `libzci_web_bg`,
  `libzci_audio_web` and `opus-reference` WASM.
- Production `dist/` preview on a temporary local port in muted headless
  Chromium: page loads as `izci`, no page/console errors.
- The Svelte worker module backend reuses the exact crude `modules-reference`
  assembly/probe/control/fact mapping already covered by muted Chromium M1
  output checks (`tone.mod/xm/s3m/it/mo3`, interpolation/channel-mute/subson
  g/speed/pitch/loops, pause/seek/EOF). Direct Svelte-UI file-input playback
  measurements for modules remain follow-up evidence; this slice does not
  claim them.

Not yet evidenced/implemented: Hively migration to the Svelte bridge, video
ownership migration, queue/library/catalog and persistence adoption, full
normalization ownership, stream/module playback-rate, mobile/Oda wiring,
real FSA/native/SAF checks through the adopted bridge, and shared-runtime
extraction from the crude consumer. Physical Android/background and GNU/Linux
remain post-MVP evidence.

## 2026-11-09: MVP rescope

The user set the MVP goal to **Svelte adoption plus playback of most existing
formats**. AVIF, HDR/non-ICC color and formal decoder-heap accounting are
deferred and no longer keep M3 open. Full Raf parity/loadouts/gapless work
(M4), core video transport (M5), the C ABI/foreign caller (M6), izci-server
adoption (A1), physical Android/background and GNU/Linux evidence are post-MVP.
The next milestone is A2 Svelte adoption. Historical entries below that describe
these items as required are superseded by this scope decision; the detailed
backlog remains in [phases.md](phases.md).

## 2026-11-09: A2 first slice — ordinary stream playback in the Svelte shell

Status: **implemented; muted Chromium checks passed**. Implementation commit:
`d528fc2e`. Modules, video, the queue/library authority and native/SAF adoption
remain open. This slice does not close A2.

The production main window now routes ordinary stream files (`mp3`, `wav`,
`flac`, `ogg`, `opus`) through libzci instead of Howler:

- `LibzciStreamPlayerService` owns browser ordinary-stream transport. It drives
  the shared Rust `WebEngine` session in a worker, uses the pinned reference
  Opus provider for Opus and the shared Symphonia provider for other streams,
  and feeds bounded PCM pool blocks to the shared audio-only worklet renderer.
- The worklet node joins the existing `audioBusService` source route, so the
  current master volume, transition/fade gain, Raf compatibility graph,
  visualizer analyser and Media Session facade remain shell-side bridges rather
  than a second transport. Playback position comes from consumed output; the UI
  does not advance it.
- Seek replaces the generation-scoped `WebPreparation` before resuming, so
  retained converter/PCM state cannot cross the seek boundary. Decoder reads use
  the Asyncify-safe `ccall` path; completion, anchor, recycle and snapshot
  generations are fenced.
- Stream ReplayGain remains an explicit shell-side bridge through the shared bus
  local gain until metadata normalization ownership moves in the queue/library
  slice. Ordinary-stream global playback-rate changes are not yet adopted and
  are logged as an explicit temporary gap.
- The unused Howler service, dependency, ambient types and test were removed;
  modules still use their existing libopenmpt/Hively services and video still
  uses the native `<video>` path. The production stream path no longer has a
  second decoder/transport implementation.
- The Vite PWA precache ceiling rose from 4 MiB to 8 MiB because the emitted
  libzci control WASM is about 5.46 MiB. Audio worklet WASM and reference Opus
  WASM are emitted alongside it. Browser runtime assets are still generated
  under `libzci/consumers/crude-pwa/src/generated`; extracting that shared
  runtime from the crude consumer remains A2 follow-up work.

Verification on Windows x64, muted headless Chromium, production `dist/` on a
temporary local preview:

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 229 files / 1,455 tests passed.
- `npm run build`: passed; PWA precache 171 entries, emitted
  `libzci_web_bg`, `libzci_audio_web` and `opus-reference` WASM plus the worker
  and output worklet.
- Real `44100-1.flac`, `44100-1.mp3`, `44100-1.ogg`, `44100-1.wav` and
  `48000-2.wav`: playback advanced, pause held position across repeated reads,
  seek to 1.5 s landed at 1.5 s, resume advanced to about 2.0–2.2 s, and no page
  or console errors occurred.
- Real 30 s `long.opus`: playback advanced, pause held, seek to 15 s landed at
  15 s, and resume advanced to 15.8 s with no errors.
- Snapshot mapping tests cover core state vocabulary and frame-to-time mapping.

Not yet evidenced/implemented: tracker and Hively migration to the Svelte
bridge, video ownership migration, queue/library/catalog and persistence
adoption, full ReplayGain/normalization ownership, stream playback-rate support,
mobile/Oda wiring, real FSA/native/SAF checks through the adopted bridge, and
shared-runtime extraction from the crude consumer. Physical Android/background
and GNU/Linux remain post-MVP evidence.

## Historical log notice: 2026-10-18 plan revision

The entries below record the first attempt through `168874dd`. They are retained
as history, including their claims and pending checks. The [source review](review.md)
found execution/output defects that those reported checks do not close.
The [replacement roadmap](phases.md) starts at R1; its R1-R4 and M1-M6 milestones
are all open. No build, test, listening, or browser result was newly produced by
this documentation revision. Append future results under the new milestone IDs.
The old phase labels and next-step statements below do not direct current work.

## 2026-10-30: end-to-end completion, M3 catalog foundation

Started at clean `0ed9277b` on `libzci-codex`. The user authorized all builds,
tests and inspections with low audio volume for completing libzci and adopting
it in izci-server and the existing Svelte shells. The source audit confirms
that M2 is the implemented starting point; A1/A2 adoption remains outstanding.
Earlier physical-device/lifecycle limitations remain explicitly unverified.

This first slice implements shared SQL catalog identities, source revisions,
Library membership, per-media/subsong favorites and half-star ratings,
bookmarks, indexed sorts and bounded filtered pages. Catalog state is queried
from SQL rather than copied into each playback snapshot. Catalog revisions
advance independently of frequent queue/playback checkpoints. Both native and
WASM public profile bindings expose the same mutations, queries and bookmarks.
Queue occurrences and catalog membership are independent. Removing membership
preserves identity/user facts; changing media metadata/revision preserves facts.
Durable request receipts and profile revision checks cover catalog transactions.

Schema 2 deliberately refuses schema 1 without changing it. Default crude-native
profiles and the browser OPFS/capability/ownership namespaces use fresh v2 names;
the prior profiles/grants are retained, with no migration or dual writing.

Verification on Windows x64 MSVC and muted headless Chromium:

- `cargo test --locked --manifest-path libzci/Cargo.toml -p libzci -p libzci-native`
  passed the starting core/native output, transport and profile suites.
- `cargo test --locked --manifest-path libzci/Cargo.toml -p libzci-native --test catalog --test profile`
  passed new catalog identity/fact/reopen, fault/receipt/revision and 2,048-item
  query checks plus the five existing profile checks.
- `python libzci/consumers/crude-pwa/scripts/build-wasm.py` rebuilt control and
  import-free audio WASM. `npm run typecheck` and `npm run test:storage` from the
  crude PWA passed on actual OPFS SQLite, including catalog/favorite/subsong
  rating/bookmark reopen, rollback, receipts and independent catalog revision.

M3 remains in progress: managed scans, metadata/lyrics policy, play counts,
artwork/images and the crude presentation controls still need implementation.
M4-M6/A1/A2 remain open; this slice does not claim shell or server adoption.

The following M3 slice adds managed root settings (recursion, launch scan,
unknown verification, bounded probe concurrency), connection-local TEMP scan
staging, bounded batches/jobs/entries and atomic successful reconciliation.
Overlapping roots retain independent memberships; rescans preserve media IDs
and user facts. Cancelled/partial/superseded scans, removed or changed roots,
connection loss and failed writes/commits cannot erase the prior catalog.
Finish receipts survive lost replies; no transient job is persisted. Native and
WASM profile bindings expose the same begin/stage/cancel/finish operations.

`cargo test --locked --manifest-path libzci/Cargo.toml -p libzci-native --test scans --test catalog --test profile`
passes 11 tests, including root ownership, empty scan, cancellation, rollback,
connection reopen, bounded staging and existing queue/profile behavior. Rebuilt
WASM, `npm run typecheck` and muted Chromium `npm run test:storage` pass actual
OPFS TEMP staging, deduplication, reconciliation, cancellation and finish receipts.
Real folder enumeration/probe wiring and crude scan controls remain next work.

Native enumeration/probe wiring now uses bounded directory depth/visited-entry,
path/event queue and probe-concurrency budgets, with no SQLite or device in probe
workers. Unsupported unknowns are ignored; corrupt known files, unavailable
directories, permission failures, revision changes and cancellation fail the scan
rather than claiming a complete enumeration. Symlinks/junctions are not followed.
The canonical path-reference helper is shared with native queue imports. Shared
metadata normalization applies first-nonempty provider precedence, common aliases,
ordinal fields, UTF-8 bounds and filename fallback without embedded payloads.

The native crude has Library/Favorites queries/pages, root settings and launch
scans, rescan/cancel, ratings/favorites, queue append and bookmark controls, in a
focused catalog view. `cargo test ... -p libzci -p libzci-native --lib` passed
core/native units (device smoke remains separately ignored). `cargo test ...
-p libzci-native --test native_scan --test scans --test catalog --test profile`
passed real on-disk WAV probes/reopen/rescan, nonrecursive scanning, bounded-queue
cancellation, corrupt/missing inputs and catalog/scan/profile suites. `cargo test
... -p crude-native` passed its two controller/headless-egui tests. No physical
listening or screenshot acceptance is inferred from those checks.

Committed slices: `79c3f410` catalog/facts/query foundation, `c2751a86` atomic
managed-root reconciliation, and `f8db8d0e` native probes/catalog controls.

Browser catalog controls now use the same owner worker and Rust APIs, with
bounded reusable probe workers and real directory enumeration. No AudioContext
is created by catalog import/probe/scan. Module codec assembly is reused within
a worker while decoder contexts remain independent. Metadata aliases include
RIFF INFO fields as well as ID3/Vorbis names. Both roots and catalog-only files
participate in core-owned capability liveness. Real `isSameEntry` identity is
reused across pickers and overlapping roots; source bytes do not deduplicate.
Stable path candidates accelerate repeated identity lookups. Handle recovery
uses bounded IDB pages, serializes with registration, and protects overlapping
staging with reference counts rather than prematurely deleting shared handles.
Scan failures and replacement cancellation release workers/staging without
overwriting the new operation's progress. Root grants are queried at launch;
only explicit document controls request them.

Validation after these browser changes:

- Control/audio WASM build, crude PWA `npm run typecheck`, `npm run build`, and
  `npm run test:storage` pass. The latter now checks genuine OPFS same-entry
  handles, overlapping staging, registration/GC races and catalog-only liveness.
- `npm run test:m3` passes real folder probes without output, same-entry catalog
  imports/overlapping roots, per-subsong facts/bookmarks, attached queries with
  no attached workers, owner loss/reload, catalog-only capability playback,
  cancellation/corrupt-file preservation and recovery, and cold offline reopen
  with automatic launch scans/probes and real output. Chromium is muted; the
  test playback master is 0.02. Evidence: `.local/libzci/m3-browser-evidence.json`
  and inspected screenshot `.local/libzci/m3-catalog.png`.
- `npm run test:m2` passes the existing production worklet, queue/settings,
  owner re-election/idempotence, capability crash recovery, cold offline,
  initialization failure and concurrent import/removal scenarios. Fixture checks
  use fresh v2 profiles, and duplicate handles now share one source capability
  while preserving duplicate queue occurrences.
- Native catalog/scan/profile/real-folder suites still pass after shared SQL
  liveness/index and metadata changes. External picker grant interactions,
  physical Android and true background/screen-off remain unverified.

Current M3 remainder: grouping, supplemental metadata/ReplayGain/lyrics policy,
audible-timeline play counts, artwork/image jobs/cache/navigation, plus their
consumer controls and acceptance. M4-M6 and server/Svelte adoption remain open.

The next slice adds shared paged artist, album+artist, genre and media-kind
groups, with the same collection/root/subsong/search filters and catalog
revision checks as flat queries. Albums with the same label under different
artists remain separate; group keys preserve exact metadata values. Exact media
ID/source-key and genre filters support focused lookups. Both crude UIs offer
group selection/clear controls over these APIs. Native catalog tests now include
group totals, filters, paging and stale-revision rejection; crude-native tests,
WASM rebuild, PWA typecheck/build, real OPFS storage/group checks and production
M3 owner/offline/catalog/group UI scenarios pass. Remaining M3 work excludes
grouping but still includes metadata/ReplayGain/lyrics, counts and artwork/images.

Browser reference Opus now exports bounded read-only tag leases from opusfile
instead of validating and dropping all comments. Reusable probe/current/output
facts carry UTF-8 container tags, and the optional WebCodecs provider retains
the reference container facts. Core normalization persists only bounded catalog
fields; embedded lyric payloads remain transient. `build-browser-codecs.py`
rebuilds the pinned C/WASM boundary. The new `npm run test:metadata` uses an
FFmpeg 8.1.1 recipe over synthetic Opus to verify UTF-8 title/artist, ReplayGain,
R128 and lyrics through repeated no-output probes and catalog normalization.
PWA typecheck/build, optional WebCodecs sample/timeline and tag checks, native
reference callback comparisons/cancellation and production M2 owner/offline
regressions pass after rebuilding the codec. This exposes tags; ReplayGain
processing and on-demand lyric reader/timeline support still remain open.

Foundation audit found two master-envelope defects: ramps advanced separately
for left/right samples (240 samples instead of 240 stereo frames), and a new
volume/mute target anchored to the last completed setting instead of the last
rendered gain. The shared processor now advances one envelope per frame and
retargets from the current finite value, preserving stereo balance and avoiding
steps during rapid changes. Muted volume updates with an unchanged effective
target do not restart the envelope. All playback providers use this master stage;
raw source renders remain independent of master settings.

Native core/output/transport/catalog/profile suites pass, including new frame
duration, linked-stereo and interrupted-ramp checks. Rebuilt import-free audio
WASM passes four real ABI tests, including stereo/retarget regression coverage.
After building the current native CLI, `npm run test:m1` passes real output for
ordinary formats and OpenMPT/Hively modules and all-sample native/browser
comparisons through 44.1/48/96/192 kHz input and unknown-duration FLAC. Its live
File invalidation case now accepts failure arriving before or after Play while
requiring the same typed unavailable outcome; it also waits for current-generation
prefill rather than an earlier output report. Missing native executables report
the actual spawn error. One intermediate validation run was invalidated by a
concurrent generated-WASM reload; the final pass used fixed generated assets.

Shared transient lyrics now include a bounded plain/LRC parser, clock offsets,
multiple/out-of-order timestamps, simultaneous cue groups, explicit clear cues,
binary-search audible-time lookup and expanded-text/input limits. Native and
WASM expose the same document semantics. Independent source jobs read ID3v2.2/
2.3/2.4 USLT and lyric TXXX fields, FLAC comments and continued Vorbis/Opus Ogg
packets with ranged reads, length/CRC/continuation validation and cancellation.
Normal ID3 reads skip unrelated artwork rather than copying it; global v2.2/2.3
unsynchronization has a separate bounded tag-buffer fallback. Compressed/encrypted
lyric frames are unsupported; UTF-8/Latin-1/UTF-16 lyric text is supported.
Input text is capped at 256 KiB, individual lines at 4096 bytes, 8192 timed cues,
expanded cue text at 1 MiB, individual comment packets at 4 MiB and metadata scan
span at 64 MiB. Nothing is persisted in catalog/queue records.

Both crudes expose transient embedded/sidecar lyrics, follow/seek cues and a
display-delay tweak. Browser lookups resolve real catalog references through the
owner, with bounded concurrent cancellable worker jobs and no decoder/output.
The presentation uses Rust cue lookup and only highlights the matching playing
source. Routine Opus/Symphonia playback/probe facts now omit embedded lyric and
artwork payloads; the on-demand jobs own their retrieval.

Verification: five pure parser/ranged-reader tests include short reads, large
skipped artwork, text encodings, corrupt lengths/CRC and expansion budgets. Two
native job tests verify no-provider operation and cancellation during a held
source while another job completes. Core/native and native Opus suites plus
crude-native controller/headless-egui tests pass. Rebuilt WASM, PWA typecheck,
`test:metadata`, build and production `test:m3` pass. Synthetic FFmpeg 8.1.1
MP3/FLAC/Vorbis/Opus fixtures yield all 300 cues beyond regular metadata-field
truncation. Browser checks cover no-output jobs, cancellation, cue highlighting,
display-delay clearing, foreign-source isolation and absent embedded payloads
in automatic snapshots. Production cold offline tests execute the on-demand
reader worker from cached assets. Remaining M3 work includes ReplayGain policy/
processing, play counts and artwork/images; M4-M6/A1/A2 remain open.

Unknown-extension verification now goes specifically through the background
OpenMPT provider on native/browser. Ordinary provider magic cannot bypass this
setting; known formats and normal playback retain their independent selection
path. A regression exposed numeric C++ exceptions on invalid module input in the
browser archive: the wrapper enabled exceptions, but archive objects had been
compiled without catching enabled. The Emscripten module build now enables
`-fexceptions` throughout the OpenMPT archive so its C boundary returns errors.
The pinned archives/wrapper were rebuilt. Native provider selection tests,
browser metadata/unknown verification checks and the full M1 ordinary/module
output and native/browser sample comparisons pass with the rebuilt archive.

Managed scans now cap accounted staging bytes at 128 MiB per root and 256 MiB
across active jobs, in addition to entry/batch/job limits. Accounting includes
JSON/scalar/index-key duplication and per-row overhead. TEMP-table triggers
maintain transactional entry/byte credits, so small browser batches do not
recount/sum the full staged corpus. Replacements release their previous cost;
budget failures roll back the entire batch and credits without publishing
membership. Scan tokens include connection-side randomness to avoid reuse after
worker/process atomic IDs restart. Native scan and real-folder tests pass,
including injected accounting high-water marks (not a physical RAM benchmark).
Rebuilt WASM, actual OPFS trigger/budget rollback checks and production M3
catalog/scan/owner/offline scenarios pass. These limits bound staging accounting;
overall codec/renderer resource measurements remain part of adoption readiness.

Catalog search/sort keys are now generated by shared Rust using canonical
normalization and Unicode default full case folding (`caseless` 0.2.2 and
`unicode-normalization` 0.1.26). SQLite `lower`/`NOCASE` only folded ASCII, so
native and OPFS queries missed accented case pairs. Keys are maintained by
manual and scan upserts, included in scan byte credits, and indexed for title,
artist/album, album, genre and path ordering. Original labels, exact group/filter
keys and platform source identities remain unchanged. This is deterministic
Unicode scalar ordering, not language-specific collation or Turkish I tailoring.
The folding algorithm follows the [caseless implementation](https://github.com/unicode-rs/rust-caseless).

Schema 3 refuses older versions without mutating them; both crudes now default
to fresh v3 profile/capability/ownership namespaces. Earlier profiles/grants
remain intact. Native tests and real OPFS tests cover accented case, decomposed
accents, German full folding, Greek sigma, exact distinct groups, stable sort
ties, scan/manual key replacement and reopen. Native query plans verify the
sort indexes without temporary sorting. Core/native suites, WASM rebuild,
TypeScript checking, browser storage, production build, M2 owner/reopen/offline
and M3 catalog/scan/owner/offline checks all pass with Chromium audio muted.

Shared ReplayGain/R128 policy and normalized catalog facts are implemented.
Optional normalization defaults off; settings persist in the shared playback
settings row and are applied by sessions independently of the crude editor.
Track/album selection, fallback, tagged preamp, missing-tag gain, R128 target
and peak-tag clipping prevention are explicit. R128 integers are validated as
signed Q7.8 (including duplicate rejection); valid R128 takes precedence over
ReplayGain for the selected scope. The default -18 LUFS target adds 5 dB to the
R128 -23 LUFS reference. Optional gain is additional to the provider-applied
Opus header gain, following [RFC 7845 §5.2.1](https://www.rfc-editor.org/rfc/rfc7845#section-5.2.1).

Native callbacks and the import-free worklet WASM run separate stereo-linked
normalization and master envelopes. New sources prime their normalization before
the first media frame; subsequent changes anchor at the last rendered value.
Both stages use five milliseconds at the actual output rate, and underrun silence
does not advance them. The raw peak precedes normalization; normalized audio
retains headroom (only floating-point overflow saturates). Native device-free render
jobs explicitly distinguish Raw, Master-only and Processed modes. Both crudes
provide settings and effective-gain diagnostics without owning policy or DSP.

Actual browser signal tests exposed ID3 user-text names such as
`TXXX:REPLAYGAIN_TRACK_GAIN`. A shared key helper now removes that wrapper for
normalization/catalog parsing and embedded-payload filtering, so lyric user-text
frames also stay out of routine provider snapshots.

Verification: core/native/browser-binding/audio-WASM/crude-native suites pass;
native reference Opus sample tests prove header gain and optional R128 each apply
once, Raw stays independent, and processed volume/mute work. Native callback
allocation tests remain at zero allocations/deallocations. The five audio-WASM
ABI tests cover source priming, rapid retargets, stereo linking, starvation and
fixed memory. `npm run test:normalization` measures actual muted Chromium
AudioWorklet levels for reference and optional WebCodecs Opus, MP3, FLAC and
Vorbis, including track/album changes, preamp, mute, invalid-setting rollback and
SQL reopen. Ratios agree within the stated 1.5% signal-measurement tolerance;
the direct native sample checks are much tighter. Metadata/lyrics checks, real
OPFS storage, production build, M2 owner/reopen/offline and M3 catalog/scan/offline
checks pass. The full M1 output/sample suite also passes all ordinary and tracker
inputs after the change. Current evidence is `.local/libzci/m3-normalization-evidence.json`.

The audit also found that reference Opus facts flatten tags across chained
links. Per-link normalization therefore still needs source-timeline boundaries
and rendering support; this slice does not establish optional normalization for
chained Opus. Raw/header-gain chain playback is preserved. This is the next
correction before M3 normalization is considered finished. Play-count accrual,
artwork/images, M4-M6 and A1/A2 adoption remain open.

The chained-Opus correction now carries bounded per-link normalization facts
with source-frame boundaries. Shared control resolves them into a revisioned
program; progress selects the displayed gain from actual consumption rather
than decoder read-ahead. The program is transient and is not copied into every
browser observation or stored in SQL. Catalog summaries keep the first audible
link's normalization facts instead of rejecting flattened repeated R128 tags.

Shared rendering splits blocks at the exact rational source/output frame
boundaries and keeps five-millisecond ramps continuous across pieces. Seek
primes the gain at its actual landed source position. Native output publishes
programs through three fixed ownership-transfer slots, retains/retries the
latest authoritative program under backpressure, and holds output until that
program can be published. Callbacks only select/process/recycle; they do not
lock, allocate or free schedules. The worklet stages/validates/commits bounded
programs into preallocated WASM storage, with generation checks for stale input.
Both retain at most 1,024 gain points. The native fixed schedule slots add about
48 KiB of declared retained storage; the worklet adds current/staged schedules.

Native sample-level checks pass for mixed mono/stereo chains with distinct
R128 tags, gain changes inside output blocks, seek into a later link, raw/master
separation and fixed-master processed renders. The real native output worker
matches processed renders exactly under read-ahead, tiny pools and partial
output at 48 kHz and 44.1 kHz. Callback allocation/deallocation remains zero,
including schedule activation. Shared core checks cover canonical frame mapping,
processing-chunk independence, validation, revision and audible-position rules.
All six import-free audio-WASM ABI tests pass, including scheduled gains inside
resampled blocks and stale-publication refusal. Actual muted Chromium signal
checks pass across the earlier formats plus a chained file: scoped probe tags,
first-link catalog facts, the audible link boundary and seek after a settings
change. The measured 1 dB link ratio was 1.12251 (expected 1.12202); the -3 dB
seek ratio was 0.70748 (expected 0.70795), within the 1.5% test tolerance.
Core/native/bindings/audio-WASM/crude-native suites, the seven reference Opus
checks, metadata/lyrics, real OPFS storage, production build, M2 and M3
owner/offline checks and the full M1 output/sample suite pass after this wiring.

Startup master priming now honors volume/mute before the first actual media
frame on native and worklet output, instead of briefly ramping from unity.
Later changes remain anchored/smoothed, including after seek/source replacement.
Native callback tests and all seven import-free audio-WASM ABI tests pass;
actual muted browser normalization levels, chained boundaries, seek, controls
and settings reopen also pass. Reference native render/output and zero-callback-
allocation checks pass. Gain parsing now examines the complete byte-bounded
comment block, so display-field limits cannot hide late gain tags or duplicate
R128 fields. Unit checks cover those late-field cases.

Play counts now qualify in the shared Session from actual output media frames,
independently of source position, decode read-ahead, underrun silence or wall
time. The output clock records media crossing the latency boundary, freezes
already credited partial spans when latency rises, and resets on generations.
Only current Library membership earns credit. Pause, seek, stop, repeat,
subsong changes, output suspension and eligibility changes reset continuity;
parameter-only generations preserve it at the same output rate. Settings expose
enablement and a 1–3,600 second continuous-play threshold (default 15 seconds).
Module plays update both whole-media and selected-subsong facts.

Shared ProfilePlayback coordinates settings, membership, qualified records and
SQL acknowledgements. Native captures a control observation before SQL and
releases the session lock; the browser owner worker invokes the same policy.
Both crudes and profile-bound CLI playback use it. Device-free renders remain
unbound and never count. SQL transactions atomically update facts, revisions,
sequence high-water marks and bounded retry receipts. Exact repeated delivery
does not double count; changed/stale sequences and old connection bindings are
refused. Removal preserves facts; removed members and images cannot increment.
The session retains at most 64 pending qualifications, with explicit skipped
counts if a sustained persistence outage exhausts that budget. This is bounded
retry behavior, not a claim of lossless counting across process loss or unlimited
storage outages. Continuity and pending records remain transient.

Windows MSVC core/native/control/audio/crude/CLI suites pass (55 core tests,
four real SQLite count/coordinator tests, and existing transport/storage/output
checks). Fault injection covers fact/receipt/high-water/profile writes and
COMMIT, preserving all prior facts and revisions. Real native Opus output and
chained normalization workers retain exact samples and count once at 48/44.1 kHz
through tiny pools; callback allocations/deallocations remain zero. The test
output mechanism explicitly reports Running, as the real device adapter does.
Control/audio WASM rebuilt; TypeScript and all seven audio ABI checks pass.
`npm run test:play-counts` passes in muted headless Chromium on actual OPFS SQL:
consumed audio, pause/reset, seek, disabled settings, count/date reopen, queue-only
exclusion and a count committed while the document debugger is paused. Evidence
is `.local/libzci/m3-play-counts-evidence.json`. Normalization signal checks and
production M2/M3 ownership, capability, catalog, scan, reopen and offline checks
also pass after the wiring. Artwork/images, M4-M6 and A1/A2 remain open.

The next M3 slice adds transient encoded artwork extraction over a common
ranged ID3/FLAC/Ogg walker. Lyrics retain their selection policy and tests;
container framing, range/length limits, unsynchronization, continuation and CRC
checks now have one owner. Artwork reads PIC/APIC, FLAC PICTURE and base64
METADATA_BLOCK_PICTURE, prefers a front cover to the first fallback, skips linked
resources without fetching them, and derives MIME from raster content. Payloads
are bounded to 16 MiB, total candidate reads to 32 MiB and metadata scanning to
64 MiB. Explicit native/WASM jobs own their encoded bytes and cancellation;
the browser catalog allows four concurrent artwork jobs. No encoded originals
enter queue/catalog records or playback observations. This implements extraction,
not yet image decoding, renditions, cache eviction or image-session navigation.

Reference Opus now distinguishes aggregate container tags (24 MiB including
vendor/framing) from routine text facts (64 KiB). Shared Rust admits text and
skips embedded payloads before allocating strings. This fixes audio open failure
for ordinary embedded covers larger than the former aggregate 64 KiB limit.
The C bridge bounds raw framing separately; optional WebCodecs accepts the same
bounded large header while retaining the smaller audio-packet budget. Tag
length/count checks reject overflow and excessive expansion. Native/browser
reference provider revisions are aligned at r5.

Windows MSVC core/native/control/audio/crude/CLI suites pass (57 core checks,
three artwork framing/budget suites and two native artwork-job/provider checks).
Native real MP3/FLAC/Vorbis/Opus extraction returns the exact generated PNG and
lyrics, and device-free rendering still completes with finite output and no
embedded payload facts. The seven reference Opus and callback allocation checks
also pass. Rebuilt control/audio WASM and reference C codec; TypeScript, all seven
audio ABI tests, `npm run test:artwork`, metadata/lyrics and production M3 checks
pass in muted Chromium. Browser artwork evidence includes exact 153,161-byte
PNG extraction, actual 256×256 bitmap decoding, output-free inspection, catalog
payload exclusion and reference/optional WebCodecs playback, seek and EOF with
the large cover. Inputs/FFmpeg 8.1.1 recipe and evidence remain ignored under
`.local/libzci/media/m3/artwork-*` and `.local/libzci/m3-artwork-evidence.json`.
Format references: [ID3 APIC](https://id3.org/id3v2.4.0-frames#Attached_picture)
and [FLAC PICTURE](https://www.rfc-editor.org/rfc/rfc9639.html#section-8.8).

The following image-provider primitive implements shared PNG/JPEG/WebP header
inspection and PNG renditions with pinned `image` 0.25.10 (only those codecs)
and `moxcms` 0.8.1. Source reads remain ranged at 32 KiB and preserve cancellation
and typed access failures. Limits are 64 MiB encoded source, 16,777,216 pixels,
32,768 per dimension, 128 MiB declared decoded storage, 1 MiB ICC input and
8 MiB encoded rendition. The decoder allocator's own limit is best effort;
explicit dimension/total-byte checks precede pixel allocation. These are input/
retention limits, not measured total-process or physical-device memory claims.

Bounded facts include encoded/display dimensions, orientation, bit depth, alpha,
and ICC size/hash; raw ICC bytes remain transient. Renditions apply all eight
EXIF orientations, convert supported RGB/grayscale ICC profiles to sRGB, avoid
upscaling, and resize with premultiplied alpha to prevent transparent-color
halos. Unprofiled pixels currently use an sRGB assumption. Broader color-tag
handling and AVIF/JXL/platform providers are still pending, along with bindings,
catalog scan integration, caches, image-session navigation and both crude UIs.
This primitive does not close M3's image acceptance gate.

Six native integration suites pass for exact orientation/pixels and removal of
the orientation tag from renditions, aspect/alpha/edge behavior, sRGB ICC identity
and bounded profile facts, PNG/JPEG/WebP, short ranged reads, access/cancel/source
limits, source revision changes and a forged oversized PNG. Control/audio WASM cross-compiles with the
new dependencies; browser pixel-runtime checks are not yet implemented here.

Shared visual job requests now expose inspection, image renditions and embedded
artwork renditions through native worker jobs and an explicit WASM result
object. Browser workers transfer the bounded PNG, then free their WASM result;
native surfaces receive oriented RGBA8 directly from the same rendition instead
of adding a shell decoder. A result can retain up to 8 MiB PNG plus 16 MiB RGBA8
at the maximum 2,048-pixel edge; neither is a playback snapshot or user record.
The PWA catalog has four concurrent rendition jobs, cancellation during handle
resolution, an artwork-preview action and presentation-owned URL cleanup. The
native crude has current/file artwork and standalone image preview controls with
the same edge setting, worker cancellation and a presentation-owned texture.
Mutable native sources verify their opened length/mtime before/after finite
visual and embedded-metadata work; this does not add per-frame callback I/O.

Native visual jobs and the egui texture lifecycle pass: real image and four
embedded formats yield identical PNGs, inspection/rendering leave the music
session revision/generation/position unchanged, changed open files are refused,
and closing the preview releases its texture. The existing crude tests pass.
`npm run test:images` passes in muted headless Chromium using real worker/WASM
decode and canvas pixel checks: all EXIF orientations, alpha edges, header
budgets, cancellation, ICC-to-sRGB with the installed sRGB profile (SHA-256
`2b3aa1645779a9e634744faf9b01e9102b0c9b88fd6deced7934df86b949af7e`),
and artwork/image work while the real audio clock continues in one generation.
The catalog preview displays the rendition and releases its URL on close.
Evidence: `.local/libzci/m3-images-evidence.json`. Production M3 checks also
load artwork/rendition workers and their decoder assets on a cold offline launch
without creating an AudioContext. Catalog image import/scanning, captured
navigation, separate cache/eviction and broader format/color support remain open.

Image facts now participate in the shared catalog metadata contract. Native
managed scans and the reusable browser probe distinguish images by content,
without inventing an audio layout/provider or constructing output. Known-media
extension policy includes images, while genuinely unknown-extension verification
remains OpenMPT-only. PNG named `.wav` is cataloged as an image; audio named
`.jpg` is still audio. Embedded pixels/profiles do not enter the stored facts.
The shared queue transaction rejects catalog image identities atomically, and
native/browser file ingestion checks image headers before appending anything.

Native image scans pass with stable identities/favorites over rescan/reopen,
content-versus-extension cases, and both image queue guards. Muted Chromium
image checks pass for catalog facts/renditions, atomic queue rejection, real
OPFS image-folder scans, corrupt-file scan preservation, favorite/handle/facts
reopen and output-free rendition restoration. These extend the existing image
evidence file. Image-session navigation and the separate rendition cache remain
open; imports do not yet turn the ordinary Open action into image viewing.

Captured image navigation is now a separate shared-core session. A bounded SQL
projection captures up to 100,000 ordered image identities from the originating
query at one catalog revision, independent of visible page size/offset. It uses
the same filters, normalized ordering and ID tie breakers as catalog pages.
The transient session owns selection, optional wrap, reload and generations;
late results, closed sessions and other session identities cannot publish facts.
Reload/rendition-size changes invalidate old work without recapturing the list.
Neither sequence nor image-session state is persisted or routed through music.

Both crudes expose Library image viewing and navigation with rendition edge and
wrap controls. Jobs/surfaces are cancelled/released on navigation and close.
Browser cancellation has per-view scopes, so image-viewer activity does not
cancel a separate artwork request. Document-owned WASM objects also share one
initialization promise to prevent concurrent lyrics/image initialization from
replacing each other's WASM memory instance.

Core sequence/session and actual SQLite query checks pass, including a 650-image
catalog with filtering and a capture larger than its one-row visible page,
revision rejection, boundaries, wrapping, reload and stale/foreign results.
The native viewer test creates/replaces/releases its texture, retains the old
sequence after catalog additions and leaves music-session state unchanged.
Muted Chromium checks pass while actual audio continues: OPFS image navigation
survives new scan members and changed Library UI filters, wraps only on request,
discards rapid stale jobs, and releases its URL without cancelling independent
renditions. Existing metadata/lyrics and production M3 offline checks pass.
Separate rendition cache/eviction and broader visual format/color support remain
open before the M3 acceptance gate can close.

The next M3 slice adds shared revision/spec/pipeline cache identities, bounded
LRU admission/eviction and integrity-checked derived PNG restoration. Defaults
are 64 MiB / 256 entries; hard limits are 256 MiB / 4096 entries, with zero
budgets disabling admission. Restoring preserves original facts while decoding
already oriented sRGB PNGs without reapplying original EXIF/ICC. The worker
validates requested size, checksum, dimensions, decode limits and removed tags.

Native uses a separate `artwork-cache-v1.sqlite3` with atomic plan/PNG writes,
serialized worker access and bounded SQLite page allocation. Browser uses a
separate artwork-cache IndexedDB with atomic metadata/PNG Blob transactions;
shared WASM supplies the same plan. No payload enters catalog, queue or handle
records. Both paths resolve access and live source revisions before lookup and
verify them after work. Stale/unavailable sources fail, while cache corruption,
quota or write errors fall back to a usable fresh rendition. Caches can be
cleared/rebuilt independently of durable facts. The crudes use caching for image
viewing and artwork previews; native diagnostics expose hit/miss/failure counts.

Core/native cache tests pass: deterministic LRU and byte/count/disabled budgets,
identity separation, exact oriented pixel/fact restore, corruption/cancellation,
SQLite reopen with zero original reads on hit, concurrent admissions, changed
native files and injected cache-write rollback. The native tests include a small
checked-in deterministic PNG rather than requiring generated media. The complete
core/native/web/crude-native test suites pass (device tests remain ignored).

Muted Chromium image tests pass real IDB reopen, corrupt PNG repair, live source
replacement, concurrent byte/count eviction and clear. A worker-realm fault test
uses the actual BrowserCatalog/FSA/IDB path, denies queryPermission and injects
QuotaExceededError on PNG writes: cached access fails visibly and quota rollback
still returns a rendition without changing domain state. These are explicit
fault injections, not physical permission-revocation or disk-exhaustion evidence.
The production PWA build, seven import-free audio-WASM checks and M3 cold-offline
catalog/scan/playback checks pass. Broader visual format/color and the remaining
M3 acceptance checks are still open; A1/A2 adoption has not begun.

The following M3 format slice adds JPEG XL through the pinned JPEG XL Project
[`jxl` 0.8.0 decoder](https://github.com/libjxl/jxl-rs), without a browser-native
image-codec dependency. A focused ImageDecoder adapter disables the codec's
orientation transform and ignores EXIF orientation; shared rendering applies the
codestream orientation exactly once. It requests straight-alpha 8-bit preview
pixels, retains original sample-depth facts and converts the reported output
ICC to sRGB through the existing shared color path. Core source/pixel/output
limits and a codec sample limit apply; typed codec size/ICC failures map to
resource exhaustion. Catalog imports/scans and separate rendition caches use
the same path. Native image pickers now include JXL.

Native and muted Chromium checks pass a project-generated lossless RGBA fixture
and the pinned, BSD-licensed upstream `bench_oriented_brg` case (orientation 5,
nonstandard BRG ICC). At full size native output differs from the 8-bit PNG
reference by at most one code value; resized WASM output differs by at most two.
These are bounded 8-bit reference comparisons, not a claim of passing the full
floating-point conformance corpus. The fixture provenance, hashes and licenses
are checked in. Native scans persist JXL image facts alongside PNG/audio while
keeping images out of the queue; browser catalog JXL jobs reopen cached results.

The current JXL still-preview path uses the first frame, explicitly rejects
CMYK, and does not promise strict 128 MiB intermediate codec allocation. In
particular, the pinned decoder has a larger internal ICC decompression ceiling
before the existing 1 MiB returned-profile limit. Resource-budget hardening and
measurement remain required readiness work; no tighter bound is inferred from
small passing fixtures. AVIF and broader non-ICC/HDR color handling remain open.
The control WASM grows from about 3.91 MB to 5.46 MB; the import-free audio WASM
is unchanged. The production build, audio-WASM checks and M3 cold-offline path
pass with the new local runtime asset.
`cargo test --locked --manifest-path libzci/Cargo.toml --workspace` also passes;
device-access smoke remains ignored. The provider-enabled native image-scan
test and the rebuilt WASM/Chromium image suite pass separately.

Ordinary image opening now uses a content-identified adapter route instead of
trying to append an image to the music queue. Native Open inspects a bounded
raster file into the shared catalog, captures an image-navigation sequence and
hands it to the independent viewer without creating an audio layout or output.
Browser Open classifies the selected bytes through the shared WASM classifier,
imports image files through the normal catalog probe/capability path and opens
the same captured viewer session; image-only batches never construct an
AudioContext. Mixed batches retain the playable queue path for audio, while
restorable image handles use the existing catalog capability lifecycle.

Verification: the native controller test opens a real PNG through its ordinary
path, confirms catalog facts and viewer capture, and reopens the image as an
image-only Library record with no queue occurrence or output. Muted Chromium
`npm run test:images` clicks the ordinary Open control with a real PNG and
asserts zero AudioContext construction, an Idle music session and an empty
queue before continuing through the existing JXL, rendition, navigation and
cache scenarios. TypeScript typechecking and the production build pass.
AVIF, broader non-ICC/HDR color handling, decoder resource hardening and the
remaining M3 acceptance work stay open.

The native decode-job audit also closed a rejected-open event bug. The worker
previously ignored `Session::opened`'s boolean and emitted `Completed` after a
provider returned successful frames but invalid normalization metadata caused
the session to reject the open. It now distinguishes stale tags from rejected
provider facts: stale work emits no terminal event, successful opens emit
`Completed`, and metadata rejection emits the authoritative `Failed` event with
the session's typed error. A transport regression uses a fake provider whose
normalization timeline does not start at frame zero and verifies the failed
state, one failure event and no spurious completion for the load request.

CLI profile synchronization is now advisory to playback rather than a `?` that
can cut audio mid-stream. `zci-play` retries qualified-play/settings sync on its
normal loop, reports distinct storage failures once, and keeps the session's
pending state available for a later retry. Shutdown still attempts both the
final sync and binding close, then reports a storage failure after normal
playback has finished instead of turning an in-flight media session into a
transport failure.

## 2026-10-23: M2 persistent queue and installed PWA


Baseline `b678df13` on `libzci-codex`, initially clean. User requested M2 end to
end and authorized builds and isolated runtime checks. Implementation milestones:
`ef2bb476` (shared queue/SQL and native profiles), `2c098558` (browser OPFS,
capability recovery, ownership and offline lifecycle), and `77f7a583` (failure,
concurrency and controlled-update verification/fixes). Existing izci stores, profiles,
grants, backends, APK/Tauri/server code and manually curated Askew text are untouched.

Implemented behavior:

- Shared Rust occurrence queue: duplicates with stable occurrence IDs, append,
  move/remove/play, next/previous, previous restart seconds, up-next, repeat and
  shuffle cycles with backward/forward history. Existing navigation outcomes
  inform single-item stepping, natural EOF, repeat and history regressions.
  Final natural consumption remains Ended when there is no next occurrence.
- Shared bound SQL owns schema/init, source references, ordered occurrences,
  session/navigation/resume options, playback settings and revision transactions.
  Native uses rusqlite 0.32.1 with bundled SQLite; browser uses official
  `@sqlite.org/sqlite-wasm` 3.54.1-build1 and `opfs-sahpool` in the engine worker.
  Initialization preserves data on failure; incompatible schemas are refused.
  Failed begin/write/commit never publishes a new durable revision. Position
  and setting changes avoid rewriting unchanged queue/source rows.
- Native GUI locks `.local/libzci/profiles/crude-native/` before opening SQL or
  output, supports an explicit `--profile DIR`, restores paused, and preserves
  missing references/resume position. The CLI remains transient by default;
  `--profile DIR` appends the given path and reopens settings, including mute.
  Both use the same core queue and storage API; no consumer domain SQL.
- Browser profile lock encloses the only engine/SQL/decoder/output owner.
  Attached windows create no player worker. Revisioned full snapshots are
  acknowledged/coalesced; requests/results are bounded and deduplicated. Durable
  SHA-256 request receipts survive re-election, reject payload reuse and expire
  visibly rather than replaying evicted mutations. Re-election restores paused.
- Genuine FSA picker handles live in separate profile-scoped IDB. Pending → SQL
  commit → completion and startup orphan recovery survive either crash boundary;
  concurrent staged imports are protected. Startup queries permission without
  prompting; explicit Grant access retries it. Plain Files remain explicitly
  non-restorable; media bytes never enter domain storage.
- Independent manifest/icons/SW/API+asset identity. A post-HTML Vite inventory
  covers 15 runtime/public assets in this build, including all five WASM payloads
  and nested SQL/decode workers. Precache checks local responses and exact sizes.
  Updates identify a genuinely different waiting version, require explicit
  restart, retain old documents' coherent assets and preserve candidate caches
  during install/wait. Obsolete caches are reclaimed after client version reports.
  Media Session play/pause/stop/seek/next/previous dispatch the same commands.

Bounds: 10,000 occurrences/sources/up-next entries, 8 MiB source-reference text,
1,024 entries per history direction, 16 attached clients, 32 pending/in-flight
requests, 64 in-memory results and 128 durable receipts. Browser command JSON is
capped at 16 MiB. Position checkpoints every two seconds; orderly native close
and browser pause/stop/seek also save state. Abrupt owner loss can lose the last
checkpoint interval; it never causes autoplay or a permission prompt.

Windows x64 MSVC / Chromium evidence (synthetic R3/M1 corpus; muted output):

- `cargo test --locked --manifest-path libzci/Cargo.toml --workspace --features
  libzci-native/provider-tests`: passes. Five new native profile/navigation
  tests cover reopen, identity/order/settings, lock exclusion, rollback,
  schema preservation, durable receipt bounds/expiry and shuffle history.
  The native crude's two tests include real controller paused resume and a
  disappeared source without resetting saved state.
- Native and wasm32 Clippy with warnings denied, Rust formatting, TypeScript
  checking, audio-only WASM import/pool/clock tests and native/WASM/PWA builds pass.
- `crude-native --headless-test .local/libzci/media/m1/tone.hvl`: hidden native
  eframe window with real muted CPAL transport, pause/seek/module/probe/teardown.
- `python libzci/tests/check-m2-cli.py`: actual process-level transient default,
  explicit profile reopen, duplicate occurrences, saved volume and silent render
  from saved mute. Evidence: `.local/libzci/m2-cli-evidence.json`.
- `test:storage`: one setting committed/reopened by real OPFS SQLite through
  Rust; duplicate queue rows; injected busy/write/commit faults; real SQLite
  page-quota exhaustion; preserved rows on schema refusal; durable retry receipt.
  A SQLite page quota is not a claim of exhausting physical browser disk quota.
- `test:m2`: real OPFS SQLite + worklet output, attached command execution with
  exactly one Web Lock and zero attached player workers, owner loss/re-election,
  duplicate delivery across reopen, pending/orphan recovery with genuine OPFS
  handles, up-next advancement at final consumption, cold offline launch of all
  assets, plain File restore status, SQL initialization failure/recovery and
  simultaneous staged-handle import/plain File append/removal without losing
  capabilities or the live File registry.
- `test:installed`: temporary persistent Chromium profile, actual CDP PWA
  install, standalone launch offline, paused queue/handle restore, local media
  consumption, then uninstall. Headless and offscreen headed runs both work.
- `test:update`: failed precache preserves old output/cache; a complete candidate
  waits during playback; explicit activation/reload preserves queue/grants paused;
  old assets remain until the last old document closes.
- Existing M1 ordinary/module output and sample comparisons, optional WebCodecs
  reference comparisons and R4 long transport/output regressions are retained.
  R4's network-failure test uses an isolated SW-blocked context so production
  offline caching cannot mask the deliberately aborted codec request.

Browser evidence files are `.local/libzci/m2-{browser,storage,installed,update}-evidence.json`.
Recipes and controls are documented in the consumer READMEs. Tests run sequentially
on port 5197 and close their servers/browsers; outputs remain ignored.

Acceptance limits remain explicit: genuine OPFS handles prove IDB capability
serialization/recovery, not external picker denial/regrant. External FSA grant
interaction, OS Media Session actions/interruption, actual hidden-document or
screen-off continuity and physical Android are pending. Both minimized/headless
and offscreen headed observations still reported `visible` (about 144,000 frames
consumed in three seconds), so they do not count as hidden output evidence.
`adb devices` had no connected target. GNU/Linux and APK integration are not
inferred. M2 implementation is present; these physical/lifecycle checks keep its
full acceptance open independently of the verified Windows/offline behavior.

## 2026-10-23: M1 validation and cleanup

Baseline `1de4e2e6` on `libzci-codex`, initially clean. User authorized review,
fixes, builds and headless/emulator tests. No library/profile/grant changes.
This pass covers R1-R4 and M1; it adds no M2 domain/storage behavior.

Review fixes (each reproduced by a failing regression before correction):

- Worklet ABI discarded the descriptor's source rate and reconstructed every
  block as 48 kHz. A 44.1 kHz source reported 128 instead of 117 frames after
  one output quantum; high-rate sources could also end short. Pass the actual
  source rate into the shared renderer; test each quantum and final drain at
  44.1/96/192 kHz and actual browser output at 96/192 kHz.
- A FLAC STREAMINFO with an unspecified sample count was accepted but browser
  seek clamped every target to zero. Preserve null duration and seek to the
  requested frame when no finite total is known. A new CC0 FLAC variant proves
  native/browser exact suffixes, a 24,000-frame seek, and final consumption.
- Provider selection treated the first short source read as the complete
  header. Fill the bounded probe prefix through partial reads until EOF or the
  byte budget; a two-byte-at-a-time source now selects the same provider.
- Cancelling an export with a blocked sink still wrote all eight queued chunks
  after cancellation. Queued continuations now check job completion before
  touching the sink. The blocked-sink regression now observes one write.

Validation cleanup:

- Main Vitest discovery now stays inside the main application's source/test
  trees. It previously collected libzci's Node test and downloaded Emscripten's
  tests, producing false failures. Windows path assertions normalize paths;
  architecture checks cache parsed imports instead of repeatedly timing out.
- The formerly skipped corpus integration now runs on Windows with separately
  pinned Gyan FFmpeg/FFprobe 8.1.1 versions, byte counts and SHA-256 values.
  Both complete generations match and pass the existing media-fact checks.
  Ubuntu 6.1.1 pins remain separate; neither toolchain check was weakened.
- `libzci-codecs --no-default-features` previously linked unrequested Opus and
  failed on `opus.lib`. Gate raw FFI, examples and integration tests on their
  actual features. Codec-free and module-only checks now pass independently.
- OpenMPT allocated-string helpers now require unsafe callers and document
  ownership correctly. Remove an unenforced instance-budget field and an
  unnecessary leaked static string. Name render stepping `next_step` and Opus
  packet reads `next_packet`. Native and WASM Clippy both pass with warnings
  denied; workspace formatting and Rust documentation also pass.
- Browser launches mute host audio. Explicit hardware transport/CLI tests use
  silent master output; native GUI validation stays in hidden eframe windows.
- Add the repeatable `test:android` runner using the dedicated headless AVD,
  Android Chrome, ADB reverse and host-supplied File bytes. It closes its Chrome
  context/server/forward afterward and preserves the APK's profile and grants.

Results (Windows x64 MSVC; Rust/Cargo 1.98.1; FFmpeg 8.1.1; Chromium 149;
Android 16/API 36 `izci_android16`, Google APIs x86_64, Chrome 133):

| Check | Result |
| --- | --- |
| Main `npm test -- --maxWorkers=4 --reporter=dot` | 221 files, **1,339 passed, zero failed/skipped** |
| `npm run check` | Zero errors/warnings |
| Windows fixture integration | Five passed, including two complete deterministic generations |
| Rust workspace + `libzci-native/provider-tests` | **91 passed**, zero failed; two opt-in hardware tests run separately and both passed silently |
| Native/WASM `cargo clippy ... -- -D warnings`, `cargo fmt --check`, `cargo doc --no-deps` | Passed |
| Codec-free / module-only feature tests; minimal CLI check | Passed |
| Audio-only WASM Node tests | Three passed, including source-rate ABI regression |
| PWA `typecheck`, WASM builds, production build | Passed |
| PWA `test:m1` | **46 scenarios passed**, 18 every-sample comparisons |
| PWA `test:webcodecs`, `test:callbacks`, `test:browser` | **8 / 15 / 5 scenarios passed**, including 30-second production drain/starvation/suspension |
| `test:android` | **44 scenarios passed**: 21 transports/probes, unknown-duration seek/drain, 22 every-sample comparisons |
| Hidden native release GUI | HVL, MOD, 192 kHz WAV and unknown-duration FLAC transport/control/probe/disposal passed |
| Release CLI process checks | Eight passed, including silent playback interruption and render cancellation |
| Android Kotlin `testDebugUnitTest --rerun-tasks` | Six passed, zero failed/skipped; all 27 Gradle tasks executed |
| Android CDP/transport Node tests | Five passed |
| Main PWA production build | Passed, 166 precache entries; existing chunk-size warning remains |
| Native release CLI/crude builds | Passed |

Maximum native/browser sample error on desktop and Android: **1.4901161e-7**,
against **3e-5** acceptance. Recycling high-water remains **8**. The seven module
families match native samples exactly. Added media remains ignored and records
recipe/tool/file hashes in M1 provenance; no third-party music was added.

Milestones: `4a4ef6ce` test isolation/Windows fixtures; `dee99a66` runtime/source/job
fixes; `bbf6b1a6` codec feature gates and API/lint cleanup. Evidence is in ignored
`.local/libzci/review-*.log`, `review-android-evidence.json`,
`m1-browser-evidence.json`, `m1-webcodecs-evidence.json`, and
`r4-{callback,browser}-evidence.json`. Reproduction commands are in the workspace
and crude-PWA READMEs. The dedicated emulator is stopped after validation.

Limits remain explicit: emulator Chrome is not physical-device, installed-PWA,
screen-off/background or OEM SAF acceptance. Optional WebCodecs is verified on
desktop Chromium; Android coverage uses the reference path. Libzci is not yet
adopted by the separate APK. Linux recovery remains unverified. No installed/
offline-libzci behavior is claimed before M2; the ordinary izci PWA build does
not establish that later milestone. Existing packaged M1 artifact manifests
remain historical; current review builds live in the usual ignored outputs.

## M1: file players, modules and both crudes

2026-10-19, Windows x64 MSVC and headless Chromium. User authorized builds and
headless tests; profile: none. Initial checkout was clean. Status: **verified
for these targets/checks**, with physical/background and other-platform limits
below. The existing izci shells, assets, profiles and grants were preserved.

Implementation milestones:

- `879e6bd8`: ordinary audio provider, module controls/observations, independent
  probe jobs, generated audible fixtures and the native crude.
- `cecdf19e`: ordinary/module browser providers, shared Session integration,
  independent jobs and optional WebCodecs Opus.
- `b2850425`: hidden native transport validation, audible module controls,
  source/cancellation checks, exact EOF anchoring and final codec limits.

Symphonia **0.5.5**, with only WAV/PCM, MP3, FLAC, Ogg and Vorbis features,
implements one native/WASM provider over bounded source reads. Opus retains
the pinned reference path. Selection/classification remains core/provider-owned;
neither crude nor the CLI chooses a media family. Unknown-extension verification
defaults off and affects only independent inspection; enabled verification can
open the module provider without constructing output.

Pinned OpenMPT **0.8.4** and Hively **f393ca7** now build reproducibly for MSVC
(`/MD`) and Emscripten **4.0.10**, with input digest checks and build records.
Native Hively initialization uses Rust `Once`; browser module instances have
separate heaps and immutable initialized tables. Hively duration/seek work is
stepped and cancellable. Both providers expose subsongs, interpolation, channel
mutes, metadata and bounded transient patterns. OpenMPT also exposes ramping,
speed/pitch and finite repeat limits. Unsupported Hively controls are disabled
with an explanation. Allocated OpenMPT strings are copied/freed.

Both crudes issue public operations for transport, volume/mute, module controls,
inspection and separate raw rendering. The native crude uses eframe/egui
**0.32.3**; no JS/webview/WASM interpreter is linked. Browser render export writes
bounded chunks to a user-selected FSA destination when available. Probe jobs
construct no AudioContext. Stop/dispose/cancel remain independent of PCM credits.
The worklet acknowledges the provider's actual landed frame before new PCM,
including empty EOF seeks; earlier unanchored reports cannot replace that frame.

Optional WebCodecs Opus is off by default, only for proved single-link family-0
mono/stereo configurations. Shared Rust Ogg CRC/lacing/header and TOC-duration
policy feed the platform decoder; Rust applies pre-skip, seek discard, mandatory
header gain and end trim once. Restart/discard seeks match the sequential native
reference suffix exactly. The optimized opusfile seek can have a short preroll
transient, so it is not the golden for restart/discard. Chained content and
unavailable AudioDecoder configurations fall back to reference. Pending platform
decodes can be interrupted before their callback returns.

Validation (Rust/Cargo **1.98.1**, wasm-bindgen **0.2.129**, MSVC **19.44.35229**,
FFmpeg **8.1.1**, Playwright **1.61.1** / Chromium **149.0.7827.55**):

- `python libzci/scripts/build-module-deps.py`,
  `python libzci/scripts/build-browser-codecs.py`,
  `python libzci/scripts/build-browser-modules.py`, and
  `python libzci/consumers/crude-pwa/scripts/build-wasm.py`: **passed**. All
  generated output remains isolated/ignored; ordinary izci WASM was untouched.
- `python libzci/tests/generate-m1-media.py`: **15 generated CC0 inputs**,
  exact recipe/tool binary/file hashes in `.local/libzci/media/m1/provenance.json`.
  Mono 44.1 kHz and stereo 48 kHz ordinary formats; audible MOD/XM/S3M/IT/MO3
  PCM-sample modules and synthesized AHX/HVL instruments. No external music.
- `cargo test --locked --manifest-path libzci/Cargo.toml --workspace
  --features libzci-native/provider-tests`: **89 passed, 0 failed, 2 explicit
  hardware opt-in tests ignored**. Includes exact seek/rewind/EOF, bounded reads,
  revoked source access, replacement cancellation tokens, two contexts, audible
  channel mutes/interpolation, speed/repeat lengths and independent probe/render.
- `cargo build --locked --manifest-path libzci/Cargo.toml -p zci-play
  -p crude-native --release`: **passed**. CLI modules are enabled by default;
  `--no-default-features` retains the lighter ordinary/reference-only build.
- `crude-native.exe --headless-test <fixture>` on HVL, MOD and 44.1 kHz FLAC:
  **passed** using a real hidden eframe window and muted CPAL output. Tests
  play/pause/seek, available module control, independent probe, stop and dispose.
  The separate egui test draws the actual UI and runs independent jobs without
  creating a window/device. PE dependency inspection confirms no JS/webview/WASM
  runtime in either native executable.
- PWA `typecheck`, production `build` and audio-only WASM tests: **passed**.
  Import-free output WASM keeps its fixed heap under long marked input.
- PWA `test:m1`: **39 scenarios passed**, including real File/worklet transport
  across all 15 inputs, module controls, independent jobs, unknown verification,
  cancellation, live ordinary-source loss and every-sample native comparison.
  All seven module outputs match exactly. Ordinary-audio maximum sample error:
  **1.49e-7**; acceptance tolerance **3e-5**. Recycling high-water stays at **8**.
- PWA `test:webcodecs`: **8 scenarios passed**, including actual optional
  worklet output, rapid seeks/stop/EOF, five sample/timeline comparisons, chained
  fallback and AudioDecoder disabled **inside the decode worker**. Optional PCM
  matches the sequential reference exactly on the proved fixtures.
- PWA `test:callbacks` and `test:browser`: **passed** after M1 integration.
  Existing long reference output, starvation, delayed recycling, cancellation,
  rate-conversion tails, suspension, rapid seeks, source loss, missing codec
  assets, a stalled document and final consumption remain covered.

Raw evidence: `.local/libzci/m1-workspace-tests.log`, `m1-browser-evidence.json`,
`m1-webcodecs-evidence.json`, `m1-production-regression.log`,
`m1-reference-regression.log`, `m1-native-hidden.log`, native dependency reports
and the acquisition/build logs. Packaged outputs and SHA-256 values are in
`artifacts/libzci/m1-artifacts.json`: `zci-play.exe`, `crude-native.exe` and
`crude-pwa.zip`, with dependency notices.

Limits: ordinary audio is mono/stereo, 8–192 kHz; modules are capped at 64 MiB.
OpenMPT source duration must be finite and under 12 hours, repeats 0–16; Hively
scan limit is 30 minutes and unsupported controls remain named. The MO3 fixture
proves its uncompressed PCM-sample path, not every compressed-sample variant.
Linux recipes are retained but unverified. New-format hardware listening,
physical Android and R4's true background/screen-off checks remain pending.
No SQLite/profile, installation, service worker or offline-launch behavior is
claimed before M2.

## Recovery R4: reference browser player — implemented; checks pending

2026-10-19, Windows x64. Baseline `3b5fc39b`; initial dirty files: none.
Builds and headless tests explicitly authorized. Profile: none.

Reference libopusfile 0.12 / libopus 1.5.2 / libogg 1.3.5 use the existing
source digests with Emscripten 4.0.10 (emsdk tag commit
`62a853cd3b3134398ce85cde8bb5cbb2ef0194cb`). Bounded FileReaderSync C callbacks
use Asyncify task yields for cancellation during open/seek scans. The engine
worker drives the same Rust Session as native; separate import-free audio WASM
uses shared processing/clock code. Eight transferable PCM blocks (262,144 bytes)
travel directly from decoder to worklet, with recycle credits and explicit
consumer generation acknowledgment. No PCM traverses the document.

Implementation milestone: `5caa0a7c` ("Play reference Opus through shared Rust
browser transport and worklet"); followed by the browser verification/recovery
commit in this session. Public seek seconds are converted in Rust. The C wrapper
matches native's explicit seek-to-trimmed-EOF behavior. Decoder jobs use a
MessageChannel task yield rather than timers, preserving cancellation delivery
without depending on background timer budgets. Missing codec assets and live
File access loss resolve Loading/Playing as typed failures.

Toolchain: Rust 1.98.1 / Cargo 1.98.1, wasm-bindgen-cli 0.2.129, Emscripten
4.0.10, Python 3.13, Node 24.16.0, Playwright 1.61.1,
Chromium 149.0.7827.55 headless, Windows x64. Profile: none.

Validation (passed unless explicitly noted):

- `python libzci/scripts/build-browser-codecs.py`: digest-verified pinned static
  libraries and reference browser module; separate ignored target outputs.
- `python libzci/consumers/crude-pwa/scripts/build-wasm.py`: separate release
  Rust control and audio-only builds, locked dependencies and matching CLI.
- `cargo test --locked --manifest-path libzci/Cargo.toml --workspace
  --features libzci-native/provider-tests`: **70 passed, 0 failed**, two explicit
  hardware tests ignored. Native output/transport and reference provider tests
  remain working. No new native hardware/listening claim.
- `npm run typecheck`, `npm test`, `npm run build` in the crude: passed. Two raw
  WASM tests establish no JS imports/control/catalog exports and exact marked
  samples over more than twelve pool capacities, variable/full/empty schedules,
  final tail/latency drain, pause/starvation/reset, and unchanged heap length.
- `python libzci/tests/generate-r4-media.py`: native CLI reference renders,
  including each tested seek, derived from R3's CC0 inputs. R4 provenance records
  native executable/media hashes, -6 dB header-gain and distinct-serial mixed
  chains, a 1,000-link scan source and corrupt/truncated/channel-map cases.
- `npm run test:callbacks`: **15 real-browser cases**. Mono/stereo/long/gain/chain
  PCM and seek tails match native sample by sample; maximum absolute error
  **7.450580596923828e-8** (asserted tolerance 3e-5). Seek comparison uses native
  seek renders rather than slices, preserving Opus preroll semantics. The full
  long source produces **1,440,006 frames in 1,501 blocks** under delayed recycle,
  with eight outstanding buffers maximum. 44.1 kHz conversion drains **55,131**
  frames for the short source. Independent workers remain isolated. A posted
  replacement/seek during a real 1,000-link C scan lands at frame 2,400 and closes
  in **12.6 ms** on the recorded run; corrupt inputs fail explicitly.
- `npm run test:browser`: **five production-bundle scenarios** with AudioDecoder
  removed and normal user activation (no autoplay override). Real File/worklet
  playback covers pause, rapid seeks, Stop, volume/mute, suspension/resume,
  full-pool disposal/reopen, mono trim, corrupt/recover, File snapshot invalidation
  and missing codec WASM. A CDP-paused production decoder drains to Pending
  silence without EOF/media-time advance and recovers after resume. A 750 ms
  stalled document leaves audio progression independent. The full long run
  consumes **1,440,006 frames exactly**, ends at the same source position and
  has output energy **26577.508522098527** vs native **26577.508491770233**;
  peak agrees at **0.15791523456573486**.

Bounds observed: C heap **33,554,432 bytes**, audio-only WASM heap **1,572,864
bytes**, transferable pool **262,144 bytes** (plus the worklet's fixed Rust pool),
48 kHz preparation/scratch **98,304 bytes**; largest actual File read **2,048
bytes**, below the hard 32 KiB callback bound. All active/pending PCM queues and
UI/worker telemetry have fixed credits or one-in-flight acknowledgment.

Limits / acceptance still open:

- Headless tab switching (including disabling focus emulation/background timer
  overrides) kept `document.visibilityState` **visible**. This is not actual
  hidden-tab/background evidence. Hidden desktop tabs and physical screen-off
  playback/OS control exposure require a real-device check; none is claimed.
- No physical Android Chrome device was available in this session. Hardware
  listening and physical Android/screen-off remain unverified. Media Session
  actions/position are wired; an anchor prototype awaits demonstrated need.
- GNU/Linux build/run recovery was not re-run. Installed/offline launch belongs
  to M2 and is not claimed. Optional WebCodecs and additional formats remain M1.

R4 is **implemented; checks pending**, not fully verified. Ordinary izci assets,
profiles, databases and grants were preserved. All temporary test servers and
browser profiles were closed. Local raw evidence: `.local/libzci/r4-regressions.log`,
`r4-browser.log`, `r4-callbacks.log`, `r4-browser-evidence.json`,
`r4-callback-evidence.json`, and `media/r4/provenance.json`. Reproduction commands
are in the crude README.

## Recovery R1: bounded, lossless output — verified

2026-10-18. Baseline `8c6dfe0a111b250619b8938fdfcdae62ee9d5772`,
branch `libzci-codex` tracking `origin/libzci-codex`; dirty files: none.
Available toolchain: project-local Rust `1.98.1 (48a229cea 2026-09-01)`,
Cargo `1.98.1 (797e8a9bc 2026-08-05)`, `x86_64-pc-windows-msvc`.
Profile: none. No product build, device, browser, or ordinary-player launch.

- Replaced the mutable-Vec ring with native `rtrb = "=0.4.0"` ready/recycle
  queues carrying indices into a fixed 256-frame stereo block pool. Unique
  endpoint ownership and queue handoffs guard private UnsafeCell slots.
- Added shared generation/source-range/rate/layout/valid-length descriptors and
  bounded preparation with short-write suffix retention, decode credits,
  distinct source EOF, converter drain, and consumer completion observations.
- Fixed converter delay/tail loss, including block-aligned EOF; output has
  ceil(input frames * output rate / input rate) frames after delay removal.
  Input, FIFO, scratch, and pending storage are bounded independently of duration.
- Native output now uses this path, applies shared master smoothing at callback
  consumption, and acknowledges generations from the consumer. Reset cannot
  rewrite a read cursor; stop/dispose bypass full PCM queues. Existing session
  command authority, clocks, provider Pending, and job locking remain R2 work.
- Pure native tests no longer pull C codecs: real-provider suites require
  `--features provider-tests`; the device unit smoke is explicitly ignored.
  A pre-existing Unix-only `File::read_at` call blocked Windows tests; Windows
  now uses its positional `seek_read` counterpart, retaining bounded reads.
- Initial checks: core 29 unit + 5 output-pipeline tests, native 9 unit + 5
  output-pipeline tests passed; one device test intentionally ignored. Coverage
  includes 50,003 numbered frames, zero/partial writes, extreme conversion
  ratios, final impulses, fixed capacity, reset during pop, full/held queues,
  20,000 concurrent marked blocks, 2,000 generation changes, and actual worker
  stop/session disposal without consumer progress. No sleep-based assertions.
- Selected upstream rtrb 0.4.0 suites `lib` and `write_and_read`: 12 passed,
  including parallel handoff and drop tests, in an ignored `.local/libzci/` copy.
  Miri/sanitizers are unavailable in the installed stable Windows toolchain;
  this is concurrency-test evidence, not a dynamic soundness proof.

Implementation milestone: `f0ecbd2e` ("Make libzci PCM output bounded and lossless
under backpressure"). Follow-up commit "Verify libzci output allocation budgets
and worker continuity" adds allocator instrumentation and final acceptance checks.

Final evidence (same target/toolchain, profile none):

- `cargo test --manifest-path libzci/Cargo.toml -p libzci -p libzci-native`:
  **55 passed, 0 failed, 1 ignored** (the explicitly gated device unit test).
  Includes all existing device-free native pipeline tests and doc tests. The
  production worker exactly matches independent session renders at 48,000,
  44,100, and 96,000 Hz through a two-slot pool under variable sink consumption.
- `cargo test --manifest-path libzci/Cargo.toml -p libzci-native
  --test output_allocations -- --nocapture`: **2 passed**. Thread-local system
  allocator instrumentation includes pool, descriptors, queues, preparation,
  converter staging/tail/output, and private FFT plans/workspace. Sources and
  sinks use fixed stack scratch. For 10,003 versus 100,003 input frames:

  | Output rate | Peak heap bytes | Setup allocations (both lengths) |
  | --- | ---: | ---: |
  | 48,000 Hz | 9,216 | 9 |
  | 44,100 Hz | 180,610 | 51 |
  | 96,000 Hz | 256,426 | 43 |

  Both lengths have identical peak bytes and allocation counts; every tracked
  allocation is released on teardown. Callback render, partial-block handling,
  master updates, stale recycling, underrun, and stop perform **zero allocations
  and zero deallocations**. These are allocator-requested heap bytes, not RSS or
  provider/device allocations; production additionally owns its fixed 4,096-sample
  decode scratch and a bounded session decoder chunk. Other pool/block/rate
  configurations have their own fixed budgets, rather than these exact numbers.
- `cargo test --manifest-path .local/libzci/rtrb-0.4.0-checks/Cargo.toml
  --test lib --test write_and_read`: **12 passed** against an unmodified ignored
  copy of the pinned crate. No dependency code was added to browser mechanisms.
- Scoped `rustfmt --check` and `git diff --check`: passed.
- Additional, non-gating web host-test attempt using `-p libzci-web`: 3 passed,
  6 failed before media operations because `tone.opus` is absent from the existing
  `.local/verification-fixtures/v1` corpus. No fixture generation was performed.
  This does not establish browser runtime/WASM/reference-codec behavior.
- Clippy was attempted but unavailable: the installed toolchain has Rustfmt but
  no Clippy component. Miri/sanitizers, real C providers, product builds, devices,
  browser inspection and installed-PWA checks were not run. R1's acceptance is
  device-free; the corresponding R2-R4 integration checks remain open.

## Recovery R2/R3: transport and native reference implementation

2026-10-18. Baseline `a551ea92f9617a801914ed0b77ff2aff6fc2a557`,
branch `libzci-codex`; initial dirty files: none. Builds authorized by the user.
First implementation milestone; final acceptance/target audit follows separately.

- Core Session is a control-only action machine with explicit source/options,
  seconds-based time, volume/mute/module controls and instance/operation/generation
  tags. Native sequential decoder workers perform open/seek/decode outside control
  and map locks. Cancellation bypasses capacity and held codec work.
- Native output and incremental render jobs use the same commands and bounded R1
  preparation. The callback maps consumption spans to source time, including
  underrun silence, generation changes and device latency. EOF is separate from
  final consumption. No runtime/output thread Arc cycle remains.
- CLI no longer constructs decoders or collects whole renders. Native production
  Opus now owns libopusfile callback contexts/handles, applies header gain with
  zero additional offset and reports tags/trim facts. Historical packet decoding
  is confined to comparison tests. Modules are an explicit optional feature.
- Acquired digest-checked libogg 1.3.5, libopus 1.5.2 and opusfile 0.12 with MSVC
  19.44.35229, /MD, target-specific archives. Built `zci-play` on Windows MSVC
  using project-local Rust/Cargo 1.98.1. Ordinary player assets/profiles untouched.
- First checks: core/native/codecs device-free suites pass, including held
  open/seek/decode cancellation, Pending, a 50,003-frame production-worker output
  through two pool slots at 48/44.1/96 kHz, fixed memory and zero callback allocation.
  Separate generated R3 Opus fixtures use FFmpeg 8.1.1 and CC0 synthetic chirps.
  Mono/stereo/30-second frame counts and seek tails match; raw packet comparison
  agrees with libopusfile. Reference FFmpeg PCM maximum difference <0.00003.
- CLI rendered 1,440,006 stereo frames (11,520,048 bytes) for the long fixture;
  a start-at-29-second Windows device run reached exactly frame 1,440,006.
  Automated device consumption is evidence, not a human listening claim.
- Existing browser proof facade compiles against the shared machine; it does not
  claim decoder read-ahead is audible. Actual reference browser output is R4.

## Recovery R2/R3: final acceptance — verified on Windows MSVC

2026-10-18. Implementation commit `d878d9b8` (transport workers, reference Opus
and streaming CLI), followed by "Verify libzci native transport and reference CLI
end to end" (acceptance, lifecycle/race hardening, recipes and documentation).
Target: `x86_64-pc-windows-msvc`; Rust/Cargo 1.98.1; MSVC 19.44.35229, `/MD`.
No ordinary izci profile/grants/assets, frontend, desktop or Android build changed.

R2 is verified through the native harness and CLI. R3 is verified for Windows
reference Opus. GNU/Linux acquisition recipes were retained with target-aware
paths and syntax checked, but no Linux recovery build/run was reproduced here
(WSL is not installed). Browser/reference-WASM output remains R4, and additional
formats/module recovery remain M1. Windows success does not verify those targets.

Final checks (run from the repository root):

- `cargo test --locked --manifest-path libzci/Cargo.toml --workspace
  --features libzci-native/provider-tests`: **76 passed, 0 failed**; two explicit
  hardware tests ignored in this ordinary run. The MSVC web cdylib link prints an
  informational import-library message; no source diagnostic or failing check.
- `cargo test --locked --manifest-path libzci/Cargo.toml -p libzci-native
  --features provider-tests -- --ignored --nocapture`: **2 hardware tests passed**.
  `Headphone (Realtek(R) Audio)`, F32 stereo, 48,000 Hz. Commands alone exercised
  Play/Pause/Seek/Stop, volume/mute, resume, final drain and disposal. Paused media
  time stayed frozen; a seek while paused landed at 480,000; final consumption
  reached 1,440,006 with an empty pool. Observed device latency was about 1,530
  frames (32 ms); already submitted OS audio cannot be recalled.
- Full CLI device run of the 30-second changing stereo chirp, at volume 0.08:
  exit **0**, final media position **1,440,006**. The human user separately
  confirmed: "Yes, it sounds clean". This listening evidence is distinct from
  callback/frame accounting.
- Real Opus through the production preparation/output worker and a deliberately
  slow **two-slot pool** matches an unrestricted reference render sample for
  sample at 48,000 and 44,100 Hz, including the final tail. The pure marked-source
  checks also cover 96,000 Hz. No dropped/duplicate media or early Ended.
- Reference Opus tests cover mono/stereo, fractional end trim, pre-skip,
  zero/middle/last-frame/EOF seeks, mandatory header gain exactly once,
  R128/ReplayGain reporting without applying tags, mixed-layout chained Ogg,
  corrupt/truncated headers, unsupported channel maps, two live handles,
  callback cancellation during open/seek/decode, bounded reads and preserved
  source access errors. Historical raw packet decoding agrees with the reference
  PCM and frame count and is now test-only.
- Held open/seek/decode jobs cannot block another session or Stop/Dispose.
  Rapid seeks/new loads reject late results, including after decode and before
  callback consumption. Pending is not EOF. Duplicate old commands cannot cancel
  newer jobs, even after source release. An output survives a decoder failure and
  recovers on a new Load. Event drains include loss counters and a recovery
  snapshot. Closed sessions/workers and render jobs have no retained runtime cycle.
- `python libzci/tests/generate-r3-media.py`: separate ignored CC0 R3 signals,
  FFmpeg **8.1.1**, exact commands, binary hash and output digests recorded in
  `.local/libzci/media/r3/provenance.json`. It does not overwrite the existing
  frontend fixture corpus or relax its generation pins. Long source SHA256:
  `8f8567613bd7b481611c5a6c0cd4a2833ce1cb688d30214a98e3eb93c7572ab6`.
  Reference FFmpeg decode and native output have identical lengths; maximum
  sample difference is **0.00001531** (different libopus builds), within 0.00003.
- Native long render: **1,440,006 stereo frames / 11,520,048 bytes** at 48 kHz.
  Start 15.5 s: **696,006 frames**. Start at EOF: **0 frames**. Converted long
  render at 44.1 kHz: **1,323,006 frames**. Rendering is incremental, explicitly
  raw or fixed-master processed, with bounded chunks and cancellation.
- `ZCI_PLAY=<release executable> python libzci/tests/check-cli.py`: **8 process
  checks passed**, including missing/corrupt/usage/device failures (exit 2), help
  and completed render (0), and playback/render interruption (130). Final packaged
  executable returned 130 about **28 ms** after playback interruption and **2 ms**
  after render interruption. Source-callback tests separately prove real provider
  cancellation. These timings are local observations, not OS-wide guarantees.
- `cargo test --locked --manifest-path libzci/Cargo.toml -p libzci-native
  --test output_allocations -- --nocapture`: fixed test-pipeline peak heap is
  140,312 / 311,706 / 387,522 bytes at 48 / 44.1 / 96 kHz, with respectively
  10 / 52 / 44 setup allocations. The 10,003- and 100,003-frame runs have identical
  peaks/counts and release all allocations. Includes the preallocated consumption
  clock and private FFT storage; excludes providers/devices. Callback render,
  gain/mute updates, reset/recycling, underrun and stop allocate/deallocate **zero**.
- Acquisition `-CheckOnly` re-verified all three pinned archive digests. MSVC
  archives and per-library BUILD-RECORDs are in `build-x86_64-pc-windows-msvc/`;
  GNU archives use their own Rust-target directories. HTTP/TLS is disabled.
  `bash -n` passed for both retained GNU/Linux acquisition scripts.
- `cargo build --locked --manifest-path libzci/Cargo.toml -p zci-play --release`:
  **passed**. Packaged executable: `artifacts/libzci/zci-play.exe`, **1,896,448
  bytes**, SHA256 `9221edfbea2db2a120d12b78b4b734d2cf7384b4ad6f837657da012f6dae7801`.
  `dumpbin /DEPENDENTS` shows Windows system/API-set libraries and the Microsoft
  CRT only; no JS, browser/webview, WASM, FFmpeg, codec DLL or C++ runtime dependency.
  The native media libraries are static; the ordinary MSVC CRT remains dynamic.
- Scoped Rustfmt and `git diff --check` passed. No browser/server/installed-PWA
  launch or frontend/desktop/Android build is claimed by these native results.

Local raw evidence: `.local/libzci/final-tests.log`, `final-hardware.log`,
`final-allocations.log`, `playback-long-windows.log`, `cli-evidence.json`,
`dependencies-release-windows.txt`, and media provenance above. Reproduction
commands are in `libzci/README.md` and the CLI README.

Historical entries follow unchanged.

---

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

## Phase 2: audible zci-play and browser audio output

### 2.1 Add shared audio processing and native device output — implemented, verification pending

Created:

- `libzci/src/audio/` (`buffer.rs`, `clock.rs`, `resampler.rs`,
  `processor.rs`): preallocated lock-free SPSC stereo ring (no
  alloc/lock/SQL in the callback path; under/overruns counted);
  `OutputClock` with requested-vs-running states and
  latency-adjusted media time (never wall-clock); `RateConverter`
  over pinned `rubato` 5 FFT sinc (arbitrary chunks in, fixed blocks
  through, FIFO out; matched rates bypass for bit-exact renders;
  flush pads one tail block — the delay is a leading transient);
  `AudioProcessor` with explicit mono→stereo upmix, finite anchored
  gain/mute ramps, and the raw-program tap point (no consumer
  attached). Master sits after the future Raf slot, per the signal
  graph.
- `libzci-native/src/audio.rs`: CPAL `DeviceOutput` (F32 stereo
  required, anything else a typed failure; preallocated ~2 s ring;
  latency estimate; pause/resume the stream; drop releases the
  device). No device, unknown name, or stream failure is a typed
  `DeviceUnavailable`.
- `libzci-native/src/playback.rs`: one worker thread per output —
  decode through the public session path, explicit channel mapping,
  shared master processor, device-rate conversion, ring feed.
  Generation changes (seek/stop/load) flush the ring and reset
  conversion; pause holds decode and the stream; stop joins the
  thread and drops queued stale audio with it. `render_to_vec`
  reuses the same stages device-free for tests and `--render-pcm`.

Evidence (native, profile `none`):

- `cargo test -p libzci` audio suites: ring bounds/under/overrun,
  clock requested-vs-running + suspend behavior, identity resample
  (delay-compensated correlation > 0.999), exact 2:1 downsample,
  mute/volume ramp shape (monotonic, ends silent, no full-scale
  steps), mono upmix.
- `cargo test -p libzci-native`: device outcome typed either way;
  fake pipeline renders exact provider totals with identical channel
  pairs; zero volume renders silence; 48k→44.1k converts within
  block tolerance; Opus/MOD fixtures render exact audible totals
  (12000 / 368640 stereo frames, finite, nonzero); Hively lifecycle
  renders to EOF.
- Audible smoke (`tests/audible.rs`, real hardware): Default Audio
  Device @48000 Hz consumed 15360 device frames for the 0.25 s Opus
  fixture (audible total plus ring play-out; 7 startup hungry pops),
  pause held the consumed clock exactly across 300 ms, resume
  drained to `drained + finished`. Requested/running, clock,
  underruns, and device label all observed.
- Pending: browser AudioWorklet output and optional platform codecs
  (2.4); gapless/preparation semantics (Phase 5).

### 2.2 Implement zci-play as the first useful consumer — implemented, verification pending

Created (`libzci/consumers/zci-play/`, binary package `zci-play`):

- `src/main.rs`: `zci-play <path>` over native runtime assembly
  (provider registration, source registration, session load/play,
  terminal events, disposal). Flags `--device`, `--volume`
  (linear 0..1), `--start` (seconds), `--subsong` (module content),
  `--diagnostics` (all stderr; stdout stays clean). Parsing only
  converts arguments to core commands.
- Subsong path opens the concrete module instance, applies
  `select_subsong`, and hands it over via the new
  `Session::load_opened` (same generation/state/event discipline as
  registry opens; also mirrored by `NativeRuntime::load_opened`).
  `--subsong` on non-module content is an actionable failure.
- `--render-pcm <file>`: explicit stereo float32-LE @48 kHz render
  without opening any device (playable via
  `aplay -f FLOAT_LE -c 2 -r 48000`). No implicit render mode, no
  FFmpeg subprocess anywhere.
- Exit status: 0 EOF success · 2 usage/media/device failure with an
  actionable stderr hint per error kind · 130 Ctrl-C interruption.
- `README.md`: exact build/run commands, `aplay` playback recipe,
  exit codes, and the native-independence statement.

Evidence (all native, profile `none`):

- `zci-play --help` → exit 0 with units/ranges.
- Audible Opus (`tone.opus --diagnostics`): exit 0; decoded 12000,
  device consumed through `finished`; provider/device/clock lines on
  stderr. Audible MOD (`tone.mod`): played to EOF, exit 0.
- Renders: MOD → exactly 368640 stereo frames (2,949,120 bytes, peak
  0.281); Opus `--start 0.1` → exactly 7200 frames (12000 − 4800);
  blank AHX → 5760 frames (total matches the lifecycle probe).
  Content verified finite/nonzero (MOD/Opus) via sample inspection.
- Failures: missing path (`Unavailable`), garbage bytes
  (`Unsupported`), `--subsong` on Opus (`InvalidArgument`) → exit 2
  with hints. Ctrl-C during the 30 s synth → exit 130
  ("interrupted"); `--start 15` seeks from the supplied position
  (start_frame 720000 in diagnostics).
- `ldd`: libc/libm/ALSA/libstdc++ only — no JS engine, webview, or
  WASM interpreter. The CLI embeds the native library directly.
- Pending: browser AudioWorklet output and optional platform codecs
  (2.4). No database/profile opened (deferred to 3.2 by design).

## Phase 2 status (task scope ends at 2.2)

`zci-play` is independently useful with Opus mandatory: it plays
Opus/MOD/Hively-lifecycle inputs audibly, seeks from a supplied
start, selects module subsongs, renders explicit PCM, handles
EOF/interruption, and frees resources. Registry changes (not CLI
dispatch) decide format support. Deliberately out of scope here:
2.3 (Symphonia-backed ordinary formats, unknown-extension
verification, audible module-fixture broadening) and 2.4
(AudioWorklet output, optional WebCodecs providers) — the browser
audible path. No database/profile opened (deferred to 3.2).
