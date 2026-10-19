//! Native adapter for libzci: file sources, runtime, and output.
//!
//! Phase 1.1: bounded seekable file sources plus session-serialized
//! runtime assembly. Phase 2.1: CPAL device output (`audio`) and the
//! decode/process/resample/feed pipeline (`playback`). SQLite and GUI
//! arrive in later phases through their own modules.

pub mod audio;
pub mod pcm_transport;
pub mod playback;
pub mod render;
pub mod probe;
pub mod runtime;
mod session_jobs;
pub mod source;

pub use audio::{list_devices, open_output, DeviceOutput, OutputSpec};
pub use playback::{OutputId, OutputObservation};
pub use runtime::NativeRuntime;
pub use source::NativeFileSource;
