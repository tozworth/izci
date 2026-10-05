//! Codec providers over compiled reference media libraries.
//!
//! Phase 1.2: the reference Opus provider. Module providers (libopenmpt,
//! Hively) land in Phase 1.4 with their own modules and the instance-safe
//! C wrappers under `c/`.

pub mod opus;
pub mod opus_ffi;

pub use opus::{OpusFactory, OpusInstance, OpusLimits};
