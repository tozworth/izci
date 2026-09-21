// Package host implements the izci-server dedicated host: a valid izci
// Multiplayer host that does not run the web application.
//
// Roles are separable: signaling lives in internal/signaling, the app-channel
// host lives here. Combined mode (serve) runs both in one process but the
// host reaches signaling only through the same socket contract a remote host
// uses, never through private signaling registry state.
//
// Every independently controlled playback stream is a Session: the room owns
// one permanent shared session, each active Freeplay peer owns an independent
// session. Clocks, generations, preparation barriers, seek epochs, queues,
// and delivery state are session-scoped. The catalog, decoder limits,
// configuration, and peer registry are server-scoped. Rendered bytes are
// cache entries, not session state.
//
// Phase 1 uses an injected fake delivery backend; real FFmpeg/libopenmpt/
// Hively rendering lands in later phases.
package host
