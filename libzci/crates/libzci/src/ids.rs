//! Runtime identity types.
//!
//! Every object that crosses the core/adapter/consumer boundary carries a
//! typed ID. Queue occurrence IDs, catalog media IDs, and durable
//! source-reference IDs arrive in later phases; this module defines the
//! runtime set needed for source/provider/session operation:
//!
//! - [`SourceId`]: one registered runtime source handle.
//! - [`SessionId`]: one playback session with its own generation counter.
//! - [`RequestId`]: one consumer command submission.
//! - [`Generation`]: validity epoch inside a session. A later seek/load
//!   increments it; output tagged with an older generation is stale and
//!   must be discarded, never rendered or published as authoritative.
//! - [`Revision`]: monotonically increasing snapshot version for observers.

use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_SOURCE: AtomicU64 = AtomicU64::new(1);
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
static NEXT_REQUEST: AtomicU64 = AtomicU64::new(1);

/// Registered runtime source handle.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct SourceId(pub u64);

impl SourceId {
    /// Allocate a fresh ID. IDs are never reused within a process.
    pub fn fresh() -> Self {
        Self(NEXT_SOURCE.fetch_add(1, Ordering::Relaxed))
    }
}

/// One playback session. Each session owns its generation counter,
/// transport state, decoder instance, and bounded PCM buffers.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct SessionId(pub u64);

impl SessionId {
    /// Allocate a fresh ID. IDs are never reused within a process.
    pub fn fresh() -> Self {
        Self(NEXT_SESSION.fetch_add(1, Ordering::Relaxed))
    }
}

/// One consumer command submission. Used to match acceptance,
/// completion/failure, and cancellation at transport seams and to
/// suppress duplicate delivery.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct RequestId(pub u64);

impl RequestId {
    /// Allocate a fresh ID.
    pub fn fresh() -> Self {
        Self(NEXT_REQUEST.fetch_add(1, Ordering::Relaxed))
    }
}

/// Validity epoch inside a session.
///
/// Incremented on every load/seek/stop that invalidates previously
/// produced PCM. Decoders, workers, and output stages tag their results
/// with the generation they were produced for; the session commits only
/// results matching the current generation.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Generation(pub u64);

impl Generation {
    /// The initial generation of a new session.
    pub const INITIAL: Self = Self(0);

    /// Move to the next generation, invalidating outstanding work.
    pub fn bump(&mut self) -> Self {
        self.0 = self.0.wrapping_add(1);
        *self
    }
}

/// Monotonically increasing snapshot version.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Revision(pub u64);

impl Revision {
    /// The revision before any state change.
    pub const INITIAL: Self = Self(0);

    /// Move to the next revision after a committed state change.
    pub fn bump(&mut self) -> Self {
        self.0 = self.0.wrapping_add(1);
        *self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_within_process() {
        assert_ne!(SourceId::fresh(), SourceId::fresh());
        assert_ne!(SessionId::fresh(), SessionId::fresh());
        assert_ne!(RequestId::fresh(), RequestId::fresh());
    }

    #[test]
    fn generation_ordering_detects_stale_output() {
        let mut gen = Generation::INITIAL;
        let old = gen;
        let next = gen.bump();
        assert!(next > old);
    }
}
