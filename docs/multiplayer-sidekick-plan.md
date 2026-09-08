# Multiplayer sidekick plan

Replace Firebase Multiplayer signaling with a small self-hosted Go service. Official izci ships with no server configured; a host enters their server, logs in, and shares an invitation. Guests open that invitation in official izci. The sidekick handles rooms and WebRTC signaling; existing Multiplayer handles everything after connection.

Keep RTDB working during implementation, with an explicit transport choice and no automatic fallback. Reuse existing playback, media transfer, buffering, caches, DSP, and Freeplay renderers.

Work through the phases in order. One agent finishes a phase's code, integration, and checks before starting the next. Read the relevant existing code as part of each phase; there is no separate planning phase or progress document. End with a short report of what changed and what was checked. Follow AGENTS.md, including the required frontend build after source changes.

## Phase 1 — Make the Go server runnable

1. Create an independent Go module in `sidekick/`, with `cmd/izci-sidekick/main.go`. Target Go 1.27 and verify/pin its patch release when implementing. Use `net/http`, the standard crypto/JSON packages, and a pinned `github.com/coder/websocket`. Keep the frontend build usable without Go.
2. Add `serve`, `keygen`, `check-config`, and `version` commands. Keygen produces 32 cryptographically random bytes; only this command prints the key. Serve reads it from a secret file.
3. Load strict JSON configuration: listen address, public HTTPS base URL, exact allowed browser origins, host key file, optional trusted proxy networks, and the limits below. Reject unknown fields and invalid values. Support a deployment path prefix consistently.
4. Default to `127.0.0.1:8787`; the container example uses `0.0.0.0:8787`. Trust forwarded addresses only from configured proxies. Keep rooms, sessions, tickets, and signaling in memory; no server database.
5. Add `GET /healthz` for liveness and `GET /v1/info` for protocol version, operator description/contact, configured ICE providers, and room limits. Put API routes beneath the configured prefix. Use no-store responses, exact-origin CORS, request timeouts, and errors with stable codes rather than UI text.
6. Add a multi-stage Dockerfile, Compose/Caddy example, and systemd unit under `sidekick/deploy/`. Build a non-root container and CGO-disabled Linux binaries for amd64/arm64. Caddy handles TLS and may serve izci alongside the API.
7. Write one short `sidekick/README.md`: generate key, edit config, validate, start, proxy TLS, check health. Add Go formatting, vet, tests/race tests, and binary builds to CI. Add focused packages as needed; do not pre-create an elaborate empty directory tree.

Use these defaults where the later phases need them:

| Limit | Default |
| --- | --- |
| Rooms / peers per room / pending attempts per room | 4 / 8 / 8 |
| Open sockets | 128 |
| Host session / room lease | 12 hours / 24 hours |
| Socket ticket / unauthenticated socket | 30 seconds / 5 seconds |
| Connection attempt / host reconnect grace | 45 seconds / 90 seconds |
| JSON message / SDP / single candidate | 64 KiB / 50 KiB / 4 KiB |
| Candidates per side per attempt | 128 |
| Per-socket outgoing queue | 64 messages and 256 KiB |
| Heartbeat interval / reply timeout | 20 seconds / 10 seconds |
| Cleanup interval / shutdown grace | 5 seconds / 10 seconds |

Check invalid config, missing secrets, prefixed routes, forbidden origins, oversized bodies, and clean shutdown with Go tests. Confirm logs do not print secrets or request bodies. Run `go vet ./...`, `go test -race ./...`, and the binary build from `sidekick/`.

## Phase 2 — Connect a host and guest through the server

1. Add focused auth, room, and signaling code. Use random opaque IDs/tokens, store credential digests, and compare host credentials in constant time. A room has a 128-bit ID, owner session, owner-resume secret, 256-bit invitation secret, capacity, lease, and bounded connection records. Store secret digests. Party titles and nicknames stay in izci.
2. Implement the routes below. A host logs in with the operator key and receives an expiring bearer session. Logout revokes it and closes its rooms. Creating a room returns owner and invitation secrets. Resuming an existing room requires both a host session and its owner secret; another logged-in tab cannot overwrite it.
3. Join accepts room ID, invitation secret, attempt nonce, and app protocol version. Check a live host and reserve a slot atomically before returning a connection token and socket ticket. Wrong/missing invitations both return `room-unavailable`; a valid invite may return `room-full`. Connection tokens authorize only their own connection.
4. Authenticate sockets with a one-use ticket in the first frame, within five seconds. Check origin and socket limits before upgrading. Never put credentials in URLs or WebSocket subprotocols. Bind role, room, connection, and socket generation on the server; do not trust client-supplied routing destinations.
5. Use JSON messages with `version`, `type`, `requestId`, optional `attemptId`, and `payload`. Give signaling its own version, separate from the existing app protocol. Decode fields strictly and reject oversized, unknown, or wrong-role messages. Put representative valid/invalid JSON in `tests/multiplayer-sidekick-contract/`; Phase 3 uses the same fixtures. Keep payload definitions in code rather than writing a separate specification.
6. Implement this exchange: authenticate → ready; server sends host `peer.requested`; host accepts/rejects; accepted guest sends offer; host sends answer; both send candidates/end-of-candidates. Install the host handler before prompting the guest to offer.
7. Number candidates per sender and attempt. Ignore identical duplicates, reject conflicting duplicates, and discard stale attempts. After both peers report connected, discard SDP/candidates and retain only the connection reservation. Keep sockets for new admissions and reconnect status.
8. Release slots once on rejection, timeout, or explicit release. Replacing a socket increments its generation; late cleanup from the old socket must not close the replacement. Pause admissions during host reconnect grace. Lease expiry, logout, room closure, and shutdown remove room authority. Direct RTC may keep playing after signaling is lost.
9. Give each socket one reader and a bounded writer queue; write outside registry locks. Cancel pumps/timers on close and disconnect slow readers. Add rate limits: login 5/minute/source, burst 5; join 30/minute/source, burst 10; socket messages 60/second, burst 120. Expire idle limiter entries and cap their map; reject new buckets when full.
10. Use stable errors including `bad-request`, `unsupported-version`, `unauthorized`, `room-unavailable`, `room-full`, `rate-limited`, `attempt-expired`, `host-unavailable`, `ticket-expired`, `ticket-consumed`, and `server-shutting-down`. Include retry delay for rate limits. Log lifecycle/error codes, never SDP, candidates, invitations, or tokens.

| Route | Access |
| --- | --- |
| `POST /v1/host/sessions` | Operator key in body |
| `DELETE /v1/host/session` | Host bearer |
| `POST /v1/rooms` | Host bearer |
| `POST /v1/rooms/{room}/resume` | Host bearer + owner secret |
| `POST /v1/rooms/{room}/renew`, `rotate` | Owning host bearer |
| `DELETE /v1/rooms/{room}` | Owning host bearer |
| `POST /v1/join` | Invitation in body |
| `POST /v1/socket-tickets` | Host or connection bearer |
| `GET /v1/socket` | Ticket in first frame |

Test the real router with a Go host and guests using ephemeral listeners and an injected clock. Cover a complete exchange, ticket replay, wrong-room/role access, concurrent last-slot joins, expiry, stale socket cleanup, slow readers, and shutdown. Run vet and race tests. This phase ends with a working server exchange, not socket stubs.

## Phase 3 — Attach the existing Multiplayer client

1. Read `multiplayer-signaling.ts`, `multiplayer-peer.ts`, `multiplayer-host-session.ts`, `multiplayer-client-connect.ts`, and `multiplayer-session.ts`. Find their Firebase calls and keep existing RTC creation/channel attachment intact.
2. Move Firebase reference types out of shared peer state in `multiplayer-types.ts`. Replace direct Firebase ICE writes with an injected candidate sender. Give the session a small transport cleanup handle. Keep RTDB behavior working through these changes; do not rebuild the session controller.
3. Add focused `multiplayer-sidekick-*` services for HTTP, sockets, decoding, host room acquisition, and guest connection. Implement the Phase 2 messages and use its JSON fixtures. Use attempt-local peer IDs until the existing RTC hello supplies identity/presentation.
4. Use AbortSignal for requests and connection attempts. Queue candidates arriving before remote SDP through existing helpers. On cancellation/server switch, dispose old subscriptions, timers, sockets, and pending RTC work before attaching new results. Check attempt ownership after awaits so late callbacks cannot mutate the current session.
5. Reconnect signaling without stopping healthy RTC playback. Retry transient failures with jittered backoff, bounded by the server's reconnect/attempt deadlines. Authentication, version, and invalid-invitation errors require user action. A new negotiation gets a fresh attempt ID.
6. Add explicit RTDB/sidekick selection to the existing settings UI and last-session record. Store sidekick state separately from RTDB UIDs. Route selection must choose the real implementation; keep the legacy invite parser during overlap.
7. Add a TypeScript integration test using the real Go router and production browser transport helpers; mock RTC only. Exercise login, join, offer/answer/candidates, release, cancellation, and server switch.

Run shared fixture tests, focused Multiplayer tests, relevant Svelte checks, and the required build. Check the diff keeps media transfer/rendering owners intact and the RTDB tests still pass.

## Phase 4 — Make setup and invitations usable

1. Add a service-owned setup controller and small dialogs in the existing Multiplayer UI. Official builds start with no endpoint and make no Multiplayer requests until the user enables/contact-authorizes it. Apply this to manual entry, links, restore, and auto-host.
2. Use `#party=<base64url JSON>` invitations containing `v`, `endpoint`, `roomId`, `secret`, and optional `title`. Limit the full invitation to 4 KiB and title to 120 characters. Parse locally, capture the pending invitation, then remove the secret-bearing fragment from the address bar.
3. Accept HTTPS endpoints only; reject URL credentials, query/fragment components, malformed ports, and ambiguous paths. Normalize the prefix once. Use WSS and fetch with credentials omitted and redirects rejected. Show the full server authority/prefix, with ASCII hostname alongside suspicious Unicode.
4. Opening an invite shows the destination and unverified title hint, then Join. Preserve the invite through first-use setup. Only after Join fetch server info; show declared ICE providers before constructing RTC, asking Continue when new providers need acknowledgment. Get real title/listener count from the established peer; do not invent a pre-connection count.
5. Add Enter server address → server description → host login or invitation entry. Hosting is login → create/resume → copy invite. Add rotate invite, close room, and logout. A same-origin endpoint suggestion still uses the setup summary. A server address does not expose a public room directory.
6. Store endpoint, label, acknowledged notice version, explicit auto-reconnect choice, and relay preference through existing synchronized settings helpers. Recents contain endpoint, room ID, display name, last-used time, and an invitation only if Remember was chosen. Remembered host rooms may store owner/invite secrets; operator keys and login bearers never persist.
7. Keep deep-link confirmation even for remembered servers. Automatic restore requires its separate saved permission and stays cancellable. After reload, hosting stops at login; do not silently save the operator key.
8. Add distinct Forget server, Forget invitation, and existing Clear received audio cache actions. Keep business logic in services/stores and mobile presentation in its existing owners. Update `en.json` and `tr.json`, never `en-askew.json`.
9. Add the GitHub setup-guide link and a brief server/provider notice. Check CSP and service-worker handling allow selected endpoints without caching API traffic or credentials. Render all external text safely and redact invitations from errors/diagnostics.

Test parser failures, prefixed endpoints, cancellation, fresh/disabled network silence, remembered restore, expired login, and cross-window settings. Run relevant checks and build. No browser session or user's phone is required to complete this implementation phase.

## Phase 5 — Restore pairing, reconnect, and optional TURN

1. Read the existing pairing stores and host/client hello handlers. Replace Firebase UID-based pairing with browser-local identities and a random per-pair secret exchanged over RTC when the host chooses Pair.
2. On reconnect, prove possession with HMAC over a versioned context containing room ID, both identities, and fresh nonces from both peers. Reject replay/wrong-peer proofs. Until hello and proof finish, keep paired privileges disabled. Feed verified identity into the existing permissions and Freeplay activation; reuse its renderers and navigation.
3. Store pair records in a sidekick-specific local settings namespace. Keep host labels and per-pair Freeplay preferences. Pairing restores app privileges after invitation admission; it does not grant server administration or bypass admission.
4. Let a newly logged-in host resume its remembered room. If the server restarted and the room is absent, recreate the saved ID/invitation atomically using host authentication. Reject collisions with existing rooms unless the owner secret matches. Explain this restart behavior in the README.
5. Rotate invitations for future joins and send replacements over currently authorized paired channels. Offline guests need a new invite. Unpair removes paired privileges; kick closes the host's RTC peer and releases its reservation. Neither prevents reuse of a shared invite unless it is rotated.
6. Keep media health, signaling reconnect, and expired host login distinct in session state. Test restart/reconnect without tearing down an otherwise healthy RTC connection.
7. Default server ICE configuration to empty. Advertise configured STUN/TURN URLs in info. Add `POST /v1/ice` for authenticated hosts/admitted connections and pass results into existing `multiplayer-ice.ts` helpers. Keep legacy TURN exchange isolated.
8. For optional coturn, read a relay secret file and issue standard REST shared-secret credentials with 10-minute expiry and opaque usernames. Limit issuance per connection, return expiry, and refresh before negotiation when needed. Use existing stats for direct/relayed status; relay-only without a relay gets a useful error.
9. Add an optional coturn deployment example and README notes explaining STUN, relay setup, HTTPS for LAN use, and browser network permissions. Briefly explain that the sidekick sees connection metadata, processes SDP/ICE transiently, and is trusted for signaling; TURN is a separate relay. Keep privacy notes factual, without a separate legal-document project.
10. Check changed catalog/hello payloads do not introduce local filesystem-path exposure. Reuse existing cache deletion controls; do not turn this migration into a cache or metadata rewrite.

Test proof replay, unpair/kick/rotation, Freeplay permission restoration, room restart/collision, credential expiry, and missing relay. Run Go and focused browser tests plus build.

## Phase 6 — Finish packaging and check the whole connection

1. Follow the README against the packaged configuration and fix incorrect commands/defaults. Keep official izci's endpoint empty. Ensure same-origin hosting and a separately hosted frontend are both supported by URL/origin handling.
2. Run the complete server/client integration test, Go vet/race tests, focused Multiplayer regression tests, relevant Svelte checks, and build. Fix migration-caused failures in their existing owners.
3. Check the final client still attaches existing source-transfer and buffered-audio channels, transport commands, and paired Freeplay. Use existing tests where available; add focused coverage only for changed connection behavior.
4. Make retired-RTDB invitation text available in the overlap build. Keep the RTDB choice until the replacement is ready to become the default.
5. Report any deployment or real-browser behavior not exercised. If the user requests a manual check, a host/guest connection with play/pause/seek and reconnect is enough to start; investigate further if it fails. Do not require a phone, group party, week-long trial, or separate acceptance log.

The result is a packaged replacement ready for use. Publishing and provider shutdown follow the user's deployment instructions; automated checks must not be described as proof of real-device playback.

## Phase 7 — Remove RTDB when switching over

Start this phase when the user is ready to retire the old service; the implementation phases above do not require that decision.

1. Inspect `package.json`, `firebase.json`, and related scripts. Separate Firebase Hosting deployment from Auth/RTDB deployment so routine hosting deploys cannot restore the old service.
2. Remove browser Firebase transport/config/dependencies, the overlap selector, obsolete rules/scripts/tests, and unused RTDB state. Keep Firebase Hosting and its CLI where still used. Do not add legacy adapters or migrations.
3. Keep old invitation detection only to show the retirement message. Remove only explicitly owned RTDB local keys; preserve sidekick state and queue/library data.
4. Identify the exact Multiplayer database paths and anonymous accounts before provider cleanup. Disable their access and delete only attributable data/accounts when authorized; preserve shared project consumers. Verify old builds cannot write new Multiplayer records.
5. Update the README and AGENTS.md to describe sidekick signaling. Run focused tests, checks, and build; verify hosting deployment no longer includes RTDB/Auth.

Finish with a short summary of code removed and any provider action still pending.
