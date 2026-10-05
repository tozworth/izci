//! `libzci` is the reusable izci engine core.
//!
//! The core owns application behavior and reusable media processing:
//! playback sessions, catalog/user facts, source and provider selection,
//! audio processing, video transport/timing policy, artwork/image jobs,
//! durable domain state (SQL statements/schema/transactions), and
//! contextual loadout matching. See `docs/libzci/boundaries.md`.
//!
//! Platform adapters own access and execution mechanisms (files and
//! grants, SQLite filesystem/VFS setup, audio devices, OS decoders,
//! rendering surfaces, lifecycle/install hooks). Shells and consumers
//! own presentation and issue typed commands; they render the snapshots
//! and events this crate publishes.
//!
//! Dependency direction is one-way: codec providers depend on this
//! crate's provider contracts, adapters depend on its access/output/SQLite
//! contracts, and consumers assemble adapters/providers and call this
//! public interface. This crate has no browser, device, Tauri, Svelte,
//! or Go dependency.
