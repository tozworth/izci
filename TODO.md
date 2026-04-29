# TODO

## Global CSS split / cleanup

- Status: completed
- Primary target:
  - `src/app.css`
- Current reality check:
  - `src/app.css` is now a small import entrypoint for the main window.
  - `src/lib/styles/themes.css` still owns shared color-theme tokens.
  - Main-window styling is split across `src/lib/styles/app/` by ownership.
- Problem:
  - Global CSS still centralizes a lot of layout and component styling.
- Desired end state:
  - Keep the current visual design, but reduce global-style sprawl where it improves maintainability.
- Completed direction:
  - Compare desktop wide layout, tabbed layout, menu bar, panels, player bar, and error banner.
  - Extracted global rules into focused files for base, shell, menus, workspace, panels, and player styles.
  - Removed stale global selectors for old add-files/details/canvas-placeholder markup.

## `App.svelte` split / cleanup

- Status: phase 1-3 completed
- Primary target:
  - `src/App.svelte`
- Current reality check:
  - `src/App.svelte` is acting as both the top-level shell and several local controllers.
  - The file currently mixes workspace orchestration, artwork/details lifecycle management, playback command flow, layout resize handling, and global window event handling.
- Problem:
  - The file is large enough that local behavior changes are harder to reason about and verify.
  - Responsibilities that already fit the repo's store/service architecture are still embedded in the root component.
- Desired end state:
  - Keep `src/App.svelte` as the top-level assembly layer for the shell.
  - Move non-rendering state machines and imperative coordination into focused services or controller-style modules.
  - Preserve the current split between streamed playback, module playback, IndexedDB persistence, and PWA/browser integration.
- Planned path:
  - Phase 1 completed: artwork/details presentation coordination moved into `src/lib/services/artwork-presentation.ts`.
  - Phase 2 completed: playback command orchestration moved into `src/lib/services/playback-commands.ts` while `playerController` remains the backend switchboard.
  - Phase 3 completed: workspace-shell coordination moved into `src/lib/services/workspace-shell.ts`.
  - Current end state: `src/App.svelte` now mainly wires stores/services into `TopMenuBar`, `TabbedWorkspace` / `WideWorkspace`, and `PlayerControls`.
- Guardrails:
  - Do not regress either playback path:
    - streamed formats stay on Howler HTML5 audio
    - tracker modules stay on Chiptune3 / Web Audio
  - Do not move durable persistence or browser integration into leaf Svelte components.
  - Keep the existing artwork-backed appearance behavior and Window Controls Overlay behavior intact.
- Validation:
  - Verify playlist and library selection, activation, context actions, and details-panel behavior in both tabbed and wide layouts.
  - Verify player controls, track stepping, track-end behavior, and launched-file replacement.
  - Verify artwork loading, player-bar artwork mode, workspace artwork mode, brightness-based contrast switching, and cleanup/revocation behavior.
  - Run the existing project checks after each phase.

## Guardrails for future cleanup

- Do not regress offline PWA behavior.
- Do not move durable persistence into Svelte components.
- Update `AGENTS.md` after major structural or architectural changes.

## Roadmap

- Improve module-specific controls and metadata: subsongs, messages, tracker detection, patterns.
- Evaluate gapless playback and large-library performance.
