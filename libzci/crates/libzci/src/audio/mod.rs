//! Shared audio execution types.
//!
//! - [`pcm`]: normalized float transport (Phase 1.1).
//! - [`output`]: bounded preparation and platform-neutral output descriptors.
//! - [`clock`]: audible output clock and requested/running states.
//! - [`resampler`]: device-rate conversion over pinned rubato.
//! - [`processor`]: channel mapping plus master gain/mute with the
//!   raw-program tap point (ReplayGain/Raf arrive later).

pub mod clock;
pub mod output;
pub mod pcm;
pub mod processor;
pub mod resampler;

pub use clock::{MediaClock, RequestedState, RunningState};
pub use output::{OutputBlock, OutputPreparation};
pub use processor::AudioProcessor;
pub use resampler::RateConverter;
