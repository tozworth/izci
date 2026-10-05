# Ownership boundaries

[Plan entry point](README.md) · [Runtime contracts](contracts.md) ·
[Initial scaffolding](scaffolding.md)

These boundaries precede the implementation sequence. Keep them stable as the
crudes expand; refine an ambiguous case here before duplicating it in a consumer.

## 1. libzci: application behavior and reusable media processing

libzci owns:

- Playback sessions: load/play/pause/stop/seek, sequencing, shuffle/repeat,
  up-next, prepared/outgoing tracks, gapless/fades/crossfades, restoration policy,
  speed/pitch semantics, errors, and cancellation.
- Catalog and user facts: stable identities, collection membership, queue
  occurrences, deduplication policy, scan reconciliation, queries/grouping,
  favorites, ratings, bookmarks, play counts, and last-played facts.
- Source/format interpretation: classification, codec-provider selection,
  container readers/demuxers, metadata readers, module probing, subsongs,
  channel controls, pattern data, and lyrics parsing/timing.
- Audio processing: mixing, channel mapping, resampling, transition envelopes,
  ReplayGain, Raf, analysis taps, master volume/mute, latency accounting, and
  output-independent rendering. Native and WASM use the same processing code.
- Video transport: stream selection, media timestamps, seek/preroll, bounded
  decode preparation, synchronization, presentation deadlines, frame-dropping
  policy, and recovery after decoder loss or hidden-surface suspension.
- Artwork/images: embedded extraction, asset identity, image decoding jobs,
  dimensions/orientation/color metadata, bounded rebuildable renditions, cache
  eviction, and a transient image-viewing sequence independent of music.
- Durable domain state: SQLite schema, SQL, constraints, transactions, settings
  normalization, and publication of committed revisions.
- Loadout context matching and playback/Raf payloads. Presentation payloads are
  shell-owned; publish the matched identity/context so shells need not reproduce
  matching rules.

Media implementations may live in optional provider modules rather than the
small central engine crate. Their registration and behavior contracts belong to
libzci. A native FFmpeg provider is optional media infrastructure, not a second
application player.

## 2. Platform adapters: access and execution mechanisms

Adapters provide:

- Native paths, browser Files/FSA handles, Android SAF content URIs, ranged reads,
  folder enumeration, permission queries, user-mediated grant requests, and
  optional filesystem watching. Report capabilities and permission failures.
- SQLite filesystem/VFS setup and platform resource locations. Native and
  browser adapters do not independently implement domain queries or updates.
- Audio devices, output buffers, actual output clock/latency, activation,
  suspension/interruption, device changes, and platform sample formats.
- Browser/OS decoder implementations behind the provider contract, including
  asynchronous packet decoding, frame-resource handles, and disposal.
- Rendering surfaces that execute supplied frame deadlines using local clocks,
  plus platform-specific drawing, scaling, color conversion, and surface loss.
- Media Session/MPRIS/native transport integration, lifecycle signals,
  installation/offline/update mechanisms, launches, and platform window hooks.
- Transient runtime objects and capability registries. Preserve real browser
  handles and real SAF grants; never synthesize one platform's handles from
  another platform's references.

An adapter can contain substantial code. It must not choose queue order, accrue
play counts, interpret favorites, apply a different Raf chain, or become the
authoritative current-track owner. User gestures originate in shells and invoke
adapter permission mechanisms; the engine receives their outcomes.

Do not assume all mechanisms share a thread. SQLite ownership, decode workers,
the audio worklet, frame rendering, and main-thread OS integration can be
separate execution contexts. Their wiring belongs to the runtime adapter.

## 3. Shells: presentation and interaction state

Shells own themes, layout, visualizers, backdrop composition and palette/contrast
analysis, workspace tabs, Oda/mobile navigation, focus, selection, columns,
window geometry, image pan/zoom/viewport controls, and video viewport placement.
They render snapshots and issue commands.

The engine offers catalog sort/group/filter queries; a shell chooses which
query, columns, and grouping presentation to use. Browser object URLs and canvas
elements are platform resources, not catalog fields. Mounting a rendering
surface must not create another playback session.

Generic asset resizing/thumbnail caching belongs to the engine's image services.
Cropping or fitting a backdrop to a particular zone, extracting a theme palette,
and deciding when visual contrast changes belong to presentation services.

Control descriptors can include stable parameter IDs, units, ranges, defaults,
and capabilities. Localized labels, icons, widget choices, and category layout
remain presentation resources. Avoid exporting today's combined node/name/icon
registry as the new engine API.

## 4. Storage and state separation

| State | Owner and storage |
| --- | --- |
| Catalog, queue, favorites/ratings/bookmarks, counts, domain settings | libzci SQLite; explicit collection/session ownership |
| Browser FSA capabilities | Browser adapter's IndexedDB registry, addressed by opaque IDs stored in SQLite |
| Native paths / SAF source references | Adapter-specific reference records; platform owns permission/grant mechanisms |
| Bounded artwork/image renditions | Separate rebuildable cache, never media blobs in catalog/queue records |
| Theme, visualization/backdrop, workspace, Oda and viewport preferences | Shell state; its storage implementation does not become a domain storage adapter |
| Image-viewing sequence, decoded frames, PCM, meters, pattern snapshots, peers, preparation | Transient; never persisted |
| Pairing/identity/operator state | Hosting/networking owner, kept distinct from catalog and transient signaling |

SQLite everywhere means one durable domain model. It does not mean pretending
browser capability objects are SQL values or putting presentation preferences in
the engine. Avoid a generic storage dialect implemented separately for SQL and
IndexedDB.

Images can be catalog/favorite items, but are not playback backends or music
queue entries. Image navigation captures the originating sequence at activation
and leaves audio/video transport independent. User rotation/zoom is presentation;
orientation encoded by the image is media data.

## 5. Consumer and hosting boundaries

- `zci-play` embeds the native library; it is not a subprocess wrapper around a
  browser player or FFmpeg executable.
- The native crude uses native widgets/drawing and the public engine API. No
  webview. Its local focus/selection state is acceptable; domain logic is not.
- The crude PWA loads the WASM engine and browser adapters. JavaScript glue is
  allowed there; it must not become a required native runtime or a JS engine
  reimplementation. Svelte itself is optional for this test consumer.
- A profile owns shared catalog/user facts. Each playback or Freeplay session
  owns its queue/navigation/timeline/DSP state. One authority per session, not a
  process-global current player. Host coordination serializes durable mutations.
- A daemon is optional consumer infrastructure. libzci remains directly
  embeddable, supports multiple instances, and can render without an audio
  device. Independently launched consumers need explicit profile ownership or
  separate profiles; SQLite locking alone does not coordinate session state.
- The future server retains signaling, admission, peer transport, permissions,
  source/Opus delivery, and orchestration. libzci replaces overlapping media,
  catalog, session behavior, and rendering machinery behind that boundary.

Multiplayer delivery remains source-file or buffered Opus. Do not add live RTP
or a jitter-buffer pathway. Listener processing remains listener-owned; offline
source renders must not accidentally bake the host's master volume or Raf into
audio that a listener processes again.

## 6. Clean break and deferred scope

No automatic import, migration, legacy compatibility readers, old preset
conversion, dual-writing, or cross-generation backup/restore for pre-libzci
state. Use a fresh namespace/profile; do not delete existing profiles as part of
scaffolding. Current-version persistence/restart correctness is still required.

Tag editing, Troubadour jobs, conversion/export interfaces, and a public
third-party plugin ABI remain undecided. Avoid scaffolding empty frameworks for
them. Current metadata parsing and fundamental artwork/image support do belong
to the player scope. Existing UI/shell migration is an explicit endgame, after
independent engine maturity, not the design driver of early APIs.
