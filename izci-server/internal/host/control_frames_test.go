package host

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestLargeCatalogUsesBrowserCompatibleControlFrames(t *testing.T) {
	items := make([]map[string]any, 250)
	for i := range items {
		items[i] = map[string]any{
			"id": fmt.Sprintf("track-%d", i), "name": strings.Repeat("Şarkı", 12),
			"extension": "opus", "kind": "stream", "size": 12345,
			"lastModified": 12345, "path": fmt.Sprintf("/music/folder/%d.opus", i),
		}
	}
	message := CatalogMessageWithItems(2, nil, items, nil, false, RepeatOff)
	if len(message) <= controlFrameLimit {
		t.Fatal("fixture must exceed one control frame")
	}
	ch := NewFakeChannel(ChannelControl)
	if err := sendControlMessage(ch, message); err != nil {
		t.Fatal(err)
	}
	frames := ch.Sent()
	if len(frames) < 2 {
		t.Fatalf("want chunked frames, got %d", len(frames))
	}
	var rebuilt strings.Builder
	var transferID string
	for index, raw := range frames {
		if len(raw) > 16*1024 {
			t.Fatalf("frame %d exceeds Pion receive bound: %d", index, len(raw))
		}
		var frame struct {
			Kind       string `json:"kind"`
			TransferID string `json:"transferId"`
			Index      int    `json:"index"`
			Total      int    `json:"total"`
			Payload    string `json:"payload"`
		}
		if err := json.Unmarshal([]byte(raw), &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Kind != "chunk" || frame.Index != index || frame.Total != len(frames) || frame.TransferID == "" {
			t.Fatalf("invalid chunk metadata at %d", index)
		}
		if transferID != "" && transferID != frame.TransferID {
			t.Fatal("one message used multiple transfer IDs")
		}
		transferID = frame.TransferID
		rebuilt.WriteString(frame.Payload)
	}
	if rebuilt.String() != message {
		t.Fatal("chunked catalog did not round trip")
	}
}

func TestInitialIdleSessionHasValidDeliveryGeneration(t *testing.T) {
	session := NewSession(SessionConfig{ID: "shared", Kind: SessionShared})
	clock, delivery, _ := session.Snapshot()
	if clock.GenerationID == "" || delivery.GenerationID != clock.GenerationID {
		t.Fatalf("idle generation mismatch: clock=%q delivery=%q", clock.GenerationID, delivery.GenerationID)
	}
	if delivery.Mode != DeliveryNone || delivery.Reason == nil || *delivery.Reason != "no-track" {
		t.Fatalf("idle delivery must explain no track: %+v", delivery)
	}
}
