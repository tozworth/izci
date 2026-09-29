# izci server plan

## Goal

Turn the existing Go Multiplayer Sidekick into `izci-server`: a lightweight,
self-hosted signaling service and valid izci Multiplayer host that does not run
the izci web application.

An izci client joining the server should behave as though it joined an ordinary
izci host. The normal queue, library, playback, source-file, buffered Opus,
pairing, and Freeplay interfaces remain in use. The only deliberate presentation
difference is host identity: connection details may show, for example,
`izci dedicated server 0.3.2` instead of `izci 0.3.2`.

The server depends on system FFmpeg and libopenmpt. Build the HivelyTracker
replayer into the server because a suitable system package is not reliably
available. Do not introduce a JavaScript runtime, browser, audio device, Web
Audio graph, or second frontend.

This plan extends and ultimately renames the implementation created by
`docs/multiplayer-sidekick-plan.md`. It is not a proposal for another signaling
server beside Sidekick.

Work through the phases in order. Finish each phase's implementation,
integration, tests, and documentation before beginning the next one. Follow
`AGENTS.md`, including the required frontend build after source changes.

## Settled product decisions

- The distributable product and executable are named `izci-server`. “Daemon”
  may describe a deployment but is not the product name.
- One Go codebase owns signaling and dedicated hosting, with separate internal
  packages and interfaces. The normal deployment is one process running both.
- Preserve a signaling-only mode and a host-only mode so signaling and media
  hosting can be split across machines without a second implementation.
- Dedicated-server invitations use izci-server signaling. Do not reproduce the
  Firebase RTDB host protocol in Go.
- System FFmpeg decodes ordinary audio/video and encodes WebM/Opus. System
  libopenmpt decodes tracker modules directly. The built-in Hively replayer
  decodes AHX/HVL. Do not depend on FFmpeg having been built with libopenmpt.
- Initial module rendering uses izci's defaults only, including no
  interpolation. User-facing module decoder settings are later work.
- Direct source-file transfer is an intentional, preferred low-overhead path.
  It is acceptable that an admitted listener receives the original file.
- Catalog paths are virtual paths equivalent to standard izci File System
  Access paths. Never publish the server's absolute filesystem paths.
- Live RTP is not required for the first complete release. Source-file and
  buffered-Opus delivery must cover ordinary audio, modules, Hively files, and
  video soundtracks. Add RTP later for live or unbounded inputs if justified.
- Freeplay is an architectural requirement, not a late extension. Shared
  playback and Freeplay must use the same session engine from the first host
  implementation.
- Compatibility is pre-alpha and scorched-earth. Prefer a clean current
  protocol and configuration over compatibility adapters for experimental
  Sidekick builds.

## Required architecture

### One program, separable roles

The executable should support these conceptual modes; exact flag spelling can
be finalized with the CLI implementation:

```text
izci-server serve    signaling + dedicated host (default deployment)
izci-server signal   signaling only (the current Sidekick role)
izci-server host     dedicated host using a separate izci-server signal endpoint
```

Keep the roles separate internally even in combined mode:

```text
cmd/izci-server
internal/
  signaling/     rooms, admission, HTTP/WebSocket signaling, ICE credentials
  protocol/      app-channel types, validation, framing, conformance fixtures
  host/          peers, commands, permissions, playback sessions
  library/       roots, scanning, stable IDs, metadata, virtual paths
  media/         source transfer, native decoders, Opus renders, cache
  persistence/   SQLite/configuration ownership
```

Do not let combined mode call private signaling state directly from the host.
Define the same logical signaling interface for an embedded or remote host so
split deployment remains continuously testable.

### Playback sessions, never a singleton player

Represent every independently controlled playback stream with the same
server-side object:

```ts
interface PlaybackSession {
  id: string;
  kind: 'shared' | 'freeplay';
  controller: 'shared' | { peerId: string };
  subscribers: Set<string>;
  queue: string[];
  upNext: string[];
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  currentTrackId: string | null;
  playback: PlaybackClock;
  delivery: DeliveryGeneration;
  preparation: PreparationState | null;
}
```

This is illustrative, not a required Go shape. The ownership rules are
required:

- The room owns one permanent shared session. All ordinary co-op peers
  subscribe to it and permitted commands target it.
- Each active Freeplay peer owns an independent session, normally with that
  peer as its only subscriber.
- Playback clocks, navigation, current sources, delivery generations, seek
  epochs, readiness, transfer cancellation, artwork selection, and end-of-track
  behavior are session-scoped.
- The catalog, metadata cache, render cache, decoder worker limits,
  configuration, and peer registry are server-scoped.
- Rendered bytes are cache entries, not session state. Multiple sessions and
  peers may pin and consume the same cached rendition concurrently.
- No media or transport package may reach for a process-global “current track”
  or player. Tests must make such an implementation inconvenient to introduce.

The shared session is conceptually the omnipresent co-op playback context. Do
not call it a “co-op client” in code, because it is not a network peer.

### Media delivery policy

The initial policy remains deliberately understandable:

```text
no playable item or audio disabled
  -> none

source transfer enabled and file matches configured size policy
  -> source-file

otherwise, finite decodable input
  -> cached buffered WebM/Opus

render failure and explicitly permitted source fallback
  -> source-file
```

Support “always transfer,” “never transfer,” and a byte-size threshold. Do not
silently transfer a source when the operator explicitly disabled source
transfer. A later policy may consider cache presence, client decoder
capabilities, CPU pressure, or outbound bandwidth, but Phase 1-3 must not hide
those heuristics in unrelated code.

For shared source playback, every subscribed client receives and prepares the
file, acknowledges readiness, and joins the synchronized start. For Freeplay,
only the owning peer participates.

### Native rendering profile

Use this initial canonical pipeline:

```text
ordinary audio/video -> FFmpeg decode -------------------+
tracker module       -> system libopenmpt -> float PCM --+-> FFmpeg Opus/WebM
AHX/HVL              -> built-in Hively -> float PCM ----+
```

The canonical output is stereo 48 kHz Opus in WebM with approximately
one-second clusters, matching the browser host's buffered-render contract.
Discard video and render its audio track for the initial server.

Define one server module profile matching izci defaults:

- no interpolation;
- default stereo separation;
- normal pitch and tempo;
- requested subsong;
- a specified finite repeat count for cached output;
- stereo float PCM at 48 kHz.

Include source revision, subsong, decoder family/version, rendering-profile
revision, and bitrate in the render-cache key. Do not expose decoder controls in
izci Options during these phases.

### Library and path model

Configured filesystem roots map to virtual roots such as `/music` or
`/modules`. Catalog records expose only virtual paths. Resolve symlinks and
reject files whose resolved locations escape their configured root.

Persist opaque track identity separately from the virtual display path so
rescans and reasonable renames can preserve stable IDs, favorites, and other
server-owned state. Do not derive identity solely from an absolute path or send
absolute paths over Multiplayer.

Use SQLite for durable server state unless implementation evidence shows a
simpler store satisfies concurrent access and atomic reconciliation. Music and
rendered media remain ordinary files; do not store their contents in SQLite.

## Phase 0 — Rewrite and specify the Multiplayer protocol

This phase is a real protocol project, not a version-field edit. Finish it
before Pion or native media hosting is added.

1. Inventory every control message, binary frame, channel property, state
   transition, bound, timeout, and compatibility check used by browser host and
   client. Include shared playback, source transfer, buffered rendering,
   synchronized starts, chat, pairing, and Freeplay.
2. Write a normative, language-neutral protocol specification under `docs/`.
   Specify the three channel labels and their required properties:
   `izci-control` is ordered/reliable, `izci-media` is ordered/reliable, and
   `izci-render` is unordered/reliable. Specify framing and backpressure
   expectations as well as JSON shapes.
3. Replace `MULTIPLAYER_PROTOCOL_VERSION` exact equality with a protocol major,
   an additive minor, and versioned capabilities. A different major is
   incompatible. A minor mismatch alone is not an admission failure.
4. Put implementation identity in hello separately from protocol identity:
   product, product version, and optional build information. Add a dedicated
   host implementation field to session state and render it without assuming
   every host is browser izci.
5. Version independently meaningful facilities, including at least
   `source-file`, `buffered-opus`, `synchronized-start`, `pairing-proof`,
   `freeplay`, and `chat`. Absence means unavailable; unknown optional
   capabilities and JSON fields are ignored.
6. Define behavior for unknown messages and commands. Unknown optional message
   kinds are ignored safely; unsupported commands receive a negative
   acknowledgement. Messages marked critical must have an explicit negotiation
   rule rather than relying on decoder failure.
7. Change signaling admission to compare the application protocol major and
   required baseline capabilities rather than an exact app protocol integer.
   Keep the signaling socket protocol separately versioned.
8. Add canonical valid and invalid JSON fixtures plus binary source/render frame
   fixtures. TypeScript and Go must consume the same files. Cover bounds,
   malformed lengths, unknown extensions, and forward-compatible fields.
9. Add stateful conformance transcripts for initial connection, shared source
   playback, shared buffered playback, synchronized seek/start, pairing, and
   Freeplay. Validate ordering and generation ownership, not only decoding.
10. Add a compatibility test matrix: current minor in both directions, unknown
    capabilities, unsupported commands, and major-version rejection.
11. Refactor browser Multiplayer where needed so protocol behavior is not
    defined only by Svelte/browser implementation details. Keep browser host and
    client behavior working through the rewrite.

Phase gate:

- The written specification and fixtures are sufficient to implement an
  independent host without reading browser service internals for wire behavior.
- Go and TypeScript pass the shared fixtures.
- Browser host/client tests demonstrate minor-version tolerance.
- The normal frontend build succeeds.

## Phase 1 — Rename Sidekick and add the concurrent host foundation

1. Rename the Go module directory, executable, service/container examples,
   configuration names, documentation, logs, and user-facing setup language
   from Sidekick to izci-server. Rename focused frontend
   `multiplayer-sidekick-*` owners to server/signaling terminology. Do not retain
   adapters solely for unpublished pre-alpha names.
2. Preserve the existing signaling behavior as the `signal` role. Preserve
   room admission, invitation rotation, pairing admission, reconnection,
   temporary TURN credentials, limits, and secret-redaction guarantees.
3. Add Pion WebRTC to a dedicated host package. Use the existing offerer/client
   and answerer/host roles. Accept the client's three data channels for
   control, source files, and buffered Opus.
4. Implement remote-host signaling through the same izci-server socket contract
   used by browser hosts. Implement combined mode through an injected embedded
   signaling transport with equivalent lifecycle semantics, not direct registry
   access.
5. Implement protocol hello, capability negotiation, catalog/state stubs,
   command acknowledgement, connection cleanup, candidate handling, ICE
   failure reporting, and ICE restarts. Reuse configured STUN/TURN providers.
6. Implement the generic playback-session engine with one shared session and
   independent Freeplay sessions. Use an injected fake delivery backend at this
   stage; do not wait for FFmpeg to prove session ownership.
7. Route commands to sessions through a single dispatcher. Shared commands
   target the room session; authenticated Freeplay commands target only the
   caller's session. Keep permission checks separate from navigation/state
   mutation.
8. Implement per-session clocks, generation changes, preparation barriers,
   seek epochs, navigation, repeat, shuffle, play-next, and ended handling.
   Preserve host-authoritative state.
9. Add deterministic tests running one shared session and at least two Freeplay
   sessions simultaneously. Seek, stop, or advance each independently and prove
   no session mutates another. Subscribe multiple peers to the shared session
   and prove it remains one timeline.
10. Add WebRTC interoperability tests with the real Go signaling router and
    production TypeScript framing/channel helpers while mocking only browser
    RTC where a real browser is unavailable.

Phase gate:

- `izci-server signal` replaces the previous binary behavior.
- `serve` and `host` can accept an izci client and complete protocol hello over
  all required channels.
- Shared and Freeplay session concurrency is tested before any real delivery
  backend is attached.
- No package contains a process-global current player/track.

## Phase 2 — Add the persistent library and source-file playback

1. Add strict configuration for named library roots, virtual mount names,
   inclusion rules, source-transfer policy, SQLite location, and scan behavior.
   Reject unknown fields and ambiguous/overlapping virtual roots.
2. Probe system dependencies at startup. Report FFmpeg, required Opus/WebM
   encoding support, and libopenmpt versions separately. Report the built-in
   Hively version. Clearly distinguish a missing renderer from formats still
   serviceable through source transfer.
3. Implement initial scans and atomic reconciliation. Preserve stable IDs and
   server-owned metadata for unchanged files. Bound scan concurrency and do not
   follow symlinks outside configured roots.
4. Populate queue, library, favorites, metadata, kind, size, modification time,
   subsong, and virtual path using the existing protocol shapes. Apply catalog
   item and total-item limits before encoding.
5. Implement source revision from stable file facts plus content evidence where
   needed. Detect replacement during an active transfer and cancel the stale
   generation rather than mixing bytes.
6. Implement `izci-media` source transfer with the specified begin/chunk/end
   framing, small bounded chunks, per-peer backpressure, cancellation tokens,
   and retry behavior. Never load a complete file into server memory merely to
   transfer it.
7. Attach source delivery to both shared and Freeplay sessions. Shared playback
   waits on the appropriate subscriber preparation barrier; Freeplay waits only
   on its owning peer. A reconnect may rejoin the current shared playback
   generation, but source delivery must use a fresh transfer ID from byte zero;
   it must never append to ambiguous bytes.
8. Implement queue activation, transport controls, synchronized starts, seeks,
   next/previous, repeat, shuffle, play-next, and ended handling with real
   source-file clients.
9. Persist server identity, library reconciliation state, shared queue/state,
   and pairing records with clear ownership. Keep transient clocks, peers,
   preparation barriers, and transfer buffers out of persistent storage.
10. Add tests for virtual-path containment, replacement during transfer,
    backpressure, cancellation, reconnect, multiple shared subscribers, and two
    concurrent Freeplay source transfers.

Phase gate:

- An ordinary izci client can browse the dedicated catalog and play transferred
  standard audio, modules, and Hively files.
- Shared and Freeplay source playback both use the generic session engine.
- Restarting preserves identity and catalog stability without persisting live
  playback machinery.

## Phase 3 — Add native buffered Opus rendering and caching

1. Implement ordinary-media decoding through system FFmpeg. Discard video and
   retain its audio track. Bound input probing and process runtime; capture
   diagnostic output without leaking absolute library paths to clients.
2. Implement tracker decoding through system libopenmpt, not FFmpeg's optional
   module support. Apply the canonical izci-default rendering profile and
   requested subsong.
3. Integrate the HivelyTracker replayer into the Go build for AHX/HVL. Keep its
   decoder behind the same PCM-source interface as FFmpeg and libopenmpt.
4. Feed stereo 48 kHz float PCM to FFmpeg for Opus/WebM output. Produce and
   validate the protocol's init segment, approximately one-second clusters,
   timestamps, duration, sizes, and total-byte bounds.
5. Implement an on-disk render cache with atomic completion, source/profile
   cache keys, an indexed size limit, LRU eviction, and pin counts. Partial or
   failed renders are never published as complete entries.
6. Implement a bounded render coordinator. Deduplicate concurrent requests for
   one cache key, cap encoder processes, queue work fairly, cancel abandoned
   unshared work, and avoid letting a Freeplay peer starve the shared session.
7. Implement `render.manifest`, `render.need`, render binary fragments,
   readiness, seek epochs, received ranges, ahead/protection windows, and
   channel backpressure exactly as specified in Phase 0.
8. Attach render delivery to both shared and Freeplay sessions. Sessions pin
   cache entries independently; they do not own or duplicate the rendered
   bytes. Concurrent sessions requesting one source must share the completed or
   in-flight render.
9. Apply the configured delivery policy and permitted fallback behavior. Source
   transfer remains first-class rather than being demoted to a renderer error
   path.
10. Add corpus tests for standard media, every supported module family,
    subsongs, AHX/HVL, video soundtracks, corrupt inputs, encoder crashes,
    cache invalidation, seek thrashing, and concurrent shared/Freeplay reuse.

Phase gate:

- An izci client can play, pause, seek, reconnect, and advance through buffered
  server renders for every supported family.
- Browser-host and server-host WebM manifests and frames satisfy the same
  protocol fixtures.
- Concurrent sessions reuse one cache entry without sharing timeline state.

## Phase 4 — Complete pairing, Freeplay, and visible host parity

1. Complete persistent server identity and pairing-proof behavior using the
   Phase 0 capability. Preserve the rule that pairing grants app privileges
   after admission but does not bypass invitations or grant server
   administration.
2. Restore per-pair Freeplay preference and session state according to the
   protocol. A reconnect may rebuild a private session but must never attach the
   peer to another client's session or route it through the shared queue.
3. Implement catalog filtering, queue restoration, independent navigation,
   artwork, end-of-track, repeat-one, shuffle, and play-next for Freeplay using
   the same owners as shared playback.
4. Implement normal shared-client control permissions and server-side
   administrative policy. Make it explicit which admitted clients may alter
   the shared session; do not scatter permission checks through command cases.
5. Implement MOTD, chat, presence, now-playing messages, and bounded history if
   advertised. If a facility is omitted, omit its capability instead of
   impersonating incomplete support.
6. Extract bounded artwork renditions and metadata without storing artwork in
   catalog records. Cache rebuildable renditions separately and never expose
   source filesystem paths in errors or metadata.
7. Update desktop, mobile, and Oda host details to show implementation product,
   product version, protocol major/minor, capabilities where useful, and
   direct/relayed connection state. Joining remains the same user flow.
8. Add end-to-end protocol tests for a shared listener and at least two paired
   Freeplay listeners playing different tracks concurrently while another
   client controls shared playback.

Phase gate:

- The dedicated server is a complete normal and Freeplay host, not a special
  browse/download mode.
- A user does not choose a “dedicated server” connection type; the established
  host identifies itself after the ordinary join flow.
- Unsupported optional features disappear or degrade through capabilities,
  not hard-coded product-name checks.

## Phase 5 — Harden resources, networking, and operations

1. Add per-server, per-room, per-peer, and per-session limits for active peers,
   queued bytes, source transfers, render requests, render ranges, seeks,
   commands, and Freeplay sessions. Validate client ranges and generations even
   when TypeScript already validates them.
2. Debounce or cancel seek-thrashed render work. Limit concurrent FFmpeg jobs
   and subprocess memory/time. A hostile admitted client must not exhaust file
   descriptors, goroutines, disk, memory, or process slots.
3. Preserve control responsiveness while reliable source/render traffic shares
   an SCTP association. Use small frames, bounded ahead windows, channel
   backpressure, and transport priority where Pion exposes it. Test loss and
   slow-reader behavior.
4. Make STUN configuration part of the normal deployment rather than assuming
   host candidates are enough. Support fixed public candidate/NAT mappings where
   appropriate and optional coturn credentials through the existing signaling
   service.
5. Test public-address, LAN, IPv4, IPv6, NAT, TURN, relay-only, ICE restart, and
   signaling-loss behavior where the environment permits. Keep a healthy RTC
   session alive when its signaling socket reconnects.
6. Add health and readiness endpoints that distinguish signaling health,
   library readiness, dependency availability, cache health, and admission
   readiness without exposing secrets or paths.
7. Add structured operational logs and bounded metrics for peers, sessions,
   transfers, cache hits, render queue time, encoder failures, and ICE routes.
   Never log invitations, pairing secrets, SDP, candidates, source contents, or
   absolute library paths at normal levels.
8. Finalize non-root container, systemd service, config example, filesystem
   permissions, persistent volume layout, graceful shutdown, and backup notes.
   Shutdown must stop admissions, cancel subprocesses, drain bounded work, and
   close peer connections predictably.
9. Document system FFmpeg/libopenmpt requirements and tested versions. Include
   clear startup diagnostics for distributions whose FFmpeg lacks required
   Opus/WebM support.

Phase gate:

- Resource limits hold under race, fuzz, slow-peer, malformed-media, and
  concurrent-Freeplay tests.
- Direct connections work where ICE permits and TURN fallback is tested without
  claiming TURN is unnecessary.
- Packaged deployments restart without changing server, room, catalog, or pair
  identity unexpectedly.

## Phase 6 — Cut over naming and verify the complete system

> Implementation status (2026-09-22): Phases 4 and 5 are implemented in the
> Go host, signaling service, configuration, tests, and deployment examples.
> Automated protocol/session, pairing, Freeplay isolation, chat, persistence,
> resource-limit, slow-reader, render/cache, readiness/metrics, reconnect, and
> packaging checks are part of the repository verification. Per the current
> work scope, real-browser, real-NAT, relay-provider, and long-duration testing
> remains explicitly deferred to Phase 6 and must not be inferred from the
> automated ICE/Pion coverage.

1. Remove remaining Sidekick product terminology from active code,
   configuration, UI, tests, deployment files, and documentation. Historical
   planning documents may retain their original title but should point to this
   plan where confusion is likely.
2. Verify signaling-only, host-only with remote signaling, and combined modes
   from packaged artifacts. Do not let combined mode be the only tested path.
3. Run Go formatting, vet, race, fuzz/conformance, media corpus, and package
   build checks. Run focused Multiplayer tests, relevant Svelte checks, i18n
   validation, and the required frontend build.
4. Test current izci browser host to current client, izci-server to current
   client, and supported minor-version skew in both directions. Check source
   transfer, buffered Opus, shared playback, pairing, Freeplay, reconnect,
   invite rotation, direct ICE, and TURN.
5. Follow the public setup documentation against a clean machine/container and
   correct inaccurate defaults or commands. Keep official izci builds free of a
   preconfigured third-party server.
6. Report any real-browser, real-NAT, platform packaging, or long-duration
   behavior not exercised. Automated ICE tests are not proof that every NAT
   topology works.

The completed result is one lightweight Go server that can replace Sidekick,
act as a full Multiplayer host, or do both at once. Publishing binaries,
changing hosted defaults, and retiring any legacy signaling deployment remain
separate user-authorized release operations.

## Explicitly later

- User-facing libopenmpt/Hively decoder controls.
- Live inputs (outside the two supported file-based delivery modes).
- Incremental/open render manifests that begin playback before a complete
  rendition is available.
- Video delivery rather than audio-only video soundtrack rendering.
- A dedicated remote-administration UI.
- Sophisticated automatic CPU-versus-bandwidth delivery heuristics.
- Multi-operator or multi-tenant hosting beyond the existing bounded room
  model.
