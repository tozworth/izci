package library

import (
	"fmt"
	"os"
	"syscall"
)

// FileKeyFor returns a stable file identity for reconciliation: device and
// inode on Unix, falling back to size/mtime when stat internals are
// unavailable. Renames preserve the key (same inode); replacements get a
// new key or a changed size/mtime, both of which trigger revision updates.
func FileKeyFor(absPath string, fi os.FileInfo) string {
	if fi == nil {
		return "unknown:" + absPath
	}
	if stat, ok := fi.Sys().(*syscall.Stat_t); ok {
		return fmt.Sprintf("%d:%d", stat.Dev, stat.Ino)
	}
	// Fallback for non-Unix: virtual-path-scoped size/mtime.
	return fmt.Sprintf("fallback:%d:%d", fi.Size(), fi.ModTime().UnixNano())
}
