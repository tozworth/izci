// Package version carries the sidekick build version.
//
// The default is "dev"; release builds override it with:
//
//	go build -ldflags "-X github.com/dunsparce9/izci/sidekick/internal/version.Version=<tag>"
package version

// Version is the sidekick release version, or "dev" for local builds.
var Version = "dev"
