// Command izci-sidekick runs the izci multiplayer sidekick: a small
// self-hosted WebRTC signaling server that replaces Firebase RTDB signaling.
//
// Usage:
//
//	izci-sidekick <command> [options]
//
// Commands:
//
//	serve         run the signaling server (reads the operator key from a secret file)
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
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/dunsparce9/izci/sidekick/internal/config"
	"github.com/dunsparce9/izci/sidekick/internal/server"
	"github.com/dunsparce9/izci/sidekick/internal/version"
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
	case "keygen":
		err = runKeygen(os.Args[2:])
	case "check-config":
		err = runCheckConfig(os.Args[2:])
	case "version", "--version", "-V":
		fmt.Printf("izci-sidekick %s\n", version.Version)
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
	fmt.Fprintf(os.Stderr, `usage: izci-sidekick <command> [options]

  serve --config <file>         run the signaling server
  keygen                        print a new 32-byte operator key (hex)
  check-config --config <file>  validate config and secret file without serving
  version                       print the build version
`)
}

func runServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	configPath := fs.String("config", "sidekick-config.json", "path to JSON config file")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, err := config.LoadFile(*configPath)
	if err != nil {
		return err
	}
	key, err := config.LoadHostKey(cfg.HostKeyFile)
	if err != nil {
		return err
	}
	warnKeyFilePerms(cfg.HostKeyFile)
	srv, err := server.New(cfg, log.New(os.Stderr, "", log.LstdFlags), key)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return srv.ListenAndServe(ctx)
}

func runCheckConfig(args []string) error {
	fs := flag.NewFlagSet("check-config", flag.ContinueOnError)
	configPath := fs.String("config", "sidekick-config.json", "path to JSON config file")
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
	fmt.Printf("config ok: listen=%s public=%s prefix=%q rooms=%d peers/room=%d\n",
		cfg.Listen, cfg.PublicBaseURL, cfg.PathPrefix,
		cfg.Limits.MaxRooms, cfg.Limits.MaxPeersPerRoom)
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
