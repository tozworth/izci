//! Browser control bindings for libzci. The engine worker owns the same Session
//! as native; decoder workers report tagged facts and use shared bounded output
//! preparation. An independent libzci-audio-web WASM runs processing/clock code
//! in the worklet. FileReaderSync, codec calls, ports and AudioContext are adapter
//! mechanisms in consumers/crude-pwa. Demux helpers remain available for later
//! optional packet providers, outside the production reference timeline.
pub mod demux;
pub mod engine;
#[cfg(target_arch = "wasm32")]
pub mod bindings;
pub use demux::OggDemux;
pub use engine::Engine;
