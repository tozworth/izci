package library

import (
	"fmt"
	"os"
)

// FileKeyFor returns a stable file identity for reconciliation: device and
// inode on Unix, falling back to size/mtime when stat internals are
// unavailable. Renames preserve the key (same inode); replacements get a
// new key or a changed size/mtime, both of which trigger revision updates.
func FileKeyFor(absPath string, fi os.FileInfo) string {
	if fi == nil {
		return "unknown:" + absPath
	}
	if key := platformFileKey(absPath, fi); key != "" {
		return key
	}
	// Include the path so distinct files with equal size and mtime cannot
	// accidentally reconcile as a rename when platform identity is unavailable.
	return fmt.Sprintf("fallback:%s:%d:%d", absPath, fi.Size(), fi.ModTime().UnixNano())
}
