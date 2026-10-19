//! Optional WebCodecs uses the shared CRC/lacing reader and Opus header policy.
//! One page and its packets are retained; chained content stays on reference.
use crate::audio_decoder::FileSource;
use libzci::*;
use std::{collections::VecDeque, sync::Arc};
use wasm_bindgen::prelude::*;
fn js(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}
#[wasm_bindgen]
pub struct WebOpusPackets {
    source: Arc<dyn RuntimeSource>,
    offset: u64,
    sequence: u32,
    serial: Option<u32>,
    carry: Vec<u8>,
    packets: VecDeque<Vec<u8>>,
    eof: bool,
    params: OpusStreamParams,
}
#[wasm_bindgen]
impl WebOpusPackets {
    pub fn duration(packet:&[u8])->std::result::Result<u32,JsValue> { libzci::format::opus_packet_frames(packet).map_err(js) }
    #[wasm_bindgen(constructor)]
    pub fn new(id: u32, len: f64) -> std::result::Result<Self, JsValue> {
        let source: Arc<dyn RuntimeSource> = Arc::new(FileSource {
            id,
            len: len as u64,
        });
        let mut result = Self {
            source,
            offset: 0,
            sequence: 0,
            serial: None,
            carry: Vec::new(),
            packets: VecDeque::new(),
            eof: false,
            params: OpusStreamParams {
                channels: 0,
                preskip: 0,
                gain_q8: 0,
                family: 0,
            },
        };
        result.page().map_err(js)?;
        let head = result
            .packets
            .pop_front()
            .ok_or_else(|| js("missing OpusHead"))?;
        result.params = parse_opus_head_packet(&head).map_err(js)?;
        Ok(result)
    }
    pub fn facts(&self) -> String {
        serde_json::json!({"channels":self.params.channels,"preskip":self.params.preskip,"gain":self.params.gain_linear().unwrap_or(1.0)}).to_string()
    }
    pub fn next(&mut self) -> std::result::Result<js_sys::Uint8Array, JsValue> {
        loop {
            if let Some(packet) = self.packets.pop_front() {
                if packet.starts_with(b"OpusTags") {
                    parse_opus_tags_packet(&packet).map_err(js)?;
                    continue;
                }
                if packet.len() > 65536 {
                    return Err(js("Opus packet exceeds budget"));
                }
                return Ok(js_sys::Uint8Array::from(packet.as_slice()));
            }
            if self.eof {
                return Ok(js_sys::Uint8Array::new_with_length(0));
            }
            self.page().map_err(js)?;
        }
    }
}
impl WebOpusPackets {
    fn page(&mut self) -> Result<()> {
        let cancel = CancelFlag::default();
        let scan = PageScanner::new(&self.source, &cancel);
        let entry = scan
            .read_page_entry(self.offset)?
            .ok_or_else(|| LibzciError::Corrupt {
                detail: "Opus EOF without EOS page".into(),
            })?;
        if entry.seq != self.sequence
            || self.serial.is_some_and(|s| s != entry.serial)
            || (self.sequence > 0 && entry.header_type & 2 != 0)
        {
            return Err(LibzciError::Unsupported {
                detail: "optional WebCodecs requires a contiguous single Ogg link".into(),
            });
        }
        self.serial = Some(entry.serial);
        self.sequence += 1;
        let header = scan.read_at(entry.offset, entry.header_len as usize)?;
        let body = scan.read_at(entry.offset + entry.header_len, entry.body_len as usize)?;
        if body.len() != entry.body_len as usize
            || ogg_crc(&header, &body, 22) != u32::from_le_bytes(header[22..26].try_into().unwrap())
        {
            return Err(LibzciError::Corrupt {
                detail: "Opus page checksum/truncation".into(),
            });
        }
        self.packets =
            split_packets_with_carry(&body, &header[27..], &mut self.carry, entry.header_type)?
                .into();
        if self.carry.len() > 65536 {
            return Err(LibzciError::ResourceExhausted {
                detail: "Opus packet carry exceeds budget".into(),
            });
        }
        self.offset += entry.header_len + entry.body_len;
        self.eof = entry.header_type & 4 != 0;
        if self.eof
            && (!self.carry.is_empty() || self.offset != self.source.len().unwrap_or(self.offset))
        {
            return Err(LibzciError::Unsupported {
                detail: "optional WebCodecs declines chained/trailing Ogg data".into(),
            });
        }
        Ok(())
    }
}

/// Shared audible timeline: raw packet PCM -> pre-skip / seek discard /
/// mandatory header gain / end trim. WebCodecs is configured without an
/// OpusHead description so it cannot apply a second pre-skip or header gain.
#[wasm_bindgen]
pub struct WebOpusTimeline {
    raw: u64,
    total: u64,
    preskip: u64,
    channels: usize,
    gain: f32,
    target: u64,
    position: u64,
}
#[wasm_bindgen]
impl WebOpusTimeline {
    #[wasm_bindgen(constructor)]
    pub fn new(
        total: f64,
        preskip: u32,
        channels: u32,
        gain: f32,
        target: f64,
    ) -> std::result::Result<Self, JsValue> {
        if channels < 1
            || channels > 2
            || !gain.is_finite()
            || gain < 0.0
            || !target.is_finite()
            || target < 0.0
        {
            return Err(js("invalid Opus timeline"));
        }
        let target = (target as u64).min(total as u64);
        Ok(Self {
            raw: 0,
            total: total as u64,
            preskip: preskip as u64,
            channels: channels as usize,
            gain,
            target,
            position: target,
        })
    }
    pub fn position(&self) -> f64 {
        self.position as f64
    }
    pub fn accept(&mut self, samples: &[f32]) -> std::result::Result<Vec<f32>, JsValue> {
        if samples.len() % self.channels != 0
            || samples.len() > 11520
            || samples.iter().any(|s| !s.is_finite())
        {
            return Err(js("invalid WebCodecs PCM"));
        }
        let frames = (samples.len() / self.channels) as u64;
        let start = self.raw.max(self.preskip + self.target);
        let end = (self.raw + frames).min(self.preskip + self.total);
        let mut out = Vec::with_capacity(end.saturating_sub(start) as usize * 2);
        for f in start..end {
            let i = (f - self.raw) as usize * self.channels;
            out.push(samples[i] * self.gain);
            out.push(samples[i + self.channels - 1] * self.gain);
        }
        self.raw += frames;
        if end > start {
            self.position = end - self.preskip;
        }
        Ok(out)
    }
}
