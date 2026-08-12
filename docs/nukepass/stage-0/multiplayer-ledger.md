# Multiplayer checkpoint ledger

Protocol 18 is the frozen desired checkpoint. The host owns its catalog and
hosted playback. Joined clients are projections plus commands. Every Freeplay
pair must own independent delivery-specific authority and resources: a
host-clocked timeline for buffered render, a host renderer/RTP audio wire for a
video source, and a client-native timeline for source-file delivery. None may
mutate the host Playlist or shared player controller.

Firebase provides anonymous-authenticated, short-lived room/directory/pairing/
TURN signaling only. Peer channels carry application state and media. TURN
credentials use ECDH P-256/AES-GCM exchange and expiring coturn HMAC usernames;
secrets may not enter logs/diagnostics/recents.

## Wire and delivery

- Control JSON includes hello/pairing/catalog/state/playback/preparation/start/
  cancel/clock/delivery/buffer/render/artwork/ack/kick plus client transport,
  Freeplay, readiness, retry and range commands.
- JSON chunks are 12,000 characters. Binary render frames contain marker,
  epoch, cluster index, offset/length and render ID; fragments are 16 KiB.
- Delivery identity is distinct across generation, render ID, seek epoch,
  source-transfer ID and Freeplay load/mode tokens.
- Source file uses the ordered media channel and client-native backend. Buffered
  Opus uses reliable unordered render delivery and client MSE. Video-source
  audio is the only live RTP path; no video track is currently negotiated.
- File threshold semantics are strict: 0 renders all, -1 transfers all, positive
  finite values transfer only strictly smaller files; exact-threshold renders.

Older `multiplayer-buffered-opus-mvp.md` descriptions of “at or under,” no
persistent render cache, old suite counts, and private CDP rigs are historical
drift. They do not override this checkpoint.

## Authority, cache, and peer resources

| Surface | Current facts | Required invariant |
| --- | --- | --- |
| Hosted authority | App applies hosted commands to local owners and broadcasts sanitized projections | Client never writes host persistence directly |
| Freeplay authority | One player/queue/delivery state per peer; source delivery is client-native, rendered delivery host-clocked | No shared host collection/player mutation |
| Peer | One RTCPeerConnection; ordered control/media and unordered reliable render channels; ICE/timers/queues/senders/readiness | Removing peer disposes every child resource |
| Host render memory | Configurable 0/64/128/256/512 MiB compressed LRU; consumer pins | Bounded/inspectable; active pins cannot be evicted |
| Client memory | Fixed 64 MiB compressed LRU | Bounded and generation-correct |
| Client disk | `izci-render-cache`; enabled by default, 256–4096 MiB, default 1024 | Rebuildable, separate, quota-observable |
| Render identity | Private host key uses `path ?? name` plus renderer version, size, mtime, subsong, bitrate, 48-kHz stereo; wire `sourceRevision` omits local path and includes renderer version, size, mtime and subsong; higher-bitrate complete substitution exists | No stale/wrong-setting reuse or path leakage |

Experimental settings and their ranges are recorded in the Goldilocks ledger.
Separate lightweight state covers Receive Audio, last session, pairings, five
recents, and one last-host Freeplay resume record. The latter contains a host ID
but joining another host overwrites it; this does not yet satisfy the desired
persisted per-pair model.

## Current strengths to preserve

- Strict threshold, immutable delivery generation, A-to-B-to-C stale readiness,
  render identity/epoch readiness, send-failure reconnect, source replacement,
  Freeplay navigation/timelines/pairing/resume, and listener-owned audio routing
  have focused tests.
- Firebase rules isolate host writes and peer-owned candidates/signals and match
  protocol 18. The non-writing version check exists.

## Unresolved defects

1. Host/client/session state is mutable closure choreography, not an explicit
   queued actor/transition model.
2. Protocol pending chunk assemblies have no count/expiry bound; transfer IDs,
   binary payload length, catalog/metadata/hello/ack/playback fields lack complete
   structural and range limits.
3. Control queues and some source-file sizes are unbounded; Every File can retain
   arbitrarily large bytes in client memory.
4. Firebase version literals synchronize mechanically, but structural rule facts
   remain duplicated; candidate collections have no count bound.
5. Session-global render cancellation allows abandoned work to occupy the single
   worker. A manifest cluster may be 16 MiB and `queueRenderFragments()` enqueues
   all framed fragments before returning, so queued bytes exceed 16 MiB with
   headers despite the nominal 512-KiB high-water.
6. Pins make the memory cap soft across up to eight independent Freeplay renders.
7. Receiver stats omit data-only source/render transport when no inbound audio
   RTP exists.
8. Cache/quota failures are swallowed; teardown diagnostics are scattered logs.
9. Render unpin depends on asynchronous data-channel `onclose`, not explicit peer
   disposal ownership.
10. Host stop retains coordinator worker/cache until app destruction; whether
    intentional reuse outweighs idle ownership is unresolved.
11. There is no checked-in actor simulation, protocol fuzz/property suite,
    cache-quota integration suite, or multi-profile browser harness.
12. Fragment completion sums fragment lengths instead of verifying non-overlap;
    overlapping fragments can meet the declared size while leaving zero-filled
    holes. Replacing a duplicate complete cluster also increments received-byte
    diagnostics again.
13. Current Freeplay resume persistence retains only one last host/pair rather
    than an independent record for every pair.

Stage 1 freezes orchestration behavior and builds the verification spine. Stage
5 owns the incompatible protocol/actor/resource reconstruction; no adapter for
protocol 18 survives that accepted cutover.
