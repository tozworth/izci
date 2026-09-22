package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Artwork is the protocol rendition shape. It is rebuildable cache data and
// never belongs in catalog/SQLite records.
type Artwork struct {
	TrackID  string `json:"trackId"`
	AssetID  string `json:"assetId"`
	DataURL  string `json:"dataUrl"`
	MimeType string `json:"mimeType"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

type ArtworkCache struct {
	Dir      string
	MaxBytes int64
	Timeout  time.Duration
	mu       sync.Mutex
}

func (c *ArtworkCache) Extract(ctx context.Context, trackID, sourceRevision, sourcePath string) (*Artwork, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Timeout <= 0 {
		c.Timeout = 15 * time.Second
	}
	if c.MaxBytes <= 0 {
		c.MaxBytes = 128 * 1024 * 1024
	}
	if err := os.MkdirAll(c.Dir, 0o750); err != nil {
		return nil, err
	}
	key := sha256.Sum256([]byte(sourceRevision + "|artwork-v1"))
	path := filepath.Join(c.Dir, hex.EncodeToString(key[:])+".jpg")
	if _, err := os.Stat(path); err != nil {
		ffmpeg, lookErr := exec.LookPath("ffmpeg")
		if lookErr != nil {
			return nil, lookErr
		}
		runCtx, cancel := context.WithTimeout(ctx, c.Timeout)
		defer cancel()
		tmp := path + ".part"
		_ = os.Remove(tmp)
		cmd := exec.CommandContext(runCtx, ffmpeg, "-nostdin", "-v", "error", "-i", sourcePath, "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=1024:1024:force_original_aspect_ratio=decrease", "-q:v", "4", "-f", "image2", tmp)
		if output, err := cmd.CombinedOutput(); err != nil {
			_ = os.Remove(tmp)
			return nil, fmt.Errorf("artwork extraction failed: %s", truncateDiag(scrubPath(string(output), sourcePath, "source"), 2048))
		}
		info, err := os.Stat(tmp)
		if err != nil || info.Size() <= 0 || info.Size() > 6*1024*1024 {
			_ = os.Remove(tmp)
			return nil, fmt.Errorf("artwork rendition rejected")
		}
		if err := os.Rename(tmp, path); err != nil {
			_ = os.Remove(tmp)
			return nil, err
		}
		c.prune()
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	asset := sha256.Sum256(data)
	return &Artwork{TrackID: trackID, AssetID: hex.EncodeToString(asset[:]), DataURL: "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data), MimeType: "image/jpeg", Width: config.Width, Height: config.Height}, nil
}

func (c *ArtworkCache) prune() {
	entries, err := os.ReadDir(c.Dir)
	if err != nil {
		return
	}
	type item struct {
		path string
		size int64
		mod  time.Time
	}
	var items []item
	var total int64
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		total += info.Size()
		items = append(items, item{filepath.Join(c.Dir, entry.Name()), info.Size(), info.ModTime()})
	}
	if total <= c.MaxBytes {
		return
	}
	sort.Slice(items, func(i, j int) bool { return items[i].mod.Before(items[j].mod) })
	for _, item := range items {
		if total <= c.MaxBytes {
			break
		}
		if os.Remove(item.path) == nil {
			total -= item.size
		}
	}
}
