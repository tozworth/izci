# LoC split refactor

## Goal

Shrink the five largest source files by extracting their clusters into focused modules, following the repo's existing conventions (sibling services with per-concern tests, UI-local helpers under `track-list-panel/`, logic pushed into controllers, `App.svelte` as a lean composition root).

Pure moves only: no behavior changes, no wire-format changes, no protocol version bump. Each step is independently revertible and verified before the next.

## Baseline (measured 2026-08)

| Rank | File | Lines | Script | Markup |
|---|---|---|---|---|
| 1 | `src/App.svelte` | 2536 | 2153 | ~380 |
| 2 | `src/lib/services/multiplayer-host.ts` | 1704 | 1704 | - |
| 3 | `src/lib/services/multiplayer-client.ts` | 1452 | 1452 | - |
| 4 | `src/lib/components/TrackListPanel.svelte` | 1408 | 1135 | 273 |
| 5 | `src/tools/troubadour/TroubadourApp.svelte` | 1271 | 971 | 298 |

Targets after the refactor: every file above under ~900 lines (App.svelte under ~600).

## Order of attack

1. `multiplayer-client.ts` — cleanest seams, pure logic, no template involvement, test convention already in place.
2. `multiplayer-host.ts` — same pattern, mirror the client-side module names.
3. `TrackListPanel.svelte` — script-only extraction into the existing `track-list-panel/` helper dir.
4. `TroubadourApp.svelte` — pure-geometry extraction first, then delegate to the controller.
5. `App.svelte` — biggest, most wiring, last.

## Verification (run after every completed step)

- `npm run check`
- Focused tests for the touched area (see per-file notes)
- `npm run build`
- Multiplayer files additionally: `npm run multiplayer:protocol:check` (no protocol drift allowed in a pure refactor) and a headless rig pass (`scripts/rig-headless-pass.py`) once host+client are both split
- `npm test` at the end of the whole effort

## 1. src/lib/services/multiplayer-client.ts (1452)

One factory closure over `core`; the sub-modules take a shared context object (core, publish, peer state) instead of nesting.

- [ ] Extract join/connect (join, joinPaired, resolveDirectoryRoomCode, restoreClientJoin, connectClient, ~244-621) to `multiplayer-client-connect.ts`
- [ ] Extract channel + message handling (attachClientChannel, ~622-960) to `multiplayer-client-channels.ts`
- [ ] Extract media/render audio + source files (attachClientRemoteAudio, media/render channels, source-file loading, render-ready, ~961-1185) to `multiplayer-client-audio.ts`
- [ ] Extract client Freeplay state (persistFreeplayState, sendFreeplayQueueToPeer, setFreeplayQueue, restoreFreeplayStateForHost, tryResumeFreeplaySelection, ~174-243) to `multiplayer-client-freeplay.ts`
- [ ] Extract reconnect/resume/leave (scheduleClientReconnect, handleClientResume, leave, resumeAudio, ~1262-1440) to `multiplayer-client-lifecycle.ts`
- [ ] Keep `createMultiplayerClientSide` as a coordinator wiring the sub-modules; command sending stays
- [ ] Add focused tests where the extracted module has testable pure logic (follow `multiplayer-*.test.ts` conventions)
- [ ] Verify: `npx vitest run src/lib/services/multiplayer-*.test.ts`, `npm run multiplayer:protocol:check`, `npm run check`, `npm run build`

## 2. src/lib/services/multiplayer-host.ts (1704)

Same factory-closure pattern; same context-object approach. Mirror client module names.

- [ ] Extract Freeplay hosting (syncPeerFreeplayMode, syncPeerMediaSource/RenderSource, syncPeerSourceFile, handleFreeplayCommand, activate/stepFreeplayTrack, catalog/state, ~573-1197) to `multiplayer-host-freeplay.ts` — the largest chunk, ~600 lines
- [ ] Extract playback preparation + clock sync (beginHostPlaybackPreparation, clock pings, acceptClientClockSample/PlaybackReady/RenderReady, ready gates, cancelScheduledClientStarts, ~1271-1454) to `multiplayer-host-playback-prep.ts`
- [ ] Extract pairing/session lifecycle (startHosting, answerTurnCredentialRequest, acceptClientOffer, togglePairing, kick, stopHosting) to `multiplayer-host-session.ts`
- [ ] Extract channel attachment (attachHostChannel/MediaChannel/RenderChannel, ~427-572) to `multiplayer-host-channels.ts`
- [ ] Extract state broadcast (sendCurrentState, syncHostAudio/SourceFiles/Artwork, buildCatalog/buildPlayback, broadcastShared, ~1455-1642) to `multiplayer-host-sync.ts`
- [ ] Keep `createMultiplayerHostSide` as a thin coordinator
- [ ] Verify: multiplayer focused tests, protocol check, `npm run check`, `npm run build`, then one `scripts/rig-headless-pass.py` run covering co-op + Freeplay

## 3. src/lib/components/TrackListPanel.svelte (1408)

Already decomposed into `track-list-panel/` subcomponents and helpers (TrackList, TrackRow, LibraryGroupList, context-menu.ts, library-columns.ts, search.ts, selection.ts, actions/). The remaining 1135-line script is orchestration glue — move it into the helper modules, not into new components.

- [ ] Move context-menu building/labels (handleContextAction, buildContextMenuActions, label/shortcut helpers, ~600-700 + 881-902) into `track-list-panel/context-menu.ts`
- [ ] Move column sort/visibility/resize + drop indicator logic (~328-370, 619-850) into `track-list-panel/columns.ts` and `library-columns.ts` where it fits
- [ ] Move drag/drop handling (handleDrop, getColumnDropIndicator, ~293-370) into a `track-list-panel/dnd.ts`
- [ ] Move window keyboard handling (~389-474) into `track-list-panel/actions/window-dismiss.ts` or a `track-list-panel/keyboard.ts`
- [ ] Move library-group open/back/search orchestration (~699-760, 903-1135) into `library-group-navigation.ts` / `search.ts`
- [ ] Keep the component as dispatch-only; the 273-line markup stays unless rows grow further
- [ ] Verify: `npx vitest run src/lib/components/track-list-panel/`, `npm run check`, `npm run build`

## 4. src/tools/troubadour/TroubadourApp.svelte (1271)

Push logic down into the controller (already owns workbench state and jobs; currently 1107 lines itself — rank 7). Do not spawn parallel module sprawl.

- [ ] Extract dock layout/resize geometry (dock guides, axis replacement, resize loops, ~216-406) to `troubadour-dock.ts` (currently a 13-line stub) — pure functions, ~190 lines, easiest extraction
- [ ] Extract file acquisition (chooseFiles, chooseFolder, addRememberedFolder, fallback, drop, ~458-555) to `troubadour-imports.ts`
- [ ] Delegate save/rename pipeline (save, previewRenames, applyRenames, grantRenameAccess, ~565-623) to `troubadour-controller.ts`
- [ ] Delegate artwork staging (~838-971) to the controller or a small `artwork-staging.ts`
- [ ] Extract item-table behaviors into a `TroubadourRow.svelte` subcomponent if the 298-line markup keeps growing
- [ ] Follow-up (separate ticket): split `troubadour-controller.ts` once the delegation lands — it will exceed the current 1107 lines
- [ ] Verify: `npx vitest run src/tools/troubadour/`, `npm run check`, `npm run build`

## 5. src/App.svelte (2536)

Composition root that violates its own "lean" mandate. The markup is only ~380 lines; ~1,200 of the script lines are multiplayer/freeplay/video/troubadour glue that never touches the template.

- [ ] Extract multiplayer orchestration (handleMultiplayerHostCommand, connection dialog state, host/join/invite/copy-invite handlers, ~499-670 and 1938-2010) to a main-window `MultiplayerController` service
- [ ] Extract Freeplay UI actions (~793-970) to `freeplay-ui-actions.ts` (server side already lives in multiplayer-host.ts)
- [ ] Extract selection plumbing (~324-497) to a `main-window-selection.ts` or fold into workspace-collections
- [ ] Extract video presentation (theater, fit, PiP, fullscreen, ~1629-1701) to `video-window-actions.ts` beside window-video.ts / video-settings.ts
- [ ] Extract Troubadour bridge (context building, result matching, apply, ~1734-1895) to `troubadour-main-window.ts`
- [ ] Collapse transport handlers (~678-990) into one transport-actions helper instead of near-identical wrappers over playerController/playback-commands
- [ ] Keep shortcut and workspace-tab cycling (~1705, 2011-2082) in `app-shortcuts.ts` / workspace-shell rather than inline
- [ ] Verify: `npm run check`, `npm run build`, `npm test`

## Rules that apply to every step

- Pure moves only: no behavior, wire-format, or protocol changes; `MULTIPLAYER_PROTOCOL_VERSION` stays untouched
- The factory-closure refactor for host/client: pass a shared context object (core + per-session state) to sub-modules — do not nest functions
- Svelte components render and dispatch; extracted logic belongs in services/helpers/controllers, never in new sibling components for the sake of it
- Per AGENTS.md: run `npm run build` after every source change; run focused tests and `npm run check` when relevant

## Definition of done

- All five files under target sizes (client/host ~600 each, TrackListPanel ~700, TroubadourApp ~600, App.svelte ~600)
- No behavior change: full `npm test` + `npm run check` + `npm run build` pass
- One successful `scripts/rig-headless-pass.py` (co-op + Freeplay) after the multiplayer work
- `npm run multiplayer:protocol:check` clean
