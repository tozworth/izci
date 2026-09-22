package media

import (
	"encoding/binary"
	"fmt"
	"math"
)

// Minimal Matroska/WebM structural parser: splits an encoded WebM stream
// into a MediaSource init segment plus timestamped clusters. It only walks
// top-level Segment children (SeekHead/Info/Tracks/Cluster...) and reads
// Cluster Timecode, staying unaware of codec payloads — a direct port of
// src/lib/services/multiplayer-webm.ts so server and browser splits agree.

const (
	ebmlID          = 0x1a45dfa3
	segmentID       = 0x18538067
	seekHeadID      = 0x114d9b74
	infoID          = 0x1549a966
	tracksID        = 0x1654ae6b
	clusterID       = 0x1f43b675
	timecodeID      = 0xe7
	durationID      = 0x4489
	timecodeScaleID = 0x2ad7b1
	defaultScale    = 1000000
)

type ebmlElement struct {
	id     uint64
	start  int // byte offset of element data
	end    int // byte offset just past the element
	header int // id+size header length
	size   int64
	sized  bool
}

func readVintID(b []byte, off int) (uint64, int, bool) {
	if off >= len(b) || b[off] == 0 {
		return 0, 0, false
	}
	length := 1
	for mask := byte(0x80); mask > 0 && b[off]&mask == 0; mask >>= 1 {
		length++
	}
	if length > 4 || off+length > len(b) {
		return 0, 0, false
	}
	var id uint64
	for i := 0; i < length; i++ {
		id = (id << 8) | uint64(b[off+i])
	}
	return id, length, true
}

func readVintSize(b []byte, off int) (int64, int, bool) {
	if off >= len(b) {
		return 0, 0, false
	}
	length := 1
	for mask := byte(0x80); mask > 0 && b[off]&mask == 0; mask >>= 1 {
		length++
	}
	if length > 8 || off+length > len(b) {
		return 0, 0, false
	}
	first := b[off]
	value := int64(first & (0xff >> length))
	for i := 1; i < length; i++ {
		value = (value << 8) | int64(b[off+i])
	}
	unknown := value == int64((uint64(1)<<(7*uint(length)))-1)
	if unknown {
		return -1, length, true
	}
	return value, length, true
}

func readElement(b []byte, off int) (ebmlElement, int, bool) {
	var el ebmlElement
	id, idLen, ok := readVintID(b, off)
	if !ok {
		return el, 0, false
	}
	size, sizeLen, ok := readVintSize(b, off+idLen)
	if !ok {
		return el, 0, false
	}
	el.id = id
	el.header = idLen + sizeLen
	el.start = off + el.header
	if size < 0 {
		el.end = len(b)
		el.sized = false
	} else {
		el.size = size
		el.sized = true
		el.end = el.start + int(size)
	}
	if el.end > len(b) {
		return el, 0, false
	}
	return el, el.end, true
}

func readEBMLUint(b []byte, start, end int) (uint64, bool) {
	if length := end - start; length < 1 || length > 8 {
		return 0, false
	}
	var v uint64
	for i := start; i < end; i++ {
		v = (v << 8) | uint64(b[i])
	}
	return v, true
}

func readEBMLFloat(b []byte, start, end int) (float64, bool) {
	switch end - start {
	case 4:
		return float64(math.Float32frombits(binary.BigEndian.Uint32(b[start:end]))), true
	case 8:
		return math.Float64frombits(binary.BigEndian.Uint64(b[start:end])), true
	}
	return 0, false
}

func readClusterTimecode(b []byte, start, end int) (uint64, bool) {
	off := start
	for off+1 < end {
		el, next, ok := readElement(b, off)
		if !ok || el.end > end {
			return 0, false
		}
		if el.id == timecodeID {
			v, ok := readEBMLUint(b, el.start, el.end)
			if !ok {
				return 0, false
			}
			return v, true
		}
		// SimpleBlock / BlockGroup appear after Timecode; stop looking.
		if el.id == 0xa3 || el.id == 0xa0 {
			return 0, false
		}
		off = next
	}
	return 0, false
}

func readInfoDuration(b []byte, start, end int) float64 {
	scale := uint64(defaultScale)
	duration := 0.0
	off := start
	for off+1 < end {
		el, next, ok := readElement(b, off)
		if !ok || el.end > end {
			break
		}
		switch el.id {
		case timecodeScaleID:
			if v, ok := readEBMLUint(b, el.start, el.end); ok && v > 0 {
				scale = v
			}
		case durationID:
			if v, ok := readEBMLFloat(b, el.start, el.end); ok {
				duration = v
			}
		}
		off = next
	}
	if scale == 0 {
		return 0
	}
	return duration * float64(scale) / 1000000
}

// SplitWebM divides an encoded WebM stream into init segment and clusters.
// It returns an error when the stream is structurally unreadable or holds
// no audio clusters.
func SplitWebM(webm []byte, bitrateKbps int) (Split, error) {
	var out Split
	ebml, off, ok := readElement(webm, 0)
	if !ok || ebml.id != ebmlID {
		return out, fmt.Errorf("media: webm has no EBML header")
	}
	segment, _, ok := readElement(webm, off)
	if !ok || segment.id != segmentID {
		return out, fmt.Errorf("media: webm has no Segment")
	}
	segEnd := len(webm)
	if segment.sized {
		if end := segment.start + int(segment.size); end < segEnd {
			segEnd = end
		}
	}
	type child struct {
		id    uint64
		start int
		end   int
	}
	var children []child
	for o := segment.start; o+1 < segEnd; {
		el, next, ok := readElement(webm, o)
		if !ok || el.end > segEnd {
			break
		}
		children = append(children, child{id: el.id, start: o, end: el.end})
		o = next
		if o >= segEnd {
			break
		}
	}
	firstCluster := -1
	for i, c := range children {
		if c.id == clusterID {
			firstCluster = i
			break
		}
	}
	if firstCluster < 0 {
		return out, fmt.Errorf("media: webm produced no audio clusters")
	}
	initEnd := segment.start
	for _, c := range children[:firstCluster] {
		if c.end > initEnd {
			initEnd = c.end
		}
	}
	for _, c := range children {
		if c.id != infoID {
			continue
		}
		// Re-parse Info children for duration.
		infoEl, _, ok := readElement(webm, c.start)
		if !ok {
			break
		}
		out.DurationMs = readInfoDuration(webm, infoEl.start, infoEl.end)
		break
	}
	var estimated uint64
	index := 0
	for _, c := range children {
		if c.id != clusterID {
			continue
		}
		clEl, _, ok := readElement(webm, c.start)
		if !ok {
			break
		}
		timeMs, ok := readClusterTimecode(webm, clEl.start, clEl.end)
		if !ok {
			timeMs = estimated
		}
		estimated = timeMs + 1
		payload := append([]byte(nil), webm[c.start:c.end]...)
		out.Clusters = append(out.Clusters, Cluster{Index: index, TimeMs: float64(timeMs), Payload: payload})
		index++
	}
	if len(out.Clusters) == 0 {
		return out, fmt.Errorf("media: webm produced no audio clusters")
	}
	out.Init = append([]byte(nil), webm[:initEnd]...)
	out.BitrateKbps = bitrateKbps
	// ClusterDurationMs reports observed spacing (encoder target is ~1s);
	// per-cluster timeMs in the manifest table is authoritative.
	out.ClusterMs = RenderClusterMs
	if len(out.Clusters) >= 2 {
		if gap := out.Clusters[1].TimeMs - out.Clusters[0].TimeMs; gap > 0 {
			out.ClusterMs = gap
		}
	}
	if out.DurationMs <= 0 {
		last := out.Clusters[len(out.Clusters)-1]
		out.DurationMs = last.TimeMs + RenderClusterMs
	}
	return out, nil
}
