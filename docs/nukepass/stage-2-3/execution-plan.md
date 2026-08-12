# Stages 2 and 3 execution plan and ownership

Stages 2 and 3 start from clean branch commit `b380b1e` on `nukepass`, after
Stage 1 accepted its characterization and browser-evidence spine. Stage 2 owns
the cross-cutting runtime kernel and dependency direction. Stage 3 consumes
that kernel while replacing persistence, file/media identity, and collection
state. Playback and audio behavior remain characterization-only until Stage 4.

## Integration rules

- Shared contracts, `src/App.svelte`, `src/lib/types.ts`, page entrypoints,
  localization catalogs, Multiplayer protocol/rules, `package.json`, and
  `vite.config.ts` have one serial integration owner.
- Parallel work begins only from a written ownership row and a frozen consumed
  contract. Survey and adversarial-review lanes are read-only outside their
  evidence documents.
- Each source-changing commit establishes one invariant or completes one
  cutover, receives focused tests plus `npm run build`, and deletes the path it
  replaces before its stage is accepted.
- Protocol-sensitive slices run `npm run multiplayer:protocol:check` before the
  build. Browser-owned changes extend or run the committed CDP evidence rather
  than treating unit tests as browser proof.
- The accepted tree stays usable after every integrated slice. Stage 2 does not
  rewrite playback, and Stage 3 does not route playback through a second media
  or collection model.

## Stage 2 ordered waves

1. Freeze bounded contracts and dependency rules. Split the common type bucket
   into media/catalog, playback/audio/DSP, settings, workspace/presentation,
   browser/window, tools/metadata, and Multiplayer contracts. Migrate imports in
   bounded groups and delete the obsolete bucket rather than preserving a
   compatibility barrel.
2. Establish the platform ports and structured domain errors. Clock, IDs,
   logging, capabilities, key/value storage, file access, and worker creation
   become injectable at orchestration boundaries without abstracting away the
   product's Chromium target.
3. Establish inspectable resource scopes. Normal completion, replacement,
   acquisition failure, cancellation, and repeated disposal cover listeners,
   clocks, abort controllers, channels, workers, object URLs, media elements,
   audio routes, peers, media sources, cache pins, and database connections.
   Domain migrations may add typed registrations only when their owner is
   reconstructed; Stage 2 does not opportunistically rewrite Stage 4 or 5.
4. Rebuild transient logging on the kernel. Per-context bounded history,
   correlation IDs, safe structured details, duplicate-safe batched
   cross-window delivery, explicit verbosity, and deterministic teardown
   replace the process-global improvisation.
5. Freeze one page-bootstrap contract, then migrate main, Options, Audio
   Compare, Editor, Converter, Logs, Troubadour, and Troubadour Options one at a
   time. Theme, locale, logging, scrollbar policy, service-worker policy,
   mobile document setup, orphan handling, readiness, and teardown remain
   explicit capabilities rather than hidden entrypoint side effects.
6. Ratchet the architecture reporter for reconstructed surfaces, run all static
   and deterministic gates, boot all built pages with CDP, adversarially review
   lifetime failures, delete superseded owners, and record Stage 2 acceptance.

## Stage 2 ownership ledger

| Lane | Writable surface | Consumes but may not change | Integration order |
| --- | --- | --- | --- |
| Integration/director | Shared contracts, shared configuration, stage evidence, final cross-domain migrations | Product constitution and Stage 1 characterization | Serial throughout |
| Contract survey | Read-only source survey; proposed contract/evidence notes | All current types and imports | Before wave 1 |
| Resource kernel | New focused platform/lifetime modules and their tests | Existing domain behavior | Waves 2–3 |
| Logging | Logging implementation/tests after ports and scope freeze | Logging settings and Logs UI contract | Wave 4 |
| Page runtime | One assigned entrypoint/page subtree at a time | Frozen bootstrap and page-specific behavior | Wave 5 |
| Architecture verification | `scripts/nukepass/architecture/` and focused tests | Frozen dependency policy | Waves 1 and 6 |
| Adversarial verification | Read-only review and stage evidence | Assembled Stage 2 tree | Wave 6 |

## Stage 2 gate

Resource-scope tests prove disposal after normal completion, replacement,
partial acquisition, error, cancellation, and repeated destroy. Reconstructed
surfaces cannot bypass their frozen ports or reverse the target dependency
direction. Every production page boots from the exact clean production build,
and the settings ledger shows no removed product behavior or control.

## Stage 3 ordered waves

1. Classify every lightweight key and synchronization scope, freeze the
   current-version settings engine contract, then migrate normalized stores in
   ownership groups. Atomic snapshots carry origin/revision/message identity;
   storage and BroadcastChannel delivery converge deterministically, suppress
   duplicates, report unavailable/quota failures, and dispose explicitly.
2. Introduce typed IndexedDB connection/transaction primitives with observable
   blocked, versionchange, abort, quota, corruption, and close behavior. Cut
   collection, handle, artwork, progress, restore-staging, and render-cache
   owners over independently while preserving their separate databases and
   deleting their hand-built connection paths.
3. Freeze an explicit persistence/backup registry. Repair live-key drift,
   preserve the security decision around exported secrets, broadcast restored
   settings through their owners, and prove that handles, source media,
   transient presentation, lyrics/patterns/meters/logs, and rebuildable blobs
   stay excluded.
4. Freeze the canonical media entity and centralized format policy. Separate
   durable identity/display path from file/handle/permission/decode/remote
   state, make materialization and object URLs scoped leases, and preserve the
   unknown-only muted OpenMPT verification rule.
5. Replace collection closure choreography with command-driven immutable state,
   typed repositories, and pure projections. Playlist duplicates, Library
   deduplication, favorites, stable IDs/play counts, selection, navigation,
   sorting/grouping, hydration ordering, mutation persistence, and shutdown
   remain explicit and separately testable.
6. Rebuild the bounded metadata pipeline and managed-folder plan/validate/apply
   transaction over the canonical entity. Cover cancellation, stale work,
   permissions, changed/deleted/moved files, duplicate identities, concurrent
   UI mutation, on-demand artwork/lyrics, and background tracker probes.
7. Run fresh/large/corrupt/quota/blocked/reload/cross-window/backup/cache/folder
   and teardown matrices, inspect storage boundaries in CDP, adversarially
   review data loss and lease lifetime, delete superseded paths, and record
   Stage 3 acceptance plus the exact Stage 4 handoff.

## Stage 3 ownership ledger

| Lane | Writable surface | Consumes but may not change | Integration order |
| --- | --- | --- | --- |
| Integration/director | Shared settings/IDB/media/collection contracts, stage evidence, cross-owner migrations | Stage 2 ports/errors/scopes | Serial throughout |
| Settings | Settings engine, normalized store migrations, settings tests | Goldilocks ledger and UI semantics | Wave 1 |
| IndexedDB/cache | Typed IDB primitives and one assigned database owner at a time | Frozen repository/cache contracts | Wave 2 |
| Backup | Backup registry, export/restore paths and tests | Frozen settings/repository APIs | Wave 3 |
| Files/media | Format policy, media identity, materialization leases and tests | Playback-facing media behavior | Wave 4 |
| Collections | Repository/state/projection owners and focused tests | Frozen media and persistence contracts | Wave 5 |
| Metadata/folders | Metadata pipeline and folder transaction owners/tests | Frozen media and collection commands | Wave 6 |
| Adversarial verification | Read-only review, CDP scenarios, and stage evidence | Assembled Stage 3 tree | Wave 7 |

## Stage 3 gate and Stage 4 handoff

The runbook's fresh-state, large-collection, duplicates, reload, cross-window,
failure, permission, external-change, launch-scan, folder, backup, cache, and
teardown matrix must pass. Storage inspection must prove that collection
records contain no artwork, source, render, lyrics, or pattern payloads. Stage
4 is ready only when playback consumes the one accepted media entity,
collection command surface, repositories, leases, ports, structured errors,
and lifetime scopes with no Stage 2 or 3 replacement still running beside an
old owner.
