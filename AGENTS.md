# izci

`izci` (Turkish for "tracker") is a local-first, offline-capable Chromium PWA music player with first-class tracker module support.

## Maintenance

- Keep this document in sync with the repo. Update `AGENTS.md` after major structural, architectural, playback, persistence, or build/PWA changes.

## Core rules

- Preserve dual playback paths:
  - streamed formats (`mp3`, `wav`, `flac`, `ogg`, `opus`) use `Howler.js`
  - tracker modules (`mod`, `xm`, `s3m`, `it`) use `Chiptune3`
- Offline PWA functionality is required and must not regress.
- Target Chromium/Blink desktop and installed PWA behavior. Prefer Chrome APIs and desktop-PWA integrations over compatibility shims.
- Assume no backend. The app runs locally against user-selected files and file handles.
- Keep playback, persistence, and browser-integration logic in services and stores, not inside Svelte components.
- Preserve local persistence and cross-window sync behavior:
  - playlist/library state is persisted in IndexedDB
  - UI/settings state is persisted in `localStorage`
  - settings sync between windows uses `BroadcastChannel` where available
- Prefer progressive enhancement for File System Access, service worker registration, PWA file handlers, popup options, and desktop window behavior.

## Project structure

Ignore generated and dependency directories unless the task explicitly involves them:

- `node_modules/`: installed dependencies.
- `dist/`: production build output.
- `dev-dist/`: generated development build output.

Working source tree:

- `package.json`: Vite/Svelte app manifest and scripts (`dev`, `build`, `preview`, `check`).
- `package-lock.json`: npm lockfile.
- `vite.config.ts`: Vite config, `$lib` alias, `chiptune3` runtime emission, and PWA manifest/workbox setup.
- `svelte.config.js`: Svelte config.
- `tsconfig.json`: TypeScript config.
- `index.html`: Vite HTML shell.
- `options.html`: dedicated Vite HTML entry for the Options popup window.
- `TODO.md`: local notes, not app logic.
- `AGENTS.md`: repo operating guide. Keep it current.

## App source map

- `src/main.ts`: Svelte mount, global CSS/material symbol import, production-only service worker registration.
- `src/App.svelte`: top-level shell; composes the extracted workspace layouts/controllers, owns high-level workspace/playback coordination, global shortcuts, and error banner wiring.
- `src/app.css`: global styling.
- `src/options/main.ts`: Options popup entry; mounts the dedicated popup Svelte app.
- `src/options/OptionsApp.svelte`: standalone Options window UI for module playback defaults and metadata behavior.
- `src/options/app.css`: Options popup styling.
- `src/options/views.ts`: popup navigation/view metadata shared by the Options UI.
- `src/vite-env.d.ts`: Vite ambient types.

### `src/lib/components/`

UI only. Keep these focused on rendering and event dispatch.

- `PlayerControls.svelte`: transport controls, seek bar, volume, and currently selected/playing track context.
- `PlaylistPanel.svelte`: shared playlist/library composition shell; wires drag/drop import, selection events, library view settings, and the extracted playlist-panel subcomponents/helpers.
- `TopMenuBar.svelte`: desktop-style File/View menu bar.
- `TrackDetailsPanel.svelte`: selected-track metadata/details surface.

### `src/lib/components/playlist-panel/`

Playlist/library panel subcomponents and UI-local helpers.

- `PlaylistPanelHeader.svelte`: panel summary, search UI, shuffle/repeat buttons, and add-files trigger.
- `LibraryColumnsHeader.svelte`: library table header with sort, resize, reorder hover, and column-menu entry points.
- `TrackList.svelte`: switches between list and column table rendering while keeping row event wiring uniform.
- `TrackRow.svelte`: individual track row renderer for both list and column layouts.
- `PanelContextMenu.svelte`: item and column context menus rendered through the extracted panel actions.
- `selection.ts`: ordered/range selection helpers for the library column view.
- `search.ts`: library search value collection, filtering, and filtered-summary helpers.
- `library-columns.ts`: column display text, width fitting/rebalancing, and sort comparison helpers.
- `context-menu.ts`: playlist-panel context-menu state types and viewport clamping helpers.
- `actions/portal.ts`: action that portals panel menus into `document.body`.
- `actions/window-dismiss.ts`: action that closes transient panel UI on outside click, escape, scroll, blur, or resize.

### `src/lib/components/workspace/`

Workspace-only composition helpers for the app shell.

- `TabbedWorkspace.svelte`: tabbed workspace layout for playlist, library, and details views.
- `WideWorkspace.svelte`: wide desktop workspace layout with the three panels and resize handles.
- `WorkspaceResizer.svelte`: reusable vertical separator handle for wide workspace layouts.
- `types.ts`: shared workspace component prop/event types used by the tabbed and wide layout components.

### `src/lib/services/`

Primary location for playback and browser-integration logic.

- `file-launch.ts`: Chromium Launch Queue integration for installed-PWA file associations; converts launched file handles into `File`s and queues them until the app is ready to replace the playlist.
- `import-controller.ts`: file import controller for picker capability detection, file-input fallback, open-files flow, and folder import flow.
- `player-controller.ts`: single coordinator for backend switching, snapshot updates, metadata inference application, and player volume propagation.
- `howler-player.ts`: streamed-audio backend built on `Howler.js`.
- `module-player.ts`: tracker-module backend built on `Chiptune3`; applies runtime module playback settings and recreates the player when required by setting changes.
- `chiptune-loader.ts`: guarded one-time `Chiptune3` initialization with timeout/error handling.
- `popup-windows.ts`: registry of popup window definitions (path, name, features) used by the window manager.
- `workspace-actions.ts`: workspace collection helpers plus playlist/library context action builders.
- `workspace-layout.ts`: wide-workspace width math, resize constraints, and panel-layout resolution.
- `window-manager.ts`: generic popup launcher/tracker and desktop-PWA exit behavior; keep UI out of this file.

### `src/lib/stores/`

- `playlist.ts`: owns both `playlistStore` and `libraryStore`; now acts as the public assembly layer that wires collection state, persistence flush/queue behavior, and the extracted playlist helpers together.
- `playlist-persistence.ts`: IndexedDB open/read/write helpers plus stored-item serialization and playback option normalization for playlist/library state.
- `playlist-materialization.ts`: file-handle permission and rehydration helpers, including streamed-format object URL creation/revocation during `ensureLoaded()`.
- `playlist-selection.ts`: selection normalization and selection action helpers shared by playlist and library stores.
- `playlist-metadata.ts`: background metadata inference and stream-duration probing helpers.
- `playlist-navigation.ts`: next/previous/track-end resolution, including shuffle session management.
- `playlist-dedupe.ts`: duplicate detection based on track identity, used only by the library store path.
- `library-view-settings.ts`: persistent library table layout and filter state (column order, widths, visibility, sort, search query) with `BroadcastChannel` sync.
- `module-playback-settings.ts`: persistent tracker playback settings (repeat, stereo/pan, interpolation, tempo, pitch) with sync.
- `metadata-settings.ts`: persistent metadata behavior settings, currently filename-based artist/title inference.
- `player-volume.ts`: persistent player volume with sync across windows.
- `workspace-panel-layout.ts`: persistent wide-layout workspace panel fractions for playlist/library/details resizing, with sync.

### `src/lib/utils/`

- `files.ts`: extension/kind inference, playlist item creation/cloning, track identity, display formatting, filename-based metadata inference, drag/drop extraction, and Chromium file-system entry helpers.

### Types and shims

- `src/lib/types.ts`: shared domain types, supported extension constants, workspace types, playlist/library view types, metadata/settings types, and playback snapshot types.
- `src/lib/types/chiptune3.d.ts`: local typings for `chiptune3`.
- `src/lib/types/file-system-access.d.ts`: File System Access API typing shim used by the app.
- `src/lib/types/howler.d.ts`: local typings for `howler` integration gaps.
- `src/lib/types/node-fs.d.ts`: node `fs` typing shim used by Vite config.
- `src/lib/types/node-url.d.ts`: node `url` typing shim used by Vite config.
- `src/lib/types/pwa-register.d.ts`: typing shim for `virtual:pwa-register`.

## Public assets

- `public/icons/izci-icon.svg`: primary app icon.
- `public/icons/izci-maskable.svg`: maskable PWA icon.

## Architecture notes

- Supported formats are centralized in `src/lib/types.ts`; keep playback routing, file pickers, file handlers, and accepted import lists aligned with those constants.
- `src/lib/utils/files.ts` creates `objectUrl`s only for streamed formats. Do not force tracker modules down the streamed path.
- `src/lib/stores/playlist.ts` persists playlist and library collections separately in IndexedDB (`izci-playlist`, `izci-library`). The library store dedupes tracks; the playlist store does not.
- `src/lib/stores/playlist.ts` should stay as the public store facade; persistence, materialization, selection, metadata, navigation, and dedupe logic now live in focused sibling modules.
- The app now has two collections:
  - playlist: ordered playback queue with shuffle/repeat behavior
  - library: persistent deduped catalog with column-based view state
- Library search/filter query is part of the persistent library view state and syncs across windows with the rest of the library UI settings.
- `src/lib/components/PlaylistPanel.svelte` should stay as a shell around `src/lib/components/playlist-panel/` rather than reaccreting column math, search traversal, or context-menu DOM wiring inline.
- `src/lib/components/workspace/` owns the tabbed vs wide workspace markup split; keep layout-specific composition there instead of rebuilding duplicated panel trees inside `App.svelte`.
- Wide-mode workspace panel widths are persisted in `localStorage` and sync across windows; tabbed mode ignores those widths.
- `src/App.svelte` is responsible for top-level workspace orchestration, but durable state and local algorithms should live in stores/services or the focused workspace components.
- File import supports multiple sources:
  - plain file input fallback
  - `showOpenFilePicker()`
  - `showDirectoryPicker()` for top-level folder imports
  - drag/drop, including Chromium filesystem entry helpers
- Installed PWA file-association launches come through Chromium `launchQueue`; those files should replace the playlist contents rather than append to the current queue.
- `src/lib/services/import-controller.ts` is the entry point for picker capability checks and menu/input import behavior. Keep drag/drop extraction in `PlaylistPanel.svelte` and `src/lib/utils/files.ts`.
- Persisted items may be rehydrated from `FileSystemFileHandle`s. Preserve the `ensureLoaded()` flow and permission prompts when changing import or playback behavior.
- Metadata is inferred from filenames only when enabled in `metadata-settings`. Do not bake inference directly into components.
- `player-controller.ts` is the single coordinator for backend switching. Changes to transport or metadata propagation should usually start there.
- Workspace context actions and library membership checks should stay in `src/lib/services/workspace-actions.ts`; wide-layout sizing rules should stay in `src/lib/services/workspace-layout.ts`.
- `module-player.ts`, `chiptune-loader.ts`, and the custom asset emission in `vite.config.ts` form one pipeline. Treat them as coupled.
- `vite.config.ts` emits `assets/libopenmpt.worklet.js`, configures the PWA manifest, and declares file handlers. Changes here can break offline playback, installed-app file opening, or module initialization.
- The Options window is a separate Vite/Svelte entrypoint (`options.html` -> `src/options/main.ts`) rather than an inline HTML string. Keep popup UIs local-first and frontend-only.
- `popup-windows.ts` is the registry for managed popup definitions. Add future popup windows there so `window-manager.ts` stays generic.
- `src/main.ts` only registers the service worker in production. Preserve that split unless there is a strong reason to change it.

## Change guidance

- Before changing playback behavior, verify whether the code path is `stream` or `module` and keep both working.
- Before changing import behavior, inspect `src/App.svelte`, `src/lib/services/import-controller.ts`, `src/lib/utils/files.ts`, and `src/lib/stores/playlist.ts` together.
- Before changing module playback settings, inspect `src/lib/stores/module-playback-settings.ts`, `src/lib/services/module-player.ts`, and `src/options/OptionsApp.svelte` together.
- Before changing library UI behavior, inspect `src/lib/components/PlaylistPanel.svelte`, `src/lib/components/playlist-panel/`, `src/lib/components/workspace/`, and `src/lib/stores/library-view-settings.ts` together.
- Before changing workspace layout behavior, inspect `src/App.svelte`, `src/lib/components/workspace/`, `src/lib/services/workspace-layout.ts`, and `src/lib/stores/workspace-panel-layout.ts` together.
- Before changing PWA/build or popup-entry behavior, inspect `vite.config.ts`, `src/main.ts`, `options.html`, `src/options/main.ts`, and icon assets together.
- Prefer extending stores/services over adding more stateful logic to `App.svelte` or leaf components.
- Do not add backend/network assumptions, cloud dependencies, or server-coupled flows.
