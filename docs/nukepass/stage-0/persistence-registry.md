# Persistence registry

All current IndexedDB schemas are version 1. Primary data, handles, lightweight
settings, and rebuildable caches remain separate.

## IndexedDB

| Database / store | Record and current owner | Reset/export/quota policy | Disposition / defect |
| --- | --- | --- | --- |
| `izci-playlist` / `playlist[state]` | Handle-backed `StoredPlaylistState`, selection, shuffle/repeat; playlist repository/facade | Primary durable state; non-handle items omitted; DB opened/closed per operation | Preserve duplicate semantics; failures mostly log/resolve |
| `izci-library` / `playlist[state]` | Same schema for deduplicating Library | Primary durable; portable records included in backups | Preserve IDs/play counts/dedupe |
| `izci-favorites` / `playlist[state]` | Favorite identities/items | Primary durable; included in backup | Preserve |
| `izci-filesystem` / `folders[state]` | Directory handles plus ID/name/mode/scan facts; runtime permission excluded | Individual forget; handles deliberately excluded from backup | Preserve separate handle boundary and no launch prompts |
| `izci-artwork-cache` / `sources`, `renditions` | Source fingerprints/negative results and WebP blobs | Rebuildable; rendition LRU 48 MiB; no clear UI; source records unbounded | Preserve boundary; repair source bound/observability |
| `izci-playback-progress` / `progress[identity]` | Position/duration/update time; progress service | Durable UX; 5-second checkpoints; backup included; no global clear/pruning | Preserve; define bound/reset policy |
| `izci-backup-restore` / `restore[pending]` | Portable unresolved folders/tracks/favorites after restore | Durable staging; same-origin channel; empty state remains stored | Preserve explicit relink workflow |
| `izci-render-cache` / `renders`, `blobs(byRender)` | Manifest/LRU facts plus WebM init/clusters | Rebuildable, optional, per-entry/all clear, 256–4096 MiB LRU | Preserve separate cache; DB connection never closes/versionchanges—repair |

Most owners open per operation and close after transactions. Render disk cache
memoizes its connection. Only artwork/render implement `blocked`; no database
installs `versionchange`. Abort/quota/corruption usually collapses to empty/null/
void rather than an inspectable degraded state. There is no origin-wide storage
estimate/persistence policy.

Collection writes are debounced by 400 ms and background metadata writes by up
to 5 seconds in `playlist.ts`, but the collection facade has no pagehide/destroy
flush. A realm closing in that window can lose the most recent mutation. Artwork
and render-cache reads also cast stored records without a complete corruption
normalizer.

## localStorage and synchronization

The common normalized settings engine resets by writing defaults, synchronizes
through storage events plus BroadcastChannel, and suppresses identical JSON.
It ignores removals, has whole-object last-writer-wins collisions, exposes no
dispose, and lets write/post failures escape after memory changed.

The Goldilocks ledger is the authoritative exact mapping of setting identity,
default/range, presentation, runtime and reset behavior. The table below records
storage boundary families without replacing those field-level records.

| Key family | Channel/scope |
| --- | --- |
| `izci.locale`, appearance, metadata, track, video, visualizer, pattern, playback, module playback, player volume, Raf rack/presets | Named same-origin settings channels |
| `izci.experimental-settings`; Multiplayer recents, pairings, last session and per-host Freeplay state | Separate named same-origin channels |
| Library view v6, workspace panel state/layout, loadouts and capture categories | Separate named same-origin channels |
| Logging settings and Logs level/column/sort stores | Separate named same-origin channels |
| Troubadour settings and workspace | Separate named same-origin channels |

Direct unsynchronized keys are `izci-install-hint-acknowledged`,
`izci.multiplayer.receive-audio`, `izci.options-window-state`,
`izci-playback-bookmarks`, `izci.playback-restoration`,
`izci.popup-window-sizes`, `izci.pwa-update-last-successful-check`,
`izci.file-launch.primary.v1`, `izci:converter-settings`, and
`izci.troubadour-options-window-state`. `izci.pwa-update-completed` is the only
sessionStorage key.

These direct keys are not automatically defects: several are intentionally
window/session coordination. Stage 3 must classify each before consolidating
settings and may not turn transient ownership into durable shared state.

## Backup/import/export registry

Backup format v1 is a zipped `.izci` bundle with manifest, allowlisted settings,
portable Library, folder descriptors without handles, favorites, and playback
progress. It deliberately excludes source media, reusable handles, Playlist,
artwork/render caches, lyrics/patterns/meters/logs, object URLs, playback/window/
update coordination, and other transient presentation.

Restore reuses matching known files or stages portable records until users
relink folders/files. File handles then return through normal folder/library
owners. Export download URLs are revoked; tool writes target user-selected
external files and are not app-origin persistence.

Known defects:

- The backup allowlist names `izci.library-view-settings.v5` while the live key
  is v6, silently omitting current Library presentation state.
- Restore writes localStorage directly and reloads only a same-origin opener;
  embedded/standalone Options does not refresh existing stores or broadcast.
- Settings outside the allowlist need explicit include/exclude records rather
  than being absent accidentally.
- The allowlisted `izci.experimental-settings` object includes
  `multiplayerTurnSecret`; export stores that secret as plaintext JSON inside the
  unencrypted zip. This requires an explicit security/product decision.

## Other memory caches

- Host Multiplayer render cache: compressed LRU, default 256 MiB, with consumer
  pins; the configured cap is soft while entries are pinned. Client compressed
  cache is bounded to 64 MiB.
- Lyrics promise cache and artwork palette cache are process-lifetime unbounded
  Maps; palette keys may reference revoked URLs.
- Editor module render cache is an unbounded process-lifetime
  `Map<string, AudioBuffer>`.
- Folder scan/artwork in-flight maps remove settled work.
- Workbox precache is rebuildable and separate from application persistence.
- Logging memory is transient and bounded to a 3,000-entry buffer plus several
  128-entry correlation/deduplication sets.

## Verification gaps

There are no repository-level fake/real IDB suites for transaction abort, quota,
blocked upgrade or versionchange; no registry assertion tying backup keys to
live stores; no simultaneous BroadcastChannel collision/close tests; and no CDP
storage-boundary inspection. Stage 1 adds the baseline and explicit defects;
Stage 3 owns behavioral replacement.
