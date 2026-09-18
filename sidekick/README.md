# izci sidekick

A small self-hosted signaling server for izci Multiplayer. It handles rooms
and WebRTC signaling; the izci client keeps doing everything after the
connection is established. Rooms, sessions, tickets, and signaling live in
memory only; there is no server database.

Official izci builds ship with no server configured: a host enters their
server address, logs in with the operator key, and shares an invitation.

## Quickstart

Generate an operator key (the only command that ever prints it):

```sh
go run ./cmd/izci-sidekick keygen > host-key
chmod 600 host-key
```

Copy `config.example.json` to `config.json` and edit it: set `listen`,
`publicBaseUrl` (https, except http for loopback dev), `allowedOrigins`,
and `hostKeyFile`. If you serve the API under a subpath, set `pathPrefix`
(e.g. `/party`) and include the same path in `publicBaseUrl`.

Validate without serving:

```sh
go run ./cmd/izci-sidekick check-config --config config.json
```

Start (default bind is `127.0.0.1:8787`; containers use `0.0.0.0:8787`):

```sh
go run ./cmd/izci-sidekick serve --config config.json
```

Put TLS in front with the Caddy example under `deploy/` (it may also serve
the izci frontend from the same origin), then check health:

```sh
curl https://sidekick.example.com/party/healthz
# {"status":"ok","version":"..."}

curl https://sidekick.example.com/party/v1/info
# protocol versions, operator contact, ICE providers, room limits
```

`GET /healthz` is also answered without the prefix for load-balancer
probes; the versioned API lives strictly beneath it.

## Signaling

A host logs in with the operator key, creates a room, and shares the
invitation secret out of band. Guests join with that secret plus the
matching app protocol version; the slot reservation is atomic, so the last
slot admits exactly one guest. Both sides then open `GET /v1/socket`
(authenticating with a one-use ticket in the first frame, never in the
URL) and exchange SDP/candidates through the server: host accepts, guest
offers, host answers, both trickle numbered candidates, and both report
connected. After connect the server discards SDP/candidates and keeps only
the reservation; established RTC keeps playing if signaling drops.

```sh
curl -X POST https://sidekick.example.com/party/v1/host/sessions \
  -d '{"hostKey":"<hex>"}'
# {"sessionToken":"...","expiresAt":"..."} — bearer for the calls below

curl -X POST https://sidekick.example.com/party/v1/rooms \
  -H "Authorization: Bearer <session>" -d '{}'
# {"roomId":"...","ownerSecret":"...","invitationSecret":"...","expiresAt":"..."}
```

Rooms carry a 24-hour lease (`renew`), invitations rotate without closing
the room (`rotate`), and a logged-in host resumes with its owner secret
(`resume`) — another tab cannot overwrite a live room. Logout revokes the
session and closes its rooms. Socket message shapes and their versions are
defined in `internal/server/protocol.go`; representative valid/invalid
frames live in `tests/multiplayer-sidekick-contract/` for the browser
client. Errors are stable codes (`room-unavailable` covers wrong and
missing invitations alike); rate limits add a `retryAfter` hint.

## Developing

```sh
gofmt -l .                  # must be clean
go vet ./...
go test -race ./...
CGO_ENABLED=0 go build ./...   # linux amd64/arm64 binaries
```

Restarting the server drops rooms (memory only). A newly logged-in host
resumes its remembered room from izci's setup panel; when the room is
absent after a restart, the panel recreates the same room ID and
invitation atomically with host authentication (`POST /v1/rooms` with
`roomId`, `ownerSecret`, and `invitationSecret`), so saved invite links
keep working. A live room refuses the collision unless the owner secret
matches, so another tab cannot take over a running room. A connected RTC
session may keep playing until it is renegotiated. Logs record method,
path, status, and client IP only: never keys, tokens, invitations, SDP,
candidates, or request bodies.

## Pairing and reconnect proofs

Pairing is browser-local: each browser keeps a stable random identity and
a per-pair secret exchanged over RTC when the host chooses Pair
(`izci.multiplayer-sidekick-pairings` in local storage; login bearers are
never persisted). An operator key can be remembered per server on the local
device when the host enables that option; it is excluded from izci backups.
Reconnects prove possession with HMAC-SHA-256 over `roomId`, both
identities, and fresh nonces from
both peers; stale nonces and wrong-peer proofs fail, and paired
privileges (including Freeplay) stay disabled until hello and proof
finish. Pairing restores app privileges after invitation admission only:
it never grants server administration and never bypasses admission.
Rotating the invitation (`POST /v1/rooms/{room}/rotate`) only affects
future joins and is announced to currently paired guests over their
authorized channels; offline guests need a fresh invite link. Unpair drops
privileges and kick closes the peer and frees its slot; neither blocks a
shared invite unless it is rotated.

## ICE, STUN, and optional TURN relay

The default ICE configuration is empty: with no `iceUrls` configured,
`POST /v1/ice` returns no servers and browsers attempt direct host
candidates. Advertise STUN/TURN URLs in `iceUrls` (shown in `GET /v1/info`
so guests can review providers before joining); authenticated hosts and
admitted connections fetch time-limited settings from `POST /v1/ice`
(host bearer plus room, or the connection's own token; issuance per
connection is capped). For a relay, run coturn with a REST shared secret
(see `deploy/coturn.example.conf`), point `relaySecretFile` at the same
secret, and list the relay in `iceUrls` as `turn:`/`turns:` URLs.
Credentials expire after `relayCredentialTtl` (default 10 minutes) and
izci refreshes them before renegotiating. Relay-only mode in izci
requires a relay and reports a plain error when the server offers none.

Direct connections usually succeed on one LAN or with friendly NATs; use
a relay for symmetric NATs and restrictive firewalls. For LAN use, serve
the API over HTTPS (browsers gate WebRTC and microphone-adjacent
features on secure contexts; loopback `http:` is allowed for local
development) and make sure the browser can reach both the sidekick
endpoint and the STUN/TURN ports.

Privacy notes, stated plainly: the sidekick is trusted for signaling. It
sees connection metadata (rooms, timing, IPs) and processes SDP/ICE
transiently to connect peers, but stores none of it beyond the live room
(all state is in memory). Media itself flows peer-to-peer over WebRTC
and never passes through the sidekick. A TURN relay is a separate
service: relayed media passes through it by design, so run your own if
that matters to you.
