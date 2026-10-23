//! Synchronous SQL execution bridge in the owner worker; policy is shared Rust.
use libzci::{
    profile::Profile,
    storage::{failure, SqlBridge},
};
use serde_json::Value;
use wasm_bindgen::prelude::*;
struct BrowserSql(js_sys::Function);
fn js(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}
fn typed(e: libzci::LibzciError) -> JsValue {
    let object = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&object, &"kind".into(), &e.kind().into());
    let _ = js_sys::Reflect::set(&object, &"detail".into(), &e.to_string().into());
    let _ = js_sys::Reflect::set(&object, &"message".into(), &e.to_string().into());
    if let libzci::LibzciError::StorageFailure { code, .. } = &e {
        let _ = js_sys::Reflect::set(&object, &"code".into(), &code.as_str().into());
    }
    object.into()
}
impl SqlBridge for BrowserSql {
    fn statement(&mut self, sql: &str, bind: &[Value]) -> libzci::Result<Vec<Vec<Value>>> {
        let response = self
            .0
            .call2(
                &JsValue::NULL,
                &sql.into(),
                &serde_json::to_string(bind).unwrap().into(),
            )
            .map_err(|e| {
                let code = js_sys::Reflect::get(&e, &"code".into())
                    .ok()
                    .and_then(|v| v.as_string())
                    .unwrap_or_else(|| "io".into());
                let detail = js_sys::Reflect::get(&e, &"message".into())
                    .ok()
                    .and_then(|v| v.as_string())
                    .unwrap_or_else(|| format!("{e:?}"));
                failure(&code, detail)
            })?;
        serde_json::from_str(
            &response
                .as_string()
                .ok_or_else(|| failure("io", "SQL bridge returned no rows"))?,
        )
        .map_err(|e| failure("io", e))
    }
}
#[wasm_bindgen]
pub struct WebProfile {
    core: Profile,
    db: BrowserSql,
}
#[wasm_bindgen]
impl WebProfile {
    #[wasm_bindgen(constructor)]
    pub fn new(statement: js_sys::Function) -> Result<WebProfile, JsValue> {
        let mut db = BrowserSql(statement);
        let core = Profile::open(&mut db).map_err(typed)?;
        Ok(Self { core, db })
    }
    pub fn snapshot(&self) -> String {
        serde_json::to_string(self.core.snapshot()).unwrap()
    }
    pub fn command(&mut self, command: &str) -> Result<String, JsValue> {
        self.request(command, None)
    }
    pub fn request(&mut self, command: &str, request: Option<String>) -> Result<String, JsValue> {
        if command.len() > 16 * 1024 * 1024 {
            return Err(typed(libzci::LibzciError::ResourceExhausted {
                detail: "profile command exceeds 16 MiB".into(),
            }));
        }
        let command = serde_json::from_str(command).map_err(|e| {
            typed(libzci::LibzciError::InvalidArgument {
                detail: e.to_string(),
            })
        })?;
        serde_json::to_string(
            &self
                .core
                .request(command, request.as_deref(), Some(&mut self.db))
                .map_err(typed)?,
        )
        .map_err(js)
    }
    pub fn restore(&self) -> String {
        serde_json::to_string(&self.core.snapshot().restore()).unwrap()
    }
}
