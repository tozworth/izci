package host

import "testing"

func TestParseProbeTrackInfoReadsStreamTagsAndReplayGain(t *testing.T) {
	probe := []byte(`{"streams":[{"tags":{"TITLE":"Tagged title","ARTIST":"Tagged artist","ALBUM":"Album","LYRICS":"[00:01.00]Line one\n[00:02.00]Line two","REPLAYGAIN_TRACK_GAIN":"-6.25 dB","REPLAYGAIN_TRACK_PEAK":"0.95"}}],"format":{"duration":"155.4","bit_rate":"282000"}}`)
	metadata, lyrics := parseProbeTrackInfo(probe, map[string]any{"title": "Filename title"})
	if metadata["title"] != "Tagged title" || metadata["artist"] != "Tagged artist" || metadata["album"] != "Album" {
		t.Fatalf("stream tags not applied: %#v", metadata)
	}
	if metadata["duration"] != 155.4 || metadata["bitrate"] != 282.0 {
		t.Fatalf("format facts not applied: %#v", metadata)
	}
	if lyrics != "[00:01.00]Line one\n[00:02.00]Line two" {
		t.Fatal("embedded lyrics not applied")
	}
	gain, ok := metadata["replayGain"].(map[string]any)
	if !ok || gain["trackGainDb"] != -6.25 || gain["trackPeak"] != 0.95 {
		t.Fatalf("ReplayGain not applied: %#v", metadata["replayGain"])
	}
}
