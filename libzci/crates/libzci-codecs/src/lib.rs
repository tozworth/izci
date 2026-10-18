//! Codec providers over compiled reference media libraries.
//!
//! - `opus`: reference Opus (Ogg packet reader plus packet-level
//!   libopus decode).
//! - `openmpt`: tracker modules over libopenmpt 0.8.4 (Phase 1.4).
//! - `hively`: AHX/HVL over the instance-safe context wrapper in `c/`
//!   (Phase 1.4; lifecycle now, audible fixtures later).

#[cfg(feature = "modules")]
pub mod hively;
#[cfg(feature = "modules")]
pub mod hively_ffi;
#[cfg(feature = "modules")]
pub mod openmpt;
#[cfg(feature = "modules")]
pub mod openmpt_ffi;
#[cfg(feature = "opus")]
pub mod opus;
pub mod opus_ffi;
#[cfg(feature = "opus")]
mod opusfile_ffi;

#[cfg(test)]
pub mod test_helpers;

#[cfg(feature = "modules")]
pub use hively::{HivelyFactory, HivelyInstance, HivelyLimits};
#[cfg(feature = "modules")]
pub use openmpt::{ModuleInfo, OpenmptFactory, OpenmptInstance, OpenmptLimits};
#[cfg(feature = "opus")]
pub use opus::{OpusFactory, OpusInstance, OpusLimits};
