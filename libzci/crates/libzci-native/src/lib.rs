//! Native adapter for libzci: file sources and minimal runtime.
//!
//! Phase 1.1: bounded seekable file sources plus session-serialized
//! runtime assembly. Device output (CPAL), SQLite, and GUI arrive in
//! later phases through their own modules.

pub mod runtime;
pub mod source;

pub use runtime::NativeRuntime;
pub use source::NativeFileSource;
