package media

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Source transfer framing over izci-media (ordered/reliable), mirroring
// src/lib/services/multiplayer-source-transfer.ts:
//
//	file.begin {transferId, trackId, generationId, name, type, size, lastModified}
//	zero or more raw 16KiB ArrayBuffer chunks (no framing)
//	file.end {transferId}
//
// Bounds: small bounded chunks (16KiB), per-peer backpressure (queue limit
// 1MiB, sender waits ~10ms when over limit, flush while bufferedAmount
// <512KiB), cancellation tokens (context), and retry behavior (the client
// sends source.retry ≤2/generation; the server re-transfers the same
// generation with a fresh transferId, never appending to stale bytes).
// The server never loads a complete file into memory merely to transfer it.
const (
	SourceChunkSize  = 16 * 1024
	SourceQueueLimit = 1024 * 1024
	SourceFlushUnder = 512 * 1024
	sourceWaitMs     = 10
)

// Channel is the minimal izci-media surface: text frames for begin/end,
// binary frames for chunks, plus backpressure visibility.
type Channel interface {
	SendText(text string) error
	SendBinary(data []byte) error
	BufferedAmount() uint64
}

// FileFacts snapshots the source at transfer start for replacement
// detection. Size/Mtime/FileKey come from the catalog/scan; Revision is
// the catalog source revision.
type FileFacts struct {
	Size     int64
	MtimeNs  int64
	FileKey  string
	Revision string
}

// ErrReplaced reports that the source file was replaced during an active
// transfer. Callers must cancel the stale generation rather than mixing
// bytes (send playback.cancel / start a new generation on retry).
type ErrReplaced struct{ Msg string }

func (e *ErrReplaced) Error() string { return e.Msg }

// MimeFor maps an extension to a client File type hint.
func MimeFor(extension string) string {
	switch extension {
	case "mp3":
		return "audio/mpeg"
	case "wav":
		return "audio/wav"
	case "flac":
		return "audio/flac"
	case "ogg", "opus":
		return "audio/ogg"
	case "mod", "xm", "s3m", "it", "mo3":
		return "audio/mod"
	case "ahx", "hvl":
		return "audio/x-hively"
	case "mp4", "m4v":
		return "video/mp4"
	case "mov":
		return "video/quicktime"
	case "webm":
		return "video/webm"
	case "mkv":
		return "video/x-matroska"
	default:
		return "application/octet-stream"
	}
}

func newTransferID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("transfer-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(raw[:])
}

func marshal(v any) string {
	raw, _ := json.Marshal(v)
	return string(raw)
}

// TransferFile streams one file over ch with begin/chunk/end framing.
// It opens the file once and streams 16KiB slices without ever holding the
// whole file in memory. Replacement of the path during transfer (size,
// mtime, or file-key change) aborts with *ErrReplaced. Context cancellation
// (new generation, disconnect, retry supersede) aborts silently with ctx.Err.
func TransferFile(ctx context.Context, ch Channel, absPath string, facts FileFacts, trackID, generationID, name, mimeType string, lastModifiedMs int64) (string, error) {
	transferID := newTransferID()
	// Open after statting the path: the FD pins the pre-replacement inode
	// on Unix while path stats detect the replacement.
	pathInfo, err := os.Stat(absPath)
	if err != nil {
		return transferID, fmt.Errorf("media: stat: %w", err)
	}
	if pathInfo.IsDir() {
		return transferID, fmt.Errorf("media: not a file")
	}
	// Never serve bytes under a stale catalog generation. Size and mtime are
	// part of SourceRevision; accepting changed facts here would associate a
	// new file with the old generation and TrackItem metadata.
	if pathInfo.Size() != facts.Size {
		return transferID, &ErrReplaced{Msg: "media: source size changed since scan"}
	}
	if facts.MtimeNs != 0 && pathInfo.ModTime().UnixNano() != facts.MtimeNs {
		return transferID, &ErrReplaced{Msg: "media: source modification time changed since scan"}
	}
	f, err := os.Open(absPath)
	if err != nil {
		return transferID, err
	}
	defer f.Close()
	fdInfo, err := f.Stat()
	if err != nil {
		return transferID, err
	}
	liveSize := fdInfo.Size()
	size := liveSize
	if facts.Size != 0 {
		size = facts.Size
		if size != liveSize {
			size = liveSize
		}
	}
	begin := map[string]any{
		"kind": "file.begin", "transferId": transferID,
		"trackId": trackID, "generationId": generationID,
		"name": name, "type": mimeType,
		"size": size, "lastModified": lastModifiedMs,
	}
	if err := ch.SendText(marshal(begin)); err != nil {
		return transferID, err
	}
	buf := make([]byte, SourceChunkSize)
	var sent int64
	// Stat the path (not the FD) every chunk to detect replacement: on
	// Unix the open FD still reads old bytes after a rename/replace, so
	// mixing would be silent without this check.
	for sent < size {
		select {
		case <-ctx.Done():
			return transferID, ctx.Err()
		default:
		}
		if err := waitForQueue(ctx, ch); err != nil {
			return transferID, err
		}
		// Replacement check before each chunk.
		if pi, statErr := os.Stat(absPath); statErr != nil {
			return transferID, &ErrReplaced{Msg: "media: source disappeared during transfer"}
		} else if !os.SameFile(fdInfo, pi) {
			return transferID, &ErrReplaced{Msg: "media: source replaced during transfer"}
		} else if facts.MtimeNs != 0 && pi.ModTime().UnixNano() != facts.MtimeNs {
			// Same-size in-place writes can otherwise mix old and new bytes.
			return transferID, &ErrReplaced{Msg: "media: source replaced during transfer"}
		} else if pi.Size() != liveSize {
			return transferID, &ErrReplaced{Msg: "media: source replaced during transfer"}
		}
		want := SourceChunkSize
		if remaining := size - sent; remaining < int64(want) {
			want = int(remaining)
		}
		n, readErr := f.Read(buf[:want])
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			if err := ch.SendBinary(chunk); err != nil {
				return transferID, err
			}
			sent += int64(n)
		}
		if readErr != nil {
			if sent == size {
				break
			}
			return transferID, fmt.Errorf("media: read: %w", readErr)
		}
		if n == 0 {
			break
		}
	}
	if sent != size {
		return transferID, fmt.Errorf("media: short transfer %d/%d", sent, size)
	}
	end := map[string]any{"kind": "file.end", "transferId": transferID}
	if err := ch.SendText(marshal(end)); err != nil {
		return transferID, err
	}
	return transferID, nil
}

func waitForQueue(ctx context.Context, ch Channel) error {
	for ch.BufferedAmount() >= SourceFlushUnder {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(sourceWaitMs * time.Millisecond):
		}
	}
	return nil
}
