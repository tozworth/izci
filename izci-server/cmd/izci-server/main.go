// Command izci-server runs signaling and dedicated hosting.
//
// Usage:
//
//	izci-server <command> [options]
//
// Commands:
//
//	serve         signaling + dedicated host (default deployment)
//	signal        signaling only (the previous server role)
//	host          dedicated host using a separate izci-server signal endpoint
//	keygen        generate a new 32-byte operator key (the only command that prints it)
//	check-config  validate a config file and its secret file without serving
//	version       print the build version
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/dunsparce9/izci/izci-server/internal/config"
	"github.com/dunsparce9/izci/izci-server/internal/host"
	"github.com/dunsparce9/izci/izci-server/internal/signaling"
	"github.com/dunsparce9/izci/izci-server/internal/version"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "serve":
		err = runServe(os.Args[2:])
	case "signal":
		err = runSignal(os.Args[2:])
	case "host":
		err = runHost(os.Args[2:])
	case "keygen":
		err = runKeygen(os.Args[2:])
	case "check-config":
		err = runCheckConfig(os.Args[2:])
	case "version", "--version", "-V":
		fmt.Printf("izci-server %s\n", version.Version)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `usage: izci-server <command> [options]

  serve --config <file>                 signaling + dedicated host (default)
  signal --config <file>                signaling only
  host --config <file> --signal <url>   dedicated host via a remote signal endpoint
  keygen                                print a new 32-byte operator key (hex)
  check-config --config <file>          validate config and secret file without serving
  version                               print the build version
`)
}

func loadConfigAndKey(configPath string) (*config.Config, [32]byte, error) {
	cfg, err := config.LoadFile(configPath)
	if err != nil {
		return nil, [32]byte{}, err
	}
	key, err := config.LoadHostKey(cfg.HostKeyFile)
	if err != nil {
		return nil, [32]byte{}, err
	}
	warnKeyFilePerms(cfg.HostKeyFile)
	return cfg, key, nil
}

func runSignal(args []string) error {
	fs := flag.NewFlagSet("signal", flag.ContinueOnError)
	configPath := fs.String("config", "izci-server-config.json", "path to JSON config file")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, key, err := loadConfigAndKey(*configPath)
	if err != nil {
		return err
	}
	srv, err := signaling.New(cfg, log.New(os.Stderr, "", log.LstdFlags), key)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return srv.ListenAndServe(ctx)
}

func runServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	configPath := fs.String("config", "izci-server-config.json", "path to JSON config file")
	hostName := fs.String("name", "izci-server", "dedicated host display name")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, key, err := loadConfigAndKey(*configPath)
	if err != nil {
		return err
	}
	logger := log.New(os.Stderr, "", log.LstdFlags)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runCombined(ctx, cfg, key, logger, *hostName)
}

// runCombined runs signaling plus the embedded dedicated host in one
// process. The host dials the local endpoints over loopback with identical
// lifecycle semantics to a remote host (never direct registry access).
func runCombined(ctx context.Context, cfg *config.Config, key [32]byte, logger *log.Logger, hostName string) error {
	srv, err := signaling.New(cfg, logger, key)
	if err != nil {
		return err
	}
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return err
	}
	// Child cancel lets an embedded-host failure unwind signaling too:
	// serve mode fails fast instead of silently running signaling-only.
	ctx, stop := context.WithCancel(ctx)
	defer stop()
	serveErr := make(chan error, 1)
	go func() {
		serveErr <- srv.Serve(ctx, ln)
	}()
	select {
	case err := <-serveErr:
		return err
	default:
	}
	localBase := listenerBase(ln.Addr()) + cfg.PathPrefix
	// Wait for the listener to serve before the host acquires its room;
	// otherwise the first Acquire fails on connection refused.
	if err := waitForHealthy(ctx, localBase, 10*time.Second); err != nil {
		return err
	}
	hostKeyHex, err := readHostKeyHex(cfg.HostKeyFile)
	if err != nil {
		return err
	}
	h, store, stopRescan, err := buildDedicatedHost(cfg, logger, hostName)
	if err != nil {
		return err
	}
	defer func() {
		stopRescan()
		_ = store.Close()
	}()
	transport := host.NewSignalTransport(host.SignalClientConfig{BaseURL: localBase, HostKey: hostKeyHex})
	h.AttachTransport(transport)
	hostErr := make(chan error, 1)
	go func() {
		// Capacity defaults to the signaling room limit.
		hostErr <- h.Run(ctx, cfg.Limits.MaxPeersPerRoom)
	}()
	select {
	case <-ctx.Done():
		// Shutdown: signaling Serve handles grace; host transport closes.
		_ = transport.Close()
		if err := <-serveErr; err != nil {
			return err
		}
		return <-hostErr
	case err := <-serveErr:
		_ = transport.Close()
		return err
	case err := <-hostErr:
		// The embedded host is required in serve mode: fail fast so the
		// operator restarts from a known state rather than silently
		// running signaling-only.
		stop()
		serveDrained := <-serveErr
		if err != nil {
			return err
		}
		return serveDrained
	}
}

func runHost(args []string) error {
	fs := flag.NewFlagSet("host", flag.ContinueOnError)
	configPath := fs.String("config", "izci-server-config.json", "path to JSON config file")
	signalURL := fs.String("signal", "", "izci-server signal base URL (https, including path prefix)")
	hostName := fs.String("name", "izci-server", "dedicated host display name")
	capacity := fs.Int("capacity", 8, "room capacity for the dedicated host")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*signalURL) == "" {
		return fmt.Errorf("host requires --signal <url>")
	}
	cfg, _, err := loadConfigAndKey(*configPath)
	if err != nil {
		return err
	}
	hostKeyHex, err := readHostKeyHex(cfg.HostKeyFile)
	if err != nil {
		return err
	}
	logger := log.New(os.Stderr, "", log.LstdFlags)
	h, store, stopRescan, err := buildDedicatedHost(cfg, logger, *hostName)
	if err != nil {
		return err
	}
	defer func() {
		stopRescan()
		_ = store.Close()
	}()
	transport := host.NewSignalTransport(host.SignalClientConfig{BaseURL: *signalURL, HostKey: hostKeyHex})
	h.AttachTransport(transport)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *capacity < 1 {
		*capacity = 1
	}
	return h.Run(ctx, *capacity)
}

func runCheckConfig(args []string) error {
	fs := flag.NewFlagSet("check-config", flag.ContinueOnError)
	configPath := fs.String("config", "izci-server-config.json", "path to JSON config file")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, err := config.LoadFile(*configPath)
	if err != nil {
		return err
	}
	if _, err := config.LoadHostKey(cfg.HostKeyFile); err != nil {
		return err
	}
	if cfg.RelaySecretFile != "" {
		if _, err := config.LoadRelaySecret(cfg.RelaySecretFile); err != nil {
			return err
		}
	}
	fmt.Printf("config ok: listen=%s public=%s prefix=%q rooms=%d peers/room=%d library=%d roots transfer=%s db=%q catalog=%d/%d\n",
		cfg.Listen, cfg.PublicBaseURL, cfg.PathPrefix,
		cfg.Limits.MaxRooms, cfg.Limits.MaxPeersPerRoom,
		len(cfg.Library.Roots), cfg.SourceTransfer.Mode,
		cfg.Database.Path, cfg.Catalog.MaxItemsPerCollection, cfg.Catalog.MaxTotalItems)
	return nil
}

func runKeygen(args []string) error {
	fs := flag.NewFlagSet("keygen", flag.ContinueOnError)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("keygen takes no arguments")
	}
	var raw [config.HostKeyLength]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Errorf("cannot generate key: %w", err)
	}
	fmt.Println(hex.EncodeToString(raw[:]))
	return nil
}

// warnKeyFilePerms nudges operators away from world-readable secret files.
// Advisory only: startup must not fail because of it.
func warnKeyFilePerms(path string) {
	fi, err := os.Stat(path)
	if err != nil {
		return
	}
	if perm := fi.Mode().Perm(); perm&0o077 != 0 {
		log.Printf("warning: host key file %s is accessible (mode %04o); consider chmod 600", path, perm)
	}
}

func readHostKeyHex(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(raw)), nil
}

// listenerBase dials a bound listener on 127.0.0.1 over http, mapping
// wildcard binds to loopback.
func listenerBase(addr net.Addr) string {
	host, port, err := net.SplitHostPort(addr.String())
	if err != nil {
		return "http://" + addr.String()
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port)
}

// waitForHealthy polls the signaling health endpoint until it answers or
// ctx ends, so the embedded host does not race the listener bind.
func waitForHealthy(ctx context.Context, base string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 2 * time.Second}
	for time.Now().Before(deadline) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/healthz", nil)
		if err != nil {
			return err
		}
		resp, err := client.Do(req)
		if err == nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return fmt.Errorf("signaling at %s did not become healthy", base)
}
