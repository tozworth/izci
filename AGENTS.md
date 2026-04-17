# izci

`izci` (Turkish for "tracker") is a local-first, offline-capable Chromium PWA music player with first-class tracker module support.

## Maintenance

- Keep this document in sync with the repo. Update `AGENTS.md` after major structural, architectural, playback, persistence, or build/PWA changes.

## Core rules

- Preserve dual playback paths:
  - streamed formats (`mp3`, `wav`, `flac`, `ogg`, `opus`) use `Howler.js` in HTML5 audio mode
  - tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3`) use `Chiptune3` / Web Audio
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

- `src/main.ts`: Svelte mount, global CSS/material symbol import, and production-only handoff to the dedicated PWA registration/update service.
- `src/App.svelte`: top-level shell; composes the extracted workspace layouts/controllers, owns high-level workspace/playback coordination, global shortcuts, error banner wiring, and the shared artwork-backed workspace background/contrast state used by the shell and player footer.
- `src/app.css`: global styling.
- `src/lib/styles/themes.css`: shared color-theme tokens consumed by the main app and Options popup.
- `src/options/main.ts`: Options popup entry; mounts the dedicated popup Svelte app.
- `src/options/OptionsApp.svelte`: standalone Options window UI for appearance, module playback defaults, and metadata behavior, including the artwork-background appearance toggle.
- `src/options/app.css`: Options popup styling.
- `src/options/views.ts`: popup navigation/view metadata shared by the Options UI.
- `src/vite-env.d.ts`: Vite ambient types.

### `src/lib/components/`

UI only. Keep these focused on rendering and event dispatch.

- `PlayerControls.svelte`: transport controls, seek bar, volume, and currently selected/playing track context.
- `PlaylistPanel.svelte`: shared playlist/library composition shell; wires drag/drop import, selection events, library view settings, and the extracted playlist-panel subcomponents/helpers.
- `TopMenuBar.svelte`: desktop-style File/View menu bar that also adapts to Window Controls Overlay state, exposes draggable titlebar regions, hides the version label while overlay mode is active, and collapses into a compact `izci` chevron menu when available titlebar space is tight.
- `MenuSurface.svelte`: shared popup menu surface used by the compact titlebar menu; supports nested submenus plus in-place drilldown fallback when flyout submenus would overflow the window.
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
- `volume.ts`: shared slider-to-gain conversion helpers, including the logarithmic-volume mapping used by playback services.
- `media-session.ts`: Chromium Media Session bridge for now-playing metadata, seek position updates, OS/media-key transport handlers, and the silent native transport anchor used to keep Chromium media surfaces alive for non-native playback paths.
- `stream-artwork.ts`: on-demand embedded metadata/artwork loading for streamed files; currently extracts `title`/`artist`/`album` tags plus transient cover art from `flac` Vorbis comments/picture blocks and `opus` `OpusTags`/`METADATA_BLOCK_PICTURE` comments for playlist metadata, the player UI, and Media Session without persisting artwork blobs.
- `artwork-background.ts`: artwork brightness analysis used by the main app shell to decide when artwork-backed backgrounds should flip UI surfaces/text into a darker-on-light contrast mode.
- `pwa-updates.ts`: service-worker registration plus proactive update checks for long-lived preview/installed PWA windows so new builds can activate without getting stuck on the first cached shell.
- `theme.ts`: shared color-theme metadata, document-theme application, and dynamic `<meta name="theme-color">` updates used by both window entrypoints so Chromium/PWA window chrome tracks the active theme where supported.
- `window-controls-overlay.ts`: readable store that tracks Window Controls Overlay support, visibility, and `titlebarAreaRect` updates from Chromium's `geometrychange` event.
- `howler-player.ts`: streamed-audio backend built on `Howler.js`, using Howler's HTML5 audio mode so Chromium media controls and pause/resume integration stay anchored to a native media element.
- `module-player.ts`: tracker-module backend built on `Chiptune3`; applies runtime module playback settings and recreates the player when required by setting changes, while mirroring transport state to the browser media-session anchor without routing module audio through it.
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
- `playlist-metadata.ts`: background streamed-track metadata hydration (filename inference, embedded `flac`/`opus` tags, and duration probing).
- `playlist-navigation.ts`: next/previous/track-end resolution, including shuffle session management.
- `playlist-dedupe.ts`: duplicate detection based on track identity, used only by the library store path.
- `library-view-settings.ts`: persistent library table layout and filter state (column order, widths, visibility, sort, search query) with `BroadcastChannel` sync.
- `appearance-settings.ts`: persistent appearance settings for color theme, shell density, system font, narrow-library behavior, and the artwork-background toggle, with `BroadcastChannel` sync.
- `playback-settings.ts`: persistent general playback settings, currently the logarithmic-volume toggle, with sync.
- `module-playback-settings.ts`: persistent tracker playback settings (repeat, stereo/pan, interpolation, tempo, pitch) with sync.
- `metadata-settings.ts`: persistent metadata behavior settings, currently filename-based artist/title inference.
- `player-volume.ts`: persistent player volume with sync across windows.
- `workspace-panel-layout.ts`: persistent wide-layout workspace panel fractions for playlist/library/details resizing, with sync.

### `src/lib/utils/`

- `files.ts`: extension/kind inference, playlist item creation/cloning, track identity, display formatting, filename-based metadata inference, drag/drop extraction, and Chromium file-system entry helpers.

### Types and shims

- `src/lib/types.ts`: shared domain types, supported extension constants, workspace types, playlist/library view types, metadata/settings types, popup-menu item types (including nested children for drilldown titlebar menus), and playback snapshot types.
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
- `src/lib/components/workspace/` owns the tabbed vs wide workspace markup split; keep layout-specific composition there instead of rebuilding duplicated panel trees inside `App.svelte`.
- Wide-mode workspace panel widths are persisted in `localStorage` and sync across windows; tabbed mode ignores those widths.
- The workspace switches to tabbed mode at viewport widths of 750px and below.
- The Track Details workspace panel is closable and starts hidden until explicitly opened from a context action; when hidden, wide layout should reflow playlist/library widths without overwriting the stored three-panel proportions used when details is shown again.
- Color theme selection is persisted in `localStorage`, synced across windows, applied at the document level so both the main app and Options popup reuse the same theme tokens, and mirrored into the page `theme-color` meta tag so installed Chromium windows can recolor their chrome with the active theme.
- The optional artwork-backed workspace background is driven from `App.svelte` using the same transient embedded-artwork loading path as the footer artwork. When enabled and artwork is available, the shell swaps in a heavily blurred backdrop and uses `src/lib/services/artwork-background.ts` to flip shared shell surface/text tokens into a light-background contrast mode for bright covers.
- In Window Controls Overlay mode, the combined titlebar/menu bar should stay on the active theme's topbar color without artwork blur or glass effects so Chromium window chrome and the app's top strip remain visually aligned.
- Installed desktop builds opt into manifest `display_override: ['window-controls-overlay']` while preserving `display: 'standalone'` fallback. Users can still toggle the title bar at runtime, so overlay-specific UI must respond to live visibility/geometry changes rather than assuming the overlay is always active.
- `src/lib/services/window-controls-overlay.ts` is the single source of truth for Window Controls Overlay state. Consume its readable store instead of querying `navigator.windowControlsOverlay` directly from components.
- `src/lib/components/TopMenuBar.svelte` is responsible for titlebar adaptation: it becomes a drag region in overlay mode, marks interactive controls as `no-drag`, hides the version badge while overlay mode is visible, and sizes/collapses itself based on the live available `titlebarAreaRect.width` rather than raw viewport width.
- When the titlebar menu collapses, it should stay on the shared `MenuSurface.svelte` path rather than inventing a second menu system. `MenuSurface.svelte` supports nested submenus and a drilldown fallback that replaces File/View root entries with submenu contents when flyout submenus would overflow the current window.
- `src/App.svelte` is responsible for top-level workspace orchestration, but durable state and local algorithms should live in stores/services or the focused workspace components.
- `src/lib/services/import-controller.ts` is the entry point for picker capability checks and menu/input import behavior. Keep drag/drop extraction in `PlaylistPanel.svelte` and `src/lib/utils/files.ts`.
- Persisted items may be rehydrated from `FileSystemFileHandle`s. Preserve the `ensureLoaded()` flow and permission prompts when changing import or playback behavior.
- `player-controller.ts` is the single coordinator for backend switching. Changes to transport or metadata propagation should usually start there.
- Streamed playback intentionally stays on Howler's HTML5 audio mode because that path is the proven stable way to keep Chromium/desktop media controls alive for streamed formats without regressing row-activation or pause/resume behavior.
- Embedded streamed metadata/artwork is not sourced from Howler. `src/lib/services/stream-artwork.ts` reads `flac` and `opus` tags directly from the selected file or file handle on demand, persists parsed textual metadata (`title`/`artist`/`album`) into IndexedDB through the playlist metadata worker, creates transient blob URLs for cover art used by the current UI/media-session presentation, and does not persist artwork blobs.
- `PlayerControls.svelte` should consume shared artwork passed down from `App.svelte` rather than starting a second artwork-loading lifecycle of its own.
- Tracker modules still play through `Chiptune3`/Web Audio because rerouting real module audio through a browser-facing media element regressed playback quality/pitch; their media-surface integration is mirrored through the silent native transport anchor instead.
- The playback split is therefore intentional, not incidental:
  - streams prioritize native browser media integration through a real media element
  - modules prioritize correct Chiptune3 playback while separately mirroring transport state to Chromium
- Workspace context actions and library membership checks should stay in `src/lib/services/workspace-actions.ts`; wide-layout sizing rules should stay in `src/lib/services/workspace-layout.ts`.
- `module-player.ts`, `chiptune-loader.ts`, and the custom asset emission in `vite.config.ts` form one pipeline. Treat them as coupled.
- `vite.config.ts` emits `assets/libopenmpt.worklet.js`, configures the PWA manifest, and declares file handlers. Changes here can break offline playback, installed-app file opening, or module initialization.
- `src/lib/services/pwa-updates.ts` complements the Vite PWA config by proactively calling `ServiceWorkerRegistration.update()` on focus/visibility/interval, which is especially important for long-lived installed windows and `vite preview` on `localhost`.
- The Options window is a separate Vite/Svelte entrypoint (`options.html` -> `src/options/main.ts`) rather than an inline HTML string. Keep popup UIs local-first and frontend-only.
- `popup-windows.ts` is the registry for managed popup definitions. Add future popup windows there so `window-manager.ts` stays generic.
- `src/main.ts` only registers the service worker in production. Preserve that split unless there is a strong reason to change it.

## Change guidance

- Before changing playback behavior, verify whether the code path is `stream` or `module` and keep both working.
- Prefer extending stores/services over adding more stateful logic to `App.svelte` or leaf components.
- Do not add backend/network assumptions, cloud dependencies, or server-coupled flows.
