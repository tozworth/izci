package protocol

import (
	"encoding/binary"
	"errors"
)

const (
	RenderMarker         = 0x52
	RenderHeaderBase     = 19
	RenderInitCluster    = 0xffffffff
	RenderFragmentSize   = 16 * 1024
	RenderQueueHighWater = 512 * 1024
	SourceChunkSize      = 16 * 1024
	SourceQueueLimit     = 1024 * 1024
	ControlChunkSize     = 12000
)

// RenderFrame is a decoded izci-render binary fragment.
type RenderFrame struct {
	RenderID       string
	Epoch          uint32
	ClusterIndex   uint32
	FragmentOffset uint32
	FragmentLength uint32
	Payload        []byte
}

// EncodeRenderFrame mirrors multiplayer-render-transfer.ts encodeRenderFrame.
func EncodeRenderFrame(renderID string, epoch, clusterIndex, fragmentOffset uint32, payload []byte) []byte {
	idBytes := []byte(renderID)
	total := RenderHeaderBase + len(idBytes) + len(payload)
	frame := make([]byte, total)
	frame[0] = RenderMarker
	binary.BigEndian.PutUint32(frame[1:5], epoch)
	binary.BigEndian.PutUint32(frame[5:9], clusterIndex)
	binary.BigEndian.PutUint32(frame[9:13], fragmentOffset)
	binary.BigEndian.PutUint32(frame[13:17], uint32(len(payload)))
	binary.BigEndian.PutUint16(frame[17:19], uint16(len(idBytes)))
	copy(frame[19:], idBytes)
	copy(frame[19+len(idBytes):], payload)
	return frame
}

// DecodeRenderFrame mirrors decodeRenderFrame. Returns an error on any
// malformed header, bad marker, bad lengths, or bad renderId bounds.
func DecodeRenderFrame(buffer []byte) (RenderFrame, error) {
	var frame RenderFrame
	if len(buffer) < RenderHeaderBase+1 {
		return frame, errors.New("truncated header")
	}
	if buffer[0] != RenderMarker {
		return frame, errors.New("bad marker")
	}
	renderIDLen := int(binary.BigEndian.Uint16(buffer[17:19]))
	headerEnd := RenderHeaderBase + renderIDLen
	if len(buffer) < headerEnd {
		return frame, errors.New("truncated render id")
	}
	renderID := string(buffer[RenderHeaderBase:headerEnd])
	if len(renderID) < 1 || len(renderID) > 80 {
		return frame, errors.New("bad render id length")
	}
	epoch := binary.BigEndian.Uint32(buffer[1:5])
	clusterIndex := binary.BigEndian.Uint32(buffer[5:9])
	fragmentOffset := binary.BigEndian.Uint32(buffer[9:13])
	fragmentLength := binary.BigEndian.Uint32(buffer[13:17])
	if int(fragmentLength) != len(buffer)-headerEnd {
		return frame, errors.New("fragment length mismatch")
	}
	frame.RenderID = renderID
	frame.Epoch = epoch
	frame.ClusterIndex = clusterIndex
	frame.FragmentOffset = fragmentOffset
	frame.FragmentLength = fragmentLength
	frame.Payload = append([]byte(nil), buffer[headerEnd:]...)
	return frame, nil
}
