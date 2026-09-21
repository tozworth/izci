// Package library owns the dedicated host's persistent music catalog:
// named filesystem roots, virtual mounts, scanning with stable IDs,
// metadata, and virtual-path containment.
//
// Catalog records expose only virtual paths (e.g. "/music/song.mp3");
// absolute filesystem paths are never published over Multiplayer.
package library

import (
	"path"
	"strings"
)

// Track kinds mirror src/lib/types.ts TrackKind.
const (
	KindStream = "stream"
	KindModule = "module"
	KindVideo  = "video"
	KindImage  = "image"
)

var streamExtensions = map[string]bool{
	"mp3": true, "wav": true, "flac": true, "ogg": true, "opus": true,
}

var videoExtensions = map[string]bool{
	"mp4": true, "m4v": true, "mov": true, "webm": true, "mkv": true,
}

var imageExtensions = map[string]bool{
	"jpg": true, "jpeg": true, "png": true, "webp": true, "avif": true,
}

var hivelyExtensions = map[string]bool{"ahx": true, "hvl": true}

var moduleExtensions = map[string]bool{
	"ahx": true, "hvl": true,
	"mptm": true, "mod": true, "s3m": true, "xm": true, "it": true,
	"667": true, "669": true, "amf": true, "ams": true, "c67": true,
	"cba": true, "dbm": true, "digi": true, "dmf": true, "dsm": true,
	"dsym": true, "dtm": true, "etx": true, "far": true, "fc": true,
	"fc13": true, "fc14": true, "fmt": true, "fst": true, "ftm": true,
	"imf": true, "ims": true, "ice": true, "j2b": true, "m15": true,
	"mdl": true, "med": true, "mms": true, "mt2": true, "mtm": true,
	"mus": true, "nst": true, "okt": true, "plm": true, "psm": true,
	"pt36": true, "ptm": true, "puma": true, "rtm": true, "sfx": true,
	"sfx2": true, "smod": true, "st26": true, "stk": true, "stm": true,
	"stx": true, "stp": true, "symmod": true, "tcb": true, "gmc": true,
	"gtk": true, "gt2": true, "ult": true, "unic": true, "wow": true,
	"xmf": true, "gdm": true, "mo3": true, "oxm": true, "umx": true,
	"xpk": true, "ppm": true, "mmcmp": true,
}

// InferExtension returns the lower-cased extension without the dot.
func InferExtension(fileName string) string {
	base := path.Base(fileName)
	idx := strings.LastIndex(base, ".")
	if idx < 0 || idx == len(base)-1 {
		return ""
	}
	return strings.ToLower(base[idx+1:])
}

// InferKind maps an extension to a TrackKind, mirroring
// src/lib/utils/files.ts inferKind. Unknown extensions return "".
func InferKind(extension string) string {
	ext := strings.ToLower(extension)
	if streamExtensions[ext] {
		return KindStream
	}
	if moduleExtensions[ext] {
		return KindModule
	}
	if videoExtensions[ext] {
		return KindVideo
	}
	if imageExtensions[ext] {
		return KindImage
	}
	return ""
}

// IsHively reports whether an extension uses the built-in Hively replayer.
func IsHively(extension string) bool {
	return hivelyExtensions[strings.ToLower(extension)]
}

// IsPlayable reports whether a kind participates in source-file delivery.
// Images are catalog-only (delivery none); streams, modules, and videos
// transfer as source files in Phase 2.
func IsPlayable(kind string) bool {
	return kind == KindStream || kind == KindModule || kind == KindVideo
}
