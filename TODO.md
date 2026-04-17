# TODO

## Global CSS split / cleanup

- Status: optional / low priority
- Primary target:
  - `src/app.css`
- Current reality check:
  - `src/app.css` still exists as the main global stylesheet.
  - `src/lib/styles/themes.css` exists, but the broader CSS split described in the old refactor notes does not appear to be completed.
- Problem:
  - Global CSS still centralizes a lot of layout and component styling.
- Desired end state:
  - Keep the current visual design, but reduce global-style sprawl where it improves maintainability.
- Possible directions:
  - Extract only if it provides clear ownership wins.
  - Prefer moving truly local styles into component `<style>` blocks.
  - Avoid a large mechanical CSS split unless there is a real maintenance pain point.
- Validation:
  - Compare desktop wide layout, tabbed layout, menu bar, panels, player bar, and error banner before/after.
  - Verify responsive breakpoints remain intact.

## `App.svelte` split / cleanup

- Status: approved starting point
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
  - Phase 1: extract artwork/details presentation coordination from `src/App.svelte` into a focused module. This includes artwork loading/revocation, background slot swapping, brightness analysis, and details-panel display synchronization.
  - Phase 2: extract playback command orchestration around play/load/step/end handling while keeping `playerController` as the backend switchboard.
  - Phase 3: extract workspace-shell coordination for selection bridging, panel props/handlers assembly, details-panel visibility, and wide-layout resize state if it still meaningfully shrinks `App.svelte`.
  - After each phase, keep `App.svelte` responsible only for wiring stores/services into `TopMenuBar`, `TabbedWorkspace` / `WideWorkspace`, and `PlayerControls`.
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
