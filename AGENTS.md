# izci agent docs

`izci` is a PWA music player.

## Core principles

- Offline PWA, does not require a backend, mainly targeting Chromium/Blink for maximum API flexibility.
- Desktop-style design: tight margins, no overstyling, no extraneous hyperlinks or pointer cursors. Basically, before working on UI, check whether the output is "too website-y" and redesign as needed.
- Goldilocks factor: izci intentionally exposes many obscure settings ("Count track as played after (s)", "Logarithmic volume", "Keep columns visible in narrow library panels"...), mostly under the per-page "Advanced tweaks" toggle. This means we have a goldilocks quota to fill. When adding a substantial feature, briefly consider its accompanying tweaks.
- The project is pre-alpha and has one (1) user. Compatibility is intentionally scorched-earth: prefer clean current-version state over legacy/adapter/migration slop.

## Keep this file small

- This is an operating guide, not a source index, feature inventory, or changelog.
- Update it only when a durable project-wide constraint, major ownership boundary, or top-level workflow changes.
- Do not add per-file summaries, implementation trivia, or anything else that can be grepped in 3 seconds.

## Non-negotiable behavior

- Preserve all playback paths:
  - streamed / "regular" audio (`mp3`, `wav`, `flac`, `ogg`, `opus`) use Howler in HTML5 audio mode;
  - tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3`) use Chiptune3/libopenmpt and Web Audio; Hively modules (`ahx`, `hvl`) use their own worklet-backed player and pattern data;
  - videos (`mp4`, `m4v`, `mov`, `webm`, `mkv`) use a native video element with audio routed through the shared Web Audio graph when Chromium permits it.
- Keep playback, persistence, DSP, and browser-integration logic in services/stores. Svelte components should primarily render and dispatch events.
- Preserve persistence boundaries:
  - queue and library collections: IndexedDB;
  - reusable File System Access directory handles: separate IndexedDB storage;
  - lightweight UI/settings state: `localStorage`;
  - same-origin settings sync: `BroadcastChannel` where available, with duplicate delivery suppressed.
- Artwork persistence is limited to bounded, rebuildable renditions in the separate artwork-cache IndexedDB; never place artwork blobs in queue/library records. Never persist live meters, pattern-grid snapshots, or other transient presentation/playback data.

## Working rules

- Ignore `node_modules/`, `dist/`, and `dev-dist/` unless the task explicitly concerns generated output or dependencies.
- After every source change, run `npm run build` so the user's hot-reload output remains current. Run focused tests and/or `npm run check` when relevant.
- Documentation-only changes do not require a build.
- Update `en.json` and `tr.json`, but **never** `en-askew.json`; Askew is a manually curated inside joke.
- Do not start dev/preview servers or inspect the app in a browser unless explicitly asked.
- Do NOT bloat App.svelte (or any other similarly load-bearing file). Prefer aggressive modularization over 2000-line closures.

## Architecture map

- `src/App.svelte`: main-window composition root.
- `src/lib/components/`: presentation and event dispatch.
- `src/lib/components/workspace/`: tabbed, wide, and Now Playing workspace composition.
- `src/lib/components/track-list-panel/`: queue/library UI and UI-local helpers.
- `src/lib/services/`: playback, audio graph, metadata, imports, browser/PWA integration, workspace controllers, and other side effects.
- `src/lib/stores/`: persisted state, collection state, normalization, and cross-window sync.
- `src/lib/i18n/`: English source catalog, Turkish translations, and localization runtime.
- `src/lib/utils/`: stateless shared helpers.
- `src/options/`: separate Options Vite/Svelte entrypoint and settings UI. Options edits stores; it does not own audio nodes or main-window library mutation.
- `src/desktop/` and `src-tauri/`: Windows Tauri integration and native shell. `npm run desktop:build` builds this target; native code/assets must stay out of PWA bundles and precache (`npm run desktop:verify`).
- `src/tools/`: standalone Audio Compare, Editor, Converter, Logs, and Troubadour window code; `tool-shell.css` supplies their shared desktop-window styling.
- `src/lib/types.ts`: shared domain types and canonical internally supported extensions.
- `vite.config.ts`: build/PWA configuration, manifest/file handlers, and Chiptune3 worklet emission.
- `public/`: icons and other static assets.

## Playback and audio ownership

- `player-controller.ts` owns backend switching and the shared playback snapshot.
- `playback-commands.ts` owns app-level play/load/seek/navigation sequencing.
- `howler-player.ts`, `module-player.ts`, `ahx-player.ts`, and `video-player.ts` own their respective backends; `player-controller.ts` remains the only backend switcher.
- `module-player.ts`, `chiptune-loader.ts`, the libopenmpt worklet, and its Vite asset emission form one coupled module pipeline; `ahx-player.ts`, its worklet, and `hively-patterns.ts` form the coupled Hively pipeline.
- `media-session.ts` owns Chromium media metadata/actions and the silent module transport anchor.
- `audio-bus.ts` owns the shared Web Audio routing. The intended graph is:
  `Howler/Chiptune3/video source -> transition envelope -> raw program tap` and
  `transition envelope -> ReplayGain -> Raf -> analyser -> master volume -> destination`.
- Player volume/mute belongs after Raf. Stream ReplayGain is a deliberate pre-Raf adjustment. Howler backend volume is only a fallback when media-element Web Audio routing is unavailable.
- `raf-engine.ts` and `raf-effects/` own DSP. Raf settings are normalized, synchronized, and applied independently of the Options window lifecycle. Parameter updates should be differential and smoothed from a finite anchored value. Video bypasses Auto Amp but otherwise uses the shared chain.
- `raf-auto-amp-meter.ts` transports live Auto Amp telemetry between windows; it is presentation state and must not be persisted.
- The visualizer consumes the shared post-Raf analyser and remains independent of artwork backdrop selection.

## Files, metadata, and library

- Extension/kind inference and supported-format behavior stay centralized in `src/lib/types.ts` and `src/lib/utils/files.ts`.
- Unknown-extension verification applies only to unknown files: when enabled, a separate muted OpenMPT probe must accept them; when disabled, normal module playback may succeed or fail.
- Only media-element formats (streams and videos) receive object URLs. Preserve `ensureLoaded()` and File System Access permission behavior during materialization.
- `queue.ts` remains the public queue/library store facade; focused sibling modules own persistence, materialization, selection, metadata, navigation, and deduplication.
- Queue and library persist separately. The library deduplicates; the queue does not.
- `TrackItem.path` is the canonical persisted/display path. Do not add a parallel folder-path cache.
- Loadouts are persisted settings bundles (appearance, playback, Raf, visualizer) with per-track/folder context matching; keep loadout state and matching in the loadout stores/services rather than reimplementing them in components.
- Managed folder scans preserve stable IDs and play counts, reconcile only tracks owned by that folder, and must not request permission during launch scans.
- Stream metadata may be persisted, but embedded artwork and lyrics stay on-demand and transient. Tracker metadata hydration should use the background module probe rather than requiring playback.
- Library play counts accrue only through the play-count service after the configured continuous-play threshold.

## Workspace and presentation

- Queue, Library, Track Details, Lyrics, and Patterns are dockable workspace tabs. Placement/open state lives in `workspace-panel-state.ts`; wide panel proportions live in `workspace-panel-layout.ts`.
- `workspace-shell.ts` owns app-level workspace selection, tab, panel, and resize coordination. Layout-specific markup stays in `src/lib/components/workspace/`.
- `contextual-tab-presentation.ts` owns automatic Lyrics/Patterns tab visibility; components supply availability and dispatch workspace actions.
- `VideoStage.svelte` and `ImageStage.svelte` separately host their player-owned elements and media-specific interactions. Visual-media viewport settings live in `video-settings.ts`; temporary desktop-window sizing and restoration live in `window-video.ts`.
- Artwork and visualizer backdrops are shared layers clipped to requesting zones. Keep contrast state local to each zone; the menu/title bar remains on the active theme rather than becoming an artwork surface.
- Artwork loading, cleanup, palette/brightness analysis, and presentation side effects remain transient and service-owned.
- Window Controls Overlay state comes from `window-controls-overlay.ts`; components must react to live geometry/visibility rather than assuming overlay mode.
- Popup definitions belong in `popup-windows.ts`; popup behavior belongs in `window-manager.ts` or a focused service.

## Mobile mode

- Mobile mode is selected from User-Agent Client Hints / navigator signals in `src/mobile/mobile-device.ts`; narrow desktop windows continue to use the desktop UI.
- Keep the bespoke mobile shell, navigation, gestures, Options presentation, and overrides under `src/mobile/`. Do not fold mobile CSS into the standard desktop stylesheets.
- The primary mobile pager order is Queue, Library, Now Playing, Lyrics, then Track Details. Keep bottom-nav taps and horizontal swipes consistent with that order, and exclude controls with their own horizontal gestures from page swiping.
- Mobile queue and flat Library views use touch-first list rows rather than library columns; tapping a track plays it. Desktop selection and double-click behavior must remain unchanged.
- Mobile Options is a full-page presentation of the shared Options content. Tool windows are intentionally not exposed in mobile mode for now.

## Oda (couch mode)

- Oda is a session-only, ten-foot presentation mode for the main window. It is entered from the main menu, exits only via `Options > Exit Oda`, and is never restored after a reload; mobile mode cannot enter it.
- It is a shell over the same runtime, not a second player: it consumes the effective queue/library/playback/artwork state and commands passed from `App.svelte`, so an active Multiplayer client gets host state without Oda-specific protocol or session logic.
- The active bit, fullscreen ownership, and route/history/focus stack live in `src/lib/services/oda-session.ts`; persistent preferences live in synchronized `src/lib/stores/oda-settings.ts`. Never persist the session, route, or focus.
- Keep `src/oda/` as its own presentation boundary (`OdaShell.svelte` plus views), analogous to `src/mobile/`. `App.svelte` structurally selects one shell; do not merely hide desktop chrome with CSS or grow `App.svelte` with Oda view logic.
- Oda gets first refusal on `keydown` before desktop shortcuts. Normalize remote/key aliases in `oda-input.ts`, and keep focus movement deterministic and geometry-independent (`oda-navigation.ts`, `oda-focus.ts`, `oda-route-focus.ts`).
- Media counts/filters are pure selectors (`oda-destinations.ts`, `oda-browse.ts`, `oda-rows.ts`) derived from the effective library; they must not mutate the persisted desktop Library view or desktop theater/Now Playing window state. Oda theaters host the single player-owned media elements and must never create a second element/source or leave both hosts visible.
- Oda Options is an Oda-native shell over the shared Options definitions/content with the Oda category first; opening it must not spawn the desktop Options window.

## Tools windows

- Tools are separate Vite pages entered through `audio-compare.html`, `editor.html`, `converter.html`, `logs.html`, and `troubadour.html`; each page mounts its matching app under `src/tools/<tool>/main.ts`. Lyrics, Loudness, and Spectrogram are Troubadour workbench tabs rather than separate pages.
- `TopMenuBar.svelte` owns main-window Tools menu presentation. Window paths and default dimensions belong in `src/lib/services/popup-windows.ts`; opening/reuse behavior stays in `window-manager.ts`.
- Keep each tool's analysis, workers, exports, and tests in its `src/tools/<tool>/` directory. Adding or removing a tool page also requires updating the multi-page inputs and PWA navigation fallback denylist in `vite.config.ts`.
- Troubadour is a transient metadata, artwork, timestamped-lyrics, album-grouping, and rename workbench; its controller owns workbench state and jobs, its settings live separately from main-player settings, and it must not directly mutate queue or library persistence.
- `troubadour-options.html` hosts Troubadour's dedicated Options view, while shared metadata readers and writers remain outside Troubadour for reuse by other tools.

## Imports, PWA, and browser integration

- `import-controller.ts` owns picker capability checks and open-file/folder flows. Drag/drop extraction stays in queue UI plus file utilities.
- PWA file-handler associations are intentionally more conservative than the internal supported-extension list.
- `vite.config.ts` and `pwa-updates.ts` jointly protect offline/install/update behavior. Changes can affect installed-app launch, file opening, module initialization, and long-lived-window updates.
- Service-worker registration remains production-only unless there is a strong reason to change it.
- Exotic platform features (WCO, launchQueue, Document PiP, Local Font Access...) must degrade safely when unavailable. Chromium-focused does not mean Chromium-only.

## Experiments

- Requests to "add an experiment" mean opt-in exploratory UI unless a permanent home is specified.
- An active experiment adds its page under Options -> Experimental with a synchronized settings store; experiments default off. The Experimental page shows a "No experiments" placeholder while empty.
- Runtime behavior still belongs in its normal service/store/component owner behind a clean feature gate.

## Multiplayer

- One izci hosts its catalog and playback state, while joined izci clients provide a remote view, transport/track controls and streamed audio. The host remains authoritative.
- Multiplayer settings live in synchronized `multiplayer-settings.ts` and default to singleplayer.
- Multiplayer uses the self-hosted izci-server exclusively for short-lived signaling, then WebRTC data channels for peer traffic. Keep session lifecycle, protocol/versioning, and persisted recent hosts in dedicated `multiplayer-*` modules, separate from queue/library data.
- Multiplayer audio delivery has exactly two paths: buffered Opus renders over data channels and source-file delivery (including videos). No live RTP audio or jitter-buffer pathway. Listeners own ReplayGain, Raf, analysis, and master volume.
- Freeplay is a persisted per-pair Multiplayer mode. Each active Freeplay client browses the host library but owns an independent host-side renderer and timeline; never route Freeplay through the host queue or shared player controller.

## izci-server

- `izci-server/` is an independent Go module: `internal/signaling` owns rooms, admission, WebRTC negotiation, ICE issuance, and deployment examples; `internal/host` owns dedicated hosting (peers, sessions, Pion answerer) with `serve` (both), `signal` (signaling only), and `host` (remote signal) modes. Official builds ship without a configured server.
- Browser-side HTTP, socket, invitation, setup, identity, pairing, and reconnect-proof behavior stays in focused `multiplayer-server-*` services/stores. Login bearers are transient; remembered operator keys, invitations, identities, and per-pair secrets stay in their existing server-specific local settings boundaries.
- Keep the izci-server signaling protocol version separate from the Multiplayer app protocol. Protocol shapes live in code, representative shared fixtures live under `tests/multiplayer-server-contract/`, and app-protocol changes must keep `scripts/sync-multiplayer-protocol.mjs` in sync.
- Treat keys, tokens, invitation and owner secrets, SDP, ICE candidates, and request bodies as sensitive: never put socket tickets in URLs, log these values, or persist transient signaling. Preserve strict JSON decoding, origin/path checks, rate limits, bounded messages, and clean shutdown.
- After izci-server source changes, run formatting, `go vet ./...`, `go test -race ./...`, and a CGO-disabled build from `izci-server/`; frontend work must remain buildable without Go installed.

## Change checklist

- For playback changes, identify the stream and module effects and keep both paths working.
- For persisted state changes, preserve the storage boundary and cross-window behavior; do not add legacy migrations unless requested.
- For UI changes, keep business logic out of components and avoid duplicating state already owned by a controller/store.
- For build/PWA changes, consider offline caching, installed launch, file handlers, and libopenmpt asset emission.
- Prefer focused tests for pure helpers/services, then run the required build.
