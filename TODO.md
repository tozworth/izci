# TODO

## Efficiency review findings (build + Helium runtime pass)

Context:
- Build/check status during this pass:
  - `npm run check`: clean, 0 errors, 0 warnings
  - `npm run build`: success
- Runtime verification:
  - Launched the built app in Helium through CDP
  - Imported sample tracks from `/home/toz/Music/izci-tests/`
  - Verified both streamed and tracker-module playback paths with real files
- Sample set used:
  - Streamed:
    - `streamed/Big Giant Circles - Fight the Current.opus`
    - `streamed/Mosaik - Goflykite.mp3`
  - Modules:
    - `modules/22DROPS.MOD`
    - `modules/city1g.it`
    - `modules/Impulse.s3m`
    - `modules/mr_spocks_cryobed.xm`

Observed rough runtime numbers from the Helium test session:
- Idle-ish session after import:
  - browser-profile CPU: about 3.41%
  - browser-profile RSS: about 1.34 GB across Helium processes
  - page JS heap used: about 3.19 MB
- Stream playback over ~10s:
  - browser-profile CPU: about 3.36%
  - browser-profile RSS: about 1.34 GB
  - page JS heap used: about 3.92 MB -> 4.16 MB
  - `LayoutCount`: 544 -> 1556
  - `TaskDuration`: 0.318 -> 0.892
- Module playback over ~10s:
  - browser-profile CPU: about 2.97%
  - browser-profile RSS: about 1.36 GB
  - page JS heap used: about 3.94 MB -> 6.70 MB
  - `LayoutCount`: 1589 -> 2145
  - `TaskDuration`: 0.962 -> 1.501

Interpretation:
- No immediate catastrophic CPU issue showed up in this pass.
- Browser-level RSS is dominated by Chromium/Helium overhead, not obvious app-only runaway usage.
- The clearest opportunities are reducing high-frequency playback/UI churn and fixing object URL lifecycle cleanup.

### Priority 1: Throttle playback progress updates to the UI and app state

- Status: pending
- Importance: highest efficiency win seen in this pass
- Primary targets:
  - `src/lib/services/howler-player.ts`
  - `src/lib/services/module-player.ts`
  - `src/lib/services/player-controller.ts`
  - `src/App.svelte`
  - `src/lib/components/PlayerControls.svelte`
- Problem:
  - Stream playback currently publishes `currentTime` on every `requestAnimationFrame()` tick in `HowlerPlayerService.#tick()`.
  - Module playback currently publishes `currentTime` on every `player.onProgress(...)` callback in `ModulePlayerService`.
  - `playerController` forwards every partial playback snapshot into the shared Svelte store.
  - `App.svelte` subscribes to the whole playback snapshot at the top level, so fast progress changes can invalidate more of the shell than needed.
  - `PlayerControls.svelte` binds the time labels and slider directly to those hot updates.
- Why this matters:
  - During only ~10 seconds of playback, layout work increased substantially, which strongly suggests progress-driven UI churn.
  - The app appears functionally fine, but it is likely doing more work than necessary to keep the timer/slider perfectly up to date.
- Desired end state:
  - Internal playback timing can stay accurate.
  - UI-facing `currentTime` updates should be throttled to a reasonable rate, for example 4-10 Hz.
  - Fast playback progress should not force top-level shell churn if only the player bar needs it.
- Preferred implementation directions:
  - Add a publish throttle in `howler-player.ts` so `#onSnapshot({ currentTime, duration })` is not emitted every frame.
  - Add a similar throttle or coalescing path in `module-player.ts` for `onProgress` updates.
  - Consider only publishing progress if the elapsed delta crosses a threshold such as 100-250 ms.
  - Consider narrowing subscriptions so the hottest playback progress path does not have to flow through `App.svelte`.
- Validation:
  - Re-run Helium playback test with the same sample files.
  - Compare `LayoutCount`, `TaskDuration`, and general UI smoothness.
  - Confirm seeking, pause/resume, track-end transitions, and displayed time remain correct.

### Priority 2: Throttle Media Session position syncing

- Status: pending
- Importance: high
- Primary target:
  - `src/lib/services/media-session.ts`
- Problem:
  - `mediaSessionService.connect()` subscribes to the playback snapshot store.
  - Every snapshot change calls `syncSession()`.
  - `syncSession()` calls `syncPositionState()`.
  - `syncPositionState()` calls `mediaSession.setPositionState(...)` whenever duration is valid.
- Why this matters:
  - If `currentTime` is being updated very frequently, the browser integration layer is also being updated very frequently.
  - This is probably unnecessary for Chromium media surfaces and may contribute to avoidable main-thread churn.
- Desired end state:
  - Media Session metadata/state remains correct.
  - Position updates happen at a lower rate than internal playback ticks.
- Preferred implementation directions:
  - Cache the last published `duration`, `position`, and `playbackState`.
  - Only call `setPositionState(...)` when position changes by a meaningful delta, for example 250-500 ms, or after explicit seek/play/pause events.
  - Keep immediate updates for track changes, seeks, stop, and end-of-track transitions.
- Validation:
  - Confirm Chromium media controls still show progress and react correctly.
  - Confirm media keys and seek events still work for both stream and module paths.

### Priority 3: Fix object URL cleanup on removal/replacement

- Status: pending
- Importance: high correctness + memory hygiene
- Primary targets:
  - `src/lib/stores/playlist.ts`
  - `src/lib/stores/playlist-materialization.ts`
- Problem:
  - `revokeObjectUrl(...)` exists and is used in some paths.
  - Duplicate streamed items are cleaned up correctly.
  - Re-materialization replacement also revokes old object URLs correctly.
  - But `remove(ids)` in `playlist.ts` does not revoke object URLs for removed streamed items.
  - `replaceAll(newItems)` records `removedItems` but does not revoke object URLs for the replaced streamed items.
- Why this matters:
  - Repeated add/remove/replace cycles can leave Blob-backed object URLs alive longer than necessary.
  - This is the clearest concrete memory-lifecycle issue found in code review during the efficiency pass.
- Desired end state:
  - Any streamed track leaving the in-memory collection has its object URL revoked unless ownership is deliberately transferred.
- Preferred implementation directions:
  - Revoke object URLs for `removedItems` in `remove(ids)`.
  - Revoke object URLs for replaced outgoing items in `replaceAll(newItems)`.
  - Re-check other destructive paths to ensure the same guarantee holds consistently.
- Validation:
  - Import streamed files repeatedly, then remove/replace them.
  - Confirm behavior remains correct and playback still works after re-import.
  - Optionally inspect for reduced memory retention in a follow-up browser pass.

### Priority 4: Narrow the hot playback subscription path through `App.svelte`

- Status: pending
- Importance: medium-high
- Primary targets:
  - `src/App.svelte`
  - `src/lib/services/player-controller.ts`
  - `src/lib/components/PlayerControls.svelte`
- Problem:
  - `App.svelte` owns the main subscription to `playerController.snapshot`.
  - The root shell also owns substantial workspace/layout/state orchestration.
  - Even if Svelte handles invalidation efficiently, this is not the narrowest possible ownership boundary for high-frequency playback progress.
- Why this matters:
  - It increases the risk that hot playback updates invalidate more than the player UI.
  - It makes the app shell part of the hottest runtime path.
- Desired end state:
  - High-frequency playback time/state updates are consumed as close to the player bar as practical.
  - The app shell should mostly react to coarse events such as track changes, backend changes, errors, and play/pause/stop state transitions.
- Preferred implementation directions:
  - Consider splitting playback state into coarse and hot subsets.
  - Or move the hot progress subscription closer to `PlayerControls`.
  - Or keep one store but only publish coarse changes globally and derive displayed time locally.
- Validation:
  - Confirm current UI behavior is unchanged.
  - Re-run the same playback profile and compare layout/task metrics.

### Priority 5: Replace metadata equality `JSON.stringify(...)` checks with a targeted comparison

- Status: pending
- Importance: medium-low
- Primary target:
  - `src/lib/stores/playlist-metadata.ts`
- Problem:
  - Metadata update detection currently uses `JSON.stringify(currentItem.metadata ?? {}) !== JSON.stringify(mergedMetadata ?? {})`.
- Why this matters:
  - It is not a crisis for small playlists.
  - It is extra allocation/work that can become more noticeable with larger libraries or many metadata updates.
- Desired end state:
  - Metadata change detection uses a small explicit compare for the fields written in this flow.
- Validation:
  - Confirm inferred metadata and duration probing still populate exactly as before.

### Priority 6: Run a follow-up efficiency pass after the above changes

- Status: pending
- Importance: medium
- Goal:
  - Verify whether the changes materially improve layout churn and memory behavior.
- Suggested workflow:
  - `npm run check`
  - `npm run build`
  - launch built app in Helium
  - import `/home/toz/Music/izci-tests/`
  - test one streamed track and one module track again
  - record the same rough metrics:
    - browser-profile CPU
    - browser-profile RSS
    - page JS heap used/total
    - `LayoutCount`
    - `TaskDuration`
- Success criteria:
  - No regressions in playback behavior.
  - Lower update churn during playback.
  - Object URL cleanup fixed on destructive playlist operations.

## Remaining structural cleanup

The old refactor phases for Options extraction, playlist-store decomposition, PlaylistPanel split, and App shell decomposition appear to be done and have been removed from this TODO.

One older cleanup item still appears open:

### Global CSS split / cleanup

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

### Guardrails for future cleanup

- Run `npm run check` after meaningful cleanup changes.
- Do not change playback routing between streamed audio and tracker modules.
- Do not regress offline PWA behavior.
- Do not move durable persistence into Svelte components.
- Update `AGENTS.md` after major structural or architectural changes.

## PWA / Chromium roadmap

- Add launch-queue handling for files opened directly into the installed app.
- Promote manifest `file_handlers` into a tested desktop flow.
- Add desktop shortcuts, protocol handling if justified, and better install UX.

## Audio roadmap

- Improve module-specific controls and metadata: subsongs, messages, tracker detection, patterns.
- Evaluate gapless playback and large-library performance.
