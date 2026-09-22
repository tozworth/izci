package host

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dunsparce9/izci/izci-server/internal/library"
	"github.com/dunsparce9/izci/izci-server/internal/media"
	"github.com/dunsparce9/izci/izci-server/internal/persistence"
	appProtocol "github.com/dunsparce9/izci/izci-server/internal/protocol"
)

// Render delivery tests: manifest flow, need/epoch planning, readiness
// gating, seek thrash, shared/Freeplay reuse, and fallback policy. The
// machinery is decoder-agnostic (covered per-family in media); here one
// ordinary-audio fixture plus failure fixtures exercise the timelines.

func renderTestHost(t *testing.T, policy media.Policy, files map[string][]byte) (*Host, *media.Cache, map[string]string) {
	t.Helper()
	deps := media.Probe()
	if deps.FFmpegVersion == "" || !deps.FFmpegOpus || !deps.FFmpegWebM {
		t.Skip("ffmpeg opus/webm unavailable")
	}
	dir := t.TempDir()
	ids := map[string]string{}
	var tracks []*library.Track
	for vpath, data := range files {
		rel := strings.TrimPrefix(vpath, "/music/")
		abs := filepath.Join(dir, "music", rel)
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, data, 0o644); err != nil {
			t.Fatal(err)
		}
		fi, _ := os.Stat(abs)
		ext := library.InferExtension(abs)
		kind := library.InferKind(ext)
		rev := library.BuildSourceRevision(fi.Size(), fi.ModTime().UnixNano(), 0, "testhash")
		id := "track-" + strings.ReplaceAll(strings.Trim(vpath, "/"), "/", "-")
		tracks = append(tracks, &library.Track{
			ID: id, VirtualPath: vpath, Name: filepath.Base(abs),
			Extension: ext, Kind: kind, Size: fi.Size(), MtimeNs: fi.ModTime().UnixNano(),
			FileKey: "test:" + vpath, SourceRevision: rev, FilesystemPath: abs,
		})
		ids[vpath] = id
	}
	store, err := persistence.Open("")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	catalog := NewCatalog(50000, 100000)
	cache, err := media.OpenCache(filepath.Join(dir, "renders"), 64*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	coord := media.NewCoordinator(cache, media.FFmpegSettings{}, deps, 2)
	h := NewHost(HostConfig{
		Name: "test", Product: "izci-server", ProductVersion: "test",
		Catalog: catalog, Policy: policy, Deps: deps,
		Store: store, ServerID: "test-server-identity-01",
		RenderCoordinator: coord, RenderCache: cache, RenderBitrate: 96,
	})
	h.SetLibraryTracks(tracks, 1)
	return h, cache, ids
}

func renderTone(t *testing.T, dir, name string, secs int) []byte {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	out := filepath.Join(dir, name)
	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "sine=frequency=440:duration="+itoa(secs), "-ar", "44100", out)
	if err := cmd.Run(); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	raw, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [8]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// silentMOD builds a 1-pattern silent ProTracker module for delivery tests.
func silentMOD() []byte {
	out := make([]byte, 0, 2200)
	out = append(out, make([]byte, 20)...)
	out = append(out, make([]byte, 31*30)...)
	out = append(out, 1, 0)
	out = append(out, make([]byte, 128)...)
	out = append(out, 'M', '.', 'K', '.')
	out = append(out, make([]byte, 64*4*4)...)
	return out
}

func attachFakeRender(h *Host, peerID string) *FakeChannel {
	ch := NewFakeChannel(ChannelRender)
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	if !ok {
		peer = &Peer{ID: peerID, AttemptID: "attempt-" + peerID, PairNonce: NewPairNonce()}
		h.peers[peerID] = peer
	}
	h.peersMu.Unlock()
	h.attachRenderChannel(peerID, ch)
	return ch
}

func renderHello(name string, freeplay bool) string {
	return marshal(map[string]any{
		"kind": "hello", "protocolMajor": 1, "protocolMinor": 0,
		"capabilities":    []string{"source-file", "buffered-opus", "synchronized-start", "freeplay"},
		"impl":            map[string]any{"product": "izci", "productVersion": "0.3.2"},
		"name":            name,
		"platform":        "test",
		"freeplayEnabled": freeplay,
	})
}

func legacyRenderHello(name string) string {
	return marshal(map[string]any{
		"kind": "hello", "protocolMajor": 1, "protocolMinor": 0,
		"capabilities": []string{"source-file", "synchronized-start"},
		"impl":         map[string]any{"product": "izci", "productVersion": "legacy"},
		"name":         name, "platform": "test", "freeplayEnabled": false,
	})
}

func activateCmd(id, collection, itemID string) string {
	return marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": id, "collection": collection, "itemId": itemID},
	})
}

func getRender(h *Host, peerID string) *FakeChannel {
	h.peersMu.Lock()
	defer h.peersMu.Unlock()
	if p, ok := h.peers[peerID]; ok {
		if ch, ok := p.Render.(*FakeChannel); ok {
			return ch
		}
	}
	return nil
}

type wireManifest struct {
	GenerationID  string
	RenderID      string
	TrackID       string
	TotalBytes    int64
	InitSizeBytes int64
	Clusters      int
}

func latestManifest(ch *FakeChannel) (wireManifest, bool) {
	var out wireManifest
	found := false
	for _, text := range ch.Sent() {
		var m map[string]any
		if err := json.Unmarshal([]byte(text), &m); err != nil || m["kind"] != "render.manifest" {
			continue
		}
		man, _ := m["manifest"].(map[string]any)
		if man == nil {
			continue
		}
		out.GenerationID, _ = man["generationId"].(string)
		out.RenderID, _ = man["renderId"].(string)
		out.TrackID, _ = man["trackId"].(string)
		if tb, ok := man["totalBytes"].(float64); ok {
			out.TotalBytes = int64(tb)
		}
		if ib, ok := man["initSizeBytes"].(float64); ok {
			out.InitSizeBytes = int64(ib)
		}
		if cl, ok := man["clusters"].([]any); ok {
			out.Clusters = len(cl)
		}
		found = true
	}
	return out, found
}

func sendNeed(h *Host, peer, gen, render string, epoch int, target, ahead float64, ranges [][2]int) {
	rs := make([][]int, len(ranges))
	for i, r := range ranges {
		rs[i] = []int{r[0], r[1]}
	}
	h.HandleControlText(peer, marshal(map[string]any{
		"kind": "render.need", "need": map[string]any{
			"generationId": gen, "renderId": render, "epoch": epoch,
			"targetTimeMs": target, "aheadMs": ahead, "ranges": rs,
		},
	}))
}

func sendReady(h *Host, peer, gen, render string, epoch int) {
	h.HandleControlText(peer, marshal(map[string]any{
		"kind": "render.ready", "generationId": gen, "renderId": render, "epoch": epoch, "positionMs": 0,
	}))
}

// reassemble collects render-channel frames until init + all clusters are
// byte-complete per the manifest, then returns total payload bytes. Like
// the browser client, it dedups repeated init frames (the host re-sends
// init on every need) instead of double-counting them.
func reassemble(t *testing.T, ch *FakeChannel, m wireManifest, timeout time.Duration) int64 {
	t.Helper()
	// Expected per-cluster sizes, resolved from the manifest once a frame
	// with the renderId arrives.
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		initSegs := map[uint32]int{}
		clusterSegs := map[uint32]map[uint32]int{}
		for _, raw := range ch.SentBinary() {
			f, err := appProtocol.DecodeRenderFrame(raw)
			if err != nil {
				t.Fatalf("bad frame: %v", err)
			}
			if f.RenderID != m.RenderID {
				continue
			}
			if f.ClusterIndex == 0xffffffff {
				if _, seen := initSegs[f.FragmentOffset]; !seen {
					initSegs[f.FragmentOffset] = len(f.Payload)
				}
				continue
			}
			segs, ok := clusterSegs[f.ClusterIndex]
			if !ok {
				segs = map[uint32]int{}
				clusterSegs[f.ClusterIndex] = segs
			}
			if _, seen := segs[f.FragmentOffset]; !seen {
				segs[f.FragmentOffset] = len(f.Payload)
			}
		}
		var initBytes int64
		for _, n := range initSegs {
			initBytes += int64(n)
		}
		var total int64 = initBytes
		for _, segs := range clusterSegs {
			for _, n := range segs {
				total += int64(n)
			}
		}
		if initBytes >= m.InitSizeBytes && len(clusterSegs) == m.Clusters && total >= m.TotalBytes {
			return total
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("incomplete render for %s", m.RenderID)
	return 0
}

// TestSharedRenderPlayback proves the full shared buffered-Opus flow:
// prepare, manifest, planned fragments reassembling to manifest bytes,
// and a barrier that ignores playback.ready but releases on render.ready
// from every subscriber.
// Render clients gate event playback on the announced snapshot state, so a
// released preparation barrier must publish the playing clock on both
// timelines, not merely the synchronized start message.
func TestRenderBarrierAnnouncesPlayingState(t *testing.T) {
	dir := t.TempDir()
	tone := renderTone(t, dir, "tone.wav", 3)
	policy := media.Policy{Mode: media.ModeThreshold, MaxBytes: 1}
	h, _, ids := renderTestHost(t, policy, map[string][]byte{"/music/tone.wav": tone})
	trackID := ids["/music/tone.wav"]

	attachFakeControl(h, "alice")
	attachFakeRender(h, "alice")
	h.HandleControlText("alice", renderHello("alice", false))
	attachFakeControl(h, "bob")
	attachFakeRender(h, "bob")
	h.HandleControlText("bob", renderHello("bob", true))

	h.HandleControlText("alice", activateCmd("c1", "library", trackID))
	h.HandleControlText("bob", marshal(map[string]any{"kind": "freeplay.queue", "itemIds": []string{trackID}}))
	h.HandleControlText("bob", activateCmd("c2", "library", trackID))

	var mShared, mFree wireManifest
	waitFor(t, 15*time.Second, func() bool {
		var okS, okF bool
		mShared, okS = latestManifest(getControl(h, "alice"))
		mFree, okF = latestManifest(getControl(h, "bob"))
		return okS && okF
	}, "both timelines need manifests")

	timelines := []struct {
		peer  string
		gen   string
		ready wireManifest
	}{
		{"alice", mShared.GenerationID, mShared},
		{"bob", mFree.GenerationID, mFree},
	}
	for _, tl := range timelines {
		sendNeed(h, tl.peer, tl.gen, tl.ready.RenderID, 0, 0, 3000, nil)
		if total := reassemble(t, getRender(h, tl.peer), tl.ready, 15*time.Second); total != tl.ready.TotalBytes {
			t.Fatalf("peer %s got %d bytes, manifest says %d", tl.peer, total, tl.ready.TotalBytes)
		}
		sendReady(h, tl.peer, tl.gen, tl.ready.RenderID, 0)
	}
	waitFor(t, 10*time.Second, func() bool {
		return playbackStateFor(getControl(h, "alice"), mShared.GenerationID) == "playing" &&
			playbackStateFor(getControl(h, "bob"), mFree.GenerationID) == "playing"
	}, "released barriers must announce a playing snapshot on both timelines")
}

// TestSharedRenderPlayback keeps the two-timeline manifest/readiness contract.
func TestSharedRenderPlayback(t *testing.T) {
	dir := t.TempDir()
	tone := renderTone(t, dir, "tone.wav", 3)
	policy := media.Policy{Mode: media.ModeThreshold, MaxBytes: 1} // everything renders
	h, _, ids := renderTestHost(t, policy, map[string][]byte{"/music/tone.wav": tone})
	trackID := ids["/music/tone.wav"]

	for _, peer := range []string{"alice", "bob"} {
		attachFakeControl(h, peer)
		attachFakeRender(h, peer)
		h.HandleControlText(peer, renderHello(peer, false))
	}
	h.HandleControlText("alice", activateCmd("c1", "library", trackID))

	var mAlice, mBob wireManifest
	waitFor(t, 15*time.Second, func() bool {
		var okA, okB bool
		mAlice, okA = latestManifest(getControl(h, "alice"))
		mBob, okB = latestManifest(getControl(h, "bob"))
		return okA && okB && mAlice.GenerationID == mBob.GenerationID && mAlice.RenderID == mBob.RenderID
	}, "both subscribers share one render generation")
	if mAlice.TrackID != trackID || mAlice.Clusters == 0 {
		t.Fatalf("bad manifest: %+v", mAlice)
	}

	// playback.ready alone must not release a render generation.
	h.HandleControlText("alice", marshal(map[string]any{"kind": "playback.ready", "generationId": mAlice.GenerationID}))
	h.HandleControlText("bob", marshal(map[string]any{"kind": "playback.ready", "generationId": mAlice.GenerationID}))
	time.Sleep(200 * time.Millisecond)
	if hasStartWithGen(getControl(h, "alice"), mAlice.GenerationID) {
		t.Fatal("playback.ready released a render barrier")
	}

	// Both peers request and reassemble the full render.
	for _, peer := range []string{"alice", "bob"} {
		sendNeed(h, peer, mAlice.GenerationID, mAlice.RenderID, 0, 0, 3000, nil)
	}
	for _, peer := range []string{"alice", "bob"} {
		total := reassemble(t, getRender(h, peer), mAlice, 15*time.Second)
		if total != mAlice.TotalBytes {
			t.Fatalf("peer %s got %d bytes, manifest says %d", peer, total, mAlice.TotalBytes)
		}
	}

	// One render.ready is not enough for two subscribers; two release it.
	sendReady(h, "alice", mAlice.GenerationID, mAlice.RenderID, 0)
	time.Sleep(200 * time.Millisecond)
	if hasStartWithGen(getControl(h, "alice"), mAlice.GenerationID) {
		t.Fatal("barrier released with one of two readies")
	}
	sendReady(h, "bob", mAlice.GenerationID, mAlice.RenderID, 0)
	waitFor(t, 5*time.Second, func() bool {
		return hasStartWithGen(getControl(h, "alice"), mAlice.GenerationID) &&
			hasStartWithGen(getControl(h, "bob"), mAlice.GenerationID)
	}, "both peers must receive synchronized start")
}

func TestLegacyPeerDoesNotCancelSharedRender(t *testing.T) {
	dir := t.TempDir()
	tone := renderTone(t, dir, "tone.wav", 2)
	h, _, ids := renderTestHost(t, media.Policy{Mode: media.ModeNever}, map[string][]byte{"/music/tone.wav": tone})
	trackID := ids["/music/tone.wav"]

	attachFakeControl(h, "alice")
	attachFakeRender(h, "alice")
	h.HandleControlText("alice", renderHello("alice", false))
	attachFakeControl(h, "legacy")
	h.HandleControlText("legacy", legacyRenderHello("legacy"))

	h.HandleControlText("alice", activateCmd("c1", "library", trackID))
	var m wireManifest
	waitFor(t, 15*time.Second, func() bool {
		var ok bool
		m, ok = latestManifest(getControl(h, "alice"))
		return ok
	}, "capable peer manifest")
	sendReady(h, "alice", m.GenerationID, m.RenderID, 0)
	waitFor(t, 5*time.Second, func() bool {
		return hasStartWithGen(getControl(h, "alice"), m.GenerationID)
	}, "legacy peer must not block shared start")
	_, delivery, _ := h.SharedSession().Snapshot()
	if delivery.GenerationID != m.GenerationID || delivery.Mode != DeliveryRender {
		t.Fatalf("legacy peer canceled shared render: %+v", delivery)
	}
}

// TestRenderSeekThrash proves rapid epoch changes converge: the last
// adopted epoch serves, stale state is dropped, and readiness still
// releases the barrier.
func TestRenderSeekThrash(t *testing.T) {
	dir := t.TempDir()
	tone := renderTone(t, dir, "tone.wav", 6)
	policy := media.Policy{Mode: media.ModeThreshold, MaxBytes: 1}
	h, _, ids := renderTestHost(t, policy, map[string][]byte{"/music/tone.wav": tone})
	trackID := ids["/music/tone.wav"]

	attachFakeControl(h, "alice")
	attachFakeRender(h, "alice")
	h.HandleControlText("alice", renderHello("alice", false))
	h.HandleControlText("alice", activateCmd("c1", "library", trackID))
	var m wireManifest
	waitFor(t, 15*time.Second, func() bool {
		var ok bool
		m, ok = latestManifest(getControl(h, "alice"))
		return ok
	}, "manifest must arrive")

	// Thrash seeks: epochs 1..5 with scattered targets.
	for epoch := 1; epoch <= 5; epoch++ {
		sendNeed(h, "alice", m.GenerationID, m.RenderID, epoch, float64(epoch*500), 3000, nil)
	}
	waitFor(t, 5*time.Second, func() bool {
		h.peersMu.Lock()
		defer h.peersMu.Unlock()
		st := h.peers["alice"].RenderState
		return st != nil && st.Epoch == 5
	}, "final epoch must win")
	// Stale ready (epoch 2) must not release; current ready (5) must.
	sendReady(h, "alice", m.GenerationID, m.RenderID, 2)
	time.Sleep(200 * time.Millisecond)
	if hasStartWithGen(getControl(h, "alice"), m.GenerationID) {
		t.Fatal("stale epoch ready released the barrier")
	}
	sendNeed(h, "alice", m.GenerationID, m.RenderID, 5, 2500, 3000, nil)
	sendReady(h, "alice", m.GenerationID, m.RenderID, 5)
	waitFor(t, 5*time.Second, func() bool {
		return hasStartWithGen(getControl(h, "alice"), m.GenerationID)
	}, "current epoch ready must release")
}

// TestSharedFreeplayRenderReuse proves concurrent sessions share one
// cache entry (same renderId) with independent pins and timelines.
func TestSharedFreeplayRenderReuse(t *testing.T) {
	dir := t.TempDir()
	tone := renderTone(t, dir, "tone.wav", 3)
	policy := media.Policy{Mode: media.ModeThreshold, MaxBytes: 1}
	h, cache, ids := renderTestHost(t, policy, map[string][]byte{"/music/tone.wav": tone})
	trackID := ids["/music/tone.wav"]

	attachFakeControl(h, "alice")
	attachFakeRender(h, "alice")
	h.HandleControlText("alice", renderHello("alice", false))
	attachFakeControl(h, "bob")
	attachFakeRender(h, "bob")
	h.HandleControlText("bob", renderHello("bob", true))

	h.HandleControlText("alice", activateCmd("c1", "library", trackID))
	// Freeplay queue needs the track before activation validates.
	h.HandleControlText("bob", marshal(map[string]any{"kind": "freeplay.queue", "itemIds": []string{trackID}}))
	h.HandleControlText("bob", activateCmd("c2", "library", trackID))

	var mShared, mFree wireManifest
	waitFor(t, 15*time.Second, func() bool {
		var okS, okF bool
		mShared, okS = latestManifest(getControl(h, "alice"))
		mFree, okF = latestManifest(getControl(h, "bob"))
		return okS && okF
	}, "both timelines need manifests")
	if mShared.RenderID != mFree.RenderID {
		t.Fatal("shared and freeplay rendered twice instead of sharing")
	}
	if mShared.GenerationID == mFree.GenerationID {
		t.Fatal("timelines share a generation; they must differ")
	}
	h.peersMu.Lock()
	aliceKey := h.peers["alice"].RenderState.CacheKey
	bobKey := h.peers["bob"].RenderState.CacheKey
	h.peersMu.Unlock()
	if aliceKey != bobKey {
		t.Fatal("sessions did not share one cache entry")
	}
	if n := cache.Pinned(aliceKey); n != 2 {
		t.Fatalf("pins=%d want 2 independent pins", n)
	}
	// Independent timelines: bob's ready starts bob only.
	sendReady(h, "bob", mFree.GenerationID, mFree.RenderID, 0)
	waitFor(t, 5*time.Second, func() bool {
		return hasStartWithGen(getControl(h, "bob"), mFree.GenerationID)
	}, "freeplay ready must start freeplay")
	time.Sleep(200 * time.Millisecond)
	if hasStartWithGen(getControl(h, "alice"), mShared.GenerationID) {
		t.Fatal("freeplay ready leaked into the shared timeline")
	}
}

// TestRenderFallbackToSource proves a failed render under a transfer
// policy pins the track to source-file and delivers a fresh generation.
func TestRenderFallbackToSource(t *testing.T) {
	policy := media.Policy{Mode: media.ModeThreshold, MaxBytes: 1}
	h, _, ids := renderTestHost(t, policy, map[string][]byte{"/music/broken.mp4": {0, 1, 2, 3}})
	trackID := ids["/music/broken.mp4"]

	attachFakeControl(h, "alice")
	attachFakeMedia(h, "alice")
	attachFakeRender(h, "alice")
	h.HandleControlText("alice", renderHello("alice", false))
	h.HandleControlText("alice", activateCmd("c1", "library", trackID))

	// Fallback activation carries a new preparation with source delivery.
	waitFor(t, 15*time.Second, func() bool {
		for _, text := range getControl(h, "alice").Sent() {
			var m map[string]any
			if err := json.Unmarshal([]byte(text), &m); err != nil || m["kind"] != "playback.prepare" {
				continue
			}
			if prep, ok := m["preparation"].(map[string]any); ok && prep["delivery"] == "source-file" {
				return true
			}
		}
		return false
	}, "fallback must prepare a source-file generation")
	// And the source file actually transfers.
	waitFor(t, 15*time.Second, func() bool {
		for _, f := range mediaTexts(getMedia(h, "alice")) {
			if f["kind"] == "file.begin" && f["trackId"] == trackID {
				return true
			}
		}
		return false
	}, "fallback must transfer the source file")
}

// TestRenderNoFallbackInNeverMode proves a failed render with source
// transfer disabled cancels the generation instead of silently
// transferring.
func TestRenderNoFallbackInNeverMode(t *testing.T) {
	policy := media.Policy{Mode: media.ModeNever}
	h, _, ids := renderTestHost(t, policy, map[string][]byte{"/music/broken.mp4": {0, 1, 2, 3}})
	trackID := ids["/music/broken.mp4"]

	attachFakeControl(h, "alice")
	attachFakeMedia(h, "alice")
	attachFakeRender(h, "alice")
	h.HandleControlText("alice", renderHello("alice", false))
	h.HandleControlText("alice", activateCmd("c1", "library", trackID))

	waitFor(t, 15*time.Second, func() bool {
		for _, text := range getControl(h, "alice").Sent() {
			var m map[string]any
			if err := json.Unmarshal([]byte(text), &m); err != nil {
				continue
			}
			if m["kind"] == "playback.cancel" {
				return true
			}
		}
		return false
	}, "failed render without fallback must cancel")
	for _, f := range mediaTexts(getMedia(h, "alice")) {
		if f["kind"] == "file.begin" {
			t.Fatal("never mode silently transferred a source file")
		}
	}
}

// TestRenderReconnect proves a mid-generation reconnect resumes through
// a fresh manifest and full window on the new channel — never by
// resuming ambiguous bytes on the old one.
func TestRenderReconnect(t *testing.T) {
	dir := t.TempDir()
	tone := renderTone(t, dir, "tone.wav", 4)
	policy := media.Policy{Mode: media.ModeThreshold, MaxBytes: 1}
	h, _, ids := renderTestHost(t, policy, map[string][]byte{"/music/tone.wav": tone})
	trackID := ids["/music/tone.wav"]

	attachFakeControl(h, "alice")
	oldRender := attachFakeRender(h, "alice")
	h.HandleControlText("alice", renderHello("alice", false))
	h.HandleControlText("alice", activateCmd("c1", "library", trackID))
	var m wireManifest
	waitFor(t, 15*time.Second, func() bool {
		var ok bool
		m, ok = latestManifest(getControl(h, "alice"))
		return ok
	}, "manifest must arrive")
	sendNeed(h, "alice", m.GenerationID, m.RenderID, 0, 0, 3000, nil)
	reassemble(t, oldRender, m, 15*time.Second)

	// Reconnect: new render channel plus a fresh hello resets the peer to
	// the current generation at the playhead.
	newRender := attachFakeRender(h, "alice")
	h.HandleControlText("alice", renderHello("alice", false))
	var m2 wireManifest
	waitFor(t, 15*time.Second, func() bool {
		var ok bool
		m2, ok = latestManifest(getControl(h, "alice"))
		return ok && m2.GenerationID == m.GenerationID
	}, "reconnect must re-manifest the current generation")
	if m2.RenderID != m.RenderID {
		t.Fatal("reconnect must reuse the cached render, not re-render")
	}
	oldCount := len(oldRender.SentBinary())
	sendNeed(h, "alice", m2.GenerationID, m2.RenderID, 0, 0, 3000, nil)
	total := reassemble(t, newRender, m2, 15*time.Second)
	if total != m2.TotalBytes {
		t.Fatalf("reconnect got %d bytes, manifest says %d", total, m2.TotalBytes)
	}
	if len(oldRender.SentBinary()) != oldCount {
		t.Fatal("old channel received bytes after reconnect")
	}
}

// TestRenderModuleDelivery proves a tracker module flows through the same
// delivery machinery (libopenmpt PCM behind the shared interface).
func TestRenderModuleDelivery(t *testing.T) {
	if media.OpenMPTVersion() == "" {
		t.Skip("system libopenmpt unavailable")
	}
	policy := media.Policy{Mode: media.ModeThreshold, MaxBytes: 1}
	h, _, ids := renderTestHost(t, policy, map[string][]byte{"/music/tone.mod": silentMOD()})
	trackID := ids["/music/tone.mod"]

	attachFakeControl(h, "alice")
	attachFakeRender(h, "alice")
	h.HandleControlText("alice", renderHello("alice", false))
	h.HandleControlText("alice", activateCmd("c1", "library", trackID))

	var m wireManifest
	waitFor(t, 15*time.Second, func() bool {
		var ok bool
		m, ok = latestManifest(getControl(h, "alice"))
		return ok && m.TrackID == trackID
	}, "module manifest must arrive")
	sendNeed(h, "alice", m.GenerationID, m.RenderID, 0, 0, 3000, nil)
	total := reassemble(t, getRender(h, "alice"), m, 15*time.Second)
	if total != m.TotalBytes {
		t.Fatalf("got %d bytes, manifest says %d", total, m.TotalBytes)
	}
}
