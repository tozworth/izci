//go:build !windows

package library

import (
	"fmt"
	"os"
	"syscall"
)

func platformFileKey(_ string, fi os.FileInfo) string {
	if stat, ok := fi.Sys().(*syscall.Stat_t); ok {
		return fmt.Sprintf("%d:%d", stat.Dev, stat.Ino)
	}
	return ""
}
