//! Explicit caller-owned visual result; encoded pixels never enter snapshots.
use libzci::{
    images::{ImageJobRequest, ImageJobResult},
    CancelFlag, LibzciError,
};
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub struct WebImageJob {
    result: ImageJobResult,
    metadata: Option<libzci::images::CachedRendition>,
}
#[wasm_bindgen]
impl WebImageJob {
    pub fn run(id: u32, len: f64, request: &str) -> Result<Self, JsValue> {
        if !len.is_finite() || !(0.0..=9_007_199_254_740_991.).contains(&len) || len.fract() != 0. {
            return Err(crate::profile::typed(LibzciError::InvalidArgument {
                detail: "invalid image source length".into(),
            }));
        }
        if request.len() > 4096 {
            return Err(crate::profile::typed(LibzciError::ResourceExhausted {
                detail: "image request exceeds 4 KiB".into(),
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
        let spec = request.rendition_spec();
        let result = libzci::images::run_image_job(&source, request, &CancelFlag::default())
            .map_err(crate::profile::typed)?;
        let metadata = match (&result, spec) {
            (ImageJobResult::Rendition(Some(r)), Some(spec)) => Some(
                libzci::images::CachedRendition::from_rendition(r, spec)
                    .map_err(crate::profile::typed)?,
            ),
            _ => None,
        };
        Ok(Self { result, metadata })
    }
    pub fn info(&self) -> String {
        let rendition = match &self.result {
            ImageJobResult::Rendition(Some(r)) => Some(
                serde_json::json!({"width":r.width,"height":r.height,"mime":"image/png","bytes":r.png.len()}),
            ),
            _ => None,
        };
        serde_json::json!({"facts":self.result.facts(),"rendition":rendition,"metadata":self.metadata}).to_string()
    }
    pub fn png(&self) -> Vec<u8> {
        match &self.result {
            ImageJobResult::Rendition(Some(r)) => r.png.clone(),
            _ => vec![],
        }
    }
}
#[wasm_bindgen]
pub fn image_cache_key(source: &str, revision: &str, request: &str) -> Result<String, JsValue> {
    if request.len() > 4096 {
        return Err(crate::profile::typed(LibzciError::InvalidArgument {
            detail: "cache request too large".into(),
        }));
    }
    let request = serde_json::from_str(request).map_err(|e| {
        crate::profile::typed(LibzciError::InvalidArgument {
            detail: format!("{e}"),
        })
    })?;
    libzci::images::rendition_cache_key(source, revision, &request).map_err(crate::profile::typed)
}
#[wasm_bindgen]
pub fn image_cache_plan(
    entries: &str,
    key: &str,
    bytes: f64,
    budget: &str,
) -> Result<String, JsValue> {
    if entries.len() > 1024 * 1024 || budget.len() > 1024 {
        return Err(crate::profile::typed(LibzciError::ResourceExhausted {
            detail: "cache manifest exceeds input budget".into(),
        }));
    }
    let parse = |e: serde_json::Error| {
        crate::profile::typed(LibzciError::InvalidArgument {
            detail: e.to_string(),
        })
    };
    let entries: Vec<libzci::images::CacheEntry> = serde_json::from_str(entries).map_err(parse)?;
    let budget = serde_json::from_str(budget).map_err(parse)?;
    let plan = libzci::images::plan_cache(&entries, key, integer(bytes)?, budget)
        .map_err(crate::profile::typed)?;
    Ok(serde_json::to_string(&plan).unwrap())
}
fn integer(value: f64) -> Result<u64, JsValue> {
    if !value.is_finite() || !(0.0..=9_007_199_254_740_991.).contains(&value) || value.fract() != 0.
    {
        return Err(crate::profile::typed(LibzciError::InvalidArgument {
            detail: "invalid image identity/generation".into(),
        }));
    }
    Ok(value as u64)
}
#[wasm_bindgen]
pub struct WebImageSession {
    core: libzci::images::ImageSession,
}
#[wasm_bindgen]
impl WebImageSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            core: Default::default(),
        }
    }
    pub fn open(&mut self, sequence: &str, media: f64) -> Result<String, JsValue> {
        if sequence.len() > 2 * 1024 * 1024 {
            return Err(crate::profile::typed(LibzciError::ResourceExhausted {
                detail: "image sequence input exceeds 2 MiB".into(),
            }));
        }
        let sequence = serde_json::from_str(sequence).map_err(|e| {
            crate::profile::typed(LibzciError::InvalidArgument {
                detail: e.to_string(),
            })
        })?;
        serde_json::to_string(
            &self
                .core
                .open(sequence, integer(media)?)
                .map_err(crate::profile::typed)?,
        )
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }
    pub fn navigate(&mut self, command: &str, wrap: bool) -> Result<String, JsValue> {
        if command.len() > 1024 {
            return Err(crate::profile::typed(LibzciError::ResourceExhausted {
                detail: "image navigation input exceeds 1 KiB".into(),
            }));
        }
        let command = serde_json::from_str(command).map_err(|e| {
            crate::profile::typed(LibzciError::InvalidArgument {
                detail: e.to_string(),
            })
        })?;
        serde_json::to_string(
            &self
                .core
                .navigate(command, wrap)
                .map_err(crate::profile::typed)?,
        )
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }
    pub fn complete(
        &mut self,
        session: f64,
        generation: f64,
        media: f64,
        facts: &str,
    ) -> Result<bool, JsValue> {
        if facts.len() > 4096 {
            return Err(crate::profile::typed(LibzciError::ResourceExhausted {
                detail: "image facts exceed 4 KiB".into(),
            }));
        }
        let facts = serde_json::from_str(facts).map_err(|e| {
            crate::profile::typed(LibzciError::InvalidArgument {
                detail: e.to_string(),
            })
        })?;
        self.core
            .complete(
                integer(session)?,
                integer(generation)?,
                integer(media)?,
                facts,
            )
            .map_err(crate::profile::typed)
    }
    pub fn snapshot(&self) -> String {
        serde_json::to_string(&self.core.snapshot()).unwrap()
    }
    pub fn close(&mut self) -> Result<(), JsValue> {
        self.core.close().map(|_| ()).map_err(crate::profile::typed)
    }
}
