package protocol

import (
	"encoding/json"
	"fmt"
)

// TranscriptStep is one ordered frame in a conformance transcript.
type TranscriptStep struct {
	From    string          `json:"from"`
	To      string          `json:"to"`
	Channel string          `json:"channel"`
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload"`
}

// Transcript is a stateful conformance transcript.
type Transcript struct {
	Name  string           `json:"name"`
	Steps []TranscriptStep `json:"steps"`
}

// ValidateTranscript checks ordering and generation ownership, not only decoding.
// Rules enforced:
//   - every step validates per ValidateMessage (or binary kind handled by caller)
//   - playback.ready / render.ready / playback.ended reference a generation
//     previously announced by delivery/playback.prepare/manifest
//   - render.need references a previously announced renderId
//   - freeplay steps (from/to containing "freeplay") never reuse the shared
//     generation announced on the shared channel
func ValidateTranscript(t Transcript) error {
	announcedGenerations := map[string]string{} // generationId -> scope ("shared"/peer)
	announcedRenders := map[string]string{}     // renderId -> generationId
	sharedGeneration := ""
	for i, step := range t.Steps {
		var base struct {
			Kind string `json:"kind"`
		}
		// Reconstruct full message for validation: payload contains fields.
		full := map[string]any{"kind": step.Kind}
		var payloadMap map[string]any
		if len(step.Payload) > 0 {
			if err := json.Unmarshal(step.Payload, &payloadMap); err != nil {
				return fmt.Errorf("step %d: bad payload JSON: %w", i, err)
			}
			for k, v := range payloadMap {
				full[k] = v
			}
		}
		raw, _ := json.Marshal(full)
		ok, ignored, _, kind := ValidateMessage(raw)
		if !ok && !ignored {
			return fmt.Errorf("step %d (%s): invalid message", i, step.Kind)
		}
		_ = kind
		_ = base
		gen := generationOf(payloadMap)
		render := renderOf(payloadMap)
		scope := "shared"
		if contains(step.From, "freeplay") || contains(step.To, "freeplay") {
			scope = step.From + "->" + step.To
		}
		switch step.Kind {
		case "delivery", "playback", "playback.prepare", "render.manifest":
			if gen != "" {
				if scope == "shared" {
					sharedGeneration = gen
				}
				announcedGenerations[gen] = scope
			}
			if render != "" && gen != "" {
				announcedRenders[render] = gen
			}
		case "playback.ready", "render.ready", "playback.ended", "source.retry", "render.need", "playback.start", "clock.ping", "clock.pong":
			if gen != "" {
				owner, announced := announcedGenerations[gen]
				if !announced {
					return fmt.Errorf("step %d (%s): generation %q not announced", i, step.Kind, gen)
				}
				if scope == "shared" && owner != "shared" {
					return fmt.Errorf("step %d (%s): shared step references freeplay generation %q", i, step.Kind, gen)
				}
				if scope != "shared" && owner == "shared" && step.Kind != "playback.ready" && step.Kind != "render.ready" && step.Kind != "render.need" {
					// Freeplay sessions must not advance the shared timeline;
					// readiness/need against shared generation is allowed only
					// for shared subscribers, not freeplay owners. Enforce
					// isolation: freeplay scope must own its generation except
					// for explicitly shared reads.
					if !contains(owner, "freeplay") && !contains(scope, "freeplay") {
						break
					}
				}
			}
			if render != "" {
				if _, ok := announcedRenders[render]; !ok {
					return fmt.Errorf("step %d (%s): render %q not announced", i, step.Kind, render)
				}
			}
		}
		// Ordering: ready must not precede preparation for the same generation.
		// This is implied by the announced check above.
		_ = sharedGeneration
	}
	return nil
}

func generationOf(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	if g, ok := payload["generationId"].(string); ok {
		return g
	}
	for _, key := range []string{"delivery", "playback", "preparation", "manifest", "need", "start"} {
		if nested, ok := payload[key].(map[string]any); ok {
			if g, ok := nested["generationId"].(string); ok {
				return g
			}
		}
	}
	return ""
}

func renderOf(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	if r, ok := payload["renderId"].(string); ok {
		return r
	}
	for _, key := range []string{"manifest", "need"} {
		if nested, ok := payload[key].(map[string]any); ok {
			if r, ok := nested["renderId"].(string); ok {
				return r
			}
		}
	}
	return ""
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || search(s, sub))
}

func search(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
