use crate::engine::Engine;
use libzci::*;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

fn js(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}
#[derive(Deserialize)]
struct Tag {
    session: u64,
    instance: u64,
    operation: u64,
    generation: u64,
}
fn parse_tag(s: &str) -> std::result::Result<JobTag, JsValue> {
    let t: Tag = serde_json::from_str(s).map_err(js)?;
    Ok(JobTag {
        session: SessionId(t.session),
        instance: RequestId(t.instance),
        operation: RequestId(t.operation),
        generation: Generation(t.generation),
    })
}
#[wasm_bindgen]
pub struct WebEngine {
    inner: Engine,
}
#[wasm_bindgen]
impl WebEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Engine::default(),
        }
    }
    pub fn command(&mut self, kind: &str, value: f64) -> std::result::Result<String, JsValue> {
        Ok(self.inner.command(kind, value).map_err(js)?.to_string())
    }
    pub fn snapshot(&self) -> String {
        self.inner.snapshot().to_string()
    }
    pub fn opened(
        &mut self,
        tag: &str,
        total: f64,
        position: f64,
    ) -> std::result::Result<bool, JsValue> {
        Ok(self
            .inner
            .opened(parse_tag(tag)?, total as u64, position as u64))
    }
    pub fn landed(&mut self, tag: &str, position: f64) -> std::result::Result<bool, JsValue> {
        Ok(self.inner.session.landed(parse_tag(tag)?, position as u64))
    }
    pub fn eof(&mut self, tag: &str) -> std::result::Result<(), JsValue> {
        self.inner.session.eof(parse_tag(tag)?);
        Ok(())
    }
    pub fn failed(
        &mut self,
        tag: &str,
        kind: &str,
        detail: &str,
    ) -> std::result::Result<bool, JsValue> {
        let detail = detail.to_owned();
        let e = match kind {
            "cancelled" => LibzciError::Cancelled,
            "source-access" => LibzciError::Unavailable { detail },
            "unsupported" => LibzciError::Unsupported { detail },
            "resource-exhausted" => LibzciError::ResourceExhausted { detail },
            "device-unavailable" => LibzciError::DeviceUnavailable { detail },
            _ => LibzciError::DecoderFailure { detail },
        };
        Ok(self.inner.session.failed(parse_tag(tag)?, e))
    }
    pub fn consumed(&mut self, generation: f64, position: f64, finished: bool) {
        self.inner
            .session
            .consumed(Generation(generation as u64), position as u64, finished);
    }
    pub fn output_state(&mut self, state: &str) {
        self.inner.session.output_state(match state {
            "running" => RunningState::Running,
            "suspended" => RunningState::Suspended,
            "failed" => RunningState::Failed,
            _ => RunningState::Closed,
        });
    }
}

/// Shared channel/rate conversion with retained suffix and converter tails.
#[wasm_bindgen]
pub struct WebPreparation {
    prep: OutputPreparation,
    block: Vec<f32>,
    descriptor: String,
}
#[wasm_bindgen]
impl WebPreparation {
    #[wasm_bindgen(constructor)]
    pub fn new(rate: u32, generation: f64) -> std::result::Result<Self, JsValue> {
        Ok(Self {
            prep: OutputPreparation::new(
                PcmLayout::stereo48k(),
                rate,
                4096,
                Generation(generation as u64),
            )
            .map_err(js)?,
            block: vec![0.; 8192],
            descriptor: String::new(),
        })
    }
    pub fn needs_input(&self) -> bool {
        self.prep.needs_input()
    }
    pub fn accept(&mut self, position: f64, samples: &[f32]) -> std::result::Result<(), JsValue> {
        self.prep.accept(position as u64, samples).map_err(js)
    }
    pub fn finish(&mut self) -> std::result::Result<(), JsValue> {
        self.prep.finish().map_err(js)
    }
    pub fn drained(&self) -> bool {
        self.prep.is_drained()
    }
    pub fn retained_bytes(&self) -> usize {
        self.prep.retained_bytes() + self.block.capacity() * 4
    }
    pub fn pull(&mut self) -> Vec<f32> {
        let block = &mut self.block;
        let desc = &mut self.descriptor;
        let n=self.prep.pump(|d,s| {
            block[..s.len()].copy_from_slice(s);
            *desc=serde_json::json!({"generation":d.generation.0,"source_start":d.source_start,"source_end":d.source_end,"source_rate":d.source_rate,"output_start":d.output_start,"rate":d.layout.sample_rate,"frames":d.valid_frames}).to_string();
            d.valid_frames
        });
        self.block[..n * 2].to_vec()
    }
    pub fn descriptor(&self) -> String {
        self.descriptor.clone()
    }
}
