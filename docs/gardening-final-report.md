# Gardening final report

The pass reviewed `063b8af..1ceb2c7` and converged on 2026-08-24. Phase 8
kept the Phase 1–7 changes, corrected one Phase 6 regression, and implemented one
additional local playback fix. No broad refactor was justified.

## Fixed findings, ranked

1. Persistence integrity: queue writes now report failure and retry; background
   metadata cannot overwrite concurrent edits or replacement tracks; backup
   restore state is not published before it is durable; locating an empty
   managed-folder restore no longer reconciles the live folder to empty.
2. Multiplayer lifecycle correctness: stale peer/channel/generation callbacks
   are rejected, obsolete transfers and render state are cleared, Freeplay
   source timelines resume correctly, and Phase 8 fixed the connecting media
   channel race that could permanently skip an initial source-file transfer.
3. Playback failure and resource handling: OpenMPT worklet allocations are
   released, media-element routing degrades to native output when Web Audio is
   unavailable, and failed Hively worklet/WASM asset loads can now be retried
   without losing successful request deduplication.
4. Tool job correctness: superseded Editor loads cannot publish stale results;
   Troubadour load cancellation survives completed save jobs; rename-after-save
   uses the refreshed preview rather than stale paths.
5. Settings convergence and reset scope: simultaneous persistent-store writers
   converge on storage, same-window backup restores refresh live stores, and
   page resets no longer erase unrelated appearance/experimental settings.
6. Presentation races: failed/stale artwork loads no longer retain the previous
   selection, destroyed artwork layers reject late decodes, and mobile Options,
   Now Playing, and Track Details navigation preserve their intended state.
7. Dead weight and duplication: unused logging exports, an unused editor tag
   helper, duplicate stats formatters, and a duplicate cache refresh were
   removed or consolidated.

## Rejected or deferred

- Deferred: successful artwork palette entries are not bounded. Cleanup spans
  object-URL ownership and two live consumers, so it should be a focused
  artwork-lifecycle change with an explicit eviction/invalidation test.
- Deferred: Chiptune3 initialization timeout/rejection cleanup needs an explicit
  owned-versus-shared `AudioContext` teardown contract and protection against a
  late vendor worklet resolution. That is a focused playback task, not a safe
  convergence patch.
- Deferred: native Editor stream decoding cannot be preempted through
  `decodeAudioData`; Phase 7 does suppress stale publication and closes the
  temporary context. Stronger best-effort abort behavior should be scoped and
  tested separately rather than presented as full cancellation.
- Rejected: file length, import cycles, informational architecture findings,
  and existing large-bundle warnings did not establish an observable defect by
  themselves. The existing playback graph, queue hydration, and multi-entry PWA
  structure remain justified.

## Phase record

- Phase 1: `a7f6f5a`
- Phase 2: `a925038`
- Phase 3: `636d5ad`
- Gardening documentation adjustment: `fb9eae8`
- Phase 4: `a8dc472`
- Phase 5: `cacfea2`
- Phase 6: `d606dbe`
- Phase 7: `1ceb2c7`
- Phase 8 changed `src/lib/services/ahx-player.ts`, added
  `src/lib/services/ahx-player.test.ts`, and changed
  `src/lib/services/multiplayer-host-freeplay.ts` plus
  `src/lib/services/multiplayer-source-transfer.test.ts`.

## Verification

- `npm test`: 166 files passed; 859 tests passed, 7 skipped.
- `npm run check`: 0 errors and 0 warnings.
- `npm run build`: production/PWA build passed; 666 modules transformed and 95
  precache entries emitted. Existing large-chunk warnings remain informational.
- `npm run test:fixtures`: 4 tests passed.
- `npm run test:quality-tools`: 9 tests passed.
- `npm run test:firebase-rules`: 8 tests passed against the local Realtime
  Database emulator.
- `npm run i18n:validate`: passed.
- `npm run multiplayer:protocol:check`: passed.
- Focused Phase 8 Multiplayer run: 3 files, 9 tests passed.
- Focused Phase 8 Hively run: 2 files, 5 tests passed.

Residual manual checks are a real-Chromium delayed-data-channel Multiplayer
join, offline-then-retry Hively playback in the installed PWA, and representative
stream/OpenMPT/Hively/video plus mobile and tool-window smoke checks. No browser
or device session was run during the pass.

A new broad gardening pass does not currently have a favorable risk-to-value
ratio. The deferred artwork and Chiptune lifecycle items are better handled as
targeted follow-ups with their own ownership decisions and playback coverage.
