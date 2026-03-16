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
- `TODO.md`: local notes, not app logic.
- `AGENTS.md`: repo operating guide. Keep it current.

## App source map

- `src/main.ts`: Svelte mount, global CSS/material symbol import, production-only service worker registration.
- `src/App.svelte`: top-level shell; manages playlist/library workspace, file and folder import flows, playback actions, context actions, responsive tabbed layout, and error banner wiring.
- `src/app.css`: global styling.
- `src/vite-env.d.ts`: Vite ambient types.

### `src/lib/components/`

UI only. Keep these focused on rendering and event dispatch.

- `PlayerControls.svelte`: transport controls, seek bar, volume, and currently selected/playing track context.
- `PlaylistPanel.svelte`: shared panel used for both playlist and library; supports drag/drop import, multi-select, context menus, and library column mode with sort/reorder/resize/visibility/search state.
- `TopMenuBar.svelte`: desktop-style File/View menu bar.
- `TrackDetailsPanel.svelte`: selected-track metadata/details surface.

### `src/lib/services/`

Primary location for playback and browser-integration logic.

- `player-controller.ts`: single coordinator for backend switching, snapshot updates, metadata inference application, and player volume propagation.
- `howler-player.ts`: streamed-audio backend built on `Howler.js`.
- `module-player.ts`: tracker-module backend built on `Chiptune3`; applies runtime module playback settings and recreates the player when required by setting changes.
- `chiptune-loader.ts`: guarded one-time `Chiptune3` initialization with timeout/error handling.
- `window-manager.ts`: popup options window generation/sync and desktop-PWA exit behavior.

### `src/lib/stores/`

- `playlist.ts`: owns both `playlistStore` and `libraryStore`; handles collection state, selection, dedupe, IndexedDB persistence, playback options, metadata updates, file-handle reloading, and next/previous/end-of-track resolution.
- `library-view-settings.ts`: persistent library table layout and filter state (column order, widths, visibility, sort, search query) with `BroadcastChannel` sync.
- `module-playback-settings.ts`: persistent tracker playback settings (repeat, stereo/pan, interpolation, tempo, pitch) with sync.
- `metadata-settings.ts`: persistent metadata behavior settings, currently filename-based artist/title inference.
- `player-volume.ts`: persistent player volume with sync across windows.

### `src/lib/utils/`

- `files.ts`: extension/kind inference, playlist item creation/cloning, track identity, display formatting, filename-based metadata inference, drag/drop extraction, and Chromium file-system entry helpers.

### Types and shims

- `src/lib/types.ts`: shared domain types, supported extension constants, playlist/library view types, metadata/settings types, and playback snapshot types.
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
- The app now has two collections:
  - playlist: ordered playback queue with shuffle/repeat behavior
  - library: persistent deduped catalog with column-based view state
- Library search/filter query is part of the persistent library view state and syncs across windows with the rest of the library UI settings.
- `src/App.svelte` is responsible for workspace orchestration, but durable state should still live in stores/services.
- File import supports multiple sources:
  - plain file input fallback
  - `showOpenFilePicker()`
  - `showDirectoryPicker()` for top-level folder imports
  - drag/drop, including Chromium filesystem entry helpers
- Persisted items may be rehydrated from `FileSystemFileHandle`s. Preserve the `ensureLoaded()` flow and permission prompts when changing import or playback behavior.
- Metadata is inferred from filenames only when enabled in `metadata-settings`. Do not bake inference directly into components.
- `player-controller.ts` is the single coordinator for backend switching. Changes to transport or metadata propagation should usually start there.
- `module-player.ts`, `chiptune-loader.ts`, and the custom asset emission in `vite.config.ts` form one pipeline. Treat them as coupled.
- `vite.config.ts` emits `assets/libopenmpt.worklet.js`, configures the PWA manifest, and declares file handlers. Changes here can break offline playback, installed-app file opening, or module initialization.
- `window-manager.ts` writes the options UI into a popup window and syncs settings over storage/BroadcastChannel. Keep that flow local-first and backend-free.
- `src/main.ts` only registers the service worker in production. Preserve that split unless there is a strong reason to change it.

## Change guidance

- Before changing playback behavior, verify whether the code path is `stream` or `module` and keep both working.
- Before changing import behavior, inspect `src/App.svelte`, `src/lib/utils/files.ts`, and `src/lib/stores/playlist.ts` together.
- Before changing module playback settings, inspect `src/lib/stores/module-playback-settings.ts`, `src/lib/services/module-player.ts`, and `src/lib/services/window-manager.ts` together.
- Before changing library UI behavior, inspect `src/lib/components/PlaylistPanel.svelte` and `src/lib/stores/library-view-settings.ts` together.
- Before changing PWA/build behavior, inspect `vite.config.ts`, `src/main.ts`, and icon assets together.
- Prefer extending stores/services over adding more stateful logic to `App.svelte` or leaf components.
- Do not add backend/network assumptions, cloud dependencies, or server-coupled flows.
