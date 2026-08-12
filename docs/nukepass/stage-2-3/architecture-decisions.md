# Stage 2 and 3 architecture decisions

These decisions freeze the shared contracts needed to execute Stages 2 and 3.
They describe the accepted current-version direction; temporary compatibility
facades and shadow state are not part of the design.

## ADR 2.1 — Bounded contracts have no common barrel

`src/lib/types.ts` is replaced by focused leaf contracts under
`src/lib/contracts/`: media format and metadata, catalog, playback, module
playback, Raf, appearance/player/experimental settings, loadouts, workspace,
and window-menu descriptions. Consumers import the owner they actually depend
on. Contract modules may depend on smaller leaf contracts but never on stores,
services, Svelte components, or browser adapters.

`PlaylistItem` retains its characterized shape only during the Stage 2 move.
Stage 3 replaces it with the canonical media entity and leases in the catalog
contract; no compatibility barrel or second application media model survives.

## ADR 2.2 — Multiplayer wire data is not application state

`multiplayer-protocol.ts` remains at its canonical path because protocol/rule
synchronization and browser evidence consume it there. The module owns explicit
wire DTOs for catalog tracks, metadata, repeat mode, and playback state. It may
not import application catalog, playback, settings, store, or presentation
contracts.

Application-to-wire projection and sanitization occur at the Multiplayer host
boundary. Validators accept only the bounded wire shape and validate finite
numeric fields. Future local entity fields cannot become network fields merely
because TypeScript structural typing permits them.

## ADR 2.3 — Browser effects enter through a page runtime

The Stage 2 runtime kernel is rooted at `src/lib/runtime/`. It owns injectable
clock, ID, capability, key/value storage, file-access, and worker-creation ports,
plus their Chromium adapters. Ports expose product operations, not a generic
browser emulation layer, and preserve native File System Access and Vite Worker
types where those are the product contract.

Domain errors keep a stable category, domain code, operation, retryability, and
safe cause. Cancellation, unavailable capability, permission denial, quota,
blocked storage, corruption, stale/conflicting work, timeout, I/O, and internal
failure remain distinguishable. User-facing text is projected separately.

## ADR 2.4 — Every reconstructed effect belongs to a resource scope

Each page owns one root resource scope; replaceable operations own child scopes.
Registration records kind and a diagnostic label, never the resource object.
Release and scope disposal are idempotent. Disposal begins LIFO, settles async
releases, and returns an inspectable report including failures instead of
silently losing them. Repeated disposal returns the same result.

Stage 2 supplies typed ownership for listeners, scheduled clock work,
AbortControllers, BroadcastChannels, Workers, and object URLs. Later stages add
database/cache, media/audio, and peer resources when their domain owner is
reconstructed. The common primitive does not take ownership away from domains.

## ADR 2.5 — Page bootstrap is explicit configuration

All eight pages use one bootstrap orchestrator with explicit page identity,
mount/unmount, production service-worker policy, mobile-document setup,
scrollbar policy, popup-size persistence, orphan policy, readiness, and marker.
Initialization order is runtime scope and logging, service worker, theme,
mobile document, scrollbar, localization, popup/orphan behavior, mount, page
readiness, then the readiness marker.

A non-BFCache `pagehide` unmounts and disposes exactly once. A persisted BFCache
transition retains the page runtime. Main readiness continues to wait for the
three collection stores; other pages retain their current mounted readiness.

## ADR 3.1 — Settings converge by an ordered snapshot envelope

The current-version settings engine stores a normalized value with origin ID,
monotonic revision, message ID, and write time. Revisions order writes; origin
and message identity provide a deterministic tie-break for simultaneous writes.
Storage events and BroadcastChannel messages apply the same comparison and
deduplicate message IDs, so delivery order cannot leave peers divergent.

A local write becomes authoritative in memory only after its serialized
snapshot is accepted by the storage boundary. Unavailable/quota failures are
observable. Reset is an ordinary atomic default snapshot. Every engine has
explicit flush/dispose behavior. Existing separate keys and channels remain
separate unless their ledger ownership says otherwise.

## ADR 3.2 — IndexedDB failures are repository state

Typed connection and transaction primitives own `blocked`, `versionchange`,
abort, quota, corruption, and close behavior. Repositories and rebuildable
caches preserve their separate databases/stores and project failures explicitly
instead of converting all faults to empty data. Connections belong to resource
scopes, and version changes close stale connections.

The current Stage 3 schemas are clean current-version schemas. No legacy schema
migration or dual read/write path is introduced.

## ADR 3.3 — Durable media identity and runtime access are separate

The canonical media entity owns stable identity, display path/name, source
folder identity, format/kind, size/revision facts, bounded catalog metadata,
rating, and optional module subsong. It never owns `File`, filesystem handles,
object URLs, decode state, permission state, or remote-transfer state.

Runtime materialization returns a scoped lease containing the current `File`
and, only for media-element stream/video paths, an object URL. Lease release
revokes the URL exactly once. File handles remain in their separate IndexedDB
boundary. Playlist/library/favorites records, backups, and Multiplayer wire data
never contain runtime materialization state.

## ADR 3.4 — Collection changes are commands over one immutable state

Playlist, Library, and Favorites retain separate repositories and policies.
The playlist permits duplicates except where the existing optional import
deduplication control applies; Library deduplicates; Favorites identity remains
subsong-aware. Stable IDs, play counts, ratings, selection, navigation, and
shuffle/repeat behavior remain explicit.

Hydration, command application, persistence scheduling, background metadata,
and shutdown have named inspectable state. Managed-folder scans produce a plan,
validate permission plus folder/collection revision, then apply one scoped
transaction. Concurrent UI mutation and stale metadata cannot be overwritten by
an anonymous queued closure.
