package host

import (
	"fmt"
	"slices"
	"testing"
)

func TestShuffleNavigationUsesRandomizedOrderWithoutReversingVisibleQueue(t *testing.T) {
	s := NewSession(SessionConfig{ID: "shuffle", Kind: SessionShared})
	ids := make([]string, 20)
	for i := range ids {
		ids[i] = fmt.Sprintf("track-%02d", i)
	}
	s.SetQueue(ids)
	s.Activate(ids[5])
	if !s.ToggleShuffle() {
		t.Fatal("shuffle did not enable")
	}
	order := append([]string(nil), s.shuffleOrder...)
	if len(order) != len(ids) || order[0] != ids[5] {
		t.Fatalf("shuffle order must start at current track: %v", order)
	}
	sorted := append([]string(nil), order...)
	slices.Sort(sorted)
	if !slices.Equal(sorted, ids) {
		t.Fatalf("shuffle order is not a permutation of queue: %v", order)
	}
	for i := 1; i < len(order); i++ {
		s.Next()
		if current := s.CurrentTrackID(); current == nil || *current != order[i] {
			t.Fatalf("next at %d = %v, want %s", i, current, order[i])
		}
	}
	s.Previous()
	if current := s.CurrentTrackID(); current == nil || *current != order[len(order)-2] {
		t.Fatalf("previous did not retrace shuffled order: %v", current)
	}
	// A library refresh with identical queue IDs must not reorder playback.
	s.SetQueue(ids)
	if !slices.Equal(s.shuffleOrder, order) {
		t.Fatal("unchanged queue reshuffled")
	}
	if s.ToggleShuffle() {
		t.Fatal("shuffle did not disable")
	}
	s.Activate(ids[5])
	s.Next()
	if current := s.CurrentTrackID(); current == nil || *current != ids[6] {
		t.Fatalf("next with shuffle off did not follow visible queue: %v", current)
	}
}

func TestTimedOutTrackUsesCurrentGenerationAndHostClock(t *testing.T) {
	now := int64(0)
	s := NewSession(SessionConfig{ID: "ended", Kind: SessionShared, NowMs: func() int64 { return now }})
	s.SetQueue([]string{"a", "b"})
	s.Subscribe("listener")
	_, delivery, _ := s.Activate("a")
	if s.SetDurationForGeneration("stale", 2) || !s.SetDurationForGeneration(delivery.GenerationID, 2) {
		t.Fatal("duration probe generation check failed")
	}
	s.HandleReady("listener", delivery.GenerationID)
	if _, _, done := s.TimedOutTrack(3249); done {
		t.Fatal("track ended before duration and grace")
	}
	if generation, track, done := s.TimedOutTrack(3250); !done || generation != delivery.GenerationID || track != "a" {
		t.Fatalf("timed out track = %q %q %v", generation, track, done)
	}
	now = 2000
	s.Seek(0)
	if _, _, done := s.TimedOutTrack(3250); done {
		t.Fatal("seek did not move timeout anchor")
	}
	s.Next()
	if s.SetDurationForGeneration(delivery.GenerationID, 2) {
		t.Fatal("stale probe changed replacement duration")
	}
}

func TestSharedQueueMoveNextIsVisibleAndNavigable(t *testing.T) {
	s := NewSession(SessionConfig{ID: "queue", Kind: SessionShared})
	s.SetQueue([]string{"a", "b", "c"})
	s.Activate("a")
	s.MoveNext([]string{"c", "d"})
	if got := s.Queue(); !slices.Equal(got, []string{"a", "c", "d", "b"}) {
		t.Fatalf("queue order = %v", got)
	}
	s.Next()
	if current := s.CurrentTrackID(); current == nil || *current != "c" {
		t.Fatalf("next did not follow visible queue: %v", current)
	}
	s.SetQueue([]string{"b", "d"}) // remove the playing track
	s.Next()
	if current := s.CurrentTrackID(); current == nil || *current != "b" {
		t.Fatalf("next after removing current = %v", current)
	}
}

func TestSharedQueueMoveNextOverridesShuffleOrder(t *testing.T) {
	s := NewSession(SessionConfig{ID: "shuffle-queue", Kind: SessionShared})
	s.SetQueue([]string{"a", "b", "c", "d"})
	s.Activate("a")
	s.ToggleShuffle()
	s.MoveNext([]string{"d"})
	s.Next()
	if current := s.CurrentTrackID(); current == nil || *current != "d" {
		t.Fatalf("play next under shuffle = %v", current)
	}
}

func TestRandomizeQueuePreservesMembershipAndCurrent(t *testing.T) {
	s := NewSession(SessionConfig{ID: "randomize", Kind: SessionShared})
	s.SetQueue([]string{"a", "b", "c", "d"})
	s.Activate("b")
	order := s.RandomizeQueue()
	if order[0] != "b" {
		t.Fatalf("current track moved from front: %v", order)
	}
	sorted := append([]string(nil), order...)
	slices.Sort(sorted)
	if !slices.Equal(sorted, []string{"a", "b", "c", "d"}) {
		t.Fatalf("randomize changed membership: %v", order)
	}
}
