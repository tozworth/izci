module github.com/dunsparce9/izci/sidekick

go 1.27.1

// github.com/coder/websocket is pinned for the Phase 2 WebRTC signaling
// socket (GET /v1/socket). It is blank-imported by internal/server so
// `go mod tidy` keeps the pin before the endpoint lands.
require github.com/coder/websocket v1.8.15
