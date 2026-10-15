// Package version carries the server build version.
//
// The default is "dev"; release builds override it with:
//
//	go build -ldflags "-X github.com/tozworth/izci/izci-server/internal/version.Version=<tag>"
package version

// Version is the server release version, or "dev" for local builds.
var Version = "dev"
