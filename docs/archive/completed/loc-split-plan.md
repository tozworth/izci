# LoC split plan (measured 2026-08-19)

## Goal

Shrink the current five largest source files by extracting their clusters into focused modules, following the repo's existing conventions: pure logic in services with `.test.ts` siblings, Svelte components render/dispatch (logic lives in services/helpers, not in new sibling components), and factories (runtime, controller) coordinate a handful of sibling modules instead of one flat body.

Pure moves only: no behavior changes, no wire-format or protocol changes, `MULTIPLAYER_PROTOCOL_VERSION` untouched. Each step is independently revertible and verified before the next.

This is a **new round**. Two prior rounds already shipped from `docs/archive/loc-split-refactor.md` (commit `c8e9576` "../Split up LoC offenders") and `docs/archive/app-svelte-modularization.md` (commit `95d8b56` "../Refactor and modularize App.svelte"). Those handled `App.svelte`, the multiplayer host/client, `TrackListPanel`, `TroubadourApp`, and moved `App.svelte` down to 1003 lines. The offenders below are the *current* top five.

## Baseline (measured 2026-08-19)

| Rank | File | Lines | Notes |
|---|---|---|---|
| 1 | `src/lib/services/stream-artwork.ts` | 1228 | monolithic stream-metadata + artwork binary parser; ~7 exported functions, absorbs everything else |
| 2 | `src/lib/services/main-window-runtime.ts` | 1178 | the composition-root factory `App.svelte` consolidated into; ~20 controllers fabricated + wired |
| 3 | `src/tools/troubadour/troubadour-controller.ts` | 1163 | factory closure, public `api` object + large orchestration body; already splits out grouping/history/rename/artwork-staging |
| 4 | `src/lib/services/multiplayer-render-playback.ts` | 1034 | ~870-line `MultiplayerRenderPlaybackService` class + ~80 lines of pure timeline helpers at the tail |
| 5 | `src/lib/components/TopMenuBar.svelte` | 1030 | script ≈ 1005 lines of menu-item builders / formatters / action handling; markup is a single `<WindowMenuBar>` (~25 lines) |

(`src/App.svelte`, 1003, is #6 — it is intentionally the lean composition root after commit `95d8b56`, so it is **not** targeted here.)

## Order of attack (cleanliness × win)

1. `stream-artwork.ts` — pure binary parsers, existing `stream-artwork.test.ts`, tiny public surface, biggest win, lowest risk.
2. `TopMenuBar.svelte` — pure builders/formatters/no I/O; easy, no behavior risk.
3. `multiplayer-render-playback.ts` — pop the pure timeline math out into a testable module.
4. `troubadour-controller.ts` — extract load and save pipelines into sibling modules.
5. `main-window-runtime.ts` — modest/optional; it *is* a module boundary already.

## Rules that apply to every step

- Pure moves only: no behavior, wire-format, or protocol changes. A green `npm run check` + focused `vitest` before and after each step proves the move is faithful.
- Keep the **public import surface stable**: introduce barrel re-exports so existing consumers do not change. `stream-artwork` has ~19 consumers importing names like `VorbisComment`, `readVorbisCommentsPacket`, `extractStreamVorbisComments`, `loadTrackMetadata`, `loadEmbeddedStreamArtwork`, `loadTrackArtwork`, `revokeTrackArtwork`, `getTrackArtworkLoadKey` — re-export all of them from the top module.
- Svelte components render and dispatch; extracted  logic goes to services/helper modules with `.test.ts` siblings, following `main-window-selection.ts` / `multiplayer-window-controller.ts` factory-closure conventions.
- Preserve persistence boundaries and cross-window behavior; no legacy migrations.
- Per AGENTS.md: run `npm run build` after every source change; run focused tests and `npm run check` when relevant (docs-only: no build).

## 1. `src/lib/services/stream-artwork.ts` (1228)

Public surface is small (7 exported functions + `VorbisComment`/`LoadedStreamArtwork`/`EmbeddedStreamArtwork` interfaces). Everything else is private parser machinery already grouped into cohesive clusters by line span. Split each cluster into a focused module and re-export from `stream-artwork.ts`.

- Low-level binary primitives → `stream-meta-binary.ts`: `readUint24BE` (52), `readUint32BE` (56), `readSynchsafeUint32` (65), `decodeBase64` (74), `concatUint8Arrays` (914), `toArrayBuffer` (1153). Pure byte-twiddling; ideal for a focused test.
- ReplayGain normalization/assignment → `stream-meta-replaygain.ts`: `normalizeReplayGainDb`/`Peak` (116, 121), `normalizeR128GainDb` (126), `ensureReplayGain` (133), `assignReplayGainValue` (138), `applyReplayGainComment` (148), plus the ID3/APE gain branches it drives.
- Vorbis + FLAC → `stream-meta-flac.ts`: Vorbis comment decoding (`readVorbisCommentsPacket` 283, `parseVorbisCommentsPacket` 331, `extractStreamVorbisComments` 348), tag normalization (`trimTagValue` 89, `normalizeYearTagValue` 94, `parseDecimalTagValue` 105, `applyVorbisComment` 185), FLAC parse (`parseFlacData` 404) and `readFlacMetadata` (1073).
- Ogg / Opus → `stream-meta-ogg.ts`: packet extraction (`extractOggPacket` 460, `extractOpusTagPacket` 535, `extractOggVorbisCommentPacket` 539), container parses (`parseOpusData` 552, `parseOggVorbisData` 569), file-range scans (`findOggPacketRanges` 921, `readLastOggGranule` 976, `readOggMetadata` 1012).
- MP3 / ID3v2 / APE → `stream-meta-mp3.ts`: `parseId3UserTextFrame` (597), `parseId3v2ReplayGain` (615), `findApeFooterOffset` (655), `parseApeReplayGain` (668), `parseMp3Data` (715), `readMp3Metadata` (1121).
- Artwork decode/presentation → `stream-artwork-extract.ts`: `parsePictureBlock` (232), `extractArtwork` (1149), `buildMediaImage` (739).
- Keep in `stream-artwork.ts` (the facade that owns I/O + the loaders): the `FileRangeReader` class (791–914), `readStreamMetadata` (1138), `canLoadStreamMetadata` (1145), and the exported `loadTrackMetadata` / `loadEmbeddedStreamArtwork` / `loadTrackArtwork` / `revokeTrackArtwork` / `getTrackArtworkLoadKey`, now re-exporting the moved internals.
- `FileRangeReader` straddles the line between parser and I/O; if it stays too big, move it to `stream-meta-io.ts` and have `stream-artwork.ts` consume it. This is a follow-up only if the facade is still heavy after the parser split.
- Verify: `npx vitest run src/lib/services/stream-artwork.test.ts` (plus any new `stream-meta-*.test.ts` added for the pure clusters), `npm run check`, `npm run build`.

Target after: `stream-artwork.ts` ≤ ~250 lines (facade); the five sibling modules each ≤ ~250.

## 2. `src/lib/components/TopMenuBar.svelte` (1030)

Script ≈ 1005 lines; markup is a single `<WindowMenuBar>` (~25 lines). The script is three near-independent clusters. Extract all three; the component keeps props + assembly + dispatch.

- Menu-item builders → `src/lib/services/menu-items.ts`: the ~11 reactive `$:` blocks (`multiplayerMenuItems` 113, `sessionMenuItems` 285, `loadoutMenuItems` 345, `playbackSpeedMenuItems` 359, `rafMenuItems` 374, `bookmarksMenuItems` 408, `sleepTimerMenuItems` 427, `playbackMenuItems` 442, `appMenuItems` 503, `fileMenuItems` 567, `helpMenuItems` 586). Turn each into a pure builder `buildXxxMenuItems(deps) => MenuItem[]`; the component keeps one thin `$:` per builder. Pure, fully unit-testable, zero markup impact.
- Formatting/conversion helpers → `src/lib/services/menu-format.ts`: `multiplayerAudioStatusLabel` (681), `formatConnectionStat` (705), `formatAudioStat` (714), `formatPacketLoss` (722), `formatBytes` (727), `formatTimingStat` (739). Pure; easy focused tests.
- Action handling → `src/lib/services/menu-actions.ts`: `runMenuAction(action: MenuActionId)` (884–1005) with the loadout/bookmark/sleep-timer/etc. branches. This is dispatch/behavior — extract as a factory `createMenuActions(deps)` following the `main-window-selection.ts` / `freeplay-ui-actions.ts` conventions, and have the component's `on:action` forward to it.
- The many `export let` multiplayer props (605–634) stay; they are the component's data contract, not extractable logic. If they keep growing, see the archived `app-svelte-modularization.md` note about re-reading shared stores directly instead of prop-drilling.
- Verify: `npm run check`, `npm run build`, full `npm test` (component has no unit test today; add `menu-items.test.ts` / `menu-format.test.ts` for the extracted pure logic).

Target after: `TopMenuBar.svelte` ≤ ~350 lines (props + `$:` builders + markup).

## 3. `src/lib/services/multiplayer-render-playback.ts` (1034)

A ~870-line state-machine class (59–931) plus ~80 lines of pure timeline helpers at the tail (933–1012). Splitting the class is low-return and risky; the clear win is the pure math.

- Extract pure position/timeline helpers → `multiplayer-render-playback-math.ts` (or fold into the existing `multiplayer-render-scheduler.ts` if it's a natural home): `expectedPositionMs` (933), `hasTimelineDiscontinuity` (943), `contiguousMsAtPosition` (952), `hasRequiredRenderWindow` (964), `renderStallRecoveryNeeded` (986), `renderGapRecoveryTargetMs` (1012). These already sit at the bottom of the file separated from the class — a clean mechanical move. Keep `documentHidden` (1022) and `waitForUpdateEnd` (1026) in the service (they touch `document`/`SourceBuffer`).
- Extract the buffering/cluster bookkeeping constants and any pure cluster math inside the class (REBUFFER threshold, DRIFT correction, stall intervals, 53–57) with the pure helpers where they belong.
- Do **not** force a class split just to shrink line count; the class's internal state (buffers, manifest, window, generation) is cohesive. Only split if a second pass shows a single function > ~250 lines.
- Verify: `npx vitest run src/lib/services/multiplayer-render-playback.test.ts` (plus a new `multiplayer-render-playback-math.test.ts`), `npm run multiplayer:protocol:check`, `npm run check`, `npm run build`.

Target after: class ≤ ~800 lines; pure math now unit-tested independent of the service.

## 4. `src/tools/troubadour/troubadour-controller.ts` (1163)

Factory closure (`createTroubadourController` at 278) with a large public `api` object; it already delegates to sibling modules `grouping.ts`, `history.ts`, `rename-template.ts`, `artwork-staging.ts`, `rename-job.ts`, and `media-metadata/*`. The remaining bulk is two pipelines — extract each the same way. This is the follow-up the archived `loc-split-refactor.md` explicitly flagged once `TroubadourApp.svelte` delegation landed.

- Loading/materialization pipeline → `troubadour-loading.ts`: `materializeWorkbenchFile` (146), `resolveParentHandle` (218), `runLoadingJob` (416), `addLoadingItems` (435), `itemFromHandle` (515), `itemsFromDiscoveredFiles` (544), plus the `DiscoveredWorkbenchFile` type (156), `LOAD_COMMIT_BATCH_SIZE` (153) and `LOAD_PROGRESS_INTERVAL_MS` (154). Share the batch/progress-state types with the controller. This is the largest chunk (~250 lines).
- Save/rename pipeline → `troubadour-save.ts`: `prepareItemForSave` (381), `writeTargetForItem` (249), `requestRenameAccess` (195), `defaultSaveHandler` (261), and the `saveSelectedOrAll` / `applyRenames` / `saveAndPublish` / `previewRenames` branches of the `api`. Roughly another ~250 lines.
- Selection/album orchestration and the remaining `api` glue stay in the controller (it should shrink to a coordinator: state shape + `api` wiring + orchestration); pure selection helpers worth their own `troubadour-selection.ts` only if they grow past ~60 lines.
- Keep `effectiveFields` (162), `selectedFieldValue` (166), `renameRulesFromSettings` (182) where consumers import them, or re-export through `troubadour-controller.ts` to avoid import churn.
- Verify: `npx vitest run src/tools/troubadour/` (existing `troubadour-controller.test.ts` coverage), `npm run check`, `npm run build`.

Target after: `troubadour-controller.ts` ≤ ~450 lines; `troubadour-loading.ts` / `troubadour-save.ts` each ≤ ~260.

## 5. `src/lib/services/main-window-runtime.ts` (1178)

This is the module `App.svelte` now delegates to (single consumer: `src/App.svelte`). It is intentionally a composition root that fabricates ~20 controllers and wires publish/subscribe. Mechanical splitting below is real but lower-value than the other four, and it carries the App.svelte refactor's timing risk (subscription/teardown order). Treat it as optional, and only if the aggressive file keeps growing.

- Move the state shape + publish/subscribe/getSnapshot bookkeeping into a focused module: `main-window-runtime-state.ts` (`MainWindowRuntimeState` 115–209 interface move, `publish` 509, `subscribe` 514, `getSnapshot` 522 and the `state` initialization).
- Extract the largest self-contained dependency bundles from the flat `createMainWindowRuntime` body into sibling factories, keeping construction order intact (this matters — see the archived plan's "Risk gate"): the multiplayer/freeplay bundle (multiplayer session creation ~627–682, `multiplayerController.subscribe`, `multiplayerSession.subscribe`), the video/theater bundle (~683–700), the lyrics bundle (~711–715), and the transport/playback bundle. Each becomes `main-window-runtime-<domain>.ts` exporting `create<Domain>Bundle(deps) => {...}`; the runtime calls them in order and collects the unsubscribe teardowns.
- Explicitly **do not** split the pure `$:`-style consumption loop or force any object to move if it is used by multiple bundles — duplicated getters across bundles are fine to keep.
- Verify: `npm run check`, `npm run build`, full `npm test`, `npm run multiplayer:protocol:check`, and one manual host+join multiplayer loop plus video theater + mini-player smoke test (timing-sensitive).

Target after (only if pursued): `main-window-runtime.ts` ≤ ~700 lines; otherwise accept it as the boundary.

## Verification (run after every completed step)

- `npm run check`
- Focused `vitest` for the touched area (see per-file notes)
- `npm run build`
- Multiplayer-adjacent steps additionally: `npm run multiplayer:protocol:check`; render steps run `multiplayer-render-*.test.ts`
- Full `npm test` at the end of the whole effort

## Definition of done

- `stream-artwork.ts` ≤ ~250 (facade + I/O + loaders), parser clusters in 5 focused modules.
- `TopMenuBar.svelte` ≤ ~350, builders/formatters/actions in `menu-items.ts` / `menu-format.ts` / `menu-actions.ts`.
- `multiplayer-render-playback.ts` class ≤ ~800, timeline math in a testable module.
- `troubadour-controller.ts` ≤ ~450, load/save pipelines extracted.
- `main-window-runtime.ts` (if pursued) ≤ ~700.
- No consumer import churn: barrel re-exports keep the public surfaces stable.
- No behavior change: full `npm test` + `npm run check` + `npm run build` pass; `npm run multiplayer:protocol:check` clean.

## Out of scope

- Svelte 5 runes migration (separate modernization; conflicts with pure-`$:` moves).
- Re-opening `docs/archive/loc-split-refactor.md` / `docs/archive/app-svelte-modularization.md` items already shipped by `c8e9576` / `95d8b56`.
- `src/App.svelte` (deliberate lean root) and any file below the top five.
- Persistence, audio, DSP, or browser-integration behavior changes of any kind.
