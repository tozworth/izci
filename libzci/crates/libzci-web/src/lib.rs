//! Browser adapter core for libzci (`libzci-web`).
//!
//! - [`engine`]: the WASM engine facade — core provider selection,
//!   sessions, generation fencing, and snapshots over a feed-driven
//!   host decoder. File bytes and platform decode stay in the decode
//!   worker; only bounded header/index/PCM messages cross.
//! - [`demux`]: the shared Ogg demuxer for the decode worker (same
//!   core reader the native provider uses).
//! - [`bindings`]: wasm-bindgen surface (compiled for
//!   `wasm32-unknown-unknown`; host tests exercise `engine`/`demux`
//!   directly).
//!
//! No DOM, `File`, `AudioDecoder`, or `AudioContext` access here —
//! those are JS-glue concerns in `consumers/crude-pwa/src/`.

pub mod demux;
pub mod engine;

#[cfg(target_arch = "wasm32")]
pub mod bindings;

pub use demux::OggDemux;
pub use engine::{
    BrowserOpusFactory, Engine, EngineCommand, HostDecoder, HostShared, SeekPlan, BROWSER_OPUS_VERSION,
    plan_opus_seek,
};
