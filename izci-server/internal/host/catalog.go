package host

import (
	"sort"
	"sync"

	"github.com/dunsparce9/izci/izci-server/internal/library"
)

// Catalog is the host's in-memory view of the persistent library: queue,
// library, favorites, revision, and shuffle/repeat. It renders protocol
// TrackItems with virtual paths only; filesystem paths never reach the wire.
type Catalog struct {
	mu       sync.RWMutex
	tracks   map[string]*library.Track
	queue    []string
	revision int64
	maxPer   int
	maxTotal int
}

// NewCatalog builds an empty catalog with item bounds.
func NewCatalog(maxPer, maxTotal int) *Catalog {
	if maxPer < 1 {
		maxPer = 50000
	}
	if maxTotal < 1 {
		maxTotal = 100000
	}
	return &Catalog{tracks: make(map[string]*library.Track), maxPer: maxPer, maxTotal: maxTotal}
}

// Load replaces the in-memory snapshot from persisted tracks plus the
// persisted shared queue (filtered to existing tracks). When the persisted
// queue is empty but the library is not, it initializes the queue to library
// order so collection.activate/next/previous have a timeline.
func (c *Catalog) Load(tracks []*library.Track, persistedQueue []string, revision int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tracks = make(map[string]*library.Track, len(tracks))
	for _, t := range tracks {
		cpy := *t
		c.tracks[t.ID] = &cpy
	}
	byID := c.tracks
	var q []string
	for _, id := range persistedQueue {
		if _, ok := byID[id]; ok {
			q = append(q, id)
		}
	}
	if len(q) == 0 && len(tracks) > 0 {
		sorted := append([]*library.Track(nil), tracks...)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i].VirtualPath < sorted[j].VirtualPath })
		for _, t := range sorted {
			q = append(q, t.ID)
		}
	}
	c.queue = q
	c.revision = revision
}

// SetRevision updates the catalog revision (bumped on scans and mutations).
func (c *Catalog) SetRevision(n int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.revision = n
}

// Revision returns the current revision.
func (c *Catalog) Revision() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.revision
}

// Get returns one track by ID.
func (c *Catalog) Get(id string) (*library.Track, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	t, ok := c.tracks[id]
	if !ok {
		return nil, false
	}
	cpy := *t
	return &cpy, true
}

// QueueIDs returns a copy of the shared queue order.
func (c *Catalog) QueueIDs() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return append([]string(nil), c.queue...)
}

// SetQueue replaces the shared queue order (filtered to existing tracks).
func (c *Catalog) SetQueue(ids []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var q []string
	for _, id := range ids {
		if _, ok := c.tracks[id]; ok {
			q = append(q, id)
		}
	}
	c.queue = q
}

// Snapshot renders queue/library/favorites TrackItems with limits applied
// before encoding. Queue preserves persisted order; library sorts by virtual
// path; favorites filter Favorite tracks sorted by virtual path.
func (c *Catalog) Snapshot() (queue, lib, favs []map[string]any) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	maxPer := c.maxPer
	maxTotal := c.maxTotal

	var qItems []map[string]any
	for _, id := range c.queue {
		if t, ok := c.tracks[id]; ok {
			qItems = append(qItems, t.TrackItemJSON())
		}
		if len(qItems) >= maxPer {
			break
		}
	}
	var all []*library.Track
	for _, t := range c.tracks {
		all = append(all, t)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].VirtualPath < all[j].VirtualPath })
	var lItems []map[string]any
	for _, t := range all {
		lItems = append(lItems, t.TrackItemJSON())
		if len(lItems) >= maxPer {
			break
		}
	}
	var fItems []map[string]any
	for _, t := range all {
		if t.Favorite {
			fItems = append(fItems, t.TrackItemJSON())
			if len(fItems) >= maxPer {
				break
			}
		}
	}
	// Total cap: preserve queue first, then favorites, then library.
	total := len(qItems) + len(lItems) + len(fItems)
	if total > maxTotal {
		over := total - maxTotal
		// Trim library first.
		if over > 0 && len(lItems) > 0 {
			cut := min(over, len(lItems))
			lItems = lItems[:len(lItems)-cut]
			over -= cut
		}
		if over > 0 && len(fItems) > 0 {
			cut := min(over, len(fItems))
			fItems = fItems[:len(fItems)-cut]
			over -= cut
		}
		if over > 0 && len(qItems) > 0 {
			cut := min(over, len(qItems))
			qItems = qItems[:len(qItems)-cut]
		}
	}
	return qItems, lItems, fItems
}

// HasInCollection reports whether id exists in the named collection.
func (c *Catalog) HasInCollection(collection, id string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	t, ok := c.tracks[id]
	if !ok {
		return false
	}
	switch collection {
	case "queue":
		for _, qid := range c.queue {
			if qid == id {
				return true
			}
		}
		return false
	case "library":
		return true
	case "favorites":
		return t.Favorite
	default:
		return false
	}
}

// HasTrack reports existence regardless of collection.
func (c *Catalog) HasTrack(id string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, ok := c.tracks[id]
	return ok
}

// Count returns the number of tracks.
func (c *Catalog) Count() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.tracks)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
