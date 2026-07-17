# Incremental Library Indexing and Metadata Hydration

## Status

Design plan for future implementation. This document does not describe shipped behavior.

## Motivation

izci currently treats discovering files and reading files as one import operation. A dropped or managed directory is recursively traversed, every file handle is materialized into a `File`, supported files are collected, and only then are tracks added to the UI. Background metadata parsing subsequently reads complete stream files into memory.

That approach is tolerable for a small local folder but fails as a library-indexing strategy. The motivating case is a mapped SMB share (Z:\hdd\500temp\Müzik\0 Albums) containing approximately:

- 7,734 files in 674 directories;
- 7,725 supported audio files;
- 7,517 FLAC files;
- 234 GB of audio data;
- approximately 50 MiB/s of available sequential throughput.

A plain recursive directory listing completes successfully, but opening thousands of files serially magnifies network round-trip latency. Reading all 234 GB for metadata would take roughly 78 minutes even at the share's theoretical maximum throughput. Neither cost should delay tracks appearing in the library.

The intended model follows the separation used by traditional desktop players such as XMPlay:

1. **Indexing:** enumerate names and list every supported path as quickly as possible.
2. **Hydration:** inspect files for tags, duration, ReplayGain, and other metadata independently.

## Goals

- Show supported tracks incrementally while a folder is still being enumerated.
- Do not call `getFile()` merely to decide whether a known extension is supported.
- Do not read audio payloads during indexing.
- Keep managed-folder tracks playable through the remembered root directory handle and their canonical paths.
- Make scan progress, cancellation, and failures visible.
- Preserve existing tracks until a full successful scan proves that they were removed.
- Hydrate metadata independently with bounded I/O and resumable persisted results.
- Read only the byte ranges required for cursory stream metadata.
- Preserve the existing stream/module playback split and offline/local-first behavior.

## Non-goals

- Solving rendering or interaction performance for 7,000-plus visible rows.
- Adding a server, network indexer, account, or cloud database.
- Eagerly extracting or persisting artwork or lyrics.
- Automatically saturating a network share with metadata reads.
- Broad filesystem compatibility shims beyond the existing Chromium target.
- Preserving old pre-alpha persistence schemas. A clean current-version schema replacement is preferred.

## Core design

The managed-folder pipeline becomes three independent stages:

```text
remember root handle
        |
        v
enumerate supported paths -----> batch-upsert lightweight library entries
        |                                      |
        | complete successfully                | entries are immediately usable
        v                                      v
finalize reconciliation                on-demand materialization
                                               |
                                               v
                                  optional metadata hydration queue
```

Indexing owns path discovery and folder reconciliation. Materialization owns obtaining a `File` for playback or another explicit consumer. Hydration owns optional file inspection. Completion or failure in one stage must not be conflated with another stage.

## Lightweight indexed tracks

An indexed managed-folder track must be representable without a `File`, object URL, per-file persisted handle, size, modification timestamp, or embedded metadata.

A representative item is:

```ts
interface PlaylistItem {
  id: string;
  sourceFolderId?: string;
  path?: string;
  name: string;
  extension: string;
  kind: TrackKind;

  file?: File;
  fileHandle?: FileSystemFileHandle;
  size: number | null;
  lastModified: number | null;
  objectUrl?: string;
  metadata?: TrackMetadata;
}
```

For a managed-folder entry immediately after discovery:

```ts
{
  id: crypto.randomUUID(),
  sourceFolderId: folderId,
  path: '0 Albums/Artist/Album/Track.flac',
  name: 'Track.flac',
  extension: 'flac',
  kind: 'stream',
  size: null,
  lastModified: null
}
```

`null` explicitly means "not inspected." It must not be represented by zero because zero is a valid file size and would blur change detection and bitrate calculations.

`PlaylistItem.path` remains the canonical persisted and displayed path. No parallel folder-path cache should be introduced.

### Identity

Managed and other path-bearing tracks continue to use normalized path identity. Size and modification time are only a fallback identity for pathless items.

```ts
path:<normalized lowercase path>
```

Consequences:

- a lightweight item can be deduplicated before stat hydration;
- later stat or metadata updates do not change identity;
- rescans can match existing items without opening files;
- existing IDs, play counts, and metadata can be preserved by path.

## Handle-only enumeration

Introduce a dedicated managed-folder enumerator. Do not reuse the current helper that returns `File[]`.

The enumerator should be an async iterator yielding descriptors:

```ts
interface IndexedFileDescriptor {
  path: string;
  name: string;
  extension: string;
  kind: TrackKind;
  handle?: FileSystemFileHandle;
}

async function* enumerateSupportedFiles(
  root: FileSystemDirectoryHandle,
  options: { maxDepth: number; signal?: AbortSignal }
): AsyncGenerator<IndexedFileDescriptor>;
```

Enumeration rules:

1. Iterate directory handles recursively up to the configured nesting limit.
2. Check cancellation before entering a directory and between entries.
3. Infer extension and kind from `entry.name` before any `getFile()` call.
4. Skip known unsupported extensions without materializing them.
5. Preserve existing unknown-extension verification semantics:
   - verification applies only to unknown extensions when enabled;
   - unknown verification necessarily belongs to hydration/materialization because it requires bytes;
   - unknown files must not block known-extension indexing;
   - a verified unknown module can be added later as a scan-side enrichment result.
6. Yield frequently; do not collect the complete tree in a single array.
7. Record directory-level failures with their paths and continue when safe.
8. Treat a root-level enumeration failure as a failed scan.

The returned file handle may be useful ephemerally during the current window lifetime, but managed-folder persistence must not depend on storing thousands of per-file handles.

## Immediate drop behavior

Dropping a directory should perform only enough work in the event handler to acquire its root handle and hand it to the folder service.

The sequence should be:

1. Accept the drop.
2. Obtain the directory handle.
3. Remember it immediately in the separate filesystem-folder store.
4. Set its requested library mode.
5. Start a managed-folder scan through the scanner service.
6. Return control to the UI.

The playlist/library component must not await the recursive crawl. Components dispatch intent; services own enumeration and state.

If a drop contains ordinary files as well as directories, ordinary file import can remain a separate operation. A directory must not be recursively materialized by `extractDroppedContent()` when it is being handed to the managed-folder scanner.

## Incremental batch publication

The scanner should accumulate descriptors into small batches and publish them to the library while enumeration continues.

Initial tuning values:

- batch size: 200 tracks;
- maximum publication interval: 250 ms;
- explicit event-loop yield after each publication;
- only one active scan per folder;
- scans of different folders queued by default rather than run without limit.

Batching by both count and elapsed time prevents a sparse or slow directory from withholding progress indefinitely.

Each batch is converted to lightweight `PlaylistItem`s and sent to a new folder-index upsert operation. The operation should:

- match existing tracks by canonical path;
- preserve existing IDs, metadata, play counts, hydrated stats, and usable ephemeral materialization;
- assign `sourceFolderId` to adoptable unmanaged or orphaned matches using existing reconciliation rules;
- append genuinely new paths;
- avoid scheduling metadata parsing automatically;
- update the Svelte store once per batch, not once per item.

## Safe reconciliation

The current full-snapshot reconciliation concept should become a scan session with explicit finalization.

```ts
interface FolderScanSession {
  folderId: string;
  generation: string;
  startedAt: number;
  discoveredCount: number;
  indexedCount: number;
  seenPaths: Set<string>;
  errors: FolderScanError[];
}
```

During enumeration, every supported normalized path is added to `seenPaths`. Existing entries are updated or preserved as batches arrive.

Only after the root traversal completes successfully may finalization remove folder-owned tracks whose paths were not seen.

If the scan is cancelled, loses permission, or encounters an error that makes the result incomplete:

- retain all previously indexed tracks;
- retain newly discovered tracks already published;
- do not perform destructive removal reconciliation;
- report that the result is partial;
- allow a later rescan to finish reconciliation.

This prevents a transient SMB disconnect from emptying part or all of the library.

The in-memory `seenPaths` set is sufficient for the expected library size. It should not be persisted as durable application state.

## Folder scan state

Folder state should distinguish indexing from metadata work.

Suggested indexing states:

```ts
type FolderScanStatus =
  | 'never'
  | 'enumerating'
  | 'indexed'
  | 'partial'
  | 'permission-required'
  | 'cancelled'
  | 'error';
```

Suggested progress fields:

```ts
interface FolderScanProgress {
  discoveredTrackCount: number;
  visitedDirectoryCount: number;
  skippedFileCount: number;
  errorCount: number;
  currentPath?: string;
}
```

`currentPath` is transient presentation state and should not be persisted. Durable folder state should retain only the final status, timestamps, track count, and a concise error summary.

User-facing examples:

- `Scanning… 1,400 tracks found`
- `Indexed 7,725 tracks`
- `Partial scan: 6,820 tracks found; 1 folder could not be read`
- `Permission required`
- `Scan cancelled after 2,100 tracks`

Metadata work must not change a folder back to `enumerating` or prevent the folder from being considered indexed.

## Managed-folder materialization

Managed-folder tracks should be materialized from the remembered root handle and canonical path when playback or another explicit operation needs a `File`.

Resolution algorithm:

1. Find the folder record using `sourceFolderId`.
2. Verify root-handle permission without prompting unless the caller explicitly permits a prompt.
3. Normalize and validate `PlaylistItem.path`.
4. Remove the root display segment when it matches the remembered root name.
5. Walk each directory component with `getDirectoryHandle()`.
6. Resolve the final component with `getFileHandle()`.
7. Call `getFile()` once.
8. Refresh nullable size and modification time.
9. Create an object URL only for a stream track.

Resolution must reject `.` and `..` traversal and must never escape the remembered root.

The resolved per-file handle and `File` may be retained ephemerally on the active item, but the durable source of truth for a managed track remains `sourceFolderId + path`.

Path resolution failures should mark the individual item unavailable for the attempted action. They must not remove it immediately; the next complete folder scan owns removal.

## Persistence changes

The library persistence schema must allow managed items without a per-file handle and with nullable stats.

Serialization rules:

- persist managed items when `sourceFolderId` and canonical `path` are valid;
- persist individually imported items only when their reusable file handle is available;
- never persist `File`, object URLs, artwork, lyrics, scan progress, or other transient data;
- continue to persist reusable root directory handles only in the filesystem-folder database;
- persist hydrated textual metadata and duration as today;
- debounce or defer writes so each indexing batch does not rewrite the full 7,000-item state immediately.

Because izci is pre-alpha, use a clean schema/version replacement rather than a compatibility adapter. Existing stored library data may be cleared and regenerated from remembered managed folders.

### Persistence scheduling

The current collection persistence writes the complete state. During a large scan, queueing one full write after every batch would create avoidable cloning and IndexedDB pressure.

Use one of these approaches, in preference order:

1. Persist changed items individually in an item-keyed object store and store collection settings separately.
2. If retaining a single-state record temporarily, throttle scan persistence and force one final write after scan completion or cancellation.

An item-keyed store is the better durable design for incremental indexing and metadata updates.

## Metadata hydration

Metadata hydration is a separate service with its own queue and status. Indexing must never await it.

### Priority classes

Suggested priority order:

1. currently selected or requested-for-playback track;
2. visible track details request;
3. explicit user-requested metadata scan;
4. low-priority automatic background hydration, if enabled.

New high-priority work should move ahead of background work. Do not launch duplicate jobs for the same track identity and metadata version.

### Concurrency and cancellation

Initial defaults:

- local or unknown storage: concurrency 2;
- managed folders: concurrency 1 by default;
- per-folder serialization to avoid random SMB access storms;
- cancellation through `AbortSignal` between byte-range reads and before parsing;
- retry only on an explicit later request or rescan, not in a tight loop.

The browser does not expose a dependable "network share" classification. The design should be conservative for all managed folders rather than depend on detecting SMB.

### Metadata status

Per-track metadata should distinguish at least:

```ts
type MetadataHydrationStatus =
  | 'unread'
  | 'queued'
  | 'reading'
  | 'complete'
  | 'failed';
```

Avoid persisting noisy transient queue states unless needed for a resumable explicit bulk job. Persist the resulting metadata and a stable indication that embedded text metadata was successfully inspected. Failed work should remain retryable.

## Range-based stream metadata

`file.arrayBuffer()` over an entire stream file must not be used for cursory metadata or artwork discovery.

### FLAC

FLAC metadata is stored in blocks before the audio frames. Implement a reader that:

1. Reads the `fLaC` marker and first block header.
2. Iterates four-byte block headers using range reads.
3. Reads the small `STREAMINFO` block for duration and technical properties.
4. Reads the `VORBIS_COMMENT` block for textual metadata and ReplayGain.
5. Skips `PICTURE` block payloads by advancing its declared length.
6. Stops at the last metadata-block flag without touching audio frames.

To reduce SMB round trips, begin with a bounded read-ahead window such as 256 KiB. Request a further range only when a required block extends beyond the buffered data. Apply a sane maximum accepted textual metadata size and fail gracefully when declarations are malformed.

Artwork loading remains on-demand. When requested, read only the selected picture block's declared range rather than the complete FLAC.

### MP3

For textual ID3v2 metadata:

1. Read the ten-byte header.
2. Parse the synchsafe tag length.
3. Walk frame headers with bounded range reads.
4. Read desired text and ReplayGain frames.
5. Skip `APIC` payloads unless artwork was explicitly requested.

For APEv2 ReplayGain, inspect the small footer range at the end of the file and fetch only the declared, bounded tag region when valid.

MP3 duration may be left unresolved until playback or derived later using a dedicated partial parser. It must not justify reading the complete file during indexing.

### Ogg Vorbis and Opus

Read enough leading Ogg pages to assemble the identification and comment packets. Stop once the required packets have been parsed. Apply byte and page-count limits so malformed files cannot cause unbounded reads.

### WAV

Walk RIFF chunk headers with bounded range reads. Skip payloads by declared chunk length and read only required format or metadata chunks. Duration can be derived from format and data-chunk sizes without reading PCM data.

### Tracker modules

Tracker metadata continues to use the separate OpenMPT background probe. Modules are generally much smaller than lossless streams, but module probing still belongs to hydration rather than path indexing.

Unknown-extension verification likewise remains a separate muted OpenMPT probe and must not delay known-extension tracks appearing.

## Initial display metadata

Before embedded tags are hydrated, tracks should still have useful presentation:

- title inferred from filename according to current settings;
- folder displayed from the canonical path;
- artist/album may be inferred conservatively from managed-folder path structure only if a dedicated, opt-in rule is introduced;
- unresolved fields remain blank rather than being guessed aggressively.

Path-based guesses must not be marked as embedded metadata. Embedded results should replace or merge with inferred values according to the existing metadata precedence rules.

## Error handling

All long-running service operations need explicit error boundaries.

Enumeration errors should include:

- normalized relative directory path;
- operation (`iterate`, `getDirectoryHandle`, or equivalent);
- a safe concise message;
- whether the scan could continue.

Do not expose raw handle objects or verbose browser exception dumps in persisted state.

Individual metadata failures should not affect folder index status. A corrupt FLAC should remain listed and playable if the backend can play it, while its metadata status may be `failed`.

Permission behavior must preserve existing rules:

- launch scans do not prompt;
- an explicit user action may request permission;
- losing permission produces `permission-required` without destructive reconciliation;
- metadata work pauses when permission is unavailable.

## Cancellation and supersession

Starting a new scan for a folder with an active scan should either return the active promise or explicitly cancel and supersede it. Do not run two traversals of the same root concurrently.

For a superseding scan:

1. abort the old session;
2. mark it superseded without final reconciliation;
3. begin a new generation;
4. ignore late batches or completion callbacks from the old generation.

Forgetting a folder or removing its library mode should abort its scan and prevent further batch publication. Existing tracks follow the current product rule for removal from the library; scan cancellation alone must not invent a new destructive behavior.

## Service ownership

Suggested ownership boundaries:

- `library-folder-scanner.ts`
  - scan sessions, enumeration, progress, batching, cancellation, and finalization;
- a focused directory-index helper under `src/lib/services/` or `src/lib/utils/`
  - handle-only recursive async iteration and path construction;
- `filesystem-folders.ts`
  - remembered root handles and durable folder scan summary;
- `playlist.ts` plus focused sibling modules
  - batch upsert, final reconciliation, nullable stat updates, and persistence;
- `playlist-materialization.ts`
  - resolution of managed paths through remembered root handles;
- a new metadata hydration service
  - prioritization, deduplication, concurrency, cancellation, and status;
- focused parsers under `src/lib/services/`
  - bounded range reads for FLAC, MP3, Ogg/Opus, and WAV;
- Svelte components
  - render progress/status and dispatch scan, cancel, or hydrate intent only.

Do not place traversal, reconciliation, metadata parsing, or queue logic in `PlaylistPanel.svelte` or the Options folder view.

## Implementation sequence

### Milestone 1: lightweight complete indexing

- Allow nullable file stats.
- Add handle-only supported-file enumeration.
- Remember dropped folders before crawling them.
- Add scan sessions and observable progress.
- Batch-upsert lightweight managed items.
- Finalize removals only after successful enumeration.
- Stop automatic metadata scheduling for scan batches.
- Resolve managed tracks from root handle plus path for playback.
- Update persistence to retain lightweight managed items.

This milestone solves the motivating requirement: all 7,000-plus FLAC files appear without opening or reading each one.

### Milestone 2: robust persistence and recovery

- Move the library to an item-keyed IndexedDB store.
- Throttle scan writes and persist final scan summaries.
- Verify relaunch restoration without per-file handles.
- Verify permission loss and recovery.
- Add cancellation and generation supersession tests.

### Milestone 3: selective metadata hydration

- Introduce the priority queue and per-track hydration status.
- Hydrate selected/played tracks first.
- Implement bounded FLAC `STREAMINFO` and Vorbis-comment reads.
- Persist successful text metadata and duration.
- Add explicit bulk hydration and cancellation controls if desired.

### Milestone 4: remaining formats and observability

- Add partial MP3, Ogg/Opus, and WAV readers.
- Keep tracker probing in the module path.
- Add useful aggregate progress and failure summaries.
- Tune batch size, persistence cadence, and hydration concurrency using real local and SMB libraries.

## Tests

### Pure enumeration tests

- yields known supported extensions without calling `getFile()`;
- skips known unsupported files;
- respects nesting depth;
- constructs normalized canonical paths;
- yields incrementally rather than after complete traversal;
- stops on cancellation;
- records recoverable child-directory failures;
- fails safely on a root-directory error.

Fake file handles should count `getFile()` calls. Known-extension indexing must assert zero calls.

### Reconciliation tests

- preserves existing IDs and play counts by path;
- adopts an existing matching path when appropriate;
- appends new paths in batches;
- removes missing paths only after successful finalization;
- preserves missing paths after partial, failed, cancelled, or superseded scans;
- ignores late batches from an old generation;
- updates nullable stats without changing identity.

### Materialization tests

- resolves a nested managed path through its remembered root;
- rejects traversal components;
- handles a renamed or missing file without removing the item;
- refreshes stats after `getFile()`;
- creates object URLs only for streams;
- preserves module materialization through the OpenMPT path;
- does not prompt during launch-owned operations.

### Metadata tests

- FLAC text metadata reads only declared metadata ranges;
- FLAC picture blocks are skipped during text hydration;
- artwork reads only the requested picture block;
- malformed block sizes are bounded and fail safely;
- priority work overtakes queued background work;
- duplicate hydration requests coalesce;
- cancellation stops further reads;
- metadata failure does not change folder index status.

### Integration tests

Use synthetic handles representing at least 10,000 tracks to verify:

- the first batch reaches the store before enumeration completes;
- progress counts are monotonic;
- the app does not retain 10,000 `File` objects;
- the scan does not schedule 10,000 metadata reads;
- final library count is correct;
- persistence and reload retain managed items without per-file handles.

Real-filesystem manual verification should cover both the local test folder and the motivating mapped network share.

## Acceptance criteria

Milestone 1 is successful when:

- dropping or registering the approximately 7,725-track folder produces visible progress immediately;
- the first tracks appear before the root traversal finishes;
- all supported known-extension tracks appear after enumeration;
- known-extension enumeration performs no `getFile()` calls;
- scan completion does not wait for metadata;
- cancelling or disconnecting the share does not delete previously indexed tracks;
- relaunch restores the indexed tracks from IndexedDB and the remembered root handle;
- selecting a track can materialize and play it through the normal stream backend;
- module playback remains on Chiptune3/OpenMPT;
- no artwork, lyrics, or live presentation data is persisted.

Metadata hydration is successful when:

- selecting a FLAC can populate its text metadata and duration without reading its audio frames;
- bulk hydration can be cancelled and does not block indexing or playback;
- hydrated results survive relaunch;
- full-file `arrayBuffer()` calls are absent from cursory stream metadata paths.

## Performance targets

These are engineering targets rather than hard filesystem guarantees:

- scan state visible within 100 ms of accepting a folder;
- first batch visible within 1 second when the filesystem produces entries promptly;
- no more than one Svelte collection update per batch;
- zero file-content bytes read during known-extension indexing;
- at most one managed-folder metadata file active by default;
- bounded memory independent of total audio byte size;
- cancellation observed between entries or range reads without waiting for the complete library.

The total enumeration time remains dependent on the filesystem and network. The key guarantee is that enumeration latency is progressive and visible, and file-content latency is not part of indexing.

## Open implementation decisions

The following should be resolved during implementation with focused measurements:

- whether to retain ephemeral per-file handles after enumeration or resolve every managed path on demand;
- the exact scan batch size and maximum publication interval;
- whether explicit bulk metadata hydration should resume across application restarts;
- byte limits and read-ahead windows for each metadata format;
- whether conservative path-based artist/album inference belongs in the initial milestone;
- whether folder scans should queue globally or allow a small cross-folder concurrency.

None of these decisions should compromise the central boundary: discovering supported paths is fast and lightweight; inspecting file contents is separate, optional work.
