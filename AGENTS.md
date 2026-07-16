# izci

`izci` (Turkish for "tracker") is a local-first, offline-capable Chromium PWA music player with first-class tracker module support.

## Maintenance

- Keep this document in sync with the repo. Update `AGENTS.md` after major structural, architectural, playback, persistence, or build/PWA changes.
- The project is in pre-alpha personal testing with an active userbase of one. Compatibility and migration policy is intentionally scorched earth: the current version supports the current version only. Prefer clean state/key/schema changes over compatibility adapters or legacy migrations unless explicitly requested.

## Core rules

- Preserve dual playback paths:
  - streamed formats (`mp3`, `wav`, `flac`, `ogg`, `opus`) use `Howler.js` in HTML5 audio mode
  - tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3`) use `Chiptune3` / Web Audio
- Offline PWA functionality is required and must not regress.
- Target Chromium/Blink desktop and installed PWA behavior. Prefer Chrome APIs and desktop-PWA integrations over compatibility shims.
- Assume no backend. The app runs locally against user-selected files and file handles.
- Run a build (`npm run build`) after every source change so user's hot reload stays current. However, do not start local dev/preview servers or perform browser inspection yourself unless user explicitly asks. Prefer static inspection, focused tests, `npm run check`, or `npm run build`.
- Do not use the Codex built-in browser as proof for installed-PWA-only behavior such as Window Controls Overlay, file handlers, or desktop window integrations; verify those paths only when explicitly requested and only in an appropriate Chromium/PWA surface.
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

- `package.json`: Vite/Svelte app manifest and scripts (`dev`, `build`, `preview`, `test`, `check`).
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
- `src/App.svelte`: lean top-level composition root; wires stores/controllers, derives shell/backdrop state, coordinates View -> Now Playing, and connects focused app controllers to the rendered menu, workspace, and player surfaces.
- `src/app.css`: main app global stylesheet entrypoint; imports the shared theme tokens plus focused app-shell CSS files.
- `src/lib/styles/themes.css`: shared color-theme tokens consumed by the main app and Options popup.
- `src/lib/styles/app/`: focused main-window CSS split by ownership (`base`, `shell`, `menus`, `workspace`, `panels`, `player`).
- `src/options/main.ts`: Options popup entry; mounts the dedicated popup Svelte app.
- `src/options/OptionsApp.svelte`: standalone Options popup shell; owns popup lifecycle, navigation, breadcrumbs, page tools, reset dispatch, and Window Controls Overlay layout while delegating route content and store bindings to focused view components.
- `src/options/components/views/`: focused Options route components for Appearance, Backdrops, Now Playing, Lyrics, Playback, Visualizer, Modules, Tracks, Filesystem, Library, Metadata, and About. Tracks owns the folder nesting limit and opt-in unknown-file verification. Filesystem lists reusable FSA directory roots and owns permission/regrant/forget actions; Library configures manual or launch-time folder scans, accepts remembered, picked, or dropped folders, and reports scan state. Metadata remains a Tracks subpage. Appearance owns local-font permission/loading UI. The UI also includes the empty-workspace-panel behavior toggle, the Now Playing side-chrome auto-hide timeout, and the window-title track-name toggle. The wide workspace backdrop zones and persisted dock-panel keys are positional: left, center, and right.
- `src/options/components/SettingsField.svelte`: shared label/control/hint shell for Options fields; route views retain their own store bindings and controls.
- `src/options/app.css`: Options popup styling.
- `src/options/views.ts`: popup navigation/view metadata shared by the Options UI.
- `src/options/components/raf/`: split effects-list/cardless-editor Raf workspace and the Graphic EQ, Stereo Width, multiband Crystalizer, Sloptimizer, and stereo convolution Reverb settings editors. The attached sticky rack toolbar manages synchronized named presets and imports/exports normalized rack settings through the clipboard or JSON files. These components edit synchronized stores only and never own Web Audio nodes. Sloptimizer defaults to its one-slider Simple mode; Advanced mode exposes six tuned controls without changing DSP topology.
- `src/vite-env.d.ts`: Vite ambient types.
- `src/**/*.test.ts`: Vitest unit tests for pure helpers/services.

### `src/lib/components/`

UI only. Keep these focused on rendering and event dispatch.

- `PlayerControls.svelte`: transport controls, seek bar, volume, and currently selected/playing track context.
- `PlayerVisualizer.svelte`: canvas spectrum visualizer renderer driven by the shared visualizer service and settings store; supports clipping to active backdrop-zone rectangles.
- `SharedBackdropArtwork.svelte`: single shared artwork layer that tracks active artwork zones and renders per-zone tuned blurred/dimmed artwork behind the shared visualizer/UI without changing zone layout.
- `SharedBackdropVisualizer.svelte`: single shared visualizer layer that tracks active visualizer zones, sizes itself to their combined bounds, and clips one canvas to those zones.
- `BackdropZone.svelte`: reusable pane wrapper that marks zones that should reveal shared artwork and/or visualizer layers while applying local contrast variables.
- `PlaylistPanel.svelte`: shared playlist/library composition shell; wires drag/drop import, selection events, library view settings, and the extracted playlist-panel subcomponents/helpers.
- `TopMenuBar.svelte`: desktop-style File/View menu bar that also adapts to Window Controls Overlay state, exposes draggable titlebar regions, hides the version label while overlay mode is active, and collapses into a compact `izci` chevron menu when available titlebar space is tight.
- `MenuSurface.svelte`: shared popup menu surface used by the compact titlebar menu; supports nested submenus plus in-place drilldown fallback when flyout submenus would overflow the window.
- `TrackDetailsPanel.svelte`: selected-track metadata/details surface; suppresses album and album-artist rows that only repeat the title or artist.
- `LyricsPanel.svelte`: transient embedded lyrics surface; loads Vorbis-comment lyrics on demand, parses synced LRC timestamps, and renders plain, timestamped, or Theater-style synced views against the shared playback snapshot.

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

- `AppWorkspace.svelte`: presentation-only switchboard for Now Playing, tabbed, and wide workspace layouts; centralizes their shared playback, artwork, lyrics, panel-prop, and tab-event wiring without owning app state.
- `WorkspaceTabContent.svelte`: shared Playlist, Library, Details, and Lyrics tab renderer used by all workspace layouts.
- `TabbedWorkspace.svelte`: slim tabbed workspace layout for open workspace tabs; supports persisted tab reordering and close events without wide-panel docking.
- `WideWorkspace.svelte`: wide desktop dock workspace with three resizable panel slots; renders per-panel tab strips, tab drag/drop between panels, collapsed-edge drop targets, and empty panels when the Appearance setting requests them.
- `NowPlayingWorkspace.svelte`: focused Apple Music-like Now Playing layout with large centered artwork/controls and the open workspace tabs alongside it; the side pane can fade its tabs/background after mouse inactivity, supports tab reordering/closing, and the Details tab intentionally hides its own artwork to avoid duplicating the large cover.
- `WorkspaceTabBar.svelte`: shared closeable/reorderable tab strip used by wide panels, slim tabbed layout, and Now Playing.
- `WorkspaceResizer.svelte`: reusable vertical separator handle for wide workspace layouts.
- `drag.ts`: native tab drag metadata helpers shared by workspace renderers.
- `types.ts`: shared workspace component prop/event types used by the tabbed and wide layout components.
- `backdrop-zone-observer.ts`: shared resize/mutation observer and refresh scheduler for artwork and visualizer backdrop-zone geometry.

### `src/lib/services/`

Primary location for playback and browser-integration logic.

- `file-launch.ts`: Chromium Launch Queue integration for installed-PWA file associations; converts launched file handles into `File`s and queues them until the app is ready to replace the playlist.
- `import-controller.ts`: file import controller for picker capability detection, file-input fallback, open-files flow, and recursive folder import flow; folder picks also register their reusable FSA root handles.
- `filesystem-folders.ts`: IndexedDB-backed reusable FSA directory-root registry with cross-window refresh, permission/availability probing, Library membership, and scan status. Directory handles never go through `localStorage`.
- `library-folder-scanner.ts`: main-window-only manual/launch library scan owner; checks permission without unsolicited prompts, traverses/validates files, and reconciles folder-owned tracks into the library.
- `library-folder-coordination.ts`: small `BroadcastChannel` command bridge that lets the Options popup request a scan while keeping library mutations in the main window.
- `file-verification.ts`: unknown-extension import gate. With verification enabled it probes files in a separate muted Chiptune3/OpenMPT player and admits successful files as tracker modules without touching active playback; with verification disabled it marks all unknown files as modules so normal playback determines whether they work.
- `app-shortcuts.ts`: global main-window keyboard/context-menu command router; interprets shortcuts against a supplied app snapshot and delegates all mutations to shell/playback/window handlers.
- `app-backdrops.ts`: pure app-shell backdrop presentation resolver; derives active artwork/visualizer requests, per-zone brightness contrast, shared-layer geometry keys, and workspace-zone backdrop props.
- `player-controller.ts`: single coordinator for backend switching, snapshot updates, metadata inference application, and player volume propagation.
- `playback-commands.ts`: app-shell playback command controller; coordinates playlist-backed play/load sequencing, launched-file playlist addition/replacement, play/pause/stop/seek actions, and next/previous/track-end navigation while delegating backend playback to `player-controller.ts`.
- `playback-restoration.ts`: checkpoints the current playlist track, position, and playing state in `localStorage`, then restores the configured subset after playlist hydration on reload/relaunch without prompting for file access.
- `play-count.ts`: app-shell play-count tracker; counts a track once after the configured continuous playback threshold, only when the playing item resolves to a library track.
- `idle-player-copy.ts`: curated idle player-bar quips and session-stable random selection.
- `volume.ts`: shared slider-to-gain conversion helpers, including the logarithmic-volume mapping used by playback services.
- `media-session.ts`: Chromium Media Session bridge for now-playing metadata, seek position updates, OS/media-key transport handlers, and the silent native transport anchor used to keep Chromium media surfaces alive for non-native playback paths.
- `visualizer.ts`: publishes and configures the shared post-source analyser from `audio-bus.ts` for the player visualizer.
- `audio-bus.ts`: shared Web Audio context/source owner; reroutes the Howler-owned HTML media element and the Chiptune3 gain output through pre-Raf source gain, Raf, the analyser, and the post-Raf master-volume gain without merging their transport backends.
- `raf-engine.ts`: main-window-only live Raf graph owner; subscribes directly to synchronized settings, maintains dry/wet bypass paths, updates parameters in place, and crossfades topology replacements.
- `raf-meter.ts`: transient cross-window Raf input/output peak telemetry; publishes the main window's live rack levels to the Options popup without persisting meter state.
- `raf-settings-transfer.ts`: validated Raf rack settings serialization plus clipboard and JSON-file import/export helpers.
- `raf-effect-registry.ts`: compile-time-only registry for built-in Raf effects, their defaults/normalizers, DSP factories, parameter updates, and disposal.
- `raf-effects/`: Web Audio implementations for the ten-band Graphic EQ, attenuation-only Stereo Width M/S processor, 13-band Crystalizer, three-band Sloptimizer loudness maximizer, and stereo convolution Reverb plus shared smoothing/disposal helpers. Graphic EQ and Crystalizer calculate always-on output headroom from their combined filter responses; Stereo Width changes the Side-to-Mid ratio without applying positive matrix gain; Sloptimizer finishes with a ceiling-bounded limiter curve; Reverb crossfades deterministic room impulses when room or decay changes.
- `artwork-palette.ts`: transient artwork color sampler used by the visualizer and optional artwork-colored player chrome; derives normalized player/visualizer palettes from the current artwork and caches per blob URL without persisting artwork data.
- `stream-artwork.ts`: on-demand embedded metadata/artwork loading for streamed files; extracts common text tags (`title`, `artist`, `album`, `albumArtist`, `genre`, `year`, track/disc numbers, `composer`) from `flac` Vorbis comments and `opus`/`ogg` comment packets, plus ReplayGain/R128 tags from those comment packets and MP3 ID3/APEv2 tags; also creates transient cover art from `flac` picture blocks and `opus` `METADATA_BLOCK_PICTURE` comments for the player UI and Media Session without persisting artwork blobs.
- `lyrics.ts`: on-demand transient embedded lyrics loading for streamed files with Vorbis-comment support; reads `LYRICS`/synced lyrics tags from supported comment packets, parses LRC timestamps, and does not persist lyric text in playlist/library metadata.
- `lyrics-presentation.ts`: main-shell lyrics presentation controller; owns async availability tracking, automatic panel open/close behavior, Now Playing lyrics focus restoration, and auto-scroll resume tokens.
- `module-metadata.ts`: background `Chiptune3` metadata probe used by store hydration to capture tracker-module duration/details without waiting for normal playback.
- `artwork-background.ts`: artwork brightness analysis used by the main app shell to decide when artwork-backed backgrounds should flip UI surfaces/text into a darker-on-light contrast mode.
- `artwork-presentation.ts`: main-shell artwork/details presentation controller; manages player/footer artwork loading, details-panel artwork synchronization, artwork-background slot swapping/cleanup, brightness-driven contrast state, and the temporary window-chrome transition bypass used when Window Controls Overlay visibility changes.
- `workspace-shell.ts`: main-shell workspace controller; manages active playlist/library focus, open tab placement/order, panel open/collapse state, tab move/close/show commands, playlist jump requests, wide-layout resize state, derived workspace panel props/tabs, and wide-layout width recomputation from the persisted panel layout store.
- `pwa-updates.ts`: service-worker registration plus proactive update checks for long-lived preview/installed PWA windows, durable About-page check status/timestamps, and a manual apply-and-restart path for waiting updates.
- `app-install.ts`: Chromium install-prompt coordinator; retains the deferred browser prompt, hides install UI in installed display modes, and manages the one-time post-engagement File-menu hint acknowledgement.
- `theme.ts`: shared color-theme metadata, document-theme application, and dynamic `<meta name="theme-color">` updates used by both window entrypoints so Chromium/PWA window chrome tracks the active theme where supported.
- `local-fonts.ts`: progressive Local Font Access API wrapper used by Options to request permission and enumerate local font families without persisting the font inventory.
- `window-controls-overlay.ts`: readable store that tracks Window Controls Overlay support, visibility, and `titlebarAreaRect` updates from Chromium's `geometrychange` event.
- `window-mini-mode.ts`: Chromium/PWA-oriented mini-mode window controller; remembers the pre-mini window bounds, resizes the app to a player-focused height, restores the previous bounds, and tracks manual resize exits.
- `window-display-state.ts`: Chromium desktop-window geometry detector for maximized/fullscreen state; used by the Appearance option that can automatically show Now Playing while the main window occupies the screen/work area.
- `howler-player.ts`: streamed-audio backend built on `Howler.js`, using Howler's HTML5 audio mode so Chromium media controls and pause/resume integration stay anchored to a native media element.
- `module-player.ts`: tracker-module backend built on `Chiptune3`; applies runtime module playback settings and recreates the player when required by setting changes, while mirroring transport state to the browser media-session anchor without routing module audio through it.
- `chiptune-loader.ts`: guarded one-time `Chiptune3` initialization with timeout/error handling.
- `popup-windows.ts`: registry of popup window definitions (path, name, features) used by the window manager.
- `workspace-actions.ts`: workspace collection helpers plus playlist/library context action builders.
- `workspace-collections.ts`: app-shell playlist/library mutation coordinator; owns file-add selection behavior, removal cleanup, context-action execution, and library play-count updates.
- `workspace-layout.ts`: wide-workspace width math, resize constraints, and panel-layout resolution for any visible subset of the three panel slots while preserving hidden-slot proportions.
- `window-manager.ts`: generic popup launcher/tracker and desktop-PWA exit behavior; keep UI out of this file.
- `options-window-state.ts`: persists the Options popup's last active page and user-resized dimensions for later launches.
- `window-fullscreen.ts`: small Chromium/PWA-friendly Fullscreen API helper used by the Alt+Enter Now Playing shortcut to distinguish app-requested fullscreen from pre-existing maximized/fullscreen window states.

### `src/lib/stores/`

- `playlist.ts`: owns both `playlistStore` and `libraryStore`; now acts as the public assembly layer that wires collection state, persistence flush/queue behavior, and the extracted playlist helpers together.
- `playlist-persistence.ts`: IndexedDB open/read/write helpers plus stored-item serialization (including the canonical privacy-safe import-relative path and optional managed-folder ID) and playback option normalization for playlist/library state.
- `playlist-materialization.ts`: file-handle permission and rehydration helpers, including streamed-format object URL creation/revocation during `ensureLoaded()`.
- `playlist-selection.ts`: selection normalization and selection action helpers shared by playlist and library stores.
- `playlist-metadata.ts`: background metadata hydration for playlist/library items (filename inference, embedded `flac`/`opus` tags, streamed duration probing from `File`/handle-backed URLs, and tracker-module metadata/duration probing).
- `playlist-navigation.ts`: next/previous/track-end resolution, including shuffle session management.
- `playlist-dedupe.ts`: duplicate detection based on track identity, used only by the library store path.
- `persistent-store.ts`: shared `localStorage` plus `BroadcastChannel` persistence/sync helper for lightweight settings stores.
- `library-view-settings.ts`: persistent library table layout and filter state (including the Folder column, column order, widths, visibility, sort, and search query) with `BroadcastChannel` sync.
- `appearance-settings.ts`: persistent appearance settings for color theme, optional artwork-colored player chrome, system font, compact one-row player-bar mode, contextual idle player quips, narrow-library behavior, whether empty workspace panels stay open after their last tab closes, View -> Now Playing layout state plus the maximized/fullscreen auto-Now-Playing preference and side-chrome auto-hide timeout, per-zone backdrop effects for the Left/Center/Right dock slots, player bar, and Now Playing (`none`, `artwork`, `visualizer`, `both`), per-zone artwork blur/brightness tuning, transient lyrics display preferences, and whether the main window title mirrors the current track title, with `BroadcastChannel` sync.
- `playback-settings.ts`: persistent general playback settings for logarithmic-volume, streamed ReplayGain mode, reload/relaunch playback restoration (`disabled`, position only, or position and state), the default-off Raf feature gate, and visibility of the player-bar Raf bypass toggle, with sync. The feature gate controls processing availability and Options navigation visibility; it is separate from the rack's own temporary power/bypass state.
- `raf-settings.ts`: persistent global Raf rack state (order, stable instance IDs, optional per-instance display names, bypass states, and typed parameters) in `localStorage`, synchronized with `BroadcastChannel`.
- `raf-presets.ts`: persistent named Raf effect-rack snapshots plus the selected preset in `localStorage`, synchronized with `BroadcastChannel`; presets contain effect order/settings/bypass state but exclude the rack-level global power/bypass toggle, and dirty state compares only the preset-owned effect rack.
- `visualizer-settings.ts`: persistent player visualizer settings (style, color source, height, opacity stored as transparency, and numeric spectrum-normalization strength), with sync.
- `module-playback-settings.ts`: persistent tracker playback settings (repeat, stereo/pan, interpolation, tempo, pitch) with sync.
- `metadata-settings.ts`: persistent metadata behavior settings, including filename-based artist/title inference and the library play-count threshold.
- `track-settings.ts`: persistent track-import settings for folder traversal depth, optional OpenMPT verification of files with unknown extensions, and whether OS-associated file launches add to or replace the playlist.
- `player-volume.ts`: persistent player volume with sync across windows.
- `workspace-panel-layout.ts`: persistent wide-layout workspace panel fractions for left/center/right resizing, with sync.
- `workspace-panel-state.ts`: persistent dock workspace state, including tab-to-panel placement, panel active tabs, open/collapsed panel slots, tabbed-layout order, active workspace tab, active playlist/library focus, and legacy Details/Lyrics visibility migration, with sync.

### `src/lib/utils/`

- `files.ts`: extension/kind inference, playlist item creation/cloning, track identity, display formatting, filename-based metadata inference, depth-limited recursive drag/drop extraction, unknown-file module overrides, and Chromium file-system entry helpers.

### Types and shims

- `src/lib/types.ts`: shared domain types, supported extension constants, workspace and lyrics view types, playlist/library view types, metadata/settings types, popup-menu item types (including nested children for drilldown titlebar menus), and playback snapshot types.
- `src/lib/types/chiptune3.d.ts`: local typings for `chiptune3`.
- `src/lib/types/file-system-access.d.ts`: File System Access API typing shim used by the app.
- `src/lib/types/howler.d.ts`: local typings for `howler` integration gaps.
- `src/lib/types/node-fs.d.ts`: node `fs` typing shim used by Vite config.
- `src/lib/types/node-url.d.ts`: node `url` typing shim used by Vite config.
- `src/lib/types/pwa-register.d.ts`: typing shim for `virtual:pwa-register`.

## Public assets

- `public/icons/izci-icon.svg`: primary app icon.
- `public/icons/izci-file.png`: PNG app icon used by Chromium file-handler associations.
- `public/icons/izci-mark.svg`: monochrome mecha-vinyl brand mark used as a CSS mask in the main player.
- `public/icons/izci-mark-light.svg`: dark-and-orange mecha-vinyl mark for light presentation surfaces such as the About hero.
- `public/icons/izci-maskable.svg`: maskable PWA icon.

## Experimental features

- Treat requests to "add an experiment", "add experiment where...", or similar wording as opt-in exploratory UI unless the request explicitly gives the feature a permanent home.
- When introducing the first active experiment, add an Options -> Experimental view and a synchronized `experimental-settings.ts` store for its opt-in state. Experiments should default to off.
- Keep the experiment's runtime behavior in the normal architectural owner for that behavior: services/stores for logic and persistence, focused components for rendering and event dispatch. The Experimental Options page is the control surface, not a catch-all implementation file.
- Experimental code must still preserve the core playback, offline PWA, persistence, and browser-integration rules in this document. Prefer a clean feature gate around the exploratory path so disabling it restores the established behavior.
- There are currently no active experiments. The cardless Raf workspace and duplicate Track Details suppression are permanent; the single-page Options prototype was removed.

## Architecture notes

- Internally supported formats are centralized in `src/lib/types.ts`; the module list follows the official extension list exposed by the bundled libopenmpt build and is used by picker, folder, and drag imports without probing. PWA file-handler associations intentionally remain a small conservative subset declared separately in `vite.config.ts` to avoid claiming ambiguous extensions in Windows.
- Verify added files only controls unknown extensions. When enabled, a muted OpenMPT probe must accept an unknown file before it is marked as a tracker module. When disabled, any unknown file is marked as a module and normal playback is allowed to succeed or fail.
- `src/lib/utils/files.ts` creates `objectUrl`s only for streamed formats. Do not force tracker modules down the streamed path.
- `src/lib/stores/playlist.ts` persists playlist and library collections separately in IndexedDB (`izci-playlist`, `izci-library`). The library store dedupes tracks; the playlist store does not.
- Reusable FSA directory roots are persisted separately in `izci-filesystem`. Filesystem entries can opt into Library scans manually or on launch; launch scans never request permission, and the Options popup delegates actual reconciliation to the main window.
- Managed library scans match tracks by folder ownership plus canonical `PlaylistItem.path`, preserve stable item IDs and play counts, refresh changed-file metadata, remove missing items owned by that folder, and leave manual/other-folder items alone. Removing or forgetting a root does not remove its existing library tracks; a later scan may re-adopt orphaned matches.
- `PlaylistItem.path` is the sole persisted/display path for imported files. The Library Folder column derives its directory from that value; do not add a parallel cached folder string.
- `src/lib/stores/playlist.ts` should stay as the public store facade; persistence, materialization, selection, metadata, navigation, and dedupe logic now live in focused sibling modules.
- `src/lib/components/workspace/` owns the tabbed vs wide workspace markup split and the shared workspace tab bar; keep layout-specific composition there instead of rebuilding duplicated panel trees inside `App.svelte`.
- Wide-mode workspace panel widths are persisted in `localStorage` and sync across windows; tabbed mode ignores those widths but keeps its own persisted open-tab order through `workspace-panel-state.ts`.
- The workspace switches to tabbed mode at viewport widths of 660px and below. Playlist/library panels keep their full column/format layouts down to 280px before using their narrow presentation.
- Playlist, Library, Track Details, and Lyrics are dockable workspace tabs. In wide mode, tabs can be reordered within a panel or dragged to another panel; closing the last tab collapses that panel unless Appearance -> Interface -> Keep empty workspace panels open is enabled. Collapsed panel slots should expose drag-edge targets while a tab is being dragged so users can restore left/center/right panels without using the menu.
- All workspace tab placement, open/closed tab state, panel active tabs, tabbed-layout order, and open empty-panel slots are persisted in `workspace-panel-state.ts`; wide panel proportions remain in `workspace-panel-layout.ts`. Hidden panel slots should reflow visible panels without overwriting the stored three-panel proportions used when slots return.
- Color theme selection is persisted in `localStorage`, synced across windows, applied at the document level so both the main app and Options popup reuse the same theme tokens, and mirrored into the page `theme-color` meta tag so installed Chromium windows can recolor their chrome with the active theme. Chameleon separately exposes persisted hue and saturation sliders and derives contrast-safe dark theme tokens from them; changing themes must not reset its chosen color.
- The main app window title defaults to the current track title when one is available, but Appearance settings can force it to remain `izci`; this preference is persisted in `localStorage` and synced across windows with the rest of the appearance settings.
- The optional artwork-colored player mode samples the current player artwork through `src/lib/services/artwork-palette.ts` and applies normalized player-bar CSS variables from `PlayerControls.svelte`. Keep it transient and frontend-only; do not persist sampled artwork palettes or blobs.
- Artwork and visualizer backdrops are configured per zone in Options -> Backdrops: Left, Center, Right, player bar, and Now Playing can each display none, artwork, visualizer, or both. New/default settings keep the Left/Center/Right dock slots and player bar on none, while Now Playing uses artwork only. Artwork blur/brightness tuning is also persisted per zone and must survive temporarily switching that zone away from artwork. `BackdropZone.svelte` marks workspace panes/Now Playing as artwork/visualizer zones; `PlayerControls.svelte` does the same for the player bar without rendering backdrop media itself. `SharedBackdropArtwork.svelte` renders tuned blurred artwork for active artwork zones below `SharedBackdropVisualizer.svelte`, which renders exactly one visualizer canvas clipped to active visualizer zones so randomized styles such as triangles stay visually coherent across panes while player-only mode sizes to the player bar. Keep bright-artwork contrast variables local to the affected zone so artwork-backed panes do not partially invert unrelated UI.
- `src/lib/services/artwork-presentation.ts` still coordinates transient artwork loading, details artwork synchronization, artwork-background slot cleanup, brightness analysis, and Window Controls Overlay transition bypassing. It should provide artwork/brightness state to the zone renderers rather than applying global shell artwork classes.
- The visualizer is a transparent shared canvas clipped to the zones that requested it. It can read visualizer palette CSS variables from the active theme or derive a transient palette from the current player artwork, falling back to theme colors when no artwork palette is available. Keep it independent from artwork backdrop choice; artwork-backed zones must not cover or replace the visualizer layer.
- The menu bar should always stay on the active theme's topbar color without artwork blur or glass effects; Window Controls Overlay mode only changes its titlebar geometry and drag regions.
- Installed desktop builds opt into manifest `display_override: ['window-controls-overlay']` while preserving `display: 'standalone'` fallback. Users can still toggle the title bar at runtime, so overlay-specific UI must respond to live visibility/geometry changes rather than assuming the overlay is always active.
- Browser-tab sessions expose File -> Install izci only while Chromium supplies a `beforeinstallprompt` event. The amber File-menu hint waits until the user imports or plays music, remains visible for its first menu opening, and is then permanently quieted in `localStorage`; installed app windows do not show the command.
- `src/lib/services/window-controls-overlay.ts` is the single source of truth for Window Controls Overlay state. Consume its readable store instead of querying `navigator.windowControlsOverlay` directly from components.
- `src/lib/services/window-mini-mode.ts` is the single source of truth for the View -> Mini mode command and `Ctrl+M` shortcut. Keep window resizing/restoration behavior there rather than scattering `resizeTo()` or `moveTo()` calls through components.
- `src/lib/services/artwork-presentation.ts` is the single coordinator for app-shell artwork/details presentation side effects. Keep artwork loading/revocation, details-artwork waiting, background-slot cleanup, brightness analysis coordination, and overlay-transition bypass logic there rather than rebuilding them in `App.svelte`; zone components should consume its output for rendering.
- `src/lib/services/playback-commands.ts` is the single coordinator for app-shell playback command sequencing. Keep playlist-backed play/load request ordering, launched-file addition/replacement, and next/previous/end-of-track command flow there rather than rebuilding that logic in `App.svelte`.
- Playback reload/relaunch checkpoints live in `src/lib/services/playback-restoration.ts` under `izci.playback-restoration`. Restoration waits for playlist IndexedDB hydration, rematerializes the saved playlist item without an unsolicited permission prompt, and routes initial-position loading through `player-controller.ts` so streamed and tracker backends preserve their separate playback paths. Position-and-state restoration is best effort when Chromium autoplay policy blocks a fresh launch.
- `src/lib/services/workspace-shell.ts` is the single coordinator for app-shell workspace state. Keep selection exclusivity, active collection/tab tracking, tab placement/open/close/move behavior, playlist jump requests, workspace panel prop derivation, and wide-layout resize coordination there rather than rebuilding that logic in `App.svelte`.
- `src/lib/components/TopMenuBar.svelte` is responsible for titlebar adaptation: it becomes a drag region in overlay mode, marks interactive controls as `no-drag`, hides the version badge while overlay mode is visible, and sizes/collapses itself based on the live available `titlebarAreaRect.width` rather than raw viewport width.
- When the titlebar menu collapses, it should stay on the shared `MenuSurface.svelte` path rather than inventing a second menu system. `MenuSurface.svelte` supports nested submenus and a drilldown fallback that replaces File/View root entries with submenu contents when flyout submenus would overflow the current window.
- `src/App.svelte` is responsible for top-level workspace orchestration, but durable state and local algorithms should live in stores/services or the focused workspace components.
- View -> Now Playing is a content layout toggle persisted in `appearance-settings.ts`; the optional maximized/fullscreen auto mode uses `window-display-state.ts` as an effective layout trigger without overwriting the user's persisted manual toggle. The Now Playing side-chrome auto-hide timeout is also persisted there and should remain a presentation behavior in `NowPlayingWorkspace.svelte`. It should reuse `NowPlayingWorkspace.svelte`, `PlayerControls.svelte`, the shared workspace tab order, and the normal workspace/playlist/playback services rather than introducing separate playback or tab state.
- `src/lib/services/import-controller.ts` is the entry point for picker capability checks and menu/input import behavior. Folder picks are also registered through `filesystem-folders.ts`. Keep drag/drop extraction in `PlaylistPanel.svelte` and `src/lib/utils/files.ts`; FSA directory handles discovered by drops are dispatched to the app shell for registry persistence.
- Persisted items may be rehydrated from `FileSystemFileHandle`s. Preserve the `ensureLoaded()` flow and permission prompts when changing import or playback behavior.
- `player-controller.ts` is the single coordinator for backend switching. Changes to transport or metadata propagation should usually start there.
- The visualizer reads the shared post-source analyser in `audio-bus.ts`. The audible sources still preserve the dual playback split: the Howler-owned HTML media element is rerouted with `createMediaElementSource()`, while tracker modules feed the same pass-through bus from the Chiptune3 gain node using the bus-owned `AudioContext`. Do not route streams through Chiptune3 or real module audio through a browser media element.
- The final shared output graph is `Howler/Chiptune3 source -> audio-bus ingress/ReplayGain -> Raf -> analyser -> master volume -> destination`. Player volume and mute belong only on the post-Raf master gain so they do not change dynamics processing or Raf meter levels; streamed ReplayGain remains an intentional pre-Raf input adjustment. Howler retains backend volume handling only as a progressive fallback when Chromium cannot route its media element through Web Audio. Raf must not own transport or decoding.
- Raf DSP and graph topology belong in `src/lib/services/`; Options components only edit `rafSettings`. The engine subscribes independently of the Options lifecycle so closing the popup never disables processing.
- Raf settings updates are differential: identical synchronized rack deliveries must be ignored, unchanged effects must not receive update calls, and effect implementations must automate only parameters whose effective values changed. This prevents high-frequency edits in one effect from disturbing unrelated Web Audio nodes.
- Raf parameter smoothing must anchor a finite current value with `cancelScheduledValues()` plus `setValueAtTime()` before starting a replacement ramp. Do not use `cancelAndHoldAtTime()` here: dense Chromium range-input events can drive the audio graph to non-finite output and poison downstream recursive filters.
- Raf is one global rack persisted under `izci.raf-settings` and synchronized on `izci-raf-settings`. Unknown/malformed instances, duplicate/invalid IDs, non-finite parameters, and malformed EQ arrays must normalize away before reaching the live graph.
- `persistent-store.ts` suppresses structurally identical external values because another same-origin window can deliver one settings write through both the `storage` event and `BroadcastChannel`; preserve that deduplication when changing cross-window sync.
- Raf is disabled at the application level by default through `playbackSettings.enableRaf`. Enabling it reveals the Raf Options child page and allows processing; the power glyph inside Raf only bypasses the current rack and must never hide the page.
- The optional player-bar Raf power glyph is visible only while the Raf feature gate is enabled, toggles `rafSettings.enabled` as the same global rack bypass used by the Raf page, and opens the Raf Options page directly on right-click.
- Built-in Raf effects are compile-time entries in `raf-effect-registry.ts`; the DSP registry must not import Svelte components. Raf supports multiple freely ordered Graphic EQ, Stereo Width, Crystalizer, Sloptimizer, and Reverb instances with global/per-effect bypass, reset, removal, drag reorder, and keyboard-accessible move commands.
- Graphic EQ gain controls are limited to +/-12 dB and its always-on headroom stage compensates the combined peak response, including preamp gain, with a small safety margin. Raf input/output meters are transient and shared from the audio-owning main window to Options; the clipping warning reflects only post-Raf output at 0 dBFS, and meter values must not be persisted in `rafSettings`.
- Stereo Width persists one -24 dB to +24 dB Side-to-Mid ratio. Negative values attenuate Side while leaving Mid at unity; positive values attenuate Mid while leaving Side at unity. Keep this effect attenuation-only so width changes cannot add peak gain.
- Crystalizer persists 13 per-band intensities plus mute and bypass state. It keeps a unity dry path, adds band-limited second-difference transient shaping, and calculates a complex combined-response headroom gain with a 1 dB safety margin. Keep zero intensity transparent and do not add oversampling, fixed-quantum, or other backend-oriented controls.
- Sloptimizer persists its Simple/Advanced presentation mode, a 0-100 Slop macro, customization flag, three band lifts, adjustable low/mid and mid/high crossover points, density, speed, and output ceiling. Moving Slop reapplies the nonlinear V-shaped stock mapping only to the lifts, density, speed, and ceiling; crossover points remain independent and are restored to the stock 180 Hz/3 kHz values only when the entire effect is reset. Manual edits to Slop-mapped Advanced controls retain Slop as an approximate position until Reset mapping is used, while crossover edits do not affect that customization state. Mode switches must never change DSP values. Its stock 0% mapping uses the direct dry path, while active settings run three-band multiband compression into a fast limiter and ceiling-bounded waveshaper.
- Reverb persists equal-power dry/wet mix, room size, decay time, pre-delay, and damping cutoff. It uses a deterministic decorrelated stereo convolution impulse with early reflections and a dense exponential tail; room/decay changes regenerate into the idle convolver and crossfade so the live wet path does not switch abruptly.
- Streamed playback intentionally stays on Howler's HTML5 audio mode because that path is the proven stable way to keep Chromium/desktop media controls alive for streamed formats without regressing row-activation or pause/resume behavior.
- Embedded streamed metadata/artwork is not sourced from Howler. `src/lib/services/stream-artwork.ts` reads supported stream tags directly from the selected file or file handle on demand, persists parsed textual metadata (`title`/`artist`/`album`, `albumArtist`, `genre`, `year`, track/disc numbers, `composer`) plus ReplayGain metadata and a one-shot embedded-tag parse sentinel into IndexedDB through the playlist metadata worker, creates transient blob URLs for cover art used by the current UI/media-session presentation, and does not persist artwork blobs.
- Embedded lyrics are intentionally separate from persisted streamed metadata. `src/lib/services/lyrics.ts` reads supported Vorbis-comment lyrics on demand for the Lyrics panel, parses synced LRC timestamps against `playerController.snapshot.currentTime`, and must not store lyric text in playlist/library IndexedDB state.
- Library play counts live in track metadata and are updated only through `src/lib/services/play-count.ts` after the user-configured continuous playback threshold. Playlist-only items should not accrue plays.
- Background duration hydration should not depend on an already-materialized streamed `objectUrl`. `src/lib/stores/playlist-metadata.ts` must be able to probe duration from either an in-memory `File` or a readable `FileSystemFileHandle`.
- `PlayerControls.svelte` should consume shared artwork passed down from `App.svelte` rather than starting a second artwork-loading lifecycle of its own.
- Tracker modules still play through `Chiptune3`/Web Audio because rerouting real module audio through a browser-facing media element regressed playback quality/pitch; their media-surface integration is mirrored through the silent native transport anchor instead.
- Tracker-module library hydration should use `src/lib/services/module-metadata.ts` for metadata/duration capture so library rows populate without requiring the user to start playback first.
- The playback split is therefore intentional, not incidental:
  - streams prioritize native browser media integration through a real media element
  - modules prioritize correct Chiptune3 playback while separately mirroring transport state to Chromium
- Workspace context actions and library membership checks should stay in `src/lib/services/workspace-actions.ts`; wide-layout sizing rules should stay in `src/lib/services/workspace-layout.ts`.
- `module-player.ts`, `chiptune-loader.ts`, and the custom asset emission in `vite.config.ts` form one pipeline. Treat them as coupled.
- `vite.config.ts` emits `assets/libopenmpt.worklet.js`, configures the PWA manifest, and declares file handlers plus their association icon. Changes here can break offline playback, installed-app file opening, or module initialization.
- `src/lib/services/pwa-updates.ts` complements the Vite PWA config by proactively calling `ServiceWorkerRegistration.update()` on focus/visibility/interval, which is especially important for long-lived installed windows and `vite preview` on `localhost`.
- The Options window is a separate Vite/Svelte entrypoint (`options.html` -> `src/options/main.ts`) rather than an inline HTML string. Keep popup UIs local-first and frontend-only.
- `popup-windows.ts` is the registry for managed popup definitions. Add future popup windows there so `window-manager.ts` stays generic.
- `src/main.ts` only registers the service worker in production. Preserve that split unless there is a strong reason to change it.

## Change guidance

- Before changing playback behavior, verify whether the code path is `stream` or `module` and keep both working.
- Prefer extending stores/services over adding more stateful logic to `App.svelte` or leaf components.
- Do not add backend/network assumptions, cloud dependencies, or server-coupled flows.
