# App.svelte modularization plan (measured 2026-08-18)

## Goal

Get `src/App.svelte` back under control. It is 1830 lines (1447 script / 383 markup) and, while it is no longer the 2536-line monster the `docs/archive/loc-split-refactor.md` targeted, it has regressed into a bloated composition root: ~80 reactive blocks, 20 controller-factory call sites, 57 script functions, and two near-identical multiplayer prop blocks in the markup.

The previous refactor (commit `c8e9576`, "Split up LoC offenders") already carved out the *action layer*: `multiplayer-window-controller.ts`, `transport-actions.ts`, `video-window-actions.ts`, `main-window-selection.ts`, `freeplay-ui-actions.ts`, `troubadour-main-window.ts`, `app-shortcuts.ts` all exist and are wired from here. This plan targets what is actually left: the **derivation layer**, the **fabrication/subscription boilerplate**, the **forwarder layer**, and the **markup prop explosion**. It does not re-propose any already-done extraction.

Pure moves only: no behavior changes, no wire-format changes, no protocol version bump. Each step is independently revertible and verified before the next.

## Baseline (measured 2026-08-18)

Current shape: **1830 lines total, script 1447 (79%), markup 383 (21%)**, 80 `$:` reactive blocks, 57 script functions.

| Section | Lines | Content |
|---|---|---|
| 1–143 | 143 | imports (16 components, ~35 services/stores/types) |
| 145–170 | 26 | store destructuring + eager side-effect setup (`startLibraryFolderCommandListener`, `startLoadoutRuntime`, `setSleepTimerFiredHandler`) |
| 172–334 | 163 | local state: `local*` store mirrors, remote (multiplayer) mirrors, presentation state |
| 336–600 | 265 | controller fabrication wave 1 (16 `create*` calls + 2 `subscribe` loops) |
| 601–671 | 71 | store/subscription wiring (12 `subscribe` + 10 `unsubscribe*`) |
| 672–746 | 75 | controller fabrication wave 2 (`importController`, `appShortcuts`, launched-files, `mediaSessionService.connect`) |
| 748–1107 | 360 | reactive layer: multiplayer dialog copy, local↔remote mirroring, video theater, now-playing/lyrics, backdrop, workspace sync, artwork sync |
| 1042–1094 | (53) | `queuePanelHandlers` / `libraryPanelHandlers` / `upNextPanelHandlers` (inside reactive layer) |
| 1109–1446 | 338 | ~45 handler functions (mostly thin forwarders) + `onDestroy` (~40 teardown calls) |
| 1449–1830 | 382 | markup: `svelte:window`, backdrops, `TopMenuBar` (~55 prop/handler lines), `MobileWorkspace`/`AppWorkspace` fork (~90 each), `VideoTheater`, toasts/dialogs, `PlayerControls` (~40) |

## Targets

- Phase 1 (pure resolvers) + Phase 2 (panel-handler factory) + Phase 5 (markup compaction): **~1500 lines**, independently revertible, low risk.
- Phase 3 (runtime extraction): **~1050–1150 lines**, script ≤ ~750.
- Phase 4 (stretch, view-state store): **≤ ~900 lines**, script ≤ ~600.
- No file added solely to carry markup or logical glue that has a home in an existing controller.

## Order of attack

### Phase 0 — Baseline gate

- [x] Run `npm run check`, `npm run build`, `npm test` and record a green baseline before touching anything. (check 0/0, build ok, 144 files / 696 passed)
- [x] Confirm `git status` is clean so each step stays independently revertible. (only the untracked plan doc itself)

### Phase 1 — Pure derivation resolvers → `src/lib/services/main-window-presentation.ts` (+ `.test.ts`)

Move the *value computations* of the reactive layer into pure functions. Each is of the form "given inputs, what is the value?" — no side effects, no mutations. The component keeps one thin `$:` call per resolver. This is the safest phase: pure moves, fully unit-testable, zero markup impact.

- [x] `resolveMultiplayerDialogPresentation(state, dialog, operation, targetName, translate)` → `{ failed, resolvedTarget, notice, statusLine }` — replaces lines 752–775.
- [x] `resolveClientCollections(local, remote, isClient)` → `{ queueItems, libraryItems, favoriteItems, collectionsReady }` — replaces 776–781.
- [x] `resolveClientSelections(localSel, remoteSel, isClient)` per collection + `resolveClientSelectedItems(items, selection)` — replaces 782–805.
- [x] `resolveClientPlayback(remote, local, isClient, isSourceFileClient, isRenderClient, buffering, ranges)` → `{ playbackSnapshot, playbackStatus, shuffleEnabled, repeatMode }` — replaces 842–872. Preserve the render-pipeline loading-state comment as the resolver's doc comment.
- [x] `resolveVideoTheaterPresentation(videoTrackActive, theaterActive, fullscreen, windowControlsOverlay, topMenuBarHeight, hasDomFullscreenElement)` → `{ isFullscreenVideoTheater, fullscreenExitAction, chromeInset, topInset }` — replaces 888–909. The `autoNowPlayingSuppressed`-style mutations stay outside resolvers.
- [x] `resolveNowPlayingEligibility(appearance, windowDisplay, innerSize, mobileMode, trackKind)` + `resolveLyricsPresentation(appearance, isNowPlayingLayoutActive)` — replaces 920–962. The empty-eligible reset of `autoNowPlayingSuppressed` (923–925, 937–939) stays in the component as an effect. Note: `isNowPlayingLayoutActive` had to split into a separate pure helper `resolveNowPlayingLayoutActive(...)` because the eligibility statement must not read the `autoNowPlayingSuppressed` toggle (Svelte 4 reactive-declaration cycle with the reset effect).
- [x] Small stragglers if convenient: `resolveWindowTitle(showTrackTitle, livePlayingTrack)` done; `resolvePatternAvailability` already lives in `contextual-tab-presentation.ts` (`resolvePatternTabAvailability`), so nothing to move.
- [x] Keep side-effectful blocks in the component: store sets (873–874), remote-selection sync (823–833), render-poll start/stop (834–841), every `*.sync(...)` call (984–1040), shutdown handling (1012–1019), metadata refresh (1096–1107), track-ended/gapless (1390–1400).
- [x] Verify: `npx vitest run src/lib/services/main-window-presentation.test.ts` (26 tests), `npm run check` (0/0), `npm run build` (ok), full `npm test` (145 files / 722 passed).

### Phase 2 — Panel-handler + forwarder consolidation → `src/lib/services/main-window-handlers.ts`

- [x] Move `queuePanelHandlers`, `libraryPanelHandlers`, `upNextPanelHandlers` (1042–1094) into `createMainWindowPanelHandlers(deps)` where `deps` is the existing getter bundle (`isMultiplayerClient`, `isFreeplayClient`, `workspaceCollections`, `workspaceShell`, `filesystemFolders`, `importController`, `windowSelection`, `multiplayerController`, `freeplayActions`, `upNext`, `playbackCommands`, `handleMenuOpenFiles`). Returns the three objects; component keeps ~10 lines.
- [x] Collapse the pure transport pass-throughs (1186–1228, 15 one-liners) by binding markup/handler objects directly to the `transport` object where unambiguous (`on:toggle={() => transport.togglePlayback()}`, etc.). Keep named wrappers only at call sites shared by multiple objects (miniPlayer handlers, mediaSession handlers, appShortcuts) — or leave all of them and let Phase 3 fold them into `runtime.actions`. Decide by churn: this is cosmetic; skip if it fights readability. (Skipped — wrappers are shared by miniPlayer/mediaSession/appShortcuts call sites; Phase 3 folds them into `runtime.actions`.)
- [x] Verify: `npx vitest run src/lib/services/` (86 files / 463 passed), `npm run check` (0/0), `npm run build` (ok), full `npm test` (145 files / 722 passed).

### Phase 3 — Fabrication + subscription extraction → `src/lib/services/main-window-runtime.ts`

The structural move. Move the ~410 lines of controller fabrication (336–600, 672–746) and the store/subscription block (601–671) into a single factory, leaving the component to consume handles and keep only derivations + markup.

- [x] **3a — fabrication**: `createMainWindowRuntime(deps)` creates the ~20 controllers in dependency order (playbackProgress → playbackCommands → transport → multiplayer → miniPlayer → mediaSession…), with internal handlers resolved against the runtime's own `actions`. The component passes a single `readState: () => stateBundle` getter (built from its reactive lets) instead of spelling out every per-controller getter; all controllers already consume lazy getters, so this is mechanical.
- [x] Runtime's `actions` become the forwarded functions (`togglePlayback`, `stepTrack`, `seekPlayback`, `handleMenuOpenFiles`, multiplayer/freeplay/video forwarders 1254–1369) so the 45 component functions collapse to markup-bound references + the handful that touch component-local state (`handleOpenOptions` mobile path, `handleAppKeydown` Escape/video-theater logic).
- [x] **3b — subscriptions**: move the 12 store `subscribe` + teardown bookkeeping into the runtime; it returns `dispose()` that tears down everything (replaces the ~40-line `onDestroy` at 1402–1446 with ~5 lines). Subscriptions whose values feed reactive derivations must surface through the runtime's returned store(s) (see 4) or a `subscribe` callback the component mirrors into a single reactive let — do not silently turn them into plain variables.
- [x] Keep multiplayer session construction order intact: `multiplayerSession` is created then assigned (461–465); the runtime must preserve that two-phase init and the `multiplayerController.prepareLaunchDialog()` call.
- [x] Keep the component's `$:` derivations referencing runtime handles via the same `$:` semantics; no runes conversion (see Out of scope).
- [ ] Risk gate: this is the only phase that can change observable timing (subscription order, teardown). After it, do a manual smoke test of play/pause/seek, video theater, mini-player, and a multiplayer host+join loop before declaring done.
- [x] Verify: `npm run check` (0/0), `npm run build` (ok), `npm run multiplayer:protocol:check` (clean), full `npm test` (145 files / 722 passed).

Note: the runtime holds its own state mirror (`MainWindowRuntimeState`) and pushes updates through a `subscribe` surface the component mirrors into its reactive lets; the component also seeds its lets from `runtime.getSnapshot()` so first-flush derivations see the initial controller state. `readState` from the plan was not needed — the runtime is self-contained.

### Phase 4 — Stretch: view-state store (only after 3 lands cleanly)

- [x] Move the low-frequency `local*` store mirrors (collections, selections, selected items, up-next entries) into a `MainWindowView` store (`src/lib/services/main-window-view.ts`) created by the runtime and surfaced as `runtime.stores.view`; the component reads `$view` in its client-resolution resolvers instead of ~20 lets. `view.set` merges partials; `getSnapshot` is `get(store)`.
- [x] The high-frequency playback mirrors (`localPlaybackSnapshot`, `localPlaybackStatus`, plus `localPlayingTrack`/`localShuffleEnabled`/`localRepeatMode`) deliberately stay on the runtime subscribe surface: the snapshot store updates on every timecode tick, and routing it through a `$:`-consumed store would re-run the derivation layer at timecode rate. This is the same shape as the existing `displayPlaybackSnapshotStore` pattern — a dedicated store for high-frequency reads.
- [x] Runtime state interface/initial state trimmed of the moved fields; `syncPlayingTrackMetadata` now reads library/favorites from `view.getSnapshot()`.
- [x] Verify: `npm run check` (0/0), `npm run build` (ok), full `npm test` (145 files / 722 passed), `npm run multiplayer:protocol:check` (clean).

### Phase 5 — Markup compaction (independent; can land in any order)

- [x] Build the multiplayer prop bundle once as a derived object (`multiplayerBarProps`, covering the ~20 `multiplayer*` props duplicated between `TopMenuBar` and `MobileWorkspace`) plus a `multiplayerBarHandlers` object for the ~12 shared multiplayer events (incl. `multiplayerForgetPairing` / `multiplayerTogglePair`, previously inline `on:multiplayer*` handlers), and spread both: `<TopMenuBar {...multiplayerBarProps} {...multiplayerBarHandlers} />` and `<MobileWorkspace {...multiplayerBarProps} {...multiplayerBarHandlers} />`. This removes ~20 duplicated props and ~24 duplicated event bindings from the markup.
- [x] Also consolidate the AppWorkspace/MobileWorkspace shared presentation props into `workspacePanelPresentationProps` (~25 props identical between the two) and spread it into both; only the genuinely divergent props (`isNowPlayingLayoutActive` vs `nowPlayingActive`, backdrop zone props, now-playing chrome/tab/resize events) stay explicit. This is consistent with the plan's trade-off note — the consolidated blocks were truly duplicated or pure pass-throughs.
- [x] Follow-up (separate change, not this refactor): have workspaces/menu components read shared stores directly instead of prop-drilling `multiplayerState` — requires making session state a store; list only if markup keeps growing.
- [x] Verify: `npm run check`, `npm run build`.

## Rules that apply to every step

- Pure moves only: no behavior, wire-format, or protocol changes; `MULTIPLAYER_PROTOCOL_VERSION` stays untouched.
- Side effects stay in `$:` blocks and controllers; resolvers are pure (given inputs → values) so they are unit-testable.
- Keep Svelte 4 `$:`/`bind:this`/`<svelte:window>` style. This refactor is about modularization, not framework migration.
- Per AGENTS.md: logic belongs in services/stores/controllers, components render and dispatch, and `App.svelte` remains the composition root — the goal is a *lean* root, not an empty one.
- Do not create sibling components to hold logic; extract to services with `.test.ts` siblings, following the `main-window-selection.ts` / `multiplayer-window-controller.ts` factory-closure conventions.
- Preserve persistence boundaries and cross-window behavior; no legacy migrations.

## Verification

- `npm run check` after every step.
- Focused tests for any new/changed service (Phase 1 is the main test-bearing step).
- `npm run build` after every source change (docs-only: no build).
- `npm run multiplayer:protocol:check` after any multiplayer-adjacent step.
- `npm test` at the end of the whole effort, plus one manual host+join multiplayer loop after Phase 3.

## Definition of done

- `src/App.svelte` ≤ ~1100 lines (script ≤ ~750) after Phases 1–3; ≤ ~900 after Phase 4.
  **Final: 1003 lines (script 688 / markup 315) after Phases 1–5.** The Phase 4 goal of script ≤ ~600 was not forced — per the plan, Phase 4 is optional once Phase 3 hits ≤ 750, and the remaining script is the thin `$:` derivation layer and the two prop-bundle builders, not mirror lets.
- All pure derivations covered by tests in `main-window-presentation.test.ts` (26 tests); panel handlers and runtime factory exist (their phases landed); `main-window-view.ts` added for the low-frequency mirrors.
- No behavior change: full `npm test` (145 files / 722 passed) + `npm run check` (0/0) + `npm run build` (ok) pass; `npm run multiplayer:protocol:check` clean.
- `App.svelte` contains: imports, state lets, thin `$:` derivations calling resolvers/sync methods, markup, and a short `onDestroy`.

## Out of scope

- Svelte 5 runes migration (separate modernization; would conflict with the pure-`$:` rule above).
- Moving reactive statements into services wholesale (breaks Svelte 4 reactivity and the composition-root mandate).
- Persistence, audio, DSP, or browser-integration changes of any kind.
- Re-opening `docs/archive/loc-split-refactor.md` items already shipped by `c8e9576`.