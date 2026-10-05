//! Shared audio execution types (moved here in Phase 2.1).
//!
//! Phase 1.1 only needs PCM transport ([`pcm`]); processing, buffering,
//! clock, and resampling land with native device output in 2.1 and are
//! re-exported from their modules there.

pub mod pcm;
