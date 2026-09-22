# izci Multiplayer application protocol (Phase 0)

Normative, language-neutral wire specification for the izci Multiplayer
data-channel protocol. This document is sufficient to implement an independent
host without reading browser service internals. Implementation shapes live in
code (`src/lib/services/multiplayer-protocol.ts`,
`src/lib/services/multiplayer-utils.ts`, `izci-server/internal/protocol/`);
representative fixtures live under `tests/multiplayer-protocol/` and are
consumed by both TypeScript and Go. The signaling socket protocol is specified
separately and keeps its own version.

Status: Phase 0 baseline. Protocol major `1`, minor `0`.

## 1. Transports and channels

WebRTC peer connection with one audio transceiver (host `sendonly`, client
`recvonly`, Opus preferred, stereo enabled) and three data channels created by
the offerer (client/guest). The answerer (host) attaches by label.

| Label | `ordered` | Reliability | Use |
|---|---|---|---|
| `izci-control` | `true` | reliable | JSON control messages, chunked when large |
| `izci-media` | `true` | reliable | source-file transfer: JSON `file.begin` / raw bytes / JSON `file.end` |
| `izci-render` | `false` | reliable | buffered-Opus binary fragments (unordered) |

`ordered:false` with no `maxRetransmits`/`maxPacketLifeTime` means reliable
unordered delivery. All channels use `binaryType='arraybuffer'` on the media
and render channels; control frames are UTF-8 strings.

Backpressure (normative expectations):

- Control: send while `bufferedAmount < 512_000`; otherwise queue locally and
  retry after ~20 ms. `onbufferedamountlow` is not required on control.
- Media (`izci-media`): queue limit `1 MiB` (`SOURCE_FILE_QUEUE_LIMIT`);
  sender waits ~10 ms when over limit. Flush while `bufferedAmount < 512_000`.
  `bufferedAmountLowThreshold = 256 KiB` drives `onbufferedamountlow` → flush.
- Render (`izci-render`): high-water `512 KiB` (`RENDER_QUEUE_HIGH_WATER`);
  sender stops planning new clusters when over water. Flush while
  `bufferedAmount < 512 KiB`. `bufferedAmountLowThreshold = 128 KiB` drives
  drain → flush → re-plan.

Chunking on `izci-control`: JSON payloads longer than `12_000` characters are
split into `{kind:'chunk', transferId, index, total, payload}` frames with
`total <= 10_000`, `0 <= index < total`. Receivers reassemble per `transferId`;
duplicates are coalesced; completion decodes as one JSON message and is then
validated as below.

## 2. Protocol identity, capabilities, implementation

Every `hello` carries both protocol identity and implementation identity.

```ts
hello = {
  kind: 'hello',
  protocolMajor: 1,
  protocolMinor: 0,        // any non-negative integer; minor skew admits
  capabilities: string[],  // e.g. ['source-file','buffered-opus',...]
  impl: { product: string, productVersion: string, build?: string },
  // host adds: name, identity?, pairNonce?
  // client adds: name, platform, freeplayEnabled, identity?
}
```

- `protocolMajor`: exact equality required. Different major is incompatible.
- `protocolMinor`: additive only. A minor mismatch alone is not an admission
  failure. Receivers must not reject a higher or lower minor when the major
  matches.
- `capabilities`: independently meaningful facilities. Canonical names:
  `source-file`, `buffered-opus`, `synchronized-start`, `pairing-proof`,
  `freeplay`, `chat`. Absence means unavailable. Unknown optional capabilities
  and unknown JSON fields are ignored.
- `impl`: product identity separate from protocol identity. Browser izci sends
  `{product:'izci', productVersion:<package version>}`. A dedicated server
  sends e.g. `{product:'izci-server', productVersion:'0.3.2'}` and clients
  render `izci dedicated server 0.3.2` instead of `izci 0.3.2`. `build` is an
  optional free-form build string (≤128 chars, no C0/DEL).
- Baseline for admission is currently empty
  (`MULTIPLAYER_REQUIRED_BASELINE_CAPABILITIES = []`): any same-major hello
  admits at the signaling layer; per-facility availability is decided by
  `capabilities`. Future baselines add names here without a major bump.

Signaling admission (both transports) compares major + baseline, not an exact
integer:

- Firebase RTDB: room `meta` and host `directory` carry `protocolMajor` (must
  be `1`) and `protocolMinor` (any number). Clients check
  `isCompatibleHelloIdentity({protocolMajor, capabilities: []})` before RTC.
  Rules enforce `protocolMajor === 1`.
- Server HTTP: `GET /v1/info` returns `{signalingVersion:1,
  appProtocolMajor:1, appProtocolMinor:0, appCapabilities:[...]}`.
  `POST /v1/join` requires `{appProtocolMajor:1, appProtocolMinor?:n,
  appCapabilities?:[...]}` and returns `unsupported-version` on major
  mismatch. Minor skew admits. Unknown capabilities ignored. Signaling socket
  `version:1` stays separately versioned.

Legacy integer `version:29` / `appVersion` hellos predate the split and are
incompatible (surfaced as “incompatible protocol”, not silently dropped).

## 3. Unknown-message and command policy

- Unknown optional message kinds are ignored safely (log at debug, no state
  change, no disconnect).
- A frame with `critical:true` and an unknown `kind` declares it must not be
  skipped silently. Senders must only emit such frames after negotiating the
  corresponding capability. Receivers log and drop them; they must not fail
  the connection on decoder failure alone. No current baseline message uses
  `critical:true`; future critical facilities must document their
  `requiresCapability` here.
- `command` envelopes are always acknowledged. A well-formed envelope with an
  unknown/unsupported `type` receives `{kind:'ack', commandId, accepted:false,
  message:'Unsupported command.'}`. Malformed envelopes (missing `commandId`)
  are dropped. This replaces the pre-Phase-0 silent drop.

Validators ignore unknown JSON fields (forward compatibility) but reject
malformed bounds (see §5).

## 4. Control messages

All control messages are JSON over `izci-control`. `H→C` = host to client,
`C→H` = client to host. Bounds in §5 apply.

### 4.1 Hello and admission

- `H→C hello {protocolMajor, protocolMinor, capabilities, impl, name,
  identity?, pairNonce?}`. `identity`/`pairNonce` are server extras
  (`[A-Za-z0-9_-]{8,128}`); absent on the legacy path.
- `C→H hello {protocolMajor, protocolMinor, capabilities, impl, name,
  platform, freeplayEnabled, identity?}`.
- Either side rejects major mismatch. Minor and unknown caps are accepted.
- Client stores `{hostImplementation: impl, hostProtocol: {major, minor,
  capabilities}}` and renders via `formatHostImplementation`.

### 4.2 Catalog, state, playback

- `H→C catalog {catalog:{revision:number, queue:TrackItem[],
  library:TrackItem[], favorites:TrackItem[], shuffleEnabled:bool,
  repeatMode:'off'|'one'|'all'}}`.
- `H→C state {shuffleEnabled, repeatMode}`.
- `H→C playback {playback:{generationId:1..80, snapshot:PlaybackSnapshot,
  track:TrackItem|null, sentAt:number}}`.
- `H→C playback.prepare {preparation:{generationId, trackId:1..200,
  delivery:'source-file'|'stream'|'render'|'none'}}`.
- `C→H playback.ready {generationId}`.
- `C→H playback.ended {generationId, trackId}`.
- `H→C playback.cancel {generationId}`.
- `H→C delivery {delivery:{generationId, trackId:null|1..200,
  mode:'none'|'stream'|'source-file'|'render',
  reason:'host-disabled'|'no-track'|null}}` with invariant
  `mode==='none' ⟺ reason!==null`.
- `H→C buffer {bufferMs:0..30000}` (host-authoritative listener buffer).
- `C→H source.retry {generationId}` (≤2 retries per generation).

`TrackItem = {id, name, extension, kind:'stream'|'module'|'video'|'image',
size, lastModified, path?, metadata?, rating?, subsong?}`. Unknown extensions
are accepted when `kind` is valid; unknown `kind` is rejected.

### 4.3 Synchronized starts and clock

- `H→C clock.ping {generationId, hostSentAt:finite}`.
- `C→H clock.pong {generationId, hostSentAt, clientReceivedAt, clientSentAt}`.
  Host estimates offset `(clientReceived-hostSent + clientSent-hostRecv)/2`.
- `H→C playback.start {start:{generationId, trackId, positionSeconds:finite≥0,
  startAt:finite}}`. `startAt` is host-clock ms plus per-peer offset and the
  configured lead (`250..3000 ms`, default `1000`).
- Ordering: `delivery → playback → artwork → source`, then `prepare + ping`,
  collect `ready + pong`, then `start`. `playback.cancel` aborts a pending
  barrier. Generations are opaque strings; stale generations are ignored.

### 4.4 Buffered Opus (`buffered-opus` capability)

- `H→C render.manifest {manifest:{generationId, renderId:1..80,
  trackId:1..200, sourceRevision:1..120, codec:'opus', container:'webm',
  durationMs:finite≥0, bitrateKbps:finite>0, clusterDurationMs:finite>0,
  clusters:[{index, timeMs, sizeBytes}] (index must equal position,
  timeMs non-decreasing, size 1..16 MiB), initSizeBytes:safeint≥0,
  totalBytes:safeint, total===init+Σclusters, total≤8 GiB,
  clusters≤200_000}}`.
- `C→H render.need {need:{generationId, renderId, epoch:int≥0,
  targetTimeMs:finite≥0, aheadMs:finite≥0, ranges:[[start,end]]≤100_000,
  start≥0, end≥start}}`.
- `C→H render.ready {generationId, renderId, epoch:int≥0,
  positionMs:finite≥0}` (deduped per generation+epoch).
- Binary fragments over `izci-render` (see §6). `epoch` increments on seek;
  mismatched in-flight fragments are dropped. Receivers report held ranges;
  senders plan only the ahead window plus protection.

### 4.5 Source-file transfer (`source-file` capability)

String frames over `izci-media` plus raw bytes between them:

- `file.begin {transferId, trackId, generationId:1..80, name, type,
  size:safeint≥0, lastModified:finite}`.
- Zero or more raw `ArrayBuffer` chunks (`16 KiB` sender slices, no framing).
- `file.end {transferId}`.
- Receivers validate byte count against `size`; mismatch → `source.retry`;
  overshoot → retry. Replacement during transfer cancels the stale generation;
  never append to ambiguous bytes. A reconnect joining an otherwise-current
  shared generation receives a fresh `transferId` and the complete file from
  byte zero; it never resumes or appends to the interrupted transfer.

### 4.6 Commands and acks

`C→H command {command}` with `commandId:1..80`:

- `transport.toggle|play|pause|stop|previous|next`
- `queue.shuffle`, `queue.repeat`
- `transport.seek {seconds:0..604800}`
- `collection.activate {collection:'queue'|'library'|'favorites',
  itemId:1..200}`
- `queue.play-next {collection, itemIds:1..50000 each 1..200}`

`H→C ack {commandId, accepted:bool, message?}`. Unsupported types nack with
`accepted:false`. Permissions are host-side and separate from
navigation/state mutation; Freeplay commands target only the caller's session.

### 4.7 Pairing (`pairing-proof` capability)

- `H→C pair.secret {hostIdentity:[A-Za-z0-9_-]{8,128}, secret:hex64}` over the
  authorized channel after the host pairs.
- `C→H pair.proof {clientIdentity, hostNonce, guestNonce (same pattern),
  proof:hex64}` where
  `proof=HMAC-SHA256('izci-pair-v1|room|host|client|hostNonce|guestNonce')`.
- `H→C pairing {paired:bool, freeplayActive:bool,
  hostId:[A-Za-z0-9_-]{1,128}, name:1..48}`.
- `H→C invitation {roomId:hex32, secret:1..512}` on rotation.
- Pairing grants app privileges after admission; it does not bypass
  invitations or grant server administration. Guests without a record stay
  silent and unpaired.

### 4.8 Freeplay (`freeplay` capability)

Active when host and client both opt in. Each Freeplay peer owns an
independent session (own queue, navigation, generation, delivery, preparation,
artwork); the room owns one permanent shared session. Messages:

- `C→H freeplay.preference {enabled:bool}`, `H→C pairing.freeplayActive`.
- `C→H freeplay.queue {itemIds≤50000 each 1..200, shuffleEnabled?,
  repeatMode?}`.
- Per-peer `catalog/state/playback/delivery/artwork/buffer/prepare` reuse the
  shared shapes but are routed to the caller's session only. `playback.ended`
  advances only that session. Never route Freeplay through the shared queue.

### 4.9 Chat (`chat` capability) and artwork

- `C→H chat.send {text:trim>0 ≤500, track?:{collection, itemId:1..200,
  title:1..500}, action?:'now-playing' (requires track)}`.
- `H→C chat.message {message:{id:1..80, name:1..48, text:1..500, sentAt:finite,
  action?:'me'|'join'|'leave'|'now-playing', track?}}`
  (`now-playing` requires `track`; no C0/DEL in name/text/title).
- `H→C chat.history {messages≤200}`, `H→C chat.clear`, `H→C chat.motd
  {motd≤500 no C0/DEL, hostName:1..48}`.
- `H→C artwork {artwork:{trackId:1..200, assetId:hex64,
  dataUrl:data:image/*;base64 ≤8 MiB, mimeType:image/*, width/height:1..4096}
  |null}`.
- `H→C oda.background {background:{dataUrl:data:image/* ≤8 MiB,
  opacity:int 0..100}|null}`, `oda.background.opacity {opacity:int 0..100}`,
  `C→H oda.background.preference {enabled}`.
- `H→C kicked` (no fields).

## 5. Bounds, timeouts, limits (normative)

Queue `50_000` items; chat `200` msgs / `500` text / `500` MOTD; render
`200_000` clusters / `8 GiB` total / `100_000` need ranges; artwork dataURL
`8 MiB`; chunk `total≤10_000`; commandId/generationId/renderId `1..80`;
trackId/itemId `1..200`; sourceRevision `1..120`; names `1..48`, platform
`≤32`; buffer `0..30000 ms`; seek `0..604800 s`; ODA opacity int `0..100`.

Transport timeouts: ICE `15_000 ms`; Firebase step `8_000 ms`; reconnect
`[2000,5000,10000,20000,30000]` with explicit `1000/2000/4000/15000` cases;
kick dispose `80 ms`; host-full reap `5 s`; receiver clamp `0..4000 ms`;
render monitor `500 ms`, stall `2500 ms`; server backoff
`[500,1000,2000,5000,10000]+rand500`, socket ready `8000 ms`, reconnect
`90 s` host / `45 s` guest. Server limits: rooms `4`, peers/room `8`,
pending/room `8`, sockets `128`, JSON `64 KiB`, SDP `50 KiB`, candidate
`4 KiB`, candidates/side `128`, queue `64 msgs/256 KiB`, heartbeat `20/10 s`.

## 6. Binary framing

### 6.1 Render fragments (`izci-render`)

```
[0]=0x52 ('R'), [1..4]=epoch u32 BE, [5..8]=clusterIndex u32 BE,
[9..12]=fragmentOffset u32 BE, [13..16]=fragmentLength u32 BE,
[17..18]=renderIdLen u16 BE, [19..]=renderId UTF-8 + payload
RENDER_INIT_CLUSTER_INDEX=0xffffffff (init segment, epoch 0)
RENDER_FRAGMENT_SIZE=16 KiB
```

Decode rejects bad marker, `renderId` empty/`>80`, or
`fragmentLength != bytes-headerEnd`. Init + clusters reassemble WebM:
init = EBML + Segment pre-cluster children; clusters carry timecodes
(~1 s clusters, stereo 48 kHz Opus in WebM, video discarded).

### 6.2 Source bytes (`izci-media`)

No per-chunk header; raw bytes between `file.begin`/`file.end` are file
content. Senders slice `16 KiB`; receivers append until `file.end` then
verify `size`.

## 7. Conformance

`tests/multiplayer-protocol/` holds canonical valid/invalid JSON, binary
render frames (`.bin`), and stateful transcripts. Both stacks must accept all
`valid-*`, reject all `invalid-*`, decode all valid `.bin`, reject invalid
`.bin`, and validate transcript ordering/generation ownership (ready matches
preparation, need matches manifest, ends match starts, Freeplay generations
never touch the shared timeline). Compatibility matrix: same-major minor skew
both directions admits; unknown caps admit; unsupported commands nack;
major mismatch rejects.
