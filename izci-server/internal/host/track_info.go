package host

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/tozworth/izci/izci-server/internal/library"
)

const maxTrackInfoProbeBytes = 128 * 1024

type boundedProbeOutput struct{ bytes.Buffer }

func (b *boundedProbeOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > maxTrackInfoProbeBytes {
		return 0, io.ErrShortWrite
	}
	return b.Buffer.Write(p)
}

func (h *Host) handleTrackInfoRequest(peer *Peer, trackID string) {
	track, ok := h.catalog.Get(trackID)
	if !ok || track == nil || track.FilesystemPath == "" {
		return
	}
	key := peer.ID + ":" + track.ID + ":" + track.SourceRevision
	h.trackInfoMu.Lock()
	if h.trackInfoPending[key] || len(h.trackInfoPending) >= 16 {
		h.trackInfoMu.Unlock()
		return
	}
	h.trackInfoPending[key] = true
	h.trackInfoMu.Unlock()
	go func() {
		defer func() {
			h.trackInfoMu.Lock()
			delete(h.trackInfoPending, key)
			h.trackInfoMu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		select {
		case h.trackInfoSlots <- struct{}{}:
			defer func() { <-h.trackInfoSlots }()
		case <-ctx.Done():
			return
		}
		info := readServerTrackInfo(ctx, track)
		h.peersMu.Lock()
		active := h.peers[peer.ID] == peer
		h.peersMu.Unlock()
		if active {
			h.sendToPeer(peer, TrackInfoMessage(info))
		}
	}()
}

func TrackInfoMessage(info map[string]any) string {
	return marshal(map[string]any{"kind": "track.info", "info": info})
}

func readServerTrackInfo(ctx context.Context, track *library.Track) map[string]any {
	metadata := map[string]any{}
	if track.Title != "" {
		metadata["title"] = track.Title
	}
	if track.Artist != "" {
		metadata["artist"] = track.Artist
	}
	if track.Album != "" {
		metadata["album"] = track.Album
	}
	var lyrics any
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration,bit_rate:format_tags:stream_tags", "-of", "json", track.FilesystemPath)
	var output boundedProbeOutput
	cmd.Stdout = &output
	cmd.Stderr = io.Discard
	if cmd.Run() == nil {
		metadata, lyrics = parseProbeTrackInfo(output.Bytes(), metadata)
	}
	return map[string]any{"trackId": track.ID, "metadata": metadata, "lyrics": lyrics}
}

func probeSourceDuration(ctx context.Context, path string) float64 {
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path)
	var output boundedProbeOutput
	cmd.Stdout = &output
	cmd.Stderr = io.Discard
	if cmd.Run() != nil {
		return 0
	}
	var result struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if json.Unmarshal(output.Bytes(), &result) != nil {
		return 0
	}
	seconds, err := strconv.ParseFloat(result.Format.Duration, 64)
	if err != nil || seconds <= 0 || seconds > 604800 {
		return 0
	}
	return seconds
}

func (h *Host) probeSessionSourceDuration(sess *Session, delivery Delivery, freeplay bool, peer *Peer) {
	if delivery.TrackID == nil {
		return
	}
	track, ok := h.catalog.Get(*delivery.TrackID)
	if !ok || track == nil || track.FilesystemPath == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		select {
		case h.trackInfoSlots <- struct{}{}:
			defer func() { <-h.trackInfoSlots }()
		case <-ctx.Done():
			return
		}
		seconds := probeSourceDuration(ctx, track.FilesystemPath)
		if !sess.SetDurationForGeneration(delivery.GenerationID, seconds) {
			return
		}
		if freeplay {
			if peer != nil {
				h.sendDeliveryPlayback(peer, true)
			}
		} else {
			h.broadcastSharedClock()
		}
	}()
}

func parseProbeTrackInfo(data []byte, metadata map[string]any) (map[string]any, any) {
	var result struct {
		Streams []struct {
			Tags map[string]string `json:"tags"`
		} `json:"streams"`
		Format struct {
			Duration string            `json:"duration"`
			Bitrate  string            `json:"bit_rate"`
			Tags     map[string]string `json:"tags"`
		} `json:"format"`
	}
	if json.Unmarshal(data, &result) != nil {
		return metadata, nil
	}
	if duration, err := strconv.ParseFloat(result.Format.Duration, 64); err == nil && duration > 0 && duration < 604800 {
		metadata["duration"] = duration
	}
	if bitrate, err := strconv.ParseFloat(result.Format.Bitrate, 64); err == nil && bitrate > 0 {
		metadata["bitrate"] = bitrate / 1000
	}
	fields := map[string]string{
		"TITLE": "title", "ARTIST": "artist", "ALBUM": "album", "ALBUMARTIST": "albumArtist",
		"ALBUM_ARTIST": "albumArtist", "ALBUM ARTIST": "albumArtist", "GENRE": "genre", "TRACKNUMBER": "trackNumber", "TRACK": "trackNumber",
		"DISCNUMBER": "discNumber", "DISC": "discNumber", "COMPOSER": "composer",
	}
	var lyrics any
	replayGain := map[string]any{}
	tags := make(map[string]string)
	for key, value := range result.Format.Tags {
		tags[key] = value
	}
	for _, stream := range result.Streams {
		for key, value := range stream.Tags {
			tags[key] = value
		}
	}
	for key, value := range tags {
		upper := strings.ToUpper(strings.TrimSpace(key))
		value = strings.TrimSpace(value)
		if field, ok := fields[upper]; ok && value != "" && len(value) <= 2048 {
			metadata[field] = value
		}
		if (upper == "DATE" || upper == "YEAR") && len(value) >= 4 {
			metadata["year"] = value[:4]
		}
		if (upper == "LYRICS" || upper == "UNSYNCEDLYRICS" || upper == "SYNCEDLYRICS" || upper == "SYNCED LYRICS") && value != "" && len(value) <= 64*1024 {
			lyrics = value
		}
		gainFields := map[string]string{"REPLAYGAIN_TRACK_GAIN": "trackGainDb", "REPLAYGAIN_ALBUM_GAIN": "albumGainDb", "REPLAYGAIN_TRACK_PEAK": "trackPeak", "REPLAYGAIN_ALBUM_PEAK": "albumPeak", "R128_TRACK_GAIN": "trackGainDb", "R128_ALBUM_GAIN": "albumGainDb"}
		if field, ok := gainFields[upper]; ok {
			plain := strings.TrimSpace(strings.TrimSuffix(strings.ToLower(value), "db"))
			if parsed, err := strconv.ParseFloat(plain, 64); err == nil {
				if strings.HasPrefix(upper, "R128_") {
					parsed /= 256
				}
				if (strings.HasSuffix(field, "GainDb") && parsed >= -60 && parsed <= 60) || (strings.HasSuffix(field, "Peak") && parsed > 0 && parsed <= 100) {
					replayGain[field] = parsed
				}
			}
		}
	}
	if len(replayGain) > 0 {
		metadata["replayGain"] = replayGain
	}
	metadata["embeddedMetadataLoaded"] = true
	return metadata, lyrics
}
