//! File range mechanism for the shared Symphonia provider. Only numeric source
//! identities cross WASM; FileReaderSync and File objects stay in the worker.
use libzci::*;
use std::sync::Arc;
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(catch, js_namespace = globalThis, js_name = libzciRead)]
    fn read_range(
        id: u32,
        position: f64,
        length: u32,
    ) -> std::result::Result<js_sys::Uint8Array, JsValue>;
}
#[derive(Debug)]
pub(crate) struct FileSource {
    pub id: u32,
    pub len: u64,
}
impl RuntimeSource for FileSource {
    fn id(&self) -> SourceId {
        SourceId(self.id as u64)
    }
    fn revision(&self) -> u64 {
        1
    }
    fn caps(&self) -> SourceCaps {
        SourceCaps::seekable_stream(Some(self.len))
    }
    fn read_at(&self, offset: u64, out: &mut [u8], cancel: &CancelFlag) -> Result<usize> {
        cancel.check()?;
        let bytes =
            read_range(self.id, offset as f64, out.len().min(32768) as u32).map_err(|_| {
                LibzciError::Unavailable {
                    detail: "browser File range read failed".into(),
                }
            })?;
        let n = bytes.length() as usize;
        if n > out.len() {
            return Err(LibzciError::ResourceExhausted {
                detail: "invalid File read".into(),
            });
        }
        bytes.copy_to(&mut out[..n]);
        Ok(n)
    }
}
#[wasm_bindgen]
pub struct WebAudioDecoder {
    decoder: Box<dyn DecoderInstance>,
    cancel: CancelFlag,
}
fn js(e: LibzciError) -> JsValue {
    let value=js_sys::Object::new();
    let _=js_sys::Reflect::set(&value,&"kind".into(),&e.kind().into());
    let _=js_sys::Reflect::set(&value,&"detail".into(),&e.to_string().into());
    value.into()
}
#[wasm_bindgen]
impl WebAudioDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(id: u32, len: f64) -> std::result::Result<Self, JsValue> {
        let cancel = CancelFlag::default();
        let decoder = libzci_symphonia::SymphoniaFactory
            .open(
                Arc::new(FileSource {
                    id,
                    len: len as u64,
                }),
                &cancel,
            )
            .map_err(js)?;
        Ok(Self { decoder, cancel })
    }
    pub fn facts(&self) -> String {
        crate::wire::facts(
            self.decoder.metadata(),
            self.decoder.capabilities(),
            self.decoder.module_observation(),
        )
        .to_string()
    }
    pub fn position(&self) -> f64 {
        self.decoder.position_frames() as f64
    }
    pub fn read(&mut self) -> std::result::Result<Vec<f32>, JsValue> {
        let mut out = vec![0.; 4096 * self.decoder.layout().layout.channels() as usize];
        let n = self
            .decoder
            .decode_into(&mut out, &self.cancel)
            .map_err(js)?;
        out.truncate(n);
        Ok(out)
    }
    /// One cancellable worker task worth of exact seek/discard work.
    pub fn seek_step(&mut self, target: f64) -> std::result::Result<f64, JsValue> {
        let target = (target as u64).min(self.decoder.total_frames().unwrap_or(u64::MAX));
        if target < self.decoder.position_frames() {
            self.decoder.seek_to_frame(0, &self.cancel).map_err(js)?;
        }
        let end = target.min(self.decoder.position_frames().saturating_add(4096));
        Ok(self.decoder.seek_to_frame(end, &self.cancel).map_err(js)? as f64)
    }
}
#[wasm_bindgen]
pub fn classify(header: &[u8], hint: &str) -> String {
    if sniff_opus_head_page(header).is_some() {
        "opus"
    } else if libzci::format::sniff_ordinary_audio(header) {
        "ordinary"
    } else if matches!(sniff_module_family(header), Some(ModuleFamily::Hively(_))) {
        "hively"
    } else if matches!(sniff_module_family(header), Some(ModuleFamily::Openmpt))
        || is_module_extension_hint(hint)
    {
        "module"
    } else {
        "unsupported"
    }
    .into()
}
#[wasm_bindgen]
pub fn known_extension(hint: &str) -> bool {
    libzci::format::known_audio_extension(hint)
}
