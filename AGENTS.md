# izci

`izci` (Turkish for "tracker") is a local-first, offline-capable PWA music player with first-class tracker module support.

## Core rules

- Preserve dual playback paths:
  - streamed formats (`mp3`, `wav`, `flac`, `ogg`, `opus`) use `Howler.js`
  - tracker modules (`mod`, `xm`, `s3m`, `it`) use `Chiptune3`
- Offline PWA functionality is required and must not regress after changes.
- Target Chromium/Blink only. Prefer proper Chrome APIs and desktop-PWA integrations over compatibility workarounds.
- Assume no backend. The player runs locally against user-selected files.
- Keep player logic in services and stores, not inside Svelte components.
- Prefer progressive enhancement for PWA-only features such as service worker registration, file handlers, launch handling, and desktop window behaviors.

## Project structure

Ignore generated and dependency directories unless the task explicitly involves them:

- `node_modules/`: installed dependencies.
- `dist/`: production build output from Vite/PWA build.
- `dev-dist/`: generated development build artifacts.

Working source tree:

- `package.json`: Vite/Svelte app manifest and scripts (`dev`, `build`, `preview`, `check`).
- `package-lock.json`: npm lockfile.
- `vite.config.ts`: Vite config, `$lib` alias, `chiptune3` runtime emission, and PWA manifest/workbox setup.
- `svelte.config.js`: Svelte preprocess configuration.
- `tsconfig.json`: TypeScript configuration for the app.
- `index.html`: Vite HTML shell.
- `TODO.md`: local task notes; not app logic.
- `AGENTS.md`: repo-specific operating instructions.

## App source map

- `src/main.ts`: app bootstrap, global CSS/material symbols import, production service worker registration.
- `src/App.svelte`: top-level shell; wires playlist state, player controller, file input, menu actions, and the three-panel layout.
- `src/app.css`: global app styling.
- `src/vite-env.d.ts`: Vite ambient types.

### `src/lib/components/`

UI only. Keep these focused on rendering and event dispatch.

- `PlayerControls.svelte`: transport controls, seek, and volume UI.
- `PlaylistPanel.svelte`: playlist view and file-add interactions.
- `TopMenuBar.svelte`: top menu actions such as opening files/options and exit.
- `TrackDetailsPanel.svelte`: metadata/details view for the selected track.

### `src/lib/services/`

Primary location for playback and browser-integration logic.

- `player-controller.ts`: orchestrates active backend selection, playback snapshot state, metadata propagation, and transport actions.
- `howler-player.ts`: streamed-audio backend built on `Howler.js`.
- `module-player.ts`: tracker-module backend built on `Chiptune3`.
- `chiptune-loader.ts`: one-time `Chiptune3` player initialization and timeout/error handling.
- `window-manager.ts`: popup/options window management and app-exit behavior for Chromium desktop PWAs.

### `src/lib/stores/`

- `playlist.ts`: Svelte store for playlist items, current selection, and metadata updates.

### `src/lib/utils/`

- `files.ts`: file-extension inference, playlist item creation, and display formatting helpers.

### `src/lib/types/`

- `types.ts`: shared domain types, supported extension constants, playlist item shape, and playback snapshot types.
- `types/chiptune3.d.ts`: local typings for `chiptune3`.
- `types/howler.d.ts`: local typings for `howler` integration gaps.
- `types/node-fs.d.ts`: node `fs` typing shim used by Vite config.
- `types/node-url.d.ts`: node `url` typing shim used by Vite config.
- `types/pwa-register.d.ts`: typing shim for `virtual:pwa-register`.

## Public assets

- `public/icons/izci-icon.svg`: primary app icon.
- `public/icons/izci-maskable.svg`: maskable PWA icon.
- `public/vendor/`: reserved for vendored static browser assets; currently empty.

## Architecture notes

- Supported formats are centralized in `src/lib/types.ts`; keep playback routing and accepted file lists aligned with those constants.
- `src/lib/utils/files.ts` creates `objectUrl`s only for streamed formats. Do not force tracker modules down the streamed path.
- `src/lib/services/player-controller.ts` is the single coordinator for backend switching. Changes to transport behavior should usually start there.
- `src/lib/services/module-player.ts` depends on `src/lib/services/chiptune-loader.ts` and the custom asset emission in `vite.config.ts`; treat those pieces as one pipeline.
- `vite.config.ts` emits `libopenmpt.worklet.js` and configures the PWA manifest/service worker. Changes here can break offline playback or module initialization.
- `src/main.ts` only registers the service worker in production. Preserve that split unless there is a strong reason to change it.

## Change guidance

- Before changing playback behavior, verify whether the code path is `stream` or `module` and keep both paths working.
- Before changing PWA/build behavior, inspect `vite.config.ts`, icon assets, and any generated output expectations.
- Prefer extending services/stores over adding stateful logic to `App.svelte` or leaf components.
- Do not add backend/network assumptions, cloud libraries, or server-coupled flows.
