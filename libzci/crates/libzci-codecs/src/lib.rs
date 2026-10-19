//! Codec providers over compiled reference media libraries.
//!
//! - `opus`: reference libopusfile callbacks, trim/gain, float decode and seek.
//! - `openmpt`: tracker modules over libopenmpt 0.8.4, with M1 jobs/controls.
//! - `hively`: AHX/HVL over the instance-safe context wrapper in `c/`
//!   (M1 audible AHX/HVL fixtures, stepped jobs and bounded inspection).

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
