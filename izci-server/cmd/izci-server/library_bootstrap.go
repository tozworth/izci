package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/tozworth/izci/izci-server/internal/config"
	"github.com/tozworth/izci/izci-server/internal/host"
	"github.com/tozworth/izci/izci-server/internal/library"
	"github.com/tozworth/izci/izci-server/internal/media"
	"github.com/tozworth/izci/izci-server/internal/persistence"
	"github.com/tozworth/izci/izci-server/internal/version"
)

// buildDedicatedHost probes system dependencies, opens durable state,
// scans the configured library roots, reconciles stable IDs atomically,
// and wires the session engine to source-file and buffered-Opus delivery.
// It returns the host, its store (for shutdown), and a rescan stop func.
func buildDedicatedHost(cfg *config.Config, logger *log.Logger, hostName string) (*host.Host, *persistence.Store, context.CancelFunc, error) {
	deps := media.Probe()
	logger.Printf("izci-server media: %s", deps.Describe())
	if !deps.RenderAvailable() {
		logger.Printf("izci-server media: full-pipeline rendering unavailable; source transfer still serves %s",
			"ordinary audio, modules, Hively files, and video sources")
	}

	store, err := persistence.Open(cfg.Database.Path)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("open database: %w", err)
	}
	serverID, err := store.ServerID()
	if err != nil {
		_ = store.Close()
		return nil, nil, nil, fmt.Errorf("server identity: %w", err)
	}
	logger.Printf("izci-server host identity %s (persistent when database.path is a file)", redactID(serverID))

	cacheDir := renderCacheDir(cfg)
	cache, err := media.OpenCache(cacheDir, cfg.Render.CacheSizeMB*1024*1024)
	if err != nil {
		_ = store.Close()
		return nil, nil, nil, fmt.Errorf("open render cache: %w", err)
	}
	logger.Printf("izci-server render cache %s (%d MiB)", cacheDir, cfg.Render.CacheSizeMB)
	coordinator := media.NewCoordinator(cache, media.FFmpegSettings{}, deps, cfg.Render.MaxEncoders)
	artwork := &media.ArtworkCache{Dir: filepath.Join(cacheDir, "artwork"), MaxBytes: 128 * 1024 * 1024}

	policy := media.Policy{Mode: cfg.SourceTransfer.Mode, MaxBytes: cfg.SourceTransfer.MaxBytes}
	catalog := host.NewCatalog(cfg.Catalog.MaxItemsPerCollection, cfg.Catalog.MaxTotalItems)
	h := host.NewHost(host.HostConfig{
		Name:                    hostName,
		Product:                 "izci-server",
		ProductVersion:          version.Version,
		Logger:                  logger,
		RTC:                     host.RTCConfig{PublicIPs: cfg.RTC.PublicIPs, UDPMin: cfg.RTC.UDPMin, UDPMax: cfg.RTC.UDPMax},
		Catalog:                 catalog,
		Policy:                  policy,
		Store:                   store,
		ServerID:                serverID,
		Deps:                    deps,
		RenderCoordinator:       coordinator,
		RenderCache:             cache,
		RenderBitrate:           cfg.Render.BitrateKbps,
		SharedControl:           cfg.Host.SharedControl,
		AutoPair:                cfg.Host.AutoPair,
		ChatEnabled:             cfg.Host.ChatEnabled,
		DisableChat:             !cfg.Host.ChatEnabled,
		Motd:                    cfg.Host.Motd,
		MaxPeers:                cfg.Limits.MaxPeersPerRoom,
		MaxFreeplaySessions:     cfg.Limits.MaxFreeplaySessions,
		MaxCommandsPerMinute:    cfg.Limits.MaxCommandsPerMinute,
		MaxSeeksPerMinute:       cfg.Limits.MaxSeeksPerMinute,
		MaxRenderNeedsPerMinute: cfg.Limits.MaxRenderNeedsPerMinute,
		MaxRenderRanges:         cfg.Limits.MaxRenderRanges,
		MaxControlMessageBytes:  cfg.Limits.MaxControlMessageBytes,
		MaxChatHistory:          cfg.Limits.MaxChatHistory,
		MaxSourceTransfers:      cfg.Limits.MaxSourceTransfers,
		MaxMediaBufferedBytes:   cfg.Limits.MaxMediaBufferedBytes,
		MaxRenderBufferedBytes:  cfg.Limits.MaxRenderBufferedBytes,
		ArtworkProvider:         artwork,
	})

	if len(cfg.Library.Roots) == 0 {
		logger.Printf("izci-server library: no roots configured; catalog stays empty until library.roots is set")
		return h, store, func() {}, nil
	}
	roots, err := resolveLibraryRoots(cfg)
	if err != nil {
		_ = store.Close()
		return nil, nil, nil, err
	}
	rev, err := scanAndReconcile(cfg, store, h, roots, logger)
	if err != nil {
		_ = store.Close()
		return nil, nil, nil, err
	}
	logger.Printf("izci-server library: %d tracks revision %d from %d roots", h.CatalogView().Count(), rev, len(roots))

	// Periodic rescan when configured; zero disables.
	var rescanStop context.CancelFunc = func() {}
	if d := time.Duration(cfg.Library.RescanInterval); d > 0 {
		ctx, cancel := context.WithCancel(context.Background())
		rescanStop = cancel
		go rescanLoop(ctx, cfg, store, h, roots, logger, d)
	}
	_ = rev
	return h, store, rescanStop, nil
}

// renderCacheDir derives the render cache directory: explicit config,
// else alongside the database file, else the OS temp dir. Renders are
// rebuildable cache entries, so every default survives a wipe.
func renderCacheDir(cfg *config.Config) string {
	if dir := cfg.Render.CacheDir; dir != "" {
		return dir
	}
	if db := cfg.Database.Path; db != "" {
		if abs, err := filepath.Abs(db); err == nil {
			return filepath.Join(filepath.Dir(abs), "renders")
		}
	}
	return filepath.Join(os.TempDir(), "izci-server-renders")
}

func resolveLibraryRoots(cfg *config.Config) ([]library.Root, error) {
	configured := make([]library.Root, 0, len(cfg.Library.Roots))
	for _, r := range cfg.Library.Roots {
		configured = append(configured, library.Root{
			Mount: "/" + r.Name, Path: r.Path,
			Include: append([]string(nil), r.Include...),
			Exclude: append([]string(nil), r.Exclude...),
		})
	}
	return library.ResolveRoots(configured)
}

func scanAndReconcile(cfg *config.Config, store *persistence.Store, h *host.Host, roots []library.Root, logger *log.Logger) (int64, error) {
	files, err := library.Scan(roots, cfg.Library.ScanConcurrency)
	if err != nil {
		return 0, fmt.Errorf("library scan: %w", err)
	}
	mounts := make([]string, 0, len(roots))
	for _, r := range roots {
		mounts = append(mounts, r.Mount)
	}
	added, updated, removed, err := store.Reconcile(filesToScanned(files), mounts, time.Now())
	if err != nil {
		return 0, fmt.Errorf("library reconcile: %w", err)
	}
	tracks, err := store.ListTracks()
	if err != nil {
		return 0, err
	}
	rev := store.CatalogRevision() + 1
	if err := store.SetCatalogRevision(rev); err != nil {
		return 0, err
	}
	libTracks := make([]*library.Track, 0, len(tracks))
	for _, t := range tracks {
		libTracks = append(libTracks, t)
	}
	h.SetLibraryTracks(libTracks, rev)
	// Persist the initialized shared queue (library order on first run) so
	// restarts preserve catalog stability without persisting live clocks.
	logger.Printf("izci-server library: scan added=%d updated=%d removed=%d total=%d", added, updated, removed, len(tracks))
	return rev, nil
}

func filesToScanned(in []library.ScannedFile) []library.ScannedFile { return in }

func rescanLoop(ctx context.Context, cfg *config.Config, store *persistence.Store, h *host.Host, roots []library.Root, logger *log.Logger, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if rev, err := scanAndReconcile(cfg, store, h, roots, logger); err != nil {
				logger.Printf("izci-server library rescan failed: %v", err)
			} else {
				logger.Printf("izci-server library rescan complete revision %d (%d tracks)", rev, h.CatalogView().Count())
			}
		}
	}
}

func redactID(id string) string {
	if len(id) <= 8 {
		return "{server}"
	}
	return id[:4] + "…" + id[len(id)-4:]
}

// dedicatedRoomStore adapts persistence without making the host package own
// SQLite concerns.
type dedicatedRoomStore struct{ store *persistence.Store }

func (s dedicatedRoomStore) LoadDedicatedRoom() (host.RoomCredentials, bool) {
	credentials, ok := s.store.DedicatedRoomCredentials()
	return host.RoomCredentials{
		RoomID: credentials.RoomID, OwnerSecret: credentials.OwnerSecret,
		InvitationSecret: credentials.InvitationSecret,
	}, ok
}

func (s dedicatedRoomStore) SaveDedicatedRoom(credentials host.RoomCredentials) error {
	return s.store.SetDedicatedRoomCredentials(persistence.DedicatedRoomCredentials{
		RoomID: credentials.RoomID, OwnerSecret: credentials.OwnerSecret,
		InvitationSecret: credentials.InvitationSecret,
	})
}
