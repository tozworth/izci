package library

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Track is one catalog record. ID is an opaque stable identifier persisted
// separately from the virtual display path so rescans and reasonable renames
// preserve favorites, queue membership, and play counts. Absolute filesystem
// paths are never stored here for wire use; FilesystemPath stays server-local
// for transfers and is never encoded into protocol messages.
type Track struct {
	ID             string
	VirtualPath    string // e.g. "/music/rock/song.mp3"
	Name           string // file base name
	Extension      string
	Kind           string
	Size           int64
	MtimeNs        int64
	FileKey        string // stable file identity (dev:ino) plus fallback
	SourceRevision string // "1:<size>:<mtimeNs>:<subsong>:<quickhash>"
	FilesystemPath string // server-local absolute path, never on the wire
	Title          string
	Artist         string
	Album          string
	Subsong        *int
	Favorite       bool
	PlayCount      int
	LastPlayed     *int64
}

// TrackItemJSON renders the protocol TrackItem shape (see
// docs/izci-server-protocol.md §4.2 and multiplayer-protocol.ts
// sanitizeTrackItem). Path is the virtual path; filesystem paths never leak.
func (t *Track) TrackItemJSON() map[string]any {
	item := map[string]any{
		"id":           t.ID,
		"name":         t.Name,
		"extension":    t.Extension,
		"kind":         t.Kind,
		"size":         t.Size,
		"lastModified": t.MtimeNs / 1_000_000,
		"path":         t.VirtualPath,
	}
	meta := map[string]any{}
	if t.Title != "" {
		meta["title"] = t.Title
	}
	if t.Artist != "" {
		meta["artist"] = t.Artist
	}
	if t.Album != "" {
		meta["album"] = t.Album
	}
	if len(meta) > 0 {
		item["metadata"] = meta
	}
	if t.Subsong != nil {
		item["subsong"] = *t.Subsong
	}
	if t.PlayCount > 0 {
		if item["metadata"] == nil {
			item["metadata"] = map[string]any{}
		}
		item["metadata"].(map[string]any)["playCount"] = t.PlayCount
	}
	if t.LastPlayed != nil {
		if item["metadata"] == nil {
			item["metadata"] = map[string]any{}
		}
		item["metadata"].(map[string]any)["lastPlayed"] = *t.LastPlayed
	}
	return item
}

// BuildSourceRevision composes a stable revision from file facts plus quick
// content evidence (first bytes hash). Subsong is part of the key so
// separated module subsongs do not share cache entries in later phases.
func BuildSourceRevision(size int64, mtimeNs int64, subsong int, quickHash string) string {
	if quickHash == "" {
		quickHash = "nohash"
	}
	if len(quickHash) > 32 {
		quickHash = quickHash[:32]
	}
	rev := fmt.Sprintf("1:%d:%d:%d:%s", size, mtimeNs, subsong, quickHash)
	if len(rev) > 120 {
		rev = rev[:120]
	}
	return rev
}

// QuickContentHash samples the first 64KiB for scan-time content evidence
// without reading entire large files. Missing/unreadable files yield "".
func QuickContentHash(absPath string) string {
	f, err := os.Open(absPath)
	if err != nil {
		return ""
	}
	defer f.Close()
	buf := make([]byte, 64*1024)
	n, _ := f.Read(buf)
	if n <= 0 {
		// Empty files still get a deterministic hash of their size marker.
		sum := sha256.Sum256([]byte("empty"))
		return hex.EncodeToString(sum[:])[:16]
	}
	sum := sha256.Sum256(buf[:n])
	return hex.EncodeToString(sum[:])[:16]
}

// InferTitleArtist mirrors the browser's filename inference
// (inferArtistTitleFromFileName): "Artist - Title.ext" splits, otherwise the
// stem is the title.
func InferTitleArtist(fileName string) (title, artist string) {
	stem := fileName
	if idx := strings.LastIndex(stem, "."); idx >= 0 {
		stem = stem[:idx]
	}
	stem = strings.TrimSpace(stem)
	if idx := strings.Index(stem, " - "); idx > 0 && idx < len(stem)-3 {
		artist = strings.TrimSpace(stem[:idx])
		title = strings.TrimSpace(stem[idx+3:])
		if artist != "" && title != "" {
			return title, artist
		}
	}
	return stem, ""
}

// VirtualPathFor maps a server-local absolute path under rootPath to a
// virtual path under mount ("/music"). It resolves symlinks and rejects
// files whose resolved locations escape the configured root.
func VirtualPathFor(mount, rootPath, absPath string) (string, error) {
	resolvedRoot, err := filepath.EvalSymlinks(rootPath)
	if err != nil {
		// Root itself may not exist yet (empty library dir); fall back to
		// absolute cleaning so scans report a clear error elsewhere.
		resolvedRoot, _ = filepath.Abs(rootPath)
	}
	resolvedFile, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		// Dangling symlink or race: resolve as far as possible.
		if abs, absErr := filepath.Abs(absPath); absErr == nil {
			resolvedFile = abs
		} else {
			return "", fmt.Errorf("library: cannot resolve %q", absPath)
		}
	}
	// Containment is checked against resolved paths, but the virtual path is
	// derived from the lexical in-root name. Thus an allowed in-root symlink
	// keeps its configured alias while its server-only source path can be
	// pinned to the resolved target.
	resolvedRel, err := filepath.Rel(resolvedRoot, resolvedFile)
	if err != nil || resolvedRel == ".." || strings.HasPrefix(resolvedRel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("library: path escapes root")
	}
	lexicalRoot, err := filepath.Abs(rootPath)
	if err != nil {
		return "", fmt.Errorf("library: cannot resolve root")
	}
	lexicalFile, err := filepath.Abs(absPath)
	if err != nil {
		return "", fmt.Errorf("library: cannot resolve path")
	}
	rel, err := filepath.Rel(lexicalRoot, lexicalFile)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("library: path escapes root")
	}
	if rel == "." {
		return "", fmt.Errorf("library: path is the root itself")
	}
	slashRel := filepath.ToSlash(rel)
	mount = "/" + strings.Trim(mount, "/")
	virtual := path.Join(mount, slashRel)
	if !strings.HasPrefix(virtual, mount) {
		return "", fmt.Errorf("library: virtual path escapes mount")
	}
	return virtual, nil
}

// VirtualMountsOverlap reports whether two virtual mounts are ambiguous
// (equal or one prefixes the other).
func VirtualMountsOverlap(a, b string) bool {
	na := "/" + strings.Trim(a, "/")
	nb := "/" + strings.Trim(b, "/")
	if na == nb {
		return true
	}
	return strings.HasPrefix(na+"/", nb+"/") || strings.HasPrefix(nb+"/", na+"/")
}
