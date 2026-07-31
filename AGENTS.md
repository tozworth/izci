# izci agent docs

`izci` is a PWA media player. It has no backend, operates on local files and File System Access handles.

## Core principles

- Offline PWA, mainly targeting Chromium/Blink for maximum API flexibility.
- Desktop-style design: tight margins, no overstyling, no extraneous hyperlinks or pointer cursors. Basically, before working on UI, check whether the output is "too website-y" and redesign as needed.
- Goldilocks factor: izci intentionally exposes many obscure settings ("Count track as played after (s)", "Logarithmic volume", "Keep columns visible in narrow library panels"...) - when adding a substantial feature, consider its accompanying Goldilocks controls under a valid Options category
- The project is pre-alpha and has one (1) user. Compatibility is intentionally scorched-earth: prefer clean current-version state over legacy/adapter/migration slop.

## Keep this file small

- This is an operating guide, not a source index, feature inventory, or changelog.
- Update it only when a durable project-wide constraint, major ownership boundary, or top-level workflow changes.
- Do not add per-file summaries, implementation trivia, or anything else that can be grepped in 3 seconds.

## Non-negotiable behavior

- Preserve all playback paths:
  - streamed / "regular" audio (`mp3`, `wav`, `flac`, `ogg`, `opus`) use Howler in HTML5 audio mode;
  - tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3`) use Chiptune3/libopenmpt and Web Audio;
  - videos (`mp4`, `m4v`, `mov`, `webm`, `mkv`) use a native video element with audio routed through the shared Web Audio graph when Chromium permits it.
- Keep playback, persistence, DSP, and browser-integration logic in services/stores. Svelte components should primarily render and dispatch events.
- Preserve persistence boundaries:
  - playlist and library collections: IndexedDB;
  - reusable File System Access directory handles: separate IndexedDB storage;
  - lightweight UI/settings state: `localStorage`;
  - same-origin settings sync: `BroadcastChannel` where available, with duplicate delivery suppressed.
- Artwork persistence is limited to bounded, rebuildable renditions in the separate artwork-cache IndexedDB; never place artwork blobs in playlist/library records. Never persist lyrics, live meters, pattern-grid snapshots, or other transient presentation/playback data.

## Working rules

- Ignore `node_modules/`, `dist/`, and `dev-dist/` unless the task explicitly concerns generated output or dependencies.
- After every source change, run `npm run build` so the user's hot-reload output remains current. Run focused tests and/or `npm run check` when relevant.
- Documentation-only changes do not require a build.
- Localization automation may update `en.json` and `tr.json`, but never `en-askew.json`; Askew is a manually curated inside joke, and automatically maintaining it would be wasted effort.
- Do not start dev/preview servers or inspect the app in a browser unless explicitly asked.
- Do not treat Codex's built-in browser as proof of installed-PWA-only behavior such as Window Controls Overlay, file handlers, or desktop window integration.

## Architecture map

- `src/App.svelte`: lean main-window composition root. Durable state and local algorithms belong elsewhere.
- `src/lib/components/`: presentation and event dispatch.
- `src/lib/components/workspace/`: tabbed, wide, and Now Playing workspace composition.
- `src/lib/components/playlist-panel/`: playlist/library UI and UI-local helpers.
- `src/lib/services/`: playback, audio graph, metadata, imports, browser/PWA integration, workspace controllers, and other side effects.
- `src/lib/stores/`: persisted state, collection state, normalization, and cross-window sync.
- `src/lib/i18n/`: English source catalog, Turkish translations, and localization runtime. Follow its README workflow when interface copy changes.
- `src/lib/utils/`: stateless shared helpers.
- `src/options/`: separate Options Vite/Svelte entrypoint and settings UI. Options edits stores; it does not own audio nodes or main-window library mutation.
- `src/tools/`: standalone Audio Compare, Editor, Converter, and Troubadour window code; `tool-shell.css` supplies their shared desktop-window styling.
- `src/lib/types.ts`: shared domain types and canonical internally supported extensions.
- `vite.config.ts`: build/PWA configuration, manifest/file handlers, and Chiptune3 worklet emission.
- `public/`: icons and other static assets.

## Playback and audio ownership

- `player-controller.ts` owns backend switching and the shared playback snapshot.
- `playback-commands.ts` owns app-level play/load/seek/navigation sequencing.
- `howler-player.ts`, `module-player.ts`, and `video-player.ts` own their respective backends; `player-controller.ts` remains the only backend switcher.
- `module-player.ts`, `chiptune-loader.ts`, the libopenmpt worklet, and its Vite asset emission form one coupled module pipeline.
- `media-session.ts` owns Chromium media metadata/actions and the silent module transport anchor.
- `audio-bus.ts` owns the shared Web Audio routing. The intended graph is:
  `Howler/Chiptune3/video source -> ingress/ReplayGain -> Raf -> analyser -> master volume -> destination`.
- Player volume/mute belongs after Raf. Stream ReplayGain is a deliberate pre-Raf adjustment. Howler backend volume is only a fallback when media-element Web Audio routing is unavailable.
- `raf-engine.ts` and `raf-effects/` own DSP. Raf settings are normalized, synchronized, and applied independently of the Options window lifecycle. Parameter updates should be differential and smoothed from a finite anchored value. Video bypasses Auto Amp but otherwise uses the shared chain.
- `raf-auto-amp-meter.ts` transports live Auto Amp telemetry between windows; it is presentation state and must not be persisted.
- The visualizer consumes the shared post-Raf analyser and remains independent of artwork backdrop selection.

## Files, metadata, and library

- Extension/kind inference and supported-format behavior stay centralized in `src/lib/types.ts` and `src/lib/utils/files.ts`.
- Unknown-extension verification applies only to unknown files: when enabled, a separate muted OpenMPT probe must accept them; when disabled, normal module playback may succeed or fail.
- Only media-element formats (streams and videos) receive object URLs. Preserve `ensureLoaded()` and File System Access permission behavior during materialization.
- `playlist.ts` remains the public playlist/library store facade; focused sibling modules own persistence, materialization, selection, metadata, navigation, and deduplication.
- Playlist and library persist separately. The library deduplicates; the playlist does not.
- `PlaylistItem.path` is the canonical persisted/display path. Do not add a parallel folder-path cache.
- Managed folder scans preserve stable IDs and play counts, reconcile only tracks owned by that folder, and must not request permission during launch scans.
- Stream metadata may be persisted, but embedded artwork and lyrics stay on-demand and transient. Tracker metadata hydration should use the background module probe rather than requiring playback.
- Library play counts accrue only through the play-count service after the configured continuous-play threshold.

## Workspace and presentation

- Playlist, Library, Track Details, Lyrics, and Patterns are dockable workspace tabs. Placement/open state lives in `workspace-panel-state.ts`; wide panel proportions live in `workspace-panel-layout.ts`.
- `workspace-shell.ts` owns app-level workspace selection, tab, panel, and resize coordination. Layout-specific markup stays in `src/lib/components/workspace/`.
- `contextual-tab-presentation.ts` owns automatic Lyrics/Patterns tab visibility; components supply availability and dispatch workspace actions.
- `VideoStage.svelte` only hosts the player-owned video element. Video viewport settings live in `video-settings.ts`; temporary desktop-window sizing and restoration live in `window-video.ts`.
- Artwork and visualizer backdrops are shared layers clipped to requesting zones. Keep contrast state local to each zone; the menu/title bar remains on the active theme rather than becoming an artwork surface.
- Artwork loading, cleanup, palette/brightness analysis, and presentation side effects remain transient and service-owned.
- Window Controls Overlay state comes from `window-controls-overlay.ts`; components must react to live geometry/visibility rather than assuming overlay mode.
- Popup definitions belong in `popup-windows.ts`; popup behavior belongs in `window-manager.ts` or a focused service.

## Tools windows

- Tools are separate Vite pages entered through `audio-compare.html`, `editor.html`, `converter.html`, and `troubadour.html`; each page mounts its matching app under `src/tools/<tool>/main.ts`. Lyrics, Loudness, and Spectrogram are Troubadour workbench tabs rather than separate pages.
- `TopMenuBar.svelte` owns main-window Tools menu presentation. Window paths and default dimensions belong in `src/lib/services/popup-windows.ts`; opening/reuse behavior stays in `window-manager.ts`.
- Keep each tool's analysis, workers, exports, and tests in its `src/tools/<tool>/` directory. Adding or removing a tool page also requires updating the multi-page inputs and PWA navigation fallback denylist in `vite.config.ts`.
- Troubadour is a transient metadata, artwork, timestamped-lyrics, album-grouping, and rename workbench; its controller owns workbench state and jobs, its settings live separately from main-player settings, and it must not directly mutate playlist or library persistence.
- `troubadour-options.html` hosts Troubadour's dedicated Options view, while shared metadata readers and writers remain outside Troubadour for reuse by other tools.

## Imports, PWA, and browser integration

- `import-controller.ts` owns picker capability checks and open-file/folder flows. Drag/drop extraction stays in playlist UI plus file utilities.
- PWA file-handler associations are intentionally more conservative than the internal supported-extension list.
- `vite.config.ts` and `pwa-updates.ts` jointly protect offline/install/update behavior. Changes can affect installed-app launch, file opening, module initialization, and long-lived-window updates.
- Service-worker registration remains production-only unless there is a strong reason to change it.
- File System Access, install prompts, Launch Queue, popup windows, titlebar overlay, and desktop-window features must degrade safely when unavailable.

## Experimental features

- Requests to "add an experiment" mean opt-in exploratory UI unless a permanent home is specified.
- The first active experiment adds an Options -> Experimental page and synchronized `experimental-settings.ts`; experiments default off.
- Runtime behavior still belongs in its normal service/store/component owner behind a clean feature gate.

## Change checklist

- For playback changes, identify the stream and module effects and keep both paths working.
- For persisted state changes, preserve the storage boundary and cross-window behavior; do not add legacy migrations unless requested.
- For UI changes, keep business logic out of components and avoid duplicating state already owned by a controller/store.
- For build/PWA changes, consider offline caching, installed launch, file handlers, and libopenmpt asset emission.
- Prefer focused tests for pure helpers/services, then run the required build.
