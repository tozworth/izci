package host

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"unicode/utf8"
)

// Browser clients reassemble kind=chunk frames before validating the message.
// Keep each frame well below Pion's 16 KiB receive bound and the negotiated
// SCTP message limit, including JSON escaping overhead.
const controlFrameLimit = 12_000
const controlChunkBytes = 8_000

func sendControlMessage(ch DataChannel, message string) error {
	if len(message) <= controlFrameLimit {
		return ch.SendText(message)
	}
	var token [9]byte
	if _, err := rand.Read(token[:]); err != nil {
		return fmt.Errorf("control transfer ID: %w", err)
	}
	chunks := make([]string, 0, (len(message)+controlChunkBytes-1)/controlChunkBytes)
	for start := 0; start < len(message); {
		end := min(start+controlChunkBytes, len(message))
		for end < len(message) && !utf8.RuneStart(message[end]) {
			end--
		}
		chunks = append(chunks, message[start:end])
		start = end
	}
	if len(chunks) > 10_000 {
		return fmt.Errorf("control message exceeds chunk count limit")
	}
	transferID := hex.EncodeToString(token[:])
	for index, payload := range chunks {
		frame, err := json.Marshal(struct {
			Kind       string `json:"kind"`
			TransferID string `json:"transferId"`
			Index      int    `json:"index"`
			Total      int    `json:"total"`
			Payload    string `json:"payload"`
		}{"chunk", transferID, index, len(chunks), payload})
		if err != nil {
			return err
		}
		if err := ch.SendText(string(frame)); err != nil {
			return err
		}
	}
	return nil
}
