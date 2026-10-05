//! wasm-bindgen surface for the engine and demux workers.
//!
//! Control crosses as JSON strings (small); PCM crosses as raw `f32`
//! slices (transferable `Float32Array`s, never JSON). Every method that
//! can fail returns a `Result<JsValue, JsValue>` with
//! `{kind, detail}` errors so the page renders typed failures.

use wasm_bindgen::prelude::*;

use crate::engine::{Engine, EngineCommand};

/// Opaque engine handle: the worker holds a `u32` id, never internals.
#[wasm_bindgen]
pub struct WebEngine {
    engine: Engine,
}

#[wasm_bindgen]
impl WebEngine {
    /// Create with the browser Opus provider registered.
    #[wasm_bindgen(constructor)]
    pub fn new() -> WebEngine {
        WebEngine { engine: Engine::new() }
    }

    /// Registered provider IDs for diagnostics.
    pub fn provider_ids(&self) -> String {
        let ids: Vec<&str> = self.engine.provider_ids().iter().map(|id| id.0).collect();
        serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into())
    }

    /// Create one idle session; returns the numeric session id.
    pub fn create_session(&mut self) -> u64 {
        self.engine.create_session().0
    }

    /// Open on header bytes (`Uint8Array`, ≤ 8 KiB) with an optional
    /// extension hint. Returns the snapshot JSON.
    pub fn open_header(
        &mut self,
        session: u64,
        header: &[u8],
        extension_hint: Option<String>,
    ) -> Result<String, JsValue> {
        let snapshot = self
            .engine
            .open_header(libzci::SessionId(session), header.to_vec(), extension_hint.as_deref())
            .map_err(err_to_js)?;
        serde_json::to_string(&SnapshotDto::from(&snapshot)).map_err(err_to_js)
    }

    /// Commit a scanned page index (`pages` JSON from the decode
    /// worker) after cross-checking its header parse. Returns
    /// `{total_frames, audio_start_page, audio_start_packet}` JSON.
    pub fn commit_index(
        &mut self,
        session: u64,
        pages_json: &str,
        audio_start_page: usize,
        audio_start_packet: usize,
        reported_preskip: u64,
        reported_channels: u8,
    ) -> Result<String, JsValue> {
        let pages: Vec<PageDto> = serde_json::from_str(pages_json).map_err(err_to_js)?;
        let entries: Vec<libzci::PageEntry> = pages.iter().map(|dto| libzci::PageEntry::from(dto)).collect();
        let (total, page, packet) = self
            .engine
            .commit_index(
                libzci::SessionId(session),
                entries,
                audio_start_page,
                audio_start_packet,
                reported_preskip,
                reported_channels,
            )
            .map_err(err_to_js)?;
        serde_json::to_string(&serde_json::json!({
            "total_frames": total,
            "audio_start_page": page,
            "audio_start_packet": packet,
        }))
        .map_err(err_to_js)
    }

    /// Ingest worker PCM (`Float32Array`) tagged with its generation.
    /// Stale generations throw `{kind: "cancelled"}` (counted, never
    /// queued). Returns `{accepted_frames, position_frames}` JSON.
    pub fn ingest_pcm(
        &mut self,
        session: u64,
        generation: u64,
        start_frame: u64,
        pcm: &[f32],
    ) -> Result<String, JsValue> {
        let (accepted, position) = self
            .engine
            .ingest_pcm(
                libzci::SessionId(session),
                libzci::Generation(generation),
                start_frame,
                pcm.to_vec(),
            )
            .map_err(err_to_js)?;
        serde_json::to_string(&serde_json::json!({
            "accepted_frames": accepted,
            "position_frames": position,
        }))
        .map_err(err_to_js)
    }

    /// Note end of stream for a generation. Returns `false` for stale
    /// notes (ignored, not an error).
    pub fn note_eof(&mut self, session: u64, generation: u64) -> Result<bool, JsValue> {
        self.engine
            .note_eof(libzci::SessionId(session), libzci::Generation(generation))
            .map_err(err_to_js)
    }

    /// Pump decoded PCM through the core session. Returns
    /// `{generation, position_frames} | null` (null is pending, not EOF).
    pub fn pump(&mut self, session: u64, max_samples: usize) -> Result<String, JsValue> {
        let pumped = self.engine.pump(libzci::SessionId(session), max_samples).map_err(err_to_js)?;
        match pumped {
            Some((generation, position)) => serde_json::to_string(&serde_json::json!({
                "generation": generation.0,
                "position_frames": position,
            }))
            .map_err(err_to_js),
            None => Ok("null".into()),
        }
    }

    /// Play/pause/stop/seek/dispose through the core session. Returns
    /// `{accept, events, snapshot | null}` JSON.
    pub fn command(&mut self, session: u64, kind: &str, frame: u64) -> Result<String, JsValue> {
        let command = match kind {
            "play" => EngineCommand::Play,
            "pause" => EngineCommand::Pause,
            "stop" => EngineCommand::Stop,
            "seek" => EngineCommand::Seek { frame },
            "dispose" => EngineCommand::Dispose,
            _ => return Err(err_to_js(libzci::LibzciError::InvalidArgument {
                detail: format!("unknown engine command {kind:?}"),
            })),
        };
        let (accept, events, snapshot) = self.engine.command(libzci::SessionId(session), command).map_err(err_to_js)?;
        serde_json::to_string(&serde_json::json!({
            "generation": accept.generation.0,
            "request_id": accept.request_id.0,
            "events": events.len(),
            "snapshot": snapshot.as_ref().map(SnapshotDto::from),
        }))
        .map_err(err_to_js)
    }

    /// Plan a decode start for `target` on a committed index.
    /// Returns `{start_page, skip_packets, skip_samples, total_frames}`.
    pub fn seek_plan(&mut self, session: u64, target: u64) -> Result<String, JsValue> {
        let (plan, total) = self.engine.plan_seek(libzci::SessionId(session), target).map_err(err_to_js)?;
        serde_json::to_string(&serde_json::json!({
            "start_page": plan.start_page,
            "skip_packets": plan.skip_packets,
            "skip_samples": plan.skip_samples,
            "total_frames": total,
        }))
        .map_err(err_to_js)
    }

    /// Current snapshot JSON for the page.
    pub fn snapshot(&self, session: u64) -> Result<String, JsValue> {
        let snapshot = self.engine.snapshot(libzci::SessionId(session)).map_err(err_to_js)?;
        serde_json::to_string(&SnapshotDto::from(&snapshot)).map_err(err_to_js)
    }
}

fn err_to_js<E: ToString>(error: E) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[derive(serde::Serialize)]
struct SnapshotDto<'a> {
    session: u64,
    revision: u64,
    generation: u64,
    state: &'a str,
    provider: Option<ProviderDto>,
    position_frames: u64,
    total_frames: Option<u64>,
    error: Option<String>,
}

#[derive(serde::Serialize)]
struct ProviderDto {
    id: String,
    version: String,
    display_name: String,
}

impl<'a> From<&'a libzci::Snapshot> for SnapshotDto<'a> {
    fn from(snapshot: &'a libzci::Snapshot) -> Self {
        Self {
            session: snapshot.session.0,
            revision: snapshot.revision.0,
            generation: snapshot.generation.0,
            state: match snapshot.state {
                libzci::TransportState::Idle => "idle",
                libzci::TransportState::Loading => "loading",
                libzci::TransportState::Ready => "ready",
                libzci::TransportState::Playing => "playing",
                libzci::TransportState::Ended => "ended",
                libzci::TransportState::Failed => "failed",
                libzci::TransportState::OutputSuspended => "output-suspended",
            },
            provider: snapshot.provider.map(|p| ProviderDto {
                id: p.id.0.into(),
                version: p.version.into(),
                display_name: p.display_name.into(),
            }),
            position_frames: snapshot.position_frames,
            total_frames: snapshot.total_frames,
            error: snapshot.error.as_ref().map(|e| e.to_string()),
        }
    }
}

#[derive(serde::Deserialize)]
struct PageDto {
    offset: u64,
    /// `-1` encodes a missing granule (see `feed_header`).
    granule: i64,
    serial: u32,
    seq: u32,
    header_type: u8,
    header_len: u64,
    body_len: u64,
}

impl From<&PageDto> for libzci::PageEntry {
    fn from(dto: &PageDto) -> Self {
        libzci::PageEntry {
            offset: dto.offset,
            granule: if dto.granule < 0 {
                libzci::GRANULE_NONE
            } else {
                dto.granule as u64
            },
            serial: dto.serial,
            seq: dto.seq,
            header_type: dto.header_type,
            header_len: dto.header_len,
            body_len: dto.body_len,
        }
    }
}

/// Worker-side Ogg demux: incremental header scan plus packet splits
/// with continued-packet carry. Packet buffers transfer to the caller.
#[wasm_bindgen]
pub struct WebDemux {
    demux: crate::demux::OggDemux,
}

#[wasm_bindgen]
impl WebDemux {
    /// Create an empty demuxer.
    #[wasm_bindgen(constructor)]
    pub fn new() -> WebDemux {
        WebDemux { demux: crate::demux::OggDemux::new() }
    }

    /// Feed one page header; returns the entry JSON. A missing
    /// granule (`GRANULE_NONE`) serializes as `-1`: raw `u64::MAX`
    /// would lose precision in JSON numbers.
    pub fn feed_header(&mut self, fixed27: &[u8], lacing: &[u8], offset: u64) -> Result<String, JsValue> {
        let entry = self.demux.feed_header(fixed27, lacing, offset).map_err(err_to_js)?;
        let granule = if entry.granule == libzci::GRANULE_NONE {
            -1i64
        } else if entry.granule > i64::MAX as u64 {
            return Err(err_to_js("granule position out of range"));
        } else {
            entry.granule as i64
        };
        serde_json::to_string(&serde_json::json!({
            "offset": entry.offset,
            "granule": granule,
            "serial": entry.serial,
            "seq": entry.seq,
            "header_type": entry.header_type,
            "header_len": entry.header_len,
            "body_len": entry.body_len,
        }))
        .map_err(err_to_js)
    }

    /// Split one page body; returns an array of `Uint8Array` packets.
    pub fn split_page(&mut self, body: &[u8], lacing: &[u8], header_type: u8) -> Result<JsValue, JsValue> {
        let packets = self.demux.split_page(body, lacing, header_type).map_err(err_to_js)?;
        let array = js_sys::Array::new();
        for packet in &packets {
            array.push(&js_sys::Uint8Array::from(packet.as_slice()));
        }
        Ok(array.into())
    }

    /// Clear continued-packet carry (seek repositioning).
    pub fn reset_carry(&mut self) {
        self.demux.reset_carry();
    }
}
