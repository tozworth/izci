package host

import (
	"encoding/json"
	"testing"
)

func TestPlaybackMessageReportsPositionAtSendTime(t *testing.T) {
	for _, tc := range []struct {
		name  string
		clock Clock
		want  float64
	}{
		{"playing", Clock{State: StatePlaying, PositionSeconds: 25, StartedAtMs: 1000, DurationSeconds: 100}, 29.5},
		{"after seek", Clock{State: StatePlaying, PositionSeconds: 42, StartedAtMs: 3000, DurationSeconds: 100}, 44.5},
		{"paused", Clock{State: StatePaused, PositionSeconds: 25, StartedAtMs: 1000, DurationSeconds: 100}, 25},
		{"future start", Clock{State: StatePlaying, PositionSeconds: 0, StartedAtMs: 6000, DurationSeconds: 100}, 0},
		{"duration bound", Clock{State: StatePlaying, PositionSeconds: 99, StartedAtMs: 1000, DurationSeconds: 100}, 100},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var message struct {
				Playback struct {
					Snapshot struct {
						CurrentTime float64 `json:"currentTime"`
					} `json:"snapshot"`
				} `json:"playback"`
			}
			if err := json.Unmarshal([]byte(PlaybackMessageWithTrack(tc.clock, nil, 5500)), &message); err != nil {
				t.Fatal(err)
			}
			if got := message.Playback.Snapshot.CurrentTime; got != tc.want {
				t.Fatalf("currentTime = %v, want %v", got, tc.want)
			}
		})
	}
}
