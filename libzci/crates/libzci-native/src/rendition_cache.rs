//! Separate rebuildable PNG storage. SQL/locking are native mechanisms; shared
//! core owns identity, integrity, admission and eviction policy. Never on output.
use libzci::{images::*, *};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
#[derive(Debug, Clone, Copy)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub failures: u64,
}
pub struct RenditionCache {
    db: Mutex<Connection>,
    limits: CacheBudget,
    hits: AtomicU64,
    misses: AtomicU64,
    failures: AtomicU64,
}
fn error(e: impl std::fmt::Display) -> LibzciError {
    libzci::storage::failure("rendition-cache", e)
}
impl RenditionCache {
    pub fn open(directory: &Path, limits: CacheBudget) -> Result<Self> {
        limits.validate()?;
        std::fs::create_dir_all(directory).map_err(error)?;
        let db = Connection::open(directory.join("artwork-cache-v1.sqlite3")).map_err(error)?;
        db.busy_timeout(std::time::Duration::from_millis(100))
            .map_err(error)?;
        // A cache can be discarded independently of profile.sqlite3. Restrict
        // SQLite's own high-water allocation as well as logical payload bytes.
        db.execute_batch(
            "PRAGMA journal_mode=DELETE; PRAGMA max_page_count=71680;
          CREATE TABLE IF NOT EXISTS renditions(key TEXT PRIMARY KEY, bytes INTEGER NOT NULL,
          touched INTEGER NOT NULL, metadata TEXT NOT NULL, png BLOB NOT NULL);",
        )
        .map_err(error)?;
        Ok(Self {
            db: Mutex::new(db),
            limits,
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
            failures: AtomicU64::new(0),
        })
    }
    pub fn stats(&self) -> CacheStats {
        CacheStats {
            hits: self.hits.load(Ordering::Relaxed),
            misses: self.misses.load(Ordering::Relaxed),
            failures: self.failures.load(Ordering::Relaxed),
        }
    }
    fn plan(tx: &Transaction<'_>, key: &str, bytes: u64, limits: CacheBudget) -> Result<CachePlan> {
        let mut statement = tx
            .prepare("SELECT key,bytes,touched FROM renditions LIMIT 4097")
            .map_err(error)?;
        let rows = statement
            .query_map([], |r| {
                Ok(CacheEntry {
                    key: r.get(0)?,
                    bytes: r.get(1)?,
                    touched: r.get(2)?,
                })
            })
            .map_err(error)?;
        let entries = rows
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(error)?;
        let plan = plan_cache(&entries, key, bytes, limits)?;
        for key in &plan.evict {
            tx.execute("DELETE FROM renditions WHERE key=?1", [key])
                .map_err(error)?;
        }
        Ok(plan)
    }
    fn lookup(&self, key: &str, spec: RenditionSpec) -> Result<Option<(CachedRendition, Vec<u8>)>> {
        let mut db = self.db.lock().map_err(error)?;
        let tx = db.transaction().map_err(error)?;
        let found:Option<(String,Vec<u8>)>=tx.query_row("SELECT metadata,png FROM renditions WHERE key=?1 AND bytes BETWEEN 1 AND 8388608 AND length(png)=bytes AND length(metadata)<=4096",[key],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(error)?;
        let Some((json, png)) = found else {
            return Ok(None);
        };
        let metadata: CachedRendition = serde_json::from_str(&json).map_err(error)?;
        metadata.validate_for(spec)?;
        let plan = Self::plan(&tx, key, png.len() as u64, self.limits)?;
        if plan.store {
            tx.execute(
                "UPDATE renditions SET touched=?1 WHERE key=?2",
                params![plan.touch, key],
            )
            .map_err(error)?;
        }
        tx.commit().map_err(error)?;
        Ok(plan.store.then_some((metadata, png)))
    }
    fn put(&self, key: &str, metadata: &CachedRendition, png: &[u8]) -> Result<()> {
        let mut db = self.db.lock().map_err(error)?;
        let tx = db.transaction().map_err(error)?;
        let plan = Self::plan(&tx, key, png.len() as u64, self.limits)?;
        if plan.store {
            tx.execute(
                "INSERT OR REPLACE INTO renditions VALUES(?1,?2,?3,?4,?5)",
                params![
                    key,
                    png.len() as u64,
                    plan.touch,
                    serde_json::to_string(metadata).map_err(error)?,
                    png
                ],
            )
            .map_err(error)?;
        }
        tx.commit().map_err(error)
    }
    pub fn clear(&self) -> Result<()> {
        self.db
            .lock()
            .map_err(error)?
            .execute_batch("DELETE FROM renditions; VACUUM;")
            .map_err(error)
    }
    pub fn run(
        &self,
        source: &dyn RuntimeSource,
        source_key: &str,
        request: ImageJobRequest,
        cancel: &CancelFlag,
    ) -> Result<ImageJobResult> {
        cancel.check()?;
        source.verify_snapshot()?;
        let Some(spec) = request.rendition_spec().filter(|_| {
            matches!(
                request,
                ImageJobRequest::Image { .. } | ImageJobRequest::Artwork { .. }
            )
        }) else {
            return run_image_job(source, request, cancel);
        };
        let key = rendition_cache_key(
            source_key,
            &format!("{}:{}", source.len().unwrap_or(0), source.revision()),
            &request,
        )?;
        match self.lookup(&key, spec) {
            Ok(Some((meta, png))) => match restore_cached_rendition(meta, png, cancel) {
                Ok(r) => {
                    source.verify_snapshot()?;
                    cancel.check()?;
                    self.hits.fetch_add(1, Ordering::Relaxed);
                    return Ok(ImageJobResult::Rendition(Some(r)));
                }
                Err(LibzciError::Cancelled) => return Err(LibzciError::Cancelled),
                Err(_) => {
                    self.failures.fetch_add(1, Ordering::Relaxed);
                    let _ = self
                        .db
                        .lock()
                        .map_err(error)?
                        .execute("DELETE FROM renditions WHERE key=?1", [&key]);
                }
            },
            Err(_) => {
                self.failures.fetch_add(1, Ordering::Relaxed);
                let _ = self.clear();
            }
            Ok(None) => (),
        }
        self.misses.fetch_add(1, Ordering::Relaxed);
        let result = run_image_job(source, request, cancel)?;
        source.verify_snapshot()?;
        cancel.check()?;
        if let ImageJobResult::Rendition(Some(r)) = &result {
            let meta = CachedRendition::from_rendition(r, spec)?;
            if self.put(&key, &meta, &r.png).is_err() {
                self.failures.fetch_add(1, Ordering::Relaxed);
            }
        }
        Ok(result)
    }
}
