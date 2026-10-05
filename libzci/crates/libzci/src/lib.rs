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

pub mod audio;
pub mod command;
pub mod error;
pub mod event;
pub mod format;
pub mod ids;
pub mod ogg_reader;
pub mod provider;
pub mod session;
pub mod source;

pub use audio::pcm::{ChannelLayout, PcmChunk, PcmLayout};
pub use audio::{AudioProcessor, OutputClock, PcmRing, RateConverter, RequestedState, RunningState};
pub use command::{Command, CommandAccept};
pub use error::{LibzciError, Result};
pub use event::{Event, EventQueue, Snapshot};
pub use format::{
    HivelyKind, ModuleFamily, OpusStreamParams, OpusTags, is_hively_extension_hint,
    is_module_extension_hint, is_opus_extension_hint, parse_opus_head_packet, parse_opus_tags_packet,
    sniff_module_family, sniff_opus_head_page,
};
pub use ids::{Generation, RequestId, Revision, SessionId, SourceId};
pub use ogg_reader::{GRANULE_NONE, MAX_SINGLE_READ, IndexFacts, PageEntry, PageScanner, ogg_crc, split_packets_with_carry, validate_ogg_index};
pub use provider::{
    AppliedAdjustments, DecoderInstance, PROBE_BYTES, ProbeInput, ProbeScore, ProviderFactory,
    ProviderId, ProviderInfo, ProviderMetadata, ProviderRegistry, decode_chunk,
};
pub use session::{PcmCollector, Session, TransportState};
pub use source::{CancelFlag, MemSource, RuntimeSource, SourceCaps};
