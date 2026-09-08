# Multiplayer sidekick implementation plan

Status: implementation specification. Deliver in phases; retain RTDB until the replacement passes daily laptop/phone use.

## 1. Outcome

Official izci keeps Multiplayer available, opt-in, with an empty server configuration. A host operates a small sidekick; friends open an invitation in official izci and join without entering server or relay settings. Operators may also serve their own izci beside the sidekick.

The sidekick supplies authenticated room creation, guest admission, and temporary WebRTC signaling. Host izci owns party presentation, catalog, membership, playback, and Freeplay. Audio and application traffic continue over existing WebRTC paths.

The intended deployment serves a handful of friends. Each server is independent, with invitation-based discovery. Host authentication remains private to the operator. Official builds contain the client implementation and a GitHub setup-guide link.

Delivery preserves the working RTDB route during development and a short period of real use. Transport selection is explicit throughout overlap. Sidekick failure stays a sidekick failure; switching back to RTDB is a user action.

## 2. Technology decisions

### Scope: replace rendezvous, reuse Multiplayer

This is a signaling-service replacement plus its setup UI. The integration endpoint is the existing established peer: once connected, current Multiplayer takes over.

The implementation budget covers the Go sidekick, Firebase-dependent signaling/identity/pairing state, invitation and server setup, and deployment retirement. Preserve existing peer/channel creation and session orchestration, extracting only the seams that currently call Firebase. A small injected candidate sender and transport cleanup handle are preferable to rebuilding the session controller.

Existing source transfer, buffered Opus, video transport, rendering, cache implementations, synchronization, Freeplay timelines, playback backends, and DSP stay with their existing implementations. Test their use through the new connection with representative playback; they are not implementation work packages. A discovered playback bug is separate work unless the signaling change caused it.

The detailed protocol and file proposals below guide the new sidekick. For existing client code, reuse comes first: extend current helpers and hello/pairing messages where practical. Additional files are justified by ownership, not by matching the proposed tree exactly.

### Sidekick

Use **Go**, a standalone module under `sidekick/`, targeting Go 1.27 with the current patch release pinned in CI/container builds at implementation time.

- Standard library: `net/http`, `encoding/json`, `crypto/rand`, `crypto/sha256`, `crypto/hmac`, `crypto/subtle`, `log/slog`, `context`, `sync`, and `testing/httptest`.
- WebSocket transport: `github.com/coder/websocket`, pinned in `go.mod`/`go.sum`.
- JSON configuration decoded with strict validation; environment overrides for deployment essentials and secret-file paths.
- In-memory registries protected by focused mutexes. Socket writes occur outside registry locks.
- One reader and bounded writer queue per socket; cancellation owns their lifetime.
- A static Linux binary with CGO disabled, shipped for amd64 and arm64. A container image packages the same executable.
- Caddy supplies public TLS and optional same-origin static izci hosting in the reference deployment.
- Persistent operator configuration consists of config and secret files. Runtime rooms, sessions, tickets, and signaling are memory-resident.

This keeps the initial operational footprint to one sidekick process plus the operator's TLS proxy. Deployment can use either a container or a systemd service.

References for implementation: [Go 1.27](https://go.dev/doc/go1.27), [coder/websocket API](https://pkg.go.dev/github.com/coder/websocket), and [library source/examples](https://github.com/coder/websocket). Verify and pin dependency patches when scaffolding.

### Browser

Retain Svelte/TypeScript, existing synchronized settings helpers, and the current Multiplayer media/control protocol. Add a dedicated sidekick signaling protocol with its own version. A signaling protocol change and a media protocol change are separate compatibility decisions.

Use explicit bearer sessions in memory for host administration in both same-origin and cross-origin deployments. This provides one initial authentication flow and works without third-party cookies. A page reload requires host login again; remembering guest invitations and pairings is separate. Cookie-based host login can be considered later if daily use warrants the additional flow.

## 3. Repository scaffold and ownership

Create the following structure in the initial scaffold. Each directory gets implementation and focused tests as its phase lands.

```text
sidekick/
  go.mod
  go.sum
  cmd/izci-sidekick/
    main.go
  internal/
    config/          configuration, defaults, validation, secret loading
    protocol/        envelope/payload types, strict decoding, error codes
    auth/            host keys, sessions, capabilities, socket tickets
    rooms/           room ownership, reservations, expiry, host leases
    signaling/       connection attempts, message routing, socket lifecycle
    ice/             configured STUN and temporary TURN credentials
    httpapi/         routes, request limits, origins, headers, health
    observability/   redacted structured events and aggregate counters
  testdata/          config examples and server-specific fixtures
  integration/       HTTP/WebSocket tests exercising the real router
  deploy/
    Dockerfile
    compose.yaml
    Caddyfile
    izci-sidekick.service
    config.example.json
  README.md
  PROTOCOL.md
  PRIVACY.md
tests/
  multiplayer-sidekick-contract/  shared valid/invalid JSON fixtures
src/lib/services/
  multiplayer-sidekick-protocol.ts
  multiplayer-sidekick-http.ts
  multiplayer-sidekick-socket.ts
  multiplayer-sidekick-host.ts
  multiplayer-sidekick-client.ts
  multiplayer-sidekick-endpoint.ts
  multiplayer-setup-controller.ts
src/lib/stores/
  multiplayer-server-settings.ts
  multiplayer-sidekick-recents.ts
  multiplayer-sidekick-pairings.ts
```

Use existing Multiplayer component/Options owners for entry actions, with focused dialog components for setup, server entry, and invite confirmation. Adjust filenames to match the actual component tree when implementing; the ownership boundaries above are the contract.

The root package scripts can expose `sidekick:test`, `sidekick:build`, and `multiplayer:contract:check`. Go remains an independent module; the frontend build should remain usable without a Go compiler.

### Existing seams requiring deliberate changes

| Existing owner | Work |
| --- | --- |
| `multiplayer-signaling.ts` | Isolate Firebase initialization and legacy invitation/credential exchange; sidekick uses its own client |
| `multiplayer-types.ts` | Separate Firebase reference types from shared peers/session state |
| `multiplayer-peer.ts` | Replace Firebase-writing ICE callbacks with an injected candidate sender; retain peer/media setup |
| `multiplayer-host-session.ts` | Separate room acquisition, peer admission, pairing lookup, and backend-independent peer creation |
| `multiplayer-client-connect.ts` | Separate invitation resolution/auth/signaling from RTC connection and channel attachment |
| `multiplayer-session.ts` | Delegate transport cleanup through one owned session handle |
| `multiplayer-window-controller.ts` | Route all manual/deep-link/restore/auto-host paths through setup and server authorization |
| `multiplayer-host-channels.ts` and client channels | Carry identity, party metadata, and pairing exchange after RTC connects |
| Existing pairings/recents/last-session stores | Keep RTDB records isolated during overlap; add explicit sidekick records |
| `multiplayer-ice.ts` and TURN helpers | Accept resolved operator ICE settings; move sidekick TURN signing to Go |
| `package.json`, `firebase.json`, protocol sync script | Separate hosting deployment from RTDB/Auth deployment before retirement |

Treat media rendering, buffering, source transfer, audio routing, and Freeplay renderers as consumers of an established peer. Their behavior should not depend on the choice of signaling service.

## 4. Configuration and operating defaults

Expose named settings in config with documented units and bounds. The values below are initial defaults to encode in tests; change them only with a recorded reason.

| Setting | Initial value / behavior |
| --- | --- |
| Listen address | `127.0.0.1:8787`; container example explicitly selects `0.0.0.0:8787` |
| Public base URL | Required HTTPS URL, including optional deployment prefix |
| Allowed browser origins | Exact configured origins; example includes official izci and the operator's frontend |
| Trusted proxy networks | Empty; reference deployment supplies its actual proxy network |
| Host key file | Required, generated high-entropy operator credential |
| Maximum rooms | 4 |
| Maximum active peers per room | 8, with host UI allowed to choose a lower limit |
| Pending attempts per room | 8 |
| Global open WebSockets | 128 |
| Host session lifetime | 12 hours |
| Socket ticket lifetime | 30 seconds, consumed once |
| Unauthenticated socket lifetime | 5 seconds |
| Signaling attempt deadline | 45 seconds |
| Host socket reconnect grace | 90 seconds |
| Room lease | 24 hours, renewable by its authenticated host |
| JSON/WebSocket message limit | 64 KiB |
| SDP payload limit | 50 KiB |
| ICE candidate limit | 4 KiB each, 128 per side per attempt |
| Socket send queue | 64 messages and 256 KiB; enforce both |
| Heartbeat interval / response deadline | 20 seconds / 10 seconds |
| Cleanup interval | 5 seconds |
| Shutdown grace | 10 seconds |
| TURN credential lifetime | 10 minutes, refreshed for authorized active attempts when needed |
| Logs | Structured lifecycle/error codes; content and credentials excluded |

Initial rate limits: host login 5/minute/source with burst 5; join attempts 30/minute/source with burst 10; signaling 60 messages/second/socket with burst 120. Apply global caps as well. Rate-limit buckets expire and have a bounded total size, so rate limiting itself cannot grow memory indefinitely. Return retry information where useful.

Normalize source addresses through trusted proxy configuration only. Shared NATs should work for a small party. Make operator overrides possible within validated ranges.

Add `keygen`, `check-config`, `serve`, and `version` commands. Generate 32 random bytes for host credentials, print the secret only from the explicit key-generation command, and support reading it from a permission-restricted file. Startup logs list enabled capabilities and limits without dumping config.

## 5. Authentication and data model

### Host credentials and sessions

The initial server has one operator credential. It may authorize multiple rooms, but room ownership belongs to the authenticated host session that created or resumed each room.

Login submits the operator credential over HTTPS in a bounded JSON body. Verify fixed-length digests with constant-time comparison. Success returns a random session bearer token and expiry; the browser holds it in memory. Session lookup stores a digest of the token. Logout revokes that session and closes its owned rooms. Login errors use one generic failure code.

A separate random room-owner resume capability lets the owning browser reclaim its room after a fresh operator login. Store it locally only when the host chooses to remember the room. Resuming requires both host authentication and the room-owner capability. Guests possess neither.

Host session expiration disables further administration and room renewal; active peer media may continue while the UI requests login. Define this as signaling availability loss, not an automatic local playback stop.

### Room record

Each room holds:

- Random 128-bit room ID.
- Owning session ID and digest of room-owner resume capability.
- Digest of a random 256-bit guest invitation secret.
- Server-configured/host-lowered capacity.
- Sidekick protocol and supported app protocol identifier.
- Creation time, lease deadline, host socket generation, and reconnect deadline.
- Bounded active connection reservations and pending attempts.

Keep party title and nicknames in the host browser. Runtime reservation records contain opaque IDs and routing state. Capacity counters describe admitted transport slots, not a public listener list.

On server restart all runtime rooms disappear. An authenticated remembered host can recreate its saved room ID and guest invitation using its local record. Creation must reject collisions atomically. Existing rooms require their resume capability; a second host tab cannot overwrite them. After a complete server reset the operator credential is the authority for recreation. Document this trust boundary.

### Guest admission

An invitation is a bearer capability for one room, reusable by the intended small group until rotated, expired with the room, or closed. It is not a one-use socket ticket.

A guest submits room ID, invitation secret, client-generated attempt nonce, and app protocol version. Validate these, verify a live host, reserve capacity atomically, and return a connection token plus socket ticket. Invalid and absent rooms return the same public `room-unavailable` result; a valid invitation may receive a useful `room-full` error.

The connection token authorizes only that reserved connection, including a short reconnect grace. It cannot create rooms, rotate invitations, address another peer, or acquire operator sessions.

Rotation invalidates the previous invitation for new admissions. Closing the room removes all signaling authority. Kicking a connected guest also requires the host browser to close that peer's RTC connection; the sidekick cannot terminate a direct channel by deleting a record.

## 6. HTTP and WebSocket contract

Use `/v1/` beneath the configured base path. All API responses carrying configuration, sessions, or capabilities use `Cache-Control: no-store`. HTTP errors carry a stable code and optional retry delay; UI text is localized in izci.

| Route | Authorization | Purpose |
| --- | --- | --- |
| `GET /healthz` | Public | Process liveness only |
| `GET /v1/info` | Public, after browser contact authorization | Protocol versions, operator notice/contact, declared ICE providers and limits |
| `POST /v1/host/sessions` | Operator credential in body | Issue host session |
| `DELETE /v1/host/session` | Host bearer | Logout/revoke |
| `POST /v1/rooms` | Host bearer | Create room and return owner/invite capabilities |
| `POST /v1/rooms/{room}/resume` | Host bearer + owner capability | Reattach/recreate remembered host room under specified rules |
| `POST /v1/rooms/{room}/renew` | Owning host bearer | Extend lease within server policy |
| `POST /v1/rooms/{room}/rotate` | Owning host bearer | Replace guest invitation |
| `DELETE /v1/rooms/{room}` | Owning host bearer | Close room |
| `POST /v1/join` | Room invitation in body | Reserve guest connection |
| `POST /v1/socket-tickets` | Host or connection bearer | Issue one-use scoped socket ticket |
| `POST /v1/ice` | Owning host/active connection bearer | Issue scoped ICE configuration/temporary TURN credentials |
| `GET /v1/socket` | First WebSocket frame supplies ticket | Attach host or guest signaling socket |

The route set is the initial contract. Phase 0 should settle payload field names and fixtures before parallel implementation.

Browser WebSockets cannot set an arbitrary Authorization header. Upgrade the socket after origin/global-limit checks, then require an `authenticate` first frame within five seconds. Atomically consume the socket ticket there. Tickets and long-lived credentials remain outside URLs and subprotocol strings.

### Envelope and messages

Use an envelope with `version`, `type`, `requestId`, optional `attemptId`, and a type-specific `payload`. Each decoder checks the entire payload, unknown fields, lengths, finite integer values, and permitted role/state. IDs are bounded base64url strings; errors never echo submitted payloads.

Required messages:

| Message | Sender | Meaning |
| --- | --- | --- |
| `authenticate` | Either browser | Consume socket ticket |
| `ready` | Server | Confirm scope, socket generation, deadlines |
| `peer.requested` | Server to host | Announce opaque admitted connection |
| `peer.accept` / `peer.reject` | Host | Accept or release pending connection |
| `peer.accepted` | Server to guest | Begin RTC exchange |
| `signal.offer` | Guest | Initial SDP for this attempt |
| `signal.answer` | Host | Matching answer |
| `signal.candidate` | Either browser | Candidate with monotonically assigned per-side sequence |
| `signal.end` | Either browser | End-of-candidates marker |
| `peer.connected` | Either browser | Local RTC/control channel ready |
| `peer.release` | Host or owning guest | End reservation |
| `peer.closed` | Server | Attempt/reservation ended |
| `room.unavailable` | Server | Host grace/room lease ended |
| `error` | Server | Stable request-scoped error |

Bind room, sender role, connection, and socket generation to the authenticated server session. Route from that authority rather than trusting sender-supplied destinations.

The guest creates the initial offer, matching the existing client-to-host flow. Establish the host handler before asking the guest to offer. ICE candidates can arrive before remote SDP; the browser queues them with existing peer helpers. Duplicate sequence numbers are ignored, conflicting duplicates fail the attempt, and stale attempt IDs are dropped.

After both sides acknowledge connection, discard SDP/candidate exchange state. Keep a bounded opaque reservation while the room connection remains registered. Host signaling stays attached for new guests; guest signaling stays attached for liveness/reconnect and carries only control traffic.

An interrupted attempt is retried with a new attempt ID and fresh ICE exchange. Avoid a durable message-replay log. If socket signaling drops while RTC still works, preserve playback and display signaling reconnect status separately.

### Protocol errors

Define fixtures for `bad-request`, `unsupported-version`, `unauthorized`, `room-unavailable`, `room-full`, `rate-limited`, `attempt-expired`, `host-unavailable`, `ticket-expired`, `ticket-consumed`, and `server-shutting-down`.

Bound automatic retries. Authentication, unsupported versions, and revoked/expired invitations require user action. Transient network errors retry with jittered backoff while the session remains authorized.

## 7. Room and connection lifecycle

Room state: created → hosting → host reconnect grace → hosting or closed. Room lease expiry, logout, explicit closure, and process shutdown close the runtime room.

Connection state: reserved → awaiting host acceptance → negotiating → connected → reconnecting or released.

Implement each transition in the room/signaling packages with an injected clock and random source for deterministic tests. Return events to socket writers after releasing locks.

Rules worth testing as state transitions:

- Concurrent joins at the last available slot admit exactly one guest.
- A failed or timed-out negotiation releases its slot once.
- Reconnecting with a valid connection capability replaces its old socket atomically and retains its slot.
- Late close handlers from an old socket generation cannot release the replacement.
- Host reconnect grace pauses new admission; an existing direct RTC session can continue.
- After server restart, the browser distinguishes lost rendezvous state from lost media. The host recreates the room; guests re-register when authorized or rejoin when RTC actually needs rebuilding.
- Room renewal and cleanup races resolve under one ownership check.
- Shutdown stops admission, sends a short shutdown event where possible, cancels all pumps, waits within the grace period, then exits.

Application teardown owns AbortControllers, subscriptions, timers, socket handles, and RTC cleanup separately. Closing a join dialog cancels its pending attempt. Switching server cancels the old attempt before credentials or ICE configuration for the new one are used.

## 8. ICE and TURN

The sidekick advertises configured ICE provider URLs in `/v1/info`. The UI presents these before constructing RTCPeerConnection. Start the default config with an empty ICE list; the deployment guide explains how to select STUN and what connectivity to expect.

Optional TURN configuration accepts URLs, a secret-file path, and bounded credential lifetime. Implement the common coturn REST shared-secret credential scheme in Go and verify it against a coturn integration fixture. Temporary usernames use an expiry and opaque random scope; they contain no display names.

Only authenticated hosts and admitted guests can request credentials. Issuance is limited per connection and constrained to the configured relay. Return expiry with credentials, refresh before a new negotiation when necessary, and report direct versus relayed route using existing stats.

The sidekick handles signaling; coturn, when configured by the operator, carries relayed encrypted RTC traffic. Disclose these as separate services. Browser settings may choose a stricter relay policy where a relay exists. A requested relay-only connection with no configured relay gets an actionable error.

During RTDB overlap, keep legacy TURN exchange isolated. Sidekick sessions obtain TURN configuration solely from their selected sidekick.

## 9. Invitation, setup, and server UX

### Invitation format

Use the player URL with a versioned base64url JSON fragment, conceptually:

`https://izci.app/#party=<encoded invitation>`

Payload fields: `v`, canonical HTTPS sidekick base URL, room ID, invitation secret, and optional party-title hint. Set a 4 KiB total invitation limit and a short bounded title. The exact fragment name is frozen in Phase 0 and tested against existing RTDB formats.

Parsing is local and side-effect-free. An endpoint validator rejects embedded URL credentials, query/fragment components in the server base URL, unsupported schemes, malformed ports, and ambiguous paths. Normalize the prefix once and construct every API route from it. Use fetch with credentials omitted and redirects rejected for bearer/body-bearing requests.

The initial public flow requires HTTPS/WSS, including LAN deployments reached from production. Document local trusted TLS and browser local-network permission constraints. Invitation confirmation shows the complete authority and any meaningful path prefix. Endpoint text is rendered as text, and suspicious Unicode hosts also show their ASCII form.

A hostname cannot be reliably classified as safe solely by inspecting it. Browser endpoint checks and explicit user approval reduce accidental contact; deployment documentation must also explain DNS/local-network behavior. The sidekick itself never fetches guest-supplied URLs.

Consume the secret-bearing fragment after capturing it in transient controller state. Redact invitation data from logs, copied diagnostics, and errors. Persist it only through an explicit remember action.

### Entry flows

**Join link / pasted invitation**

1. Parse locally and show server plus optional unverified title hint.
2. Complete first-use setup if needed, retaining the pending invitation.
3. Join authorizes contact with that server.
4. Fetch server info and show declared ICE providers as part of connection setup; first contact may require a short Continue before ICE if new providers need acknowledgment.
5. Submit invitation, establish RTC, then receive authoritative party title and listener count through the peer channel.
6. Enter the normal connected UI.

Desired compact summary remains `party.example · Sea Shanties Only · 3 listeners · [Join]`. At the initial offline confirmation, title is a hint and the count is unknown. Live count/title require a connection. Implement that honest baseline first; a later preflight preview can use an explicitly authorized connection and a second admission action if the additional click proves worthwhile.

**Connect to server**

An “Enter server address” dialog leads to server contact/description, then room-invitation entry or host login. The server address alone provides connection configuration, not a public room list.

**Host a party**

Choose/enter server, authorize contact, log in, create or resume room, then copy an invite. Host labels and party title remain local. Same-origin deployments can suggest their endpoint through operator frontend configuration, but the first-use connection summary still appears.

### Settings and persistence

Add synchronized server settings for canonical endpoint, display label, notice version acknowledged, explicit automatic-reconnect permission, and locally selected relay preference. Keep host session tokens in memory.

Sidekick recents store endpoint, room ID, last host display name, last-used time, and optional remembered invitation. Give clear “Forget server,” “Forget invitation,” and “Clear received audio cache” actions with distinct effects.

Use a new sidekick-specific storage namespace during overlap so RTDB UIDs and sidekick room IDs cannot be confused. Last-session restore is a discriminated record with explicit transport. Service-owned restoration checks endpoint authorization before network calls.

Automatic hosting still works within an authenticated host session. Across browser restarts it stops at host login rather than storing the operator key silently. Treat that prompt as an intentional behavior change and test it in daily use before RTDB retirement.

Deep links always show their short summary, including remembered/same-origin servers. Automatic restoration is a separately authorized behavior and is visible/cancellable in connection status.

## 10. Pairing and Freeplay continuity

Replace Firebase UID identity with browser-local host and client identities. Use a per-pair random secret exchanged over the established RTC control channel when the host chooses Pair. Store the host's pair records and the client's pair secret locally. Verify possession on later peer connections with a fresh nonce and HMAC over a versioned context including room ID and both nonces.

The host keeps its peer labels and per-pair Freeplay preference. The client keeps the paired host label and matching secret. The server receives only normal invitation admission and opaque connection IDs.

Pairing and signaling admission remain distinct: a remembered guest invitation reaches the host; the peer-channel proof restores paired privileges and Freeplay. Pairing alone does not confer room creation.

A fresh connection begins with restricted application access until the existing hello/protocol checks and any pairing proof finish. An unpaired invited guest receives the room's normal guest permissions; a paired guest receives the host's stored permissions. Freeplay starts only after host-side authorization.

For stable daily reconnect, the host can remember room ID and invitation locally and recreate them after a sidekick restart following authentication. Clients keep remembered invitations by choice. If the host rotates the invitation, distribute the replacement over currently authorized paired channels and update local recents. Offline guests need the new invitation from the host.

Unpairing revokes paired privileges. Removing someone's ability to reuse a shared party invitation requires rotating that invitation; the UI should distinguish these actions. A host can kick an active peer independently.

This preserves local relationships without introducing a persistent sidekick directory. Cross-device host identity synchronization and seamless offline invitation redistribution are outside the initial release.

## 11. Security and privacy implementation work

Treat the server as operator infrastructure visible to participants. It sees network metadata and connection timing. SDP/ICE is processed transiently. Its operator can influence signaling, so the initial system trusts the selected sidekick; RTC encryption alone is not a promise of protection against a malicious signaling operator.

Specific work packages:

- Strict Go and TypeScript decoders sharing valid/invalid fixtures, with fuzz targets for Go decoding and endpoint/invite parsing.
- Role/room isolation and one-use ticket tests using real HTTP and WebSocket handlers.
- Origin allowlist checks before WebSocket upgrade, explicit CORS preflight responses, and browser credentials omitted for cross-origin API requests.
- Request/read/write timeouts, bounded queues, bounded rate-limit maps, and slow-reader cleanup.
- Configured trusted proxies and redacted structured logs.
- CSP/connect-src review for arbitrary user-selected HTTPS/WSS endpoints. Service-worker routing treats sidekick traffic as network-only and excludes API credentials/responses from caches.
- Review existing catalog serialization, especially TrackItem.path, and send only fields required by guest UI. Keep the host's canonical local path intact.
- Clear distinction between local media caches and sidekick retention, with working local deletion controls.
- Versioned setup and factual operator notice: provider, purpose, categories, retention, contact, optional relay, and peer address/content visibility.

Write an operator notice template with explicit fill-in fields and a factual PRIVACY document. Verify legal statements against current authoritative guidance when preparing publishable terms/KVKK text. Self-hosting changes who operates the service; it does not determine an operator's legal obligations by itself.

## 12. Phases and executable work packages

Each phase produces reviewable commits and an updated acceptance record. The coordinator owns shared contracts and integration. Delegate independent packages only after their inputs are fixed.

### Phase 0 — Freeze contracts and map current behavior

**Inputs:** this plan, current Multiplayer tests, RTDB rules, session/peer services, and deployment scripts.

**Tasks**

1. Trace host creation, guest join, candidate exchange, teardown, restore, pairing, Freeplay authorization, and TURN issuance from entry point to cleanup.
2. Record every Firebase-specific field and function in those flows. Classify each as temporary legacy transport state, shared session state, or local paired-host state.
3. Write sidekick/PROTOCOL.md with exact HTTP bodies, envelopes, errors, limits, state transitions, and compatibility rules.
4. Create shared contract fixtures: successful login/join/offer/answer/candidate plus each malformed/unauthorized boundary.
5. Freeze invitation format, socket ticket first-frame authentication, host bearer flow, and endpoint normalization.
6. Capture the RTDB baseline commands/test groups and existing known failures. Record the user's actual laptop/phone modes needed for cutover.
7. Separate proposed work into the ownership packages below; identify files requiring serial integration.

**Exit:** Go and browser agents can implement independently from the same fixtures, including complete cancellation/error flows. No production behavior changes are needed to reach this gate.

### Phase 1 — Build and package the Go scaffold

**Tasks**

1. Create go.mod, command entry point, package directories, version output, and reproducible build commands.
2. Implement strict config loading, defaults/bounds, secret-file handling, keygen, and check-config.
3. Construct the HTTP router with health/info endpoints, request limits, no-store headers, origin middleware, structured errors, and graceful shutdown.
4. Add the WebSocket dependency and a bounded authenticated-socket skeleton with first-frame timeout.
5. Add multi-stage Docker build, non-root runtime, example config, Caddy routing, and systemd unit.
6. Add CI for formatting, go vet, tests/race tests, and linux amd64/arm64 builds. Ensure tests use injected clocks and ephemeral httptest listeners.
7. Write the README quick start: generate key, validate config, start service, proxy TLS, check health.

**Tests:** invalid config, missing secret, accidental secret logging, prefixed base paths, forbidden origins, oversized requests, first-frame timeout, clean shutdown.

**Exit:** a fresh checkout produces a runnable single binary/container and a health/info response through the documented proxy layout.

### Phase 2 — Implement authentication, rooms, and signaling

**Tasks**

1. Implement host sessions, room-owner resume capabilities, guest invitation digest checks, connection tokens, and one-use socket tickets.
2. Implement room registry transitions and atomic capacity reservations with fake-clock expiry tests.
3. Wire the complete HTTP routes to those services.
4. Implement socket authentication, role binding, bounded read/write pumps, candidate sequencing, peer admission, offer/answer routing, and connected cleanup.
5. Add host/guest reconnection generations and stale-handler protection.
6. Add rate limits, bounded limiter eviction, slow-consumer termination, and aggregate diagnostics.
7. Exercise the real router using a Go test host and several Go test guests. Include cross-room and guest-hosting attacks.

**Tests:** ticket replay race, last-slot race, guessed room, wrong role, expired session, room owner collision, host disconnect grace, malformed/stale SDP/candidates, repeated release, cancellation leaks, server restart, and independent RTC-independent reservation states.

**Exit:** the server connects mock parties with enforceable authority and bounded resources. Shared fixtures pass against Go. No frontend media implementation is required yet.

### Phase 3 — Integrate the browser transport behind explicit selection

**Tasks**

1. Extract the small signaling session seam from Firebase-coupled peer/session code. Define candidate send, event subscription, attempt close, and transport dispose operations.
2. Keep the RTDB implementation in its existing focused modules, with Firebase-specific types moved out of the shared peer model.
3. Implement sidekick HTTP/socket clients with AbortSignal support, strict decoding, timeout/error mapping, and backoff.
4. Implement host room acquisition and guest admission, then attach existing RTC/channel creation.
5. Replace Firebase UID assumptions with attempt-local IDs for sidekick peers. Keep peer presentation pending until the RTC hello arrives.
6. Make teardown idempotent across canceled UI, room close, failed handshake, settings change, and window lifecycle.
7. Add explicit transport selection to the overlap UI and saved-session record. Existing RTDB invitations retain their current parser; new invitations select sidekick.
8. Add a cross-language integration harness: TypeScript client tests launch/use a Go sidekick on an ephemeral port and run the login/admission/signaling protocol. RTC itself can be mocked in this harness.

**Tests:** ordered and early candidates, connection cancellation during each await, stale socket callbacks, retry attempt isolation, server switch, network loss with live RTC, and no automatic provider fallback.

**Exit:** sidekick signaling produces working existing peers in the application; RTDB baseline remains green. Both contract suites use identical fixtures.

### Phase 4 — Complete invitations, setup, and settings

**Tasks**

1. Implement local invitation/endpoint parsing and secure fragment consumption.
2. Add first-use setup controller and short per-invitation confirmation.
3. Add Enter server address, server description, host login, create/resume room, copy invite, rotate invite, and forget actions.
4. Gate manual, invite, auto-host, and last-session restore entry points through the same service-owned authorization.
5. Add sidekick server settings/recents with existing normalization and cross-window synchronization conventions.
6. Keep credentials scoped to endpoint and session. Ensure untrusted invitation hints render safely.
7. Localize actual UI content in the project's maintained source catalogs.
8. Review mobile flow, modal cancellation, focus management, and error recovery; preserve the pending invite across setup.
9. Audit browser network policy and PWA caches for official-izci-to-sidekick use.

**Tests:** parse failures, endpoint prefix normalization, redirects, disabled/fresh network silence, same-origin confirmation, remembered authorization, changed provider disclosure, cross-window updates, and expired host login.

**Exit:** a guest opens a link in official izci, understands the destination, and joins without entering server or TURN configuration. A host can operate a room from the same production UI.

### Phase 5 — Replace Firebase-dependent pairing, reconnect, and TURN exchange

**Tasks**

1. Implement local pair-secret exchange and challenge/response in the application control protocol.
2. Feed verified paired identity into the existing paired/Freeplay permission fields and existing activation flow. This changes how pairing is established and stored; Freeplay navigation, renderers, scheduling, and playback retain their current implementation.
3. Implement remembered room recreation after sidekick restart, invitation rotation, paired online redistribution, and explicit offline re-invitation behavior.
4. Integrate operator-declared ICE and temporary TURN credentials with the existing ICE configuration/stats helpers.
5. Add coturn reference configuration as an optional deployment profile and test credential expiry/refresh.
6. Distinguish active media health, signaling availability, and host authorization status in session snapshots.
7. Tune reconnect/backoff through phone backgrounding and network changes while retaining bounded attempts.
8. Finish the signaling/privacy documentation against implemented behavior. Describe current local caches using existing controls. Record unrelated cache or catalog improvements separately; only address exposure introduced by this migration here.

**Tests:** paired proof replay/wrong peer/wrong room, unpairing, invite rotation, kicked guest, Freeplay privilege boundary, host login after reload, server restart with remembered room, TURN expiry, and relay-only failure.

**Exit:** the sidekick route covers daily laptop/phone needs, including remembered access and configured relays. Any intentional UX differences from RTDB are documented and acceptable before the overlap trial begins.

### Phase 6 — Release both and prove the replacement

**Tasks**

1. Release the overlap build and deploy the user's sidekick following the published recipe.
2. Keep RTDB selected for any session that needs it; sidekick trial sessions explicitly select the new route.
3. Record real-device scenarios in a small acceptance log: build, devices/network, mode, result, reproducible issue.
4. Run laptop→phone and phone→laptop where hosting is supported; repeat after backgrounding, screen lock, network transition, browser reopen, and sidekick restart.
5. Run a three-to-four-person party with the user's usual tracks and at least one remote network. Include one small source-transfer track and one buffered track to confirm the existing channels attach correctly.
6. Test direct ICE and an operator-provided TURN route where available.
7. Fix failures in their owning phase/package and rerun the affected scenarios.
8. Confirm both daily devices use an updated PWA before retirement.

**Exit:** the migration acceptance matrix below passes and RTDB is no longer necessary for normal use. The playback smoke check confirms the established connection reaches existing Multiplayer successfully; a full format/device certification campaign is unnecessary. Roughly one week is a useful trial duration; readiness determines the cutover.

### Phase 7 — Retire RTDB and simplify the code

**Tasks**

1. Publish useful retired-invitation failure text in the overlap build before shutting down service access.
2. Inspect the exact Firebase project's Multiplayer paths and anonymous-account usage. Prepare scoped shutdown/deletion targets.
3. Split hosting deployment scripts so routine hosting deployment cannot re-enable Auth/RTDB. Current `hosting:deploy` deploys all three; remove that coupling.
4. Disable Multiplayer database access and legacy anonymous sign-up where shared project usage permits.
5. Remove Firebase transport imports/config/dependencies, legacy route selection, RTDB tests/scripts, and rule generation that no longer has consumers.
6. Keep Firebase Hosting deployment support where still used; audit firebase-tools separately from the browser Firebase SDK.
7. Remove obsolete local RTDB settings/session records by exact owned key; retain queue/library and sidekick state.
8. Delete scoped RTDB room/directory/pairing data and attributable anonymous accounts through provider controls. Record provider retention limitations.
9. Verify older installed builds cannot recreate RTDB signaling state, and old invite input produces an understandable error in the new build.
10. Update the durable architecture guide and sidekick docs to describe the final single transport.

**Exit:** production Multiplayer uses user-selected sidekicks; RTDB/Auth no longer serve Multiplayer; deployment scripts cannot restore the retired service accidentally.

## 13. Subagent execution map

The coordinator owns Phase 0, contract changes, shared-state edits, and phase acceptance. Agents receive bounded packages with explicit file ownership, fixture versions, and required validation.

| Package | Primary ownership | Can run alongside | Handoff |
| --- | --- | --- | --- |
| Contract/scaffold | sidekick protocol docs, fixtures, Go module/config/CLI | Existing-flow inventory | Frozen payloads, defaults, commands |
| Go auth/rooms | internal/auth and internal/rooms | Browser HTTP/parser implementation | Transition tests and service APIs |
| Go socket/API | internal/signaling and internal/httpapi | UI shell using controller stubs | Real-router integration tests |
| Browser transport | sidekick client modules, candidate sender seam | Go server after contract freeze | Mocked RTC and cross-language tests |
| Setup/settings UI | setup controller, focused components/stores | Transport implementation | All entry paths routed through authorization |
| Pairing identity | local pair store, small channel handshake extension, existing permission fields | TURN package | Reconnect and identity authorization tests |
| ICE/deployment | internal/ice, optional coturn, container/proxy/docs | Pairing package | Working deployment and relay credential tests |
| Retirement | package/deploy/config cleanup and provider inventory | Final documentation review | Exact cutover checklist and removal diff |

With four agent slots, run at most three independent implementation packages beside the coordinator. Sequence agents that touch shared session/channel files; parallelism should not turn those files into concurrent merge targets.

Each handoff includes changed files, exported APIs, fixture changes, tests run, known failures, and remaining integration work. Contract changes are integrated first, then both language implementations update. The coordinator reviews lifecycle cleanup and authority boundaries before merging a package into the next phase.

For browser changes, each handoff also identifies the Firebase dependency being replaced and the existing Multiplayer functions being reused. Proposed edits to media/render/playback owners need a concrete migration-caused failure or dependency; otherwise they become separate follow-up work. Subagents should not treat the acceptance list as a request to reimplement the systems named in it.

Use a separate review pass after Phases 2, 5, and 7: one reviewer follows authorization from HTTP through sockets, another follows browser cancellation/restoration/persistence, and the coordinator checks deployment/data retirement. Review findings become concrete fixes with focused regression tests.

## 14. Migration acceptance and playback smoke check

The acceptance gate concentrates on the new server and changed connection paths. Existing playback suites remain useful regression coverage; the migration adds tests for changed behavior rather than duplicating the player's format coverage.

| Area | Required evidence |
| --- | --- |
| Scaffold | Binary/container builds; config/keygen/help work; documented proxy prefix works |
| Protocol | Shared Go/TS fixtures agree; incompatible versions fail before RTC |
| Host authority | Guest/invite/connection token rejected by every host-only operation |
| Isolation | Wrong room/attempt/socket generation cannot route or mutate another connection |
| Resource bounds | Concurrent joins, malformed floods, stalled readers, expiry and shutdown remain bounded |
| Privacy gate | Fresh/disabled state and unopened invitations make no Multiplayer requests |
| Guest UX | Official production joins same-origin and cross-origin sidekicks through one invitation |
| Host UX | Login, create/resume, rotate, close, logout, and re-login after reload work |
| Local state | Endpoint-scoped recents, pairings, permissions and cross-window settings behave consistently |
| Playback smoke check | A normal laptop/phone FLAC session with play/pause/seek; one small source transfer and one buffered transfer exercise existing data channels |
| Paired behavior | A remembered guest regains existing paired/Freeplay permissions after reconnect; check a normal Freeplay action if used in daily sessions |
| Existing media owners | Diff review confirms source transfer, renderers, caches, playback backends and DSP were reused; investigate only migration-caused regressions |
| Mobility | Backgrounding, screen lock, network changes, browser reopen and server restart |
| ICE | Suitable direct routes work; configured relay works; unavailable routes explain failure |
| PWA | Installed update, offline local playback, and sidekick network-only caching behavior |
| Retirement | Old clients denied access; exact data/account cleanup; hosting-only deployment remains functional |

Run Go formatting/vet/tests, `go test -race ./...`, and targeted fuzzing for the new decoders. Run focused Vitest suites around changed signaling, invitations, settings and pairing, the cross-language harness, relevant Svelte checks, and the required frontend build. Use existing playback tests as regression coverage when shared peer/channel code changes. The small real-device smoke check supplements protocol mocks.

Hively, libopenmpt, video playback, codec handling and DSP need no dedicated new implementation or test campaign for this migration. Broaden checks only if an actual change or failure reaches one of those owners.

Track acceptance in the phase log with reproducible evidence. The user’s working RTDB route remains available until Phase 6 establishes that the replacement handles the use cases it is replacing.
