//! Codec providers over compiled reference media libraries.
//!
//! - `opus`: reference Opus (Ogg packet reader plus packet-level
//!   libopus decode).
//! - `openmpt`: tracker modules over libopenmpt 0.8.4 (Phase 1.4).
//! - `hively`: AHX/HVL over the instance-safe context wrapper in `c/`
//!   (Phase 1.4; lifecycle now, audible fixtures later).

pub mod hively;
pub mod hively_ffi;
pub mod openmpt;
pub mod openmpt_ffi;
pub mod opus;
pub mod opus_ffi;

#[cfg(test)]
pub mod test_helpers;

pub use hively::{HivelyFactory, HivelyInstance, HivelyLimits};
pub use openmpt::{ModuleInfo, OpenmptFactory, OpenmptInstance, OpenmptLimits};
pub use opus::{OpusFactory, OpusInstance, OpusLimits};
