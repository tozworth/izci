# TODO

## Current refactor

### Goals

- Reduce the largest files to narrower modules with clear ownership.
- Preserve both playback backends:
  - streamed formats (`mp3`, `wav`, `flac`, `ogg`, `opus`) stay on `Howler.js`
  - tracker modules (`mod`, `xm`, `s3m`, `it`) stay on `Chiptune3`
- Keep offline PWA behavior, IndexedDB persistence, `localStorage` settings, and `BroadcastChannel` sync unchanged.
- Move durable logic toward services, stores, and focused helpers rather than large component files.

### Largest files driving this refactor

- `src/lib/components/PlaylistPanel.svelte`
- `src/lib/services/window-manager.ts`
- `src/App.svelte`
- `src/lib/stores/playlist.ts`
- `src/app.css`

### Phase 1: Options window extraction

- Status: done
- Primary target:
  - `src/lib/services/window-manager.ts`
- Problem:
  - `window-manager.ts` is a thin public API wrapped around a full inline popup app, including markup, CSS, state normalization, rendering, event wiring, and resize behavior.
- Desired end state:
  - `window-manager.ts` only owns popup lifecycle and desktop-PWA exit behavior.
  - The Options UI becomes its own small app with normal source modules instead of a giant string literal.
- Preferred implementation:
  - Add a dedicated options entrypoint such as:
    - `src/options/main.ts`
    - `src/options/OptionsApp.svelte`
    - `src/options/app.css`
    - `src/options/lib/` for popup-specific helpers
  - Load that entrypoint in the popup rather than writing a full HTML document string inline.
- Lower-risk intermediate step if needed:
  - Extract current inline popup code into:
    - `src/lib/services/options-window/options-template.ts`
    - `src/lib/services/options-window/options-styles.ts`
    - `src/lib/services/options-window/options-bootstrap.ts`
  - Keep the current popup architecture temporarily, but stop storing the entire mini-app in one file.
- Subtasks:
  - Extract popup constants and view definitions.
  - Extract settings normalization and storage/broadcast helpers.
  - Extract popup DOM wiring and resize behavior.
  - Keep module playback settings and metadata settings behavior exactly aligned with the existing stores.
- Validation:
  - Open Options from the main app.
  - Confirm module settings render and persist.
  - Confirm metadata settings render and persist.
  - Confirm settings sync between windows.
  - Confirm popup reset actions and hint toggle still work.
- Landed:
  - Added dedicated popup entry files:
    - `options.html`
    - `src/options/main.ts`
    - `src/options/OptionsApp.svelte`
    - `src/options/app.css`
    - `src/options/views.ts`
  - Added `src/lib/services/popup-windows.ts` as the popup registry for future managed windows.
  - Reduced `src/lib/services/window-manager.ts` to generic popup launch/tracking and app exit behavior.
  - Updated `vite.config.ts` so `index.html` and `options.html` both build as entrypoints.
  - Updated `AGENTS.md` to reflect the new popup architecture.

### Phase 2: Playlist store decomposition

- Status: done
- Primary target:
  - `src/lib/stores/playlist.ts`
- Problem:
  - One file currently owns persistence, rehydration, file-handle permission flow, metadata inference, duration loading, selection logic, dedupe, and playback navigation.
- Desired end state:
  - `playlist.ts` remains the public store assembly layer.
  - Supporting concerns move into focused helpers.
- Proposed modules:
  - `src/lib/stores/playlist-persistence.ts`
    - IndexedDB open/read/write
    - stored item serialization and normalization
  - `src/lib/stores/playlist-materialization.ts`
    - file-handle permission helpers
    - `ensureLoaded()` / file rehydration behavior
    - object URL creation and revocation for streamed formats only
  - `src/lib/stores/playlist-selection.ts`
    - selection normalization
    - range selection ordering
    - `select`, `selectAll`, `setSelection`
  - `src/lib/stores/playlist-metadata.ts`
    - inferred metadata initialization
    - background scheduling
    - stream duration probing
  - `src/lib/stores/playlist-navigation.ts`
    - next/previous/track-end resolution
    - linear vs shuffled navigation
  - `src/lib/stores/playlist-dedupe.ts`
    - duplicate detection based on track identity
- Subtasks:
  - Keep `playlistStore` and `libraryStore` exports unchanged.
  - Preserve library dedupe and playlist non-dedupe behavior.
  - Preserve hydration queue semantics and pending operation flush behavior.
  - Preserve object URL cleanup guarantees.
- Validation:
  - Rehydrate persisted playlist/library after reload.
  - Re-open tracks through file handles.
  - Verify metadata inference and stream durations still appear.
  - Verify shuffle/repeat/next/previous/end-of-track behavior.
  - Verify duplicate handling remains different for playlist vs library.

### Phase 3: PlaylistPanel split

- Status: done
- Primary target:
  - `src/lib/components/PlaylistPanel.svelte`
- Problem:
  - One component currently mixes rendering with drag/drop import, selection policies, context menus, library search, column sizing, column reordering, sorting, and global window listeners.
- Desired end state:
  - `PlaylistPanel.svelte` becomes a composition shell.
  - Non-UI logic moves to helpers or actions.
  - Distinct UI areas become smaller components.
- First extraction pass: pure TS helpers
  - `src/lib/components/playlist-panel/selection.ts`
    - ordered/range selection for filtered column view
  - `src/lib/components/playlist-panel/search.ts`
    - search value collection and filtering
  - `src/lib/components/playlist-panel/library-columns.ts`
    - width fitting
    - resize rebalancing
    - sort comparison helpers
  - `src/lib/components/playlist-panel/context-menu.ts`
    - menu state types and clamping helpers
- Second extraction pass: UI components
  - `src/lib/components/playlist-panel/PlaylistPanelHeader.svelte`
  - `src/lib/components/playlist-panel/LibraryColumnsHeader.svelte`
  - `src/lib/components/playlist-panel/TrackList.svelte`
  - `src/lib/components/playlist-panel/TrackRow.svelte`
  - `src/lib/components/playlist-panel/PanelContextMenu.svelte`
- Third extraction pass: reusable DOM behavior
  - `src/lib/components/playlist-panel/actions/portal.ts`
  - `src/lib/components/playlist-panel/actions/window-dismiss.ts`
  - possibly a column-drag interaction helper if the event wiring remains complex
- Subtasks:
  - Keep current public events stable: `addFiles`, `openFiles`, `select`, `setSelection`, `activate`, `contextAction`, `toggleShuffle`, `cycleRepeat`.
  - Preserve library-specific search and column behavior.
  - Preserve compact-column fallback behavior.
  - Preserve drag/drop import behavior.
- Validation:
  - Verify selection, range selection, and toggle selection in both modes.
  - Verify library search and search-close keyboard behavior.
  - Verify column resize, reorder, sort, and visibility toggling.
  - Verify item and column context menus.
  - Verify drag/drop import still works.

### Phase 4: App shell decomposition

- Status: done
- Primary target:
  - `src/App.svelte`
- Problem:
  - `App.svelte` currently owns workspace orchestration plus file import flows, context actions, panel layout math, keyboard shortcuts, playback coordination, and duplicated markup for tabbed vs wide layouts.
- Desired end state:
  - `App.svelte` becomes a thin shell that composes smaller workspace pieces.
- Proposed extractions:
  - `src/lib/services/import-controller.ts`
    - open files / open folder / input fallback behavior
    - picker capability detection
  - `src/lib/services/workspace-layout.ts`
    - wide panel width math
    - resizer constraints
  - `src/lib/services/workspace-actions.ts`
    - playlist/library context action builders
    - library membership helpers
  - `src/lib/components/workspace/TabbedWorkspace.svelte`
  - `src/lib/components/workspace/WideWorkspace.svelte`
  - `src/lib/components/workspace/WorkspaceResizer.svelte`
- Optional follow-up:
  - If playback and collection coordination still feels too dense, introduce a focused orchestration helper used by `App.svelte` rather than embedding all handlers directly.
- Subtasks:
  - Remove duplicated playlist/library panel wiring between tabbed and wide layouts where practical.
  - Keep `playerController` as the playback coordinator.
  - Keep `App.svelte` responsible for top-level workspace composition, but not for every local algorithm.
- Validation:
  - Verify file import through picker, input fallback, folder picker, and drag/drop.
  - Verify playlist/library activation behavior.
  - Verify wide-panel resize persistence and tabbed-mode behavior.
  - Verify global shortcuts still work.
  - Verify playback error banner behavior.
- Landed:
  - Added `src/lib/services/import-controller.ts` for picker capability detection plus file/file-input/folder import flows.
  - Added `src/lib/services/workspace-layout.ts` for wide workspace sizing and resizer constraint math.
  - Added `src/lib/services/workspace-actions.ts` for playlist/library context actions and library membership helpers.
  - Added `src/lib/components/workspace/TabbedWorkspace.svelte`, `src/lib/components/workspace/WideWorkspace.svelte`, and `src/lib/components/workspace/WorkspaceResizer.svelte`.
  - Reduced `src/App.svelte` to a thinner shell that composes the extracted workspace pieces and shared panel wiring.
  - Updated `AGENTS.md` to reflect the new workspace architecture.

### Phase 5: Global CSS split

- Primary target:
  - `src/app.css`
- Problem:
  - Global CSS currently carries tokens, layout, menu, panel, playlist, details, player, and responsive behavior in one file.
- Desired end state:
  - Global CSS is split by ownership and lower-level components own their local styles where appropriate.
- Proposed structure:
  - `src/lib/styles/tokens.css`
  - `src/lib/styles/base.css`
  - `src/lib/styles/menu.css`
  - `src/lib/styles/workspace.css`
  - `src/lib/styles/panel.css`
  - `src/lib/styles/player.css`
- Subtasks:
  - Keep app-level design tokens centralized.
  - Move component-specific styles into local `<style>` blocks when the styles do not need to be global.
  - Avoid changing the visual design during the split unless a bug requires it.
- Validation:
  - Compare desktop wide layout, tabbed layout, menu bar, panels, player bar, and error banner before and after the split.
  - Verify responsive breakpoints remain intact.

### Cross-phase rules

- Run `npm run check` after each phase or meaningful subphase.
- Do not change playback routing between streamed audio and tracker modules.
- Do not regress offline PWA behavior.
- Do not move durable persistence into Svelte components.
- Update `AGENTS.md` after any major structural or architectural change lands.

### Suggested execution order

1. Phase 1: extract the Options window first because it has the clearest boundary and the worst single-file concentration.
2. Phase 2: decompose `playlist.ts` next because it is core logic with low UI coupling.
3. Phase 3: split `PlaylistPanel.svelte` after store helpers are cleaner.
4. Phase 4: reduce `App.svelte` once the lower-level pieces exist.
5. Phase 5: split `app.css` alongside or immediately after the component/module extractions.

## PWA / Chromium roadmap

- Add launch-queue handling for files opened directly into the installed app.
- Promote manifest `file_handlers` into a tested desktop flow.
- Add desktop shortcuts, protocol handling if justified, and better install UX.

## Audio roadmap

- Improve module-specific controls and metadata: subsongs, messages, tracker detection, patterns.
- Evaluate gapless playback and large-library performance.
