//! Transient encoded bytes, retained only by an explicit caller-owned object.
use libzci::{artwork::EncodedArtwork, CancelFlag, LibzciError};
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub struct WebArtwork {
    core: EncodedArtwork,
}
#[wasm_bindgen]
impl WebArtwork {
    pub fn from_source(id: u32, len: f64) -> Result<Option<WebArtwork>, JsValue> {
        if !len.is_finite() || !(0.0..=9_007_199_254_740_991.).contains(&len) || len.fract() != 0. {
            return Err(crate::profile::typed(LibzciError::InvalidArgument {
                detail: "invalid artwork source length".into(),
            }));
        }
        let source = crate::audio_decoder::FileSource {
            id,
            len: len as u64,
        };
        Ok(
            libzci::artwork::read_embedded_artwork(&source, &CancelFlag::default())
                .map_err(crate::profile::typed)?
                .map(|core| Self { core }),
        )
    }
    pub fn info(&self) -> String {
        serde_json::json!({"mime":self.core.mime,"picture_type":self.core.picture_type,"bytes":self.core.bytes.len()}).to_string()
    }
    pub fn bytes(&self) -> Vec<u8> {
        self.core.bytes.clone()
    }
}
#[wasm_bindgen]
pub struct MetadataBudget {
    core: libzci::provider::CommentBudget,
}
#[wasm_bindgen]
impl MetadataBudget {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            core: libzci::provider::CommentBudget::new(65536),
        }
    }
    pub fn reserve(&mut self, length: u32) -> Result<(), JsValue> {
        self.core
            .reserve(length as usize)
            .map_err(crate::profile::typed)
    }
    pub fn visible(&mut self, key: &str, length: u32) -> Result<bool, JsValue> {
        self.core
            .visible(key, length as usize)
            .map_err(crate::profile::typed)
    }
}
