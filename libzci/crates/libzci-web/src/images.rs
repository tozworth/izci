//! Explicit caller-owned visual result; encoded pixels never enter snapshots.
use libzci::{
    images::{ImageJobRequest, ImageJobResult},
    CancelFlag, LibzciError,
};
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub struct WebImageJob {
    result: ImageJobResult,
}
#[wasm_bindgen]
impl WebImageJob {
    pub fn run(id: u32, len: f64, request: &str) -> Result<Self, JsValue> {
        if !len.is_finite() || !(0.0..=9_007_199_254_740_991.).contains(&len) || len.fract() != 0. {
            return Err(crate::profile::typed(LibzciError::InvalidArgument {
                detail: "invalid image source length".into(),
            }));
        }
        if request.len() > 1024 {
            return Err(crate::profile::typed(LibzciError::ResourceExhausted {
                detail: "image request exceeds 1 KiB".into(),
            }));
        }
        let request: ImageJobRequest = serde_json::from_str(request).map_err(|e| {
            crate::profile::typed(LibzciError::InvalidArgument {
                detail: e.to_string(),
            })
        })?;
        let source = crate::audio_decoder::FileSource {
            id,
            len: len as u64,
        };
        let result = libzci::images::run_image_job(&source, request, &CancelFlag::default())
            .map_err(crate::profile::typed)?;
        Ok(Self { result })
    }
    pub fn info(&self) -> String {
        let rendition = match &self.result {
            ImageJobResult::Rendition(Some(r)) => Some(
                serde_json::json!({"width":r.width,"height":r.height,"mime":"image/png","bytes":r.png.len()}),
            ),
            _ => None,
        };
        serde_json::json!({"facts":self.result.facts(),"rendition":rendition}).to_string()
    }
    pub fn png(&self) -> Vec<u8> {
        match &self.result {
            ImageJobResult::Rendition(Some(r)) => r.png.clone(),
            _ => vec![],
        }
    }
}
