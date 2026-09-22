package media

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// On-disk render cache. Each entry is a directory:
//
//	<cacheDir>/<keyhash>/manifest.json
//	<cacheDir>/<keyhash>/init.blob
//	<cacheDir>/<keyhash>/cluster-000000.blob ...
//
// Entries are built in a temp directory and renamed into place atomically,
// so partial or failed renders are never published as complete entries.
// Rendered bytes are cache entries, not session state: multiple sessions
// and peers pin and consume the same entry concurrently without owning or
// duplicating it. Sizes are indexed with an LRU cap; pinned entries are
// never evicted.

// DefaultRenderCacheMB bounds the render cache when unconfigured.
const DefaultRenderCacheMB = 512

// cacheIndexEntry is the persisted per-entry metadata (no absolute paths,
// no audio bytes — the index stays small and greppable).
type cacheIndexEntry struct {
	Key          string  `json:"key"`
	Dir          string  `json:"dir"`
	SizeBytes    int64   `json:"sizeBytes"`
	Clusters     int     `json:"clusters"`
	DurationMs   float64 `json:"durationMs"`
	LastUsedUnix int64   `json:"lastUsedUnix"`
	StoredUnix   int64   `json:"storedUnix"`
	// seq orders same-second entries oldest-first. It is process-local
	// (never persisted); across restarts ties break arbitrarily.
	seq uint64 `json:"-"`
}

// Cache is a bounded on-disk LRU of completed renders with in-memory pin
// counts. All methods are safe for concurrent use; there is exactly one
// Cache per server process.
type Cache struct {
	mu      sync.Mutex
	dir     string
	maxByte int64
	entries map[string]*cacheIndexEntry // key string -> entry
	pins    map[string]int
	seq     uint64
}

// OpenCache opens (creating if needed) the render cache at dir with a
// total byte cap. Startup reconciles the index from disk: entries missing
// manifest.json (crashed mid-publish) are removed.
func OpenCache(dir string, maxBytes int64) (*Cache, error) {
	if dir == "" {
		return nil, fmt.Errorf("media: render cache directory is required")
	}
	if maxBytes <= 0 {
		return nil, fmt.Errorf("media: render cache limit must be positive")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("media: cache dir: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, fmt.Errorf("media: secure cache dir: %w", err)
	}
	c := &Cache{dir: dir, maxByte: maxBytes, entries: map[string]*cacheIndexEntry{}, pins: map[string]int{}}
	if err := c.reconcile(); err != nil {
		return nil, err
	}
	return c, nil
}

// Dir returns the cache root.
func (c *Cache) Dir() string { return c.dir }

// reconcile rebuilds the index from disk, dropping partial publishes.
func (c *Cache) reconcile() error {
	index, err := c.readIndex()
	if err != nil {
		index = nil
	}
	adopted := map[string]bool{}
	for _, e := range index {
		if e == nil || !validCacheDir(e.Dir) || e.Key == "" || e.Dir != dirNameForKey(e.Key) {
			continue
		}
		manifestPath := filepath.Join(c.dir, e.Dir, "manifest.json")
		raw, err := os.ReadFile(manifestPath)
		if err != nil {
			continue // partial publish: never admit it
		}
		var stored StoredRender
		entryDir := filepath.Join(c.dir, e.Dir)
		size, clusters, ok := validateStoredDir(entryDir, raw, &stored)
		if !ok || stored.Key != e.Key {
			continue
		}
		c.seq++
		e.seq = c.seq
		e.SizeBytes = size
		e.Clusters = clusters
		e.DurationMs = stored.Manifest.DurationMs
		c.entries[e.Key] = e
		adopted[e.Dir] = true
	}
	// Adopt completed entries the index forgot (e.g. index write raced a
	// shutdown): any directory with a valid manifest.json.
	dirs, _ := os.ReadDir(c.dir)
	for _, d := range dirs {
		name := d.Name()
		if !d.IsDir() || adopted[name] || strings.HasPrefix(name, "tmp-") {
			continue
		}
		manifestPath := filepath.Join(c.dir, name, "manifest.json")
		raw, err := os.ReadFile(manifestPath)
		if err != nil {
			continue
		}
		var stored StoredRender
		size, clusters, ok := validateStoredDir(filepath.Join(c.dir, name), raw, &stored)
		if !ok || stored.Key == "" || name != dirNameForKey(stored.Key) {
			continue
		}
		now := time.Now().Unix()
		c.seq++
		c.entries[stored.Key] = &cacheIndexEntry{
			Key: stored.Key, Dir: name, SizeBytes: size,
			Clusters: clusters, DurationMs: stored.Manifest.DurationMs,
			LastUsedUnix: now, StoredUnix: now, seq: c.seq,
		}
		adopted[name] = true
	}
	// Drop temp, partial, corrupt, and otherwise orphaned directories.
	// Names come from ReadDir, so removal remains contained in c.dir even
	// when an attacker or disk corruption supplied a hostile index.json.
	for _, d := range dirs {
		if d.IsDir() && !adopted[d.Name()] {
			_ = os.RemoveAll(filepath.Join(c.dir, d.Name()))
		}
	}
	c.evictLocked()
	return c.persistLocked()
}

func validateStoredDir(dir string, raw []byte, stored *StoredRender) (int64, int, bool) {
	if json.Unmarshal(raw, stored) != nil || stored.Manifest.CheckUnbound() != nil {
		return 0, 0, false
	}
	initInfo, err := os.Stat(filepath.Join(dir, "init.blob"))
	if err != nil || !initInfo.Mode().IsRegular() || initInfo.Size() != stored.Manifest.InitSizeBytes {
		return 0, 0, false
	}
	total := initInfo.Size() + int64(len(raw))
	for i, cluster := range stored.Manifest.Clusters {
		info, err := os.Stat(filepath.Join(dir, fmt.Sprintf("cluster-%06d.blob", i)))
		if err != nil || !info.Mode().IsRegular() || info.Size() != cluster.SizeBytes {
			return 0, 0, false
		}
		total += info.Size()
	}
	return total, len(stored.Manifest.Clusters), true
}

func dirNameForKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func validCacheDir(name string) bool {
	if len(name) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(name)
	return err == nil
}

// StoredRender is the on-disk manifest.json: the key plus the wire
// manifest with an empty generation (bound per delivery at send time).
type StoredRender struct {
	Key      string   `json:"key"`
	Manifest Manifest `json:"manifest"`
}

// Lookup returns the index entry for a key, if present. Callers pin the
// entry before reading bytes so eviction cannot race delivery.
func (c *Cache) Lookup(key RenderKey) (*cacheIndexEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key.String()]
	return e, ok
}

// EntryPath returns the directory holding one cached entry. Callers must
// hold a pin across reads.
func (c *Cache) EntryPath(key string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.entries[key]; ok {
		return filepath.Join(c.dir, e.Dir)
	}
	return ""
}

// Pin records one session's use of an entry. Sessions pin independently;
// the entry survives until every session unpins it (or the process ends).
func (c *Cache) Pin(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.entries[key]; !ok {
		return
	}
	c.pins[key]++
	c.entries[key].LastUsedUnix = time.Now().Unix()
	_ = c.persistLocked()
}

// Unpin releases one session's use. Unpinning an unknown key is a no-op.
func (c *Cache) Unpin(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pins[key] > 0 {
		c.pins[key]--
	}
	c.evictLocked()
	_ = c.persistLocked()
}

// Pinned reports the pin count (tests/diagnostics).
func (c *Cache) Pinned(key string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.pins[key]
}

// EntryCount reports indexed entries (tests/diagnostics).
func (c *Cache) EntryCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.entries)
}

// TotalBytes reports indexed bytes (tests/diagnostics).
func (c *Cache) TotalBytes() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	var total int64
	for _, e := range c.entries {
		total += e.SizeBytes
	}
	return total
}

// Publish atomically installs a completed render: init + clusters are
// written to a temp directory, fsynced, then renamed into place. The
// caller holds no pins; sessions pin on lookup.
func (c *Cache) Publish(key RenderKey, manifest Manifest, init []byte, clusters [][]byte) error {
	keyStr := key.String()
	if key.SourceRevision == "" || key.DecoderVersion == "" {
		return fmt.Errorf("media: incomplete render cache key")
	}
	if err := manifest.CheckUnbound(); err != nil {
		return err
	}
	if int64(len(init)) != manifest.InitSizeBytes || len(clusters) != len(manifest.Clusters) {
		return fmt.Errorf("media: render payload does not match manifest")
	}
	for i, payload := range clusters {
		if int64(len(payload)) != manifest.Clusters[i].SizeBytes {
			return fmt.Errorf("media: render cluster %d does not match manifest", i)
		}
	}
	tmp, err := os.MkdirTemp(c.dir, "tmp-")
	if err != nil {
		return fmt.Errorf("media: cache staging: %w", err)
	}
	defer func() { _ = os.RemoveAll(tmp) }()
	if err := os.WriteFile(filepath.Join(tmp, "init.blob"), init, 0o600); err != nil {
		return fmt.Errorf("media: cache staging: %w", err)
	}
	for i, payload := range clusters {
		name := fmt.Sprintf("cluster-%06d.blob", i)
		if err := os.WriteFile(filepath.Join(tmp, name), payload, 0o600); err != nil {
			return fmt.Errorf("media: cache staging: %w", err)
		}
	}
	raw, err := json.Marshal(StoredRender{Key: keyStr, Manifest: manifest})
	if err != nil {
		return fmt.Errorf("media: cache staging: %w", err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "manifest.json"), raw, 0o600); err != nil {
		return fmt.Errorf("media: cache staging: %w", err)
	}
	var size int64 = int64(len(init))
	for _, p := range clusters {
		size += int64(len(p))
	}
	size += int64(len(raw))
	final := filepath.Join(c.dir, key.DirName())
	entrySize := size
	entryClusters := len(clusters)
	entryDuration := manifest.DurationMs
	// A concurrent publisher may have won the race; either outcome leaves
	// exactly one complete entry.
	if err := os.Rename(tmp, final); err != nil {
		if _, statErr := os.Stat(final); statErr != nil {
			return fmt.Errorf("media: cache publish: %w", err)
		}
		existingRaw, readErr := os.ReadFile(filepath.Join(final, "manifest.json"))
		var existing StoredRender
		existingSize, existingClusters, valid := validateStoredDir(final, existingRaw, &existing)
		if readErr != nil || !valid || existing.Key != keyStr {
			return fmt.Errorf("media: cache publish collision is invalid")
		}
		entrySize = existingSize
		entryClusters = existingClusters
		entryDuration = existing.Manifest.DurationMs
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now().Unix()
	if _, ok := c.entries[keyStr]; !ok {
		c.seq++
		c.entries[keyStr] = &cacheIndexEntry{
			Key: keyStr, Dir: key.DirName(), SizeBytes: entrySize,
			Clusters: entryClusters, DurationMs: entryDuration,
			LastUsedUnix: now, StoredUnix: now, seq: c.seq,
		}
	}
	c.evictLocked()
	return c.persistLocked()
}

// ReadCluster loads one cluster payload. Callers must hold a pin.
func (c *Cache) ReadCluster(key string, index int) ([]byte, error) {
	c.mu.Lock()
	e, ok := c.entries[key]
	dir := c.dir
	c.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("media: render evicted before delivery")
	}
	return os.ReadFile(filepath.Join(dir, e.Dir, fmt.Sprintf("cluster-%06d.blob", index)))
}

// ReadInit loads the init segment. Callers must hold a pin.
func (c *Cache) ReadInit(key string) ([]byte, error) {
	c.mu.Lock()
	e, ok := c.entries[key]
	dir := c.dir
	c.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("media: render evicted before delivery")
	}
	return os.ReadFile(filepath.Join(dir, e.Dir, "init.blob"))
}

// StoredManifest returns the cached wire manifest. Callers must hold a pin.
func (c *Cache) StoredManifest(key string) (Manifest, error) {
	var m Manifest
	c.mu.Lock()
	e, ok := c.entries[key]
	dir := c.dir
	c.mu.Unlock()
	if !ok {
		return m, fmt.Errorf("media: render evicted before delivery")
	}
	raw, err := os.ReadFile(filepath.Join(dir, e.Dir, "manifest.json"))
	if err != nil {
		return m, err
	}
	var stored StoredRender
	if err := json.Unmarshal(raw, &stored); err != nil {
		return m, err
	}
	return stored.Manifest, nil
}

// evictLocked drops unpinned entries, oldest-first, until under the cap.
// Callers hold mu.
func (c *Cache) evictLocked() {
	var total int64
	for _, e := range c.entries {
		total += e.SizeBytes
	}
	if total <= c.maxByte {
		return
	}
	ordered := make([]*cacheIndexEntry, 0, len(c.entries))
	for _, e := range c.entries {
		ordered = append(ordered, e)
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].LastUsedUnix != ordered[j].LastUsedUnix {
			return ordered[i].LastUsedUnix < ordered[j].LastUsedUnix
		}
		return ordered[i].seq < ordered[j].seq
	})
	for _, e := range ordered {
		if total <= c.maxByte {
			break
		}
		if c.pins[e.Key] > 0 {
			continue
		}
		if err := os.RemoveAll(filepath.Join(c.dir, e.Dir)); err != nil {
			continue
		}
		total -= e.SizeBytes
		delete(c.entries, e.Key)
	}
}

const cacheIndexName = "index.json"

func (c *Cache) persistLocked() error {
	entries := make([]*cacheIndexEntry, 0, len(c.entries))
	for _, e := range c.entries {
		cpy := *e
		entries = append(entries, &cpy)
	}
	raw, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	tmp := filepath.Join(c.dir, "tmp-index.json")
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(c.dir, cacheIndexName))
}

func (c *Cache) readIndex() ([]*cacheIndexEntry, error) {
	raw, err := os.ReadFile(filepath.Join(c.dir, cacheIndexName))
	if err != nil {
		return nil, err
	}
	var entries []*cacheIndexEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}
