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

Restarting the server drops rooms (memory only). Hosts resume or recreate
their rooms afterwards; a connected RTC session may keep playing until it
is renegotiated. Logs record method, path, status, and client IP only:
never keys, tokens, invitations, SDP, candidates, or request bodies.
