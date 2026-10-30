//! Transient document binding: parse once, look up cue ranges on the audible
//! timeline. Documents never become catalog fields or persisted snapshots.
use libzci::lyrics::LyricsDocument;
use libzci::{CancelFlag, LibzciError};
use wasm_bindgen::prelude::*;
fn error(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}

#[wasm_bindgen]
pub fn read_embedded_lyrics(id: u32, len: f64) -> Result<Option<String>, JsValue> {
    if !len.is_finite() || !(0.0..=9_007_199_254_740_991.).contains(&len) || len.fract() != 0. {
        return Err(crate::profile::typed(LibzciError::InvalidArgument {
            detail: "invalid lyric source length".into(),
        }));
    }
    let source = crate::audio_decoder::FileSource {
        id,
        len: len as u64,
    };
    libzci::lyrics::read_embedded_lyrics(&source, &CancelFlag::default())
        .map_err(crate::profile::typed)?
        .map(|doc| serde_json::to_string(&doc).map_err(error))
        .transpose()
}
#[wasm_bindgen]
pub struct WebLyrics {
    core: LyricsDocument,
}
#[wasm_bindgen]
impl WebLyrics {
    #[wasm_bindgen(constructor)]
    pub fn new(raw: &str) -> Result<WebLyrics, JsValue> {
        Ok(Self {
            core: LyricsDocument::parse(raw).map_err(crate::profile::typed)?,
        })
    }
    pub fn from_comments(comments: &str) -> Result<Option<WebLyrics>, JsValue> {
        if comments.len() > 2 * 1024 * 1024 {
            return Err(crate::profile::typed(LibzciError::ResourceExhausted {
                detail: "lyric comment input exceeds 2 MiB".into(),
            }));
        }
        let comments: Vec<(String, String)> = serde_json::from_str(comments).map_err(|e| {
            crate::profile::typed(LibzciError::InvalidArgument {
                detail: e.to_string(),
            })
        })?;
        Ok(LyricsDocument::from_comments(&comments)
            .map_err(crate::profile::typed)?
            .map(|core| Self { core }))
    }
    pub fn snapshot(&self) -> String {
        serde_json::to_string(&self.core).unwrap()
    }
    pub fn active_first(&self, seconds: f64) -> i32 {
        self.core
            .active(seconds)
            .map_or(-1, |range| range.start as i32)
    }
    pub fn active_end(&self, seconds: f64) -> i32 {
        self.core
            .active(seconds)
            .map_or(-1, |range| range.end as i32)
    }
}
