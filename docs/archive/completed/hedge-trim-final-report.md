# Hedge-trim final report

The pass began at `d1db1f2` and converged on 2026-09-05. All three phases and
both audit rounds completed. The final review found no unevaluated,
high-confidence production cut.

## Accounting

Accounting combines the three phase diffs and excludes the unrelated
`b290ba4` fix, documentation, locale catalogs, vendored/generated code, and
build output.

- Production source: 1,353 lines added, 2,851 removed; net **-1,498**.
- Tests: 62 lines added, 67 removed; net **-5**.
- Production plus tests: net **-1,503**.
- Production modules: **408 to 400** (`-8`).
- Explicit named TypeScript/JavaScript exports: net **-462** across the three
  phases. The working tree has 1,472; the excluded `b290ba4` fix added one.
- Phase 3 alone: production net **-199**, tests net **-2**, two production
  modules removed, and 311 exports removed or made private.

Export-only changes count as contract reduction, not line reduction.

## Meaningful seams removed

- Phase 1 removed dead local helpers and selectors, repeated menu/tool code,
  duplicated settings plumbing, and small forwarding surfaces.
- Phase 2 collapsed the split-era main-window runtime bundles, narrowed
  Multiplayer host/client contexts, removed Track List pass-throughs, and
  deleted the stream-artwork extraction facade.
- Phase 3 removed unused backend lifecycle methods and the obsolete global
  input-gain path left behind by source-local ReplayGain, collapsed two audio
  bus pass-throughs, and narrowed the Raf constructor.
- Queue restoration now returns its already-normalized record without copying
  every field. Its previous own-property shape remains covered.
- The single-consumer packet-loss module and unused media-metadata barrel were
  removed. One unused video-action dependency and verified stale Options,
  workspace, and Editor CSS were deleted.
- File-local declarations across the tree are private again; dynamic Svelte,
  worker/worklet, build-entry, and test consumers remain exported.

## Rejected or deferred

- Kept the throttled playback status store, per-bundle snapshots and sequence
  guards, Media Session transport anchor, backend-specific teardown, native
  media fallbacks, and separate OpenMPT/Hively/video pipelines. Their timing or
  resource ownership pays for the apparent duplication.
- Kept queue state mirrors, launch-scan refreshes, persistent-store duplicate
  suppression, artwork-cache stores, backup restore publication ordering, and
  the queue persistence module. They preserve synchronous APIs, cross-window
  convergence, retry behavior, or storage boundaries.
- Rejected generic persistence, backend, settings, and IndexedDB abstraction
  layers: each would increase contract surface or erase meaningful semantics.
- Kept `NonComponentMessages.svelte` for build-time locale extraction and the
  Raf fake-audio module for tests despite static unreferenced-module reports.
- Deferred four additive correctness findings discovered during the audit:
  backup allowlisting still names library-view settings `v5` while the live key
  is `v6`; pending backup-restore updates can overwrite a concurrent window;
  artwork presentation keys stable IDs without file revision data; and replaced
  video bundles can leave elements in the parking host because bundle teardown
  uses `unload()` rather than `destroy()`. Each needs focused behavior work and
  is not a hedge-trim deletion.

## Verification

- `npm test`: 162 files passed; 844 tests passed, 7 skipped.
- `npm run check`: 0 errors and 0 warnings.
- `npm run build`: passed; 658 modules transformed and 95 PWA precache entries
  emitted. The existing large-chunk and stale Browserslist-data notices remain
  informational.
- `npm run test:fixtures`: 4 tests passed.
- `npm run test:quality-tools`: 9 tests passed.
- `npm run multiplayer:protocol:check`: passed.
- `npm run i18n:validate`: passed.
- Focused playback/audio and persistence/artwork/backup runs passed.
- Firebase rules tests were not run because no Firebase rule or authentication
  behavior changed.

No browser or device session was run. Residual manual checks are representative
stream, OpenMPT, Hively, and video playback; a Multiplayer receiver-stats view;
and visual inspection of the Options, workspace, and Editor surfaces whose
dead selectors were removed.
