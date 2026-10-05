//! Shared audio execution types.
//!
//! - [`pcm`]: normalized float transport (Phase 1.1).
//! - [`buffer`]: preallocated lock-free PCM transport (Phase 2.1).
//! - [`clock`]: audible output clock and requested/running states.
//! - [`resampler`]: device-rate conversion over pinned rubato.
//! - [`processor`]: channel mapping plus master gain/mute with the
//!   raw-program tap point (ReplayGain/Raf arrive later).

pub mod buffer;
pub mod clock;
pub mod pcm;
pub mod processor;
pub mod resampler;

pub use buffer::PcmRing;
pub use clock::{OutputClock, RequestedState, RunningState};
pub use processor::AudioProcessor;
pub use resampler::RateConverter;
