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
pub(crate) fn typed(e: libzci::LibzciError) -> JsValue {
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
    playback: Option<libzci::profile::ProfilePlayback>,
}
#[wasm_bindgen]
impl WebProfile {
    #[wasm_bindgen(constructor)]
    pub fn new(statement: js_sys::Function) -> Result<WebProfile, JsValue> {
        let mut db = BrowserSql(statement);
        let core = Profile::open(&mut db).map_err(typed)?;
        Ok(Self {
            core,
            db,
            playback: None,
        })
    }
    pub fn attach_playback(
        &mut self,
        engine: &mut crate::bindings::WebEngine,
    ) -> Result<(), JsValue> {
        if self.playback.is_some() {
            return Err(typed(failure("busy", "profile playback already attached")));
        }
        self.playback = Some(
            libzci::profile::ProfilePlayback::attach(
                &self.core,
                &engine.inner.session.snapshot(),
                &mut self.db,
            )
            .map_err(typed)?,
        );
        self.sync_playback(engine).map(|_| ())
    }
    pub fn sync_playback(
        &mut self,
        engine: &mut crate::bindings::WebEngine,
    ) -> Result<bool, JsValue> {
        let binding = self
            .playback
            .as_mut()
            .ok_or_else(|| typed(failure("unavailable", "profile playback is not attached")))?;
        let observation = libzci::profile::PlaybackObservation {
            snapshot: engine.inner.session.snapshot(),
            qualified: engine.inner.session.qualified_plays(),
        };
        let plan = binding
            .prepare(&mut self.core, observation, &mut self.db)
            .map_err(typed)?;
        for ack in &plan.acknowledged {
            engine
                .inner
                .session
                .acknowledge_plays(&ack.binding, ack.sequence)
                .map_err(typed)?;
        }
        for command in &plan.commands {
            engine.inner.session.accept(command).map_err(typed)?;
        }
        Ok(plan.counts.is_some_and(|c| c.counted != 0))
    }
    pub fn close_playback(&mut self) -> Result<(), JsValue> {
        if let Some(binding) = self.playback.as_mut() {
            binding.close(&self.core, &mut self.db).map_err(typed)?;
        }
        self.playback = None;
        Ok(())
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
    pub fn catalog_request(
        &mut self,
        command: &str,
        request: Option<String>,
    ) -> Result<String, JsValue> {
        if command.len() > 4 * 1024 * 1024 {
            return Err(typed(libzci::LibzciError::ResourceExhausted {
                detail: "catalog command exceeds 4 MiB".into(),
            }));
        }
        let command = serde_json::from_str(command).map_err(|e| {
            typed(libzci::LibzciError::InvalidArgument {
                detail: format!("{e}"),
            })
        })?;
        serde_json::to_string(
            &self
                .core
                .catalog_request(command, request.as_deref(), &mut self.db)
                .map_err(typed)?,
        )
        .map_err(js)
    }
    pub fn catalog_query(&mut self, query: &str) -> Result<String, JsValue> {
        if query.len() > 32 * 1024 {
            return Err(typed(libzci::LibzciError::ResourceExhausted {
                detail: "catalog query exceeds 32 KiB".into(),
            }));
        }
        let query = serde_json::from_str(query).map_err(|e| {
            typed(libzci::LibzciError::InvalidArgument {
                detail: format!("{e}"),
            })
        })?;
        serde_json::to_string(
            &self
                .core
                .catalog_query(&query, &mut self.db)
                .map_err(typed)?,
        )
        .map_err(js)
    }
    pub fn bookmarks(&mut self, media: u64, subsong: Option<u32>) -> Result<String, JsValue> {
        serde_json::to_string(
            &self
                .core
                .bookmarks(media, subsong, &mut self.db)
                .map_err(typed)?,
        )
        .map_err(js)
    }
    pub fn catalog_groups(&mut self, by: &str, query: &str) -> Result<String, JsValue> {
        if query.len() > 32 * 1024 || by.len() > 32 {
            return Err(typed(libzci::LibzciError::ResourceExhausted {
                detail: "catalog group query input exceeds budget".into(),
            }));
        }
        let by = serde_json::from_value(serde_json::Value::String(by.into())).map_err(|e| {
            typed(libzci::LibzciError::InvalidArgument {
                detail: format!("{e}"),
            })
        })?;
        let query = serde_json::from_str(query).map_err(|e| {
            typed(libzci::LibzciError::InvalidArgument {
                detail: format!("{e}"),
            })
        })?;
        serde_json::to_string(
            &self
                .core
                .catalog_groups(by, &query, &mut self.db)
                .map_err(typed)?,
        )
        .map_err(js)
    }
    pub fn managed_roots(&mut self) -> Result<String, JsValue> {
        serde_json::to_string(&self.core.managed_roots(&mut self.db).map_err(typed)?).map_err(js)
    }
    pub fn begin_scan(&mut self, root: u64) -> Result<String, JsValue> {
        serde_json::to_string(&self.core.begin_scan(root, &mut self.db).map_err(typed)?).map_err(js)
    }
    pub fn stage_scan(&mut self, token: &str, media: &str) -> Result<u64, JsValue> {
        if media.len() > 4 * 1024 * 1024 {
            return Err(typed(libzci::LibzciError::ResourceExhausted {
                detail: "scan batch exceeds 4 MiB".into(),
            }));
        }
        let media = serde_json::from_str(media).map_err(|e| {
            typed(libzci::LibzciError::InvalidArgument {
                detail: format!("{e}"),
            })
        })?;
        self.core
            .stage_scan(token, media, &mut self.db)
            .map_err(typed)
    }
    pub fn cancel_scan(&mut self, token: &str) -> Result<(), JsValue> {
        self.core.cancel_scan(token, &mut self.db).map_err(typed)
    }
    pub fn references_browser_capability(&mut self, locator: &str) -> Result<bool, JsValue> {
        self.core
            .references_browser_capability(locator, &mut self.db)
            .map_err(typed)
    }
    pub fn references_source(&mut self, key: &str) -> Result<bool, JsValue> {
        self.core
            .references_source(key, &mut self.db)
            .map_err(typed)
    }
}

#[wasm_bindgen]
pub fn normalize_metadata(
    comments: &str,
    duration_seconds: Option<f64>,
    display_path: &str,
    normalization_points: Option<String>,
) -> Result<String, JsValue> {
    if comments.len() > 2 * 1024 * 1024 || display_path.len() > 8192 {
        return Err(typed(libzci::LibzciError::ResourceExhausted {
            detail: "metadata input budget exceeded".into(),
        }));
    }
    let comments = serde_json::from_str::<Vec<(String, String)>>(comments).map_err(|e| {
        typed(libzci::LibzciError::InvalidArgument {
            detail: e.to_string(),
        })
    })?;
    let points = if let Some(points) = normalization_points {
        if points.len() > 256 * 1024 {
            return Err(typed(libzci::LibzciError::ResourceExhausted {
                detail: "normalization metadata byte budget exceeded".into(),
            }));
        }
        let points: Vec<libzci::ReplayGainPoint> = serde_json::from_str(&points).map_err(js)?;
        if points.len() > libzci::MAX_GAIN_POINTS {
            return Err(typed(libzci::LibzciError::ResourceExhausted {
                detail: "normalization metadata point budget exceeded".into(),
            }));
        }
        for point in &points {
            point.tags.validate().map_err(typed)?;
        }
        points
    } else {
        Vec::new()
    };
    serde_json::to_string(&libzci::catalog::Metadata::from_comments_with_points(
        &comments,
        duration_seconds,
        display_path,
        &points,
    ))
    .map_err(js)
}

#[wasm_bindgen]
pub fn metadata_tag_visible(key: &str) -> bool {
    key.len() <= 256 && !libzci::provider::is_embedded_payload_key(key)
}
