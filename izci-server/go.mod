module github.com/tozworth/izci/izci-server

go 1.27.1

require (
	// github.com/coder/websocket is pinned for the signaling socket
	// (GET /v1/socket). It is blank-imported by internal/signaling so
	// `go mod tidy` keeps the pin before the endpoint lands.
	github.com/coder/websocket v1.8.15
	github.com/ebitengine/purego v0.11.1
	github.com/huin/goupnp v1.3.0
	github.com/pion/webrtc/v3 v3.3.6
	github.com/tetratelabs/wazero v1.12.0
	modernc.org/sqlite v1.39.0
)

require (
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/ncruces/go-strftime v0.1.9 // indirect
	github.com/pion/datachannel v1.5.8 // indirect
	github.com/pion/dtls/v2 v2.2.12 // indirect
	github.com/pion/ice/v2 v2.3.38 // indirect
	github.com/pion/interceptor v0.1.29 // indirect
	github.com/pion/logging v0.2.2 // indirect
	github.com/pion/mdns v0.0.12 // indirect
	github.com/pion/randutil v0.1.0 // indirect
	github.com/pion/rtcp v1.2.14 // indirect
	github.com/pion/rtp v1.8.7 // indirect
	github.com/pion/sctp v1.8.19 // indirect
	github.com/pion/sdp/v3 v3.0.9 // indirect
	github.com/pion/srtp/v2 v2.0.20 // indirect
	github.com/pion/stun v0.6.1 // indirect
	github.com/pion/transport/v2 v2.2.10 // indirect
	github.com/pion/turn/v2 v2.1.6 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/stretchr/testify v1.9.0 // indirect
	github.com/wlynxg/anet v0.0.3 // indirect
	golang.org/x/crypto v0.21.0 // indirect
	golang.org/x/exp v0.0.0-20250620022241-b7579e27df2b // indirect
	golang.org/x/net v0.22.0 // indirect
	golang.org/x/sync v0.15.0 // indirect
	golang.org/x/sys v0.44.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
	modernc.org/libc v1.66.3 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.11.0 // indirect
)
