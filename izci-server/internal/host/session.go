package host

import (
	"fmt"
	"sync"
)

// RepeatMode mirrors the app protocol repeat mode.
type RepeatMode string

const (
	RepeatOff RepeatMode = "off"
	RepeatOne RepeatMode = "one"
	RepeatAll RepeatMode = "all"
)

// DeliveryMode mirrors the app protocol delivery mode.
type DeliveryMode string

const (
	DeliveryNone       DeliveryMode = "none"
	DeliveryStream     DeliveryMode = "stream"
	DeliverySourceFile DeliveryMode = "source-file"
	DeliveryRender     DeliveryMode = "render"
)

// PlaybackState mirrors the snapshot state.
type PlaybackState string

const (
	StateIdle    PlaybackState = "idle"
	StateLoading PlaybackState = "loading"
	StatePlaying PlaybackState = "playing"
	StatePaused  PlaybackState = "paused"
	StateEnded   PlaybackState = "ended"
	StateError   PlaybackState = "error"
)

// SessionKind distinguishes the permanent shared session from per-peer
// Freeplay sessions.
type SessionKind string

const (
	SessionShared   SessionKind = "shared"
	SessionFreeplay SessionKind = "freeplay"
)

// Clock is the per-session host-authoritative playback clock.
type Clock struct {
	GenerationID    string
	State           PlaybackState
	PositionSeconds float64
	DurationSeconds float64
	StartedAtMs     int64
	UpdatedAtMs     int64
}

// Delivery describes the current delivery generation.
type Delivery struct {
	GenerationID string
	TrackID      *string
	Mode         DeliveryMode
	Reason       *string
}

// Preparation is a pending synchronized-start barrier. Shared playback waits
// on every subscribed peer; Freeplay waits only on its owning peer.
type Preparation struct {
	GenerationID string
	TrackID      string
	Delivery     DeliveryMode
	Epoch        int
	Pending      map[string]bool
	Ready        map[string]bool
}

// Session is one independently controlled playback stream. All mutable state
// is guarded by mu; there is no process-global current track.
type Session struct {
	mu sync.Mutex

	id         string
	kind       SessionKind
	controller string // "shared" or owning peer ID

	subscribers map[string]bool
	queue       []string
	upNext      []string
	shuffle     bool
	repeat      RepeatMode

	currentTrackID *string
	clock          Clock
	delivery       Delivery
	preparation    *Preparation

	seekEpoch         int
	generationCounter int

	nowMs func() int64
	// startLeadMs is the synchronized-start lead (250..3000, default 1000).
	startLeadMs int64

	deliveryBackend DeliveryBackend
}

// SessionConfig carries per-session construction parameters.
type SessionConfig struct {
	ID          string
	Kind        SessionKind
	Controller  string
	NowMs       func() int64
	StartLeadMs int64
	Backend     DeliveryBackend
}

// NewSession builds a session. Backend may be nil (defaults to fake none).
func NewSession(cfg SessionConfig) *Session {
	now := cfg.NowMs
	if now == nil {
		now = func() int64 { return 0 }
	}
	lead := cfg.StartLeadMs
	if lead < 250 || lead > 3000 {
		lead = 1000
	}
	backend := cfg.Backend
	if backend == nil {
		backend = FakeDelivery{}
	}
	return &Session{
		id:              cfg.ID,
		kind:            cfg.Kind,
		controller:      cfg.Controller,
		subscribers:     make(map[string]bool),
		repeat:          RepeatOff,
		nowMs:           now,
		startLeadMs:     lead,
		deliveryBackend: backend,
		clock:           Clock{State: StateIdle},
		delivery:        Delivery{Mode: DeliveryNone},
	}
}

// ID returns the session ID.
func (s *Session) ID() string {
	return s.id
}

// Kind returns the session kind.
func (s *Session) Kind() SessionKind {
	return s.kind
}

// Controller returns the session controller.
func (s *Session) Controller() string {
	return s.controller
}

// Subscribe adds a peer to the shared timeline. Freeplay sessions normally
// have exactly one subscriber (the owner); the method still enforces
// session scope so tests can prove isolation.
func (s *Session) Subscribe(peerID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.subscribers[peerID] = true
}

// Unsubscribe removes a peer. If it was the last pending member of a
// preparation barrier, the remaining subscribers may start immediately.
// A Freeplay owner leaving does not touch the shared session.
func (s *Session) Unsubscribe(peerID string) (bool, Clock, int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.subscribers, peerID)
	if s.preparation == nil {
		return false, s.clock, 0
	}
	if _, pending := s.preparation.Pending[peerID]; !pending {
		return false, s.clock, 0
	}
	delete(s.preparation.Pending, peerID)
	if len(s.preparation.Pending) != 0 {
		return false, s.clock, 0
	}
	startAt := s.nowMs() + s.startLeadMs
	s.clock.State = StatePlaying
	s.clock.StartedAtMs = startAt
	s.clock.PositionSeconds = 0
	s.preparation = nil
	return true, s.clock, startAt
}

// Subscribers returns a copy of the subscriber set.
func (s *Session) Subscribers() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.subscribers))
	for id := range s.subscribers {
		out = append(out, id)
	}
	return out
}

// SetQueue replaces the session queue. Host-authoritative.
func (s *Session) SetQueue(ids []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.queue = append([]string(nil), ids...)
}

// Queue returns a copy of the queue.
func (s *Session) Queue() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.queue...)
}

// UpNext returns a copy of the play-next list.
func (s *Session) UpNext() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.upNext...)
}

// ShuffleEnabled reports the shuffle flag.
func (s *Session) ShuffleEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.shuffle
}

// RepeatMode reports the repeat mode.
func (s *Session) RepeatMode() RepeatMode {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.repeat
}

// CurrentTrackID returns the current track, if any.
func (s *Session) CurrentTrackID() *string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.currentTrackID == nil {
		return nil
	}
	cpy := *s.currentTrackID
	return &cpy
}

// Snapshot returns copies of clock, delivery, and preparation.
func (s *Session) Snapshot() (Clock, Delivery, *Preparation) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var prep *Preparation
	if s.preparation != nil {
		pcpy := *s.preparation
		pcpy.Pending = copySet(s.preparation.Pending)
		pcpy.Ready = copySet(s.preparation.Ready)
		prep = &pcpy
	}
	var trackCpy *string
	if s.delivery.TrackID != nil {
		v := *s.delivery.TrackID
		trackCpy = &v
	}
	del := s.delivery
	del.TrackID = trackCpy
	return s.clock, del, prep
}

// SeekEpoch reports the current seek epoch.
func (s *Session) SeekEpoch() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.seekEpoch
}

func copySet(in map[string]bool) map[string]bool {
	out := make(map[string]bool, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// nextGeneration mints a session-scoped opaque generation ID. Callers hold mu.
func (s *Session) nextGenerationLocked() string {
	s.generationCounter++
	return fmt.Sprintf("%s-g%d", s.id, s.generationCounter)
}

// ToggleShuffle flips the shuffle flag. Shuffled order is deterministic
// (reverse of queue order) so tests stay deterministic while proving
// per-session isolation.
func (s *Session) ToggleShuffle() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.shuffle = !s.shuffle
	return s.shuffle
}

// SetRepeat cycles off -> all -> one -> off and returns the new mode.
func (s *Session) CycleRepeat() RepeatMode {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch s.repeat {
	case RepeatOff:
		s.repeat = RepeatAll
	case RepeatAll:
		s.repeat = RepeatOne
	default:
		s.repeat = RepeatOff
	}
	return s.repeat
}

// PlayNext inserts items immediately after the current track.
func (s *Session) PlayNext(ids []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Prepend to upNext so the first ID plays next.
	rev := append([]string(nil), ids...)
	for i, j := 0, len(rev)-1; i < j; i, j = i+1, j-1 {
		rev[i], rev[j] = rev[j], rev[i]
	}
	for _, id := range rev {
		s.upNext = append([]string{id}, s.upNext...)
	}
	// Bound the queue like the protocol (50k items).
	if len(s.upNext) > 50000 {
		s.upNext = s.upNext[:50000]
	}
}

// Activate starts playback of one queue item and begins a new delivery
// generation with a preparation barrier over the current subscribers.
func (s *Session) Activate(trackID string) (Clock, Delivery, Preparation) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.startLocked(trackID)
}

// Play resumes from pause, or restarts the current track when idle.
func (s *Session) Play() (Clock, Delivery) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.clock.State == StatePaused {
		s.clock.State = StatePlaying
		s.clock.StartedAtMs = s.nowMs()
		return s.clock, s.delivery
	}
	if s.currentTrackID != nil && s.clock.State != StatePlaying {
		s.clock.State = StatePlaying
		s.clock.StartedAtMs = s.nowMs()
		return s.clock, s.delivery
	}
	return s.clock, s.delivery
}

// Pause pauses playback host-authoritatively.
func (s *Session) Pause() (Clock, Delivery) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.clock.State == StatePlaying {
		// Freeze position at pause time (logical clock; real duration math
		// is owned by the delivery backend in later phases).
		s.clock.State = StatePaused
		s.clock.UpdatedAtMs = s.nowMs()
	}
	return s.clock, s.delivery
}

// Stop clears the current track and cancels preparation.
func (s *Session) Stop() (Clock, Delivery, *string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var cancelled *string
	if s.preparation != nil {
		g := s.preparation.GenerationID
		cancelled = &g
		s.preparation = nil
	}
	s.currentTrackID = nil
	s.clock = Clock{State: StateIdle}
	noTrack := "no-track"
	s.delivery = Delivery{GenerationID: s.nextGenerationLocked(), TrackID: nil, Mode: DeliveryNone, Reason: &noTrack}
	return s.clock, s.delivery, cancelled
}

// CancelGeneration stops only when generationID is still active. Source
// workers use this compare-and-cancel operation after detecting replacement,
// so a stale worker cannot stop a newer user activation.
func (s *Session) CancelGeneration(generationID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if generationID == "" || s.delivery.GenerationID != generationID {
		return false
	}
	s.preparation = nil
	s.currentTrackID = nil
	s.clock = Clock{State: StateIdle}
	reason := "source-replaced"
	s.delivery = Delivery{GenerationID: s.nextGenerationLocked(), Mode: DeliveryNone, Reason: &reason}
	return true
}

// Toggle flips between play and pause.
func (s *Session) Toggle() (Clock, Delivery) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.clock.State == StatePlaying {
		s.clock.State = StatePaused
		s.clock.UpdatedAtMs = s.nowMs()
	} else if s.clock.State == StatePaused {
		s.clock.State = StatePlaying
		s.clock.StartedAtMs = s.nowMs()
	} else if s.currentTrackID != nil {
		s.clock.State = StatePlaying
		s.clock.StartedAtMs = s.nowMs()
	}
	return s.clock, s.delivery
}

// Seek moves the playhead and bumps the seek epoch. Mismatched in-flight
// fragments are dropped by epoch comparison downstream.
func (s *Session) Seek(seconds float64) (Clock, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if seconds < 0 {
		seconds = 0
	}
	if seconds > 604800 {
		seconds = 604800
	}
	s.clock.PositionSeconds = seconds
	s.clock.UpdatedAtMs = s.nowMs()
	s.seekEpoch++
	return s.clock, s.seekEpoch
}

// Next advances to the next track per repeat/shuffle/upNext rules.
func (s *Session) Next() (Clock, Delivery, *Preparation, *string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.repeat == RepeatOne && s.currentTrackID != nil {
		return s.tripleLocked(*s.currentTrackID)
	}
	if len(s.upNext) > 0 {
		next := s.upNext[0]
		s.upNext = s.upNext[1:]
		return s.tripleLocked(next)
	}
	idx := s.indexOfCurrentLocked()
	ordered := s.orderedQueueLocked()
	if idx >= 0 && idx+1 < len(ordered) {
		return s.tripleLocked(ordered[idx+1])
	}
	if s.repeat == RepeatAll && len(ordered) > 0 {
		return s.tripleLocked(ordered[0])
	}
	// End of queue: stop.
	var cancelled *string
	if s.preparation != nil {
		g := s.preparation.GenerationID
		cancelled = &g
		s.preparation = nil
	}
	s.currentTrackID = nil
	s.clock = Clock{State: StateIdle}
	noTrack := "no-track"
	s.delivery = Delivery{GenerationID: s.nextGenerationLocked(), TrackID: nil, Mode: DeliveryNone, Reason: &noTrack}
	return s.clock, s.delivery, nil, cancelled
}

// Previous moves backwards; with repeat-one it restarts the current track.
func (s *Session) Previous() (Clock, Delivery, *Preparation, *string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.repeat == RepeatOne && s.currentTrackID != nil {
		return s.tripleLocked(*s.currentTrackID)
	}
	idx := s.indexOfCurrentLocked()
	ordered := s.orderedQueueLocked()
	if idx > 0 {
		return s.tripleLocked(ordered[idx-1])
	}
	if s.repeat == RepeatAll && len(ordered) > 0 && idx == 0 {
		return s.tripleLocked(ordered[len(ordered)-1])
	}
	if s.currentTrackID != nil {
		return s.tripleLocked(*s.currentTrackID)
	}
	return s.clock, s.delivery, s.preparation, nil
}

// HandleReady records one peer's readiness. It returns true when the barrier
// is satisfied and the caller should emit a synchronized start.
func (s *Session) HandleReady(peerID, generationID string) (bool, Clock, int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.preparation == nil || s.preparation.GenerationID != generationID {
		return false, s.clock, 0
	}
	if _, ok := s.preparation.Pending[peerID]; !ok {
		// Unknown peer or duplicate ready: report barrier state without mutation.
		return len(s.preparation.Pending) == 0, s.clock, 0
	}
	delete(s.preparation.Pending, peerID)
	s.preparation.Ready[peerID] = true
	if len(s.preparation.Pending) != 0 {
		return false, s.clock, 0
	}
	startAt := s.nowMs() + s.startLeadMs
	s.clock.State = StatePlaying
	s.clock.StartedAtMs = startAt
	s.clock.PositionSeconds = 0
	done := s.preparation
	s.preparation = nil
	_ = done
	return true, s.clock, startAt
}

// HandleEnded advances only when the ended generation/track matches the
// session's current delivery. Stale generations are ignored.
func (s *Session) HandleEnded(generationID, trackID string) (Clock, Delivery, *Preparation, *string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.delivery.GenerationID != generationID {
		return s.clock, s.delivery, s.preparation, nil, false
	}
	cur := ""
	if s.currentTrackID != nil {
		cur = *s.currentTrackID
	}
	if cur != trackID {
		return s.clock, s.delivery, s.preparation, nil, false
	}
	if s.repeat == RepeatOne {
		c, d, p, cancelled := s.tripleLocked(cur)
		return c, d, p, cancelled, true
	}
	// Reuse Next logic inline (already holding mu).
	if len(s.upNext) > 0 {
		next := s.upNext[0]
		s.upNext = s.upNext[1:]
		c, d, p, cancelled := s.tripleLocked(next)
		return c, d, p, cancelled, true
	}
	idx := s.indexOfCurrentLocked()
	ordered := s.orderedQueueLocked()
	if idx >= 0 && idx+1 < len(ordered) {
		c, d, p, cancelled := s.tripleLocked(ordered[idx+1])
		return c, d, p, cancelled, true
	}
	if s.repeat == RepeatAll && len(ordered) > 0 {
		c, d, p, cancelled := s.tripleLocked(ordered[0])
		return c, d, p, cancelled, true
	}
	var cancelled *string
	if s.preparation != nil {
		g := s.preparation.GenerationID
		cancelled = &g
		s.preparation = nil
	}
	s.currentTrackID = nil
	s.clock = Clock{State: StateEnded}
	noTrack := "no-track"
	s.delivery = Delivery{GenerationID: s.nextGenerationLocked(), TrackID: nil, Mode: DeliveryNone, Reason: &noTrack}
	return s.clock, s.delivery, nil, cancelled, true
}

// PendingBarrier returns the pending peer set for the current preparation.
func (s *Session) PendingBarrier() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.preparation == nil {
		return nil
	}
	out := make([]string, 0, len(s.preparation.Pending))
	for id := range s.preparation.Pending {
		out = append(out, id)
	}
	return out
}

// --- internals (callers hold mu) ---

func (s *Session) startLocked(trackID string) (Clock, Delivery, Preparation) {
	gen := s.nextGenerationLocked()
	v := trackID
	s.currentTrackID = &v
	mode := s.deliveryBackend.ModeFor(trackID)
	var reason *string
	if mode == DeliveryNone {
		r := "no-track"
		reason = &r
	}
	s.delivery = Delivery{GenerationID: gen, TrackID: &v, Mode: mode, Reason: reason}
	s.clock = Clock{GenerationID: gen, State: StateLoading, PositionSeconds: 0, StartedAtMs: s.nowMs(), UpdatedAtMs: s.nowMs()}
	pending := make(map[string]bool, len(s.subscribers))
	for id := range s.subscribers {
		pending[id] = true
	}
	prep := &Preparation{GenerationID: gen, TrackID: trackID, Delivery: mode, Epoch: s.seekEpoch, Pending: pending, Ready: make(map[string]bool)}
	s.preparation = prep
	cpy := *prep
	cpy.Pending = copySet(prep.Pending)
	cpy.Ready = copySet(prep.Ready)
	return s.clock, s.delivery, cpy
}

func (s *Session) tripleLocked(trackID string) (Clock, Delivery, *Preparation, *string) {
	var cancelled *string
	if s.preparation != nil {
		g := s.preparation.GenerationID
		cancelled = &g
	}
	c, d, p := s.startLocked(trackID)
	return c, d, &p, cancelled
}

func (s *Session) indexOfCurrentLocked() int {
	if s.currentTrackID == nil {
		return -1
	}
	ordered := s.orderedQueueLocked()
	for i, id := range ordered {
		if id == *s.currentTrackID {
			return i
		}
	}
	return -1
}

func (s *Session) orderedQueueLocked() []string {
	if !s.shuffle {
		return s.queue
	}
	// Deterministic shuffle: reverse order.
	out := make([]string, len(s.queue))
	for i, id := range s.queue {
		out[len(s.queue)-1-i] = id
	}
	return out
}
