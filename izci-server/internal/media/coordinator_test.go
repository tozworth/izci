package media

import (
	"context"
	"sync"
	"testing"
	"time"
)

func coordDeps(t *testing.T) Dependencies {
	t.Helper()
	d := Probe()
	if d.FFmpegVersion == "" || !d.FFmpegOpus || !d.FFmpegWebM {
		t.Skip("ffmpeg opus/webm unavailable")
	}
	return d
}

func slowTone(t *testing.T, dir, name string, secs int) string {
	t.Helper()
	return genTone(t, dir, name, append(sineArgs(secs), "-ar", "44100", "-codec:a", "pcm_s16le")...)
}

// TestCoordinatorDedup proves concurrent sessions requesting one source
// share the completed or in-flight render: identical render IDs, one
// cache entry, independent pins.
func TestCoordinatorDedup(t *testing.T) {
	deps := coordDeps(t)
	dir := t.TempDir()
	path := slowTone(t, dir, "shared.wav", 12)
	cache := testCache(t)
	coord := NewCoordinator(cache, FFmpegSettings{}, deps, 2)
	req := RenderRequest{TrackID: "t", AbsPath: path, Kind: "stream", Extension: "wav",
		SourceRevision: "rev:dedup", BitrateKbps: 96}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var wg sync.WaitGroup
	results := make([]AcquireResult, 2)
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int, lane Lane) {
			defer wg.Done()
			request := req
			request.TrackID = "t-" + string(rune('a'+i))
			results[i], errs[i] = coord.Acquire(ctx, lane, request)
		}(i, LaneShared)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("acquire %d: %v", i, err)
		}
	}
	if results[0].Manifest.RenderID != results[1].Manifest.RenderID {
		t.Fatal("concurrent acquires rendered twice instead of sharing")
	}
	if results[0].Manifest.TrackID != "t-a" || results[1].Manifest.TrackID != "t-b" {
		t.Fatalf("delivery track IDs not rebound: %q, %q", results[0].Manifest.TrackID, results[1].Manifest.TrackID)
	}
	if n := cache.EntryCount(); n != 1 {
		t.Fatalf("entries=%d want 1", n)
	}
	// Independent pins: two pins, two unpins, entry still indexed.
	cache.Pin(results[0].Key.String())
	cache.Pin(results[1].Key.String())
	if n := cache.Pinned(results[0].Key.String()); n != 2 {
		t.Fatalf("pins=%d want 2", n)
	}
	cache.Unpin(results[0].Key.String())
	cache.Unpin(results[1].Key.String())
	if _, ok := cache.Lookup(results[0].Key); !ok {
		t.Fatal("entry lost after independent unpins")
	}
}

// TestCoordinatorSharedPriority proves a shared-session request jumps
// ahead of queued Freeplay work so a Freeplay peer cannot starve the
// shared session.
func TestCoordinatorSharedPriority(t *testing.T) {
	deps := coordDeps(t)
	dir := t.TempDir()
	fast := slowTone(t, dir, "fast.wav", 2)
	cache := testCache(t)
	coord := NewCoordinator(cache, FFmpegSettings{}, deps, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	mkReq := func(rev string) RenderRequest {
		return RenderRequest{TrackID: "t-" + rev, AbsPath: fast, Kind: "stream", Extension: "wav",
			SourceRevision: "rev:" + rev, BitrateKbps: 96}
	}
	// Occupy the single encoder with a slow job.
	slowPath := slowTone(t, dir, "slow.wav", 25)
	slowReq := RenderRequest{TrackID: "slow", AbsPath: slowPath, Kind: "stream", Extension: "wav",
		SourceRevision: "rev:slow", BitrateKbps: 96}
	slowDone := make(chan struct{})
	go func() {
		defer close(slowDone)
		_, _ = coord.Acquire(ctx, LaneFreeplay, slowReq)
	}()
	// Wait until the slow job is running (semaphore taken).
	deadline := time.Now().Add(10 * time.Second)
	for {
		coord.mu.Lock()
		running := coord.activeJobs > 0
		coord.mu.Unlock()
		if running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("slow job never started")
		}
		time.Sleep(20 * time.Millisecond)
	}
	// Queue a freeplay job, then a shared job. Shared must finish first.
	order := make(chan string, 2)
	go func() {
		if _, err := coord.Acquire(ctx, LaneFreeplay, mkReq("free")); err == nil {
			order <- "free"
		}
	}()
	// Wait until the freeplay job is queued behind the slow job.
	deadline = time.Now().Add(10 * time.Second)
	for {
		_, free := coord.QueuedJobs()
		if free == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("freeplay job never queued")
		}
		time.Sleep(20 * time.Millisecond)
	}
	go func() {
		if _, err := coord.Acquire(ctx, LaneShared, mkReq("shared")); err == nil {
			order <- "shared"
		}
	}()
	first := <-order
	second := <-order
	<-slowDone
	if first != "shared" || second != "free" {
		t.Fatalf("completion order=%q,%q want shared,free", first, second)
	}
}

// TestCoordinatorAbandoned proves a waiter that leaves a queued call
// removes it: no encoder slot is consumed for abandoned work.
func TestCoordinatorAbandoned(t *testing.T) {
	deps := coordDeps(t)
	dir := t.TempDir()
	cache := testCache(t)
	coord := NewCoordinator(cache, FFmpegSettings{}, deps, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	slowPath := slowTone(t, dir, "slow.wav", 20)
	slowReq := RenderRequest{TrackID: "slow", AbsPath: slowPath, Kind: "stream", Extension: "wav",
		SourceRevision: "rev:slow", BitrateKbps: 96}
	slowDone := make(chan struct{})
	go func() {
		defer close(slowDone)
		_, _ = coord.Acquire(ctx, LaneFreeplay, slowReq)
	}()
	deadline := time.Now().Add(10 * time.Second)
	for {
		coord.mu.Lock()
		running := coord.activeJobs > 0
		coord.mu.Unlock()
		if running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("slow job never started")
		}
		time.Sleep(20 * time.Millisecond)
	}
	fast := slowTone(t, dir, "fast.wav", 2)
	abandonCtx, abandonCancel := context.WithCancel(ctx)
	abandoned := make(chan error, 1)
	go func() {
		_, err := coord.Acquire(abandonCtx, LaneFreeplay, RenderRequest{
			TrackID: "gone", AbsPath: fast, Kind: "stream", Extension: "wav",
			SourceRevision: "rev:gone", BitrateKbps: 96})
		abandoned <- err
	}()
	// Wait until the call is actually queued behind the slow job.
	deadline = time.Now().Add(10 * time.Second)
	for {
		_, free := coord.QueuedJobs()
		if free == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("abandoned call never queued")
		}
		time.Sleep(20 * time.Millisecond)
	}
	abandonCancel()
	if err := <-abandoned; err == nil {
		t.Fatal("abandoned acquire returned success")
	}
	if shared, free := coord.QueuedJobs(); shared+free != 0 {
		t.Fatalf("abandoned call stayed queued: shared=%d free=%d", shared, free)
	}
	<-slowDone
	if n := coord.MaxObservedConcurrency(); n > 1 {
		t.Fatalf("max concurrency=%d exceeds cap 1", n)
	}
}

// TestCoordinatorConcurrencyCap proves encoder slots stay bounded under
// parallel pressure from both lanes.
func TestCoordinatorConcurrencyCap(t *testing.T) {
	deps := coordDeps(t)
	dir := t.TempDir()
	cache := testCache(t)
	coord := NewCoordinator(cache, FFmpegSettings{}, deps, 2)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rev := string(rune('a' + i))
			path := slowTone(t, dir, "p"+rev+".wav", 6)
			lane := LaneFreeplay
			if i%2 == 0 {
				lane = LaneShared
			}
			_, _ = coord.Acquire(ctx, lane, RenderRequest{
				TrackID: "t" + rev, AbsPath: path, Kind: "stream", Extension: "wav",
				SourceRevision: "rev:cap-" + rev, BitrateKbps: 96})
		}(i)
	}
	wg.Wait()
	if n := coord.MaxObservedConcurrency(); n > 2 {
		t.Fatalf("max concurrency=%d exceeds cap 2", n)
	}
}
