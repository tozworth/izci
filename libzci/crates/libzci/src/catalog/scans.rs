//! Enumeration/probing happens in adapters. Core stages bounded batches in TEMP
//! SQL tables, then reconciles ownership atomically only after successful EOF.
//! No scan jobs or partial catalog payloads survive closing the connection.
use super::*;
use crate::storage::{decode, exec, failure, transaction, SqlBridge};
use serde_json::{json, Value};
const MAX_ROOTS: u64 = 256;
const MAX_SCANS: u64 = 8;
const MAX_SCAN_ENTRIES: u64 = 100_000;
const MAX_SCAN_BYTES: u64 = 128 * 1024 * 1024;
const MAX_TOTAL_SCAN_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ScanSettings {
    pub recursive: bool,
    pub scan_on_launch: bool,
    pub verify_unknown: bool,
    pub probe_concurrency: u8,
}
impl Default for ScanSettings {
    fn default() -> Self {
        Self {
            recursive: true,
            scan_on_launch: false,
            verify_unknown: true,
            probe_concurrency: 2,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RootInput {
    pub source: SourceReference,
    pub settings: ScanSettings,
}
impl RootInput {
    fn validate(&self) -> Result<()> {
        self.source.validate()?;
        if matches!(self.source.kind, crate::queue::SourceKind::Ephemeral) {
            return Err(invalid(
                "managed root requires a reusable platform reference",
            ));
        }
        if !(1..=8).contains(&self.settings.probe_concurrency) {
            return Err(invalid("probe concurrency must be in 1..8"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ManagedRoot {
    pub id: u64,
    pub revision: u64,
    pub config: RootInput,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ScanPlan {
    pub token: String,
    pub root: ManagedRoot,
    pub max_batch: usize,
    pub max_entries: u64,
    pub max_bytes: u64,
    pub max_total_bytes: u64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ScanSummary {
    pub root: u64,
    pub entries: u64,
    pub added: u64,
    pub removed: u64,
}
fn integer(rows: &[Vec<Value>]) -> Result<u64> {
    rows.first()
        .and_then(|r| r.first())
        .and_then(Value::as_u64)
        .ok_or_else(|| failure("corrupt", "missing scan integer"))
}
pub(crate) fn root(db: &mut dyn SqlBridge, n: u64) -> Result<ManagedRoot> {
    id(n)?;
    let rows = db.statement(
        "SELECT revision,config FROM managed_roots WHERE id=?",
        &[json!(n)],
    )?;
    let row = rows
        .first()
        .ok_or_else(|| invalid("unknown managed root"))?;
    Ok(ManagedRoot {
        id: n,
        revision: row[0]
            .as_u64()
            .ok_or_else(|| failure("corrupt", "root revision"))?,
        config: decode(&row[1])?,
    })
}
pub(crate) fn roots(db: &mut dyn SqlBridge) -> Result<Vec<ManagedRoot>> {
    db.statement(
        "SELECT id,revision,config FROM managed_roots ORDER BY id",
        &[],
    )?
    .into_iter()
    .map(|row| {
        Ok(ManagedRoot {
            id: row[0]
                .as_u64()
                .ok_or_else(|| failure("corrupt", "root ID"))?,
            revision: row[1]
                .as_u64()
                .ok_or_else(|| failure("corrupt", "root revision"))?,
            config: decode(&row[2])?,
        })
    })
    .collect()
}
pub(crate) fn put_root(db: &mut dyn SqlBridge, input: &RootInput, revision: u64) -> Result<u64> {
    input.validate()?;
    let rows = db.statement(
        "SELECT config FROM managed_roots WHERE source_key=?",
        &[json!(input.source.key)],
    )?;
    if let Some(row) = rows.first() {
        let old: RootInput = decode(&row[0])?;
        if old.source.kind != input.source.kind {
            return Err(invalid("root source identity collision"));
        }
    } else if integer(&db.statement("SELECT count(*) FROM managed_roots", &[])?)? >= MAX_ROOTS {
        return Err(invalid("managed root budget exceeded"));
    }
    exec(db,"INSERT INTO managed_roots(source_key,config,revision) VALUES(?,?,?) ON CONFLICT(source_key) DO UPDATE SET config=excluded.config,revision=excluded.revision",&[json!(input.source.key),json!(serde_json::to_string(input).unwrap()),json!(revision)])?;
    let id = integer(&db.statement(
        "SELECT id FROM managed_roots WHERE source_key=?",
        &[json!(input.source.key)],
    )?)?;
    invalidate_root(db, id)?;
    Ok(id)
}
pub(crate) fn invalidate_root(db: &mut dyn SqlBridge, root: u64) -> Result<()> {
    init(db)?;
    exec(db, "DELETE FROM scan_jobs WHERE root_id=?", &[json!(root)])
}
fn init(db: &mut dyn SqlBridge) -> Result<()> {
    exec(db,"CREATE TEMP TABLE IF NOT EXISTS scan_jobs (token TEXT PRIMARY KEY,root_id INTEGER NOT NULL UNIQUE,root_revision INTEGER NOT NULL,entries INTEGER NOT NULL DEFAULT 0 CHECK(entries>=0),bytes INTEGER NOT NULL DEFAULT 0 CHECK(bytes>=0))",&[])?;
    exec(db,"CREATE TEMP TABLE IF NOT EXISTS scan_stage (token TEXT NOT NULL REFERENCES scan_jobs(token) ON DELETE CASCADE,source_key TEXT NOT NULL,reference TEXT NOT NULL,source_revision TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,artist TEXT NOT NULL,album TEXT NOT NULL,genre TEXT NOT NULL,metadata TEXT NOT NULL,byte_cost INTEGER NOT NULL CHECK(byte_cost>=0),PRIMARY KEY(token,source_key))",&[])?;
    // Transactional credits avoid rescanning the staged corpus on each small
    // browser batch. Global accounting touches at most eight job records.
    for sql in [
        "CREATE TEMP TRIGGER IF NOT EXISTS scan_insert AFTER INSERT ON scan_stage BEGIN UPDATE scan_jobs SET entries=entries+1,bytes=bytes+new.byte_cost WHERE token=new.token; END",
        "CREATE TEMP TRIGGER IF NOT EXISTS scan_update AFTER UPDATE ON scan_stage BEGIN UPDATE scan_jobs SET bytes=bytes+new.byte_cost-old.byte_cost WHERE token=new.token; END",
        "CREATE TEMP TRIGGER IF NOT EXISTS scan_delete AFTER DELETE ON scan_stage BEGIN UPDATE scan_jobs SET entries=entries-1,bytes=bytes-old.byte_cost WHERE token=old.token; END",
    ]{exec(db,sql,&[])?;}
    Ok(())
}
fn job(db: &mut dyn SqlBridge, token: &str) -> Result<ManagedRoot> {
    text(token, 128, false)?;
    init(db)?;
    let rows = db.statement(
        "SELECT root_id,root_revision FROM scan_jobs WHERE token=?",
        &[json!(token)],
    )?;
    let row = rows
        .first()
        .ok_or_else(|| invalid("scan cancelled, superseded or not owned by this connection"))?;
    let root = root(
        db,
        row[0]
            .as_u64()
            .ok_or_else(|| failure("corrupt", "scan root ID"))?,
    )?;
    if row[1].as_u64() != Some(root.revision) {
        return Err(invalid("root changed during scan; restart enumeration"));
    }
    Ok(root)
}
pub(crate) fn begin(db: &mut dyn SqlBridge, n: u64) -> Result<ScanPlan> {
    transaction(db, |db| {
        init(db)?;
        let root = root(db, n)?;
        exec(db, "DELETE FROM scan_jobs WHERE root_id=?", &[json!(n)])?;
        if integer(&db.statement("SELECT count(*) FROM scan_jobs", &[])?)? >= MAX_SCANS {
            return Err(invalid("active scan budget exceeded"));
        }
        // A process/worker restart resets atomic IDs. Include connection-side
        // entropy so an old consumer token cannot name a replacement job.
        let nonce = db.statement("SELECT lower(hex(randomblob(16)))", &[])?;
        let nonce = nonce
            .first()
            .and_then(|r| r.first())
            .and_then(Value::as_str)
            .filter(|n| n.len() == 32 && n.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(|| failure("io", "missing scan job nonce"))?;
        let token = format!("scan-{}-{nonce}", crate::RequestId::fresh().0);
        exec(
            db,
            "INSERT INTO scan_jobs(token,root_id,root_revision) VALUES(?,?,?)",
            &[json!(token), json!(n), json!(root.revision)],
        )?;
        Ok(ScanPlan {
            token,
            root,
            max_batch: MAX_BATCH,
            max_entries: MAX_SCAN_ENTRIES,
            max_bytes: MAX_SCAN_BYTES,
            max_total_bytes: MAX_TOTAL_SCAN_BYTES,
        })
    })
}
pub(crate) fn stage(db: &mut dyn SqlBridge, token: &str, media: Vec<MediaInput>) -> Result<u64> {
    if media.is_empty() || media.len() > MAX_BATCH {
        return Err(invalid("scan batch must contain 1..256 entries"));
    }
    // Validate before acquiring the SQL transaction. A failed batch is atomic.
    for item in &media {
        item.validate()?;
    }
    transaction(db, |db| {
        job(db, token)?;
        for input in media {
            let m = &input.metadata;
            let reference = serde_json::to_string(&input.source).unwrap();
            let metadata = serde_json::to_string(m).unwrap();
            // Include duplicated scalar/JSON fields and primary-key storage,
            // plus per-row/page overhead. A row-count bound alone permits huge
            // TEMP allocations when a root has unusually long metadata/paths.
            let cost = 512
                + 2 * (token.len() + input.source.key.len())
                + reference.len()
                + input.source_revision.len()
                + input.kind.sql().len()
                + m.title.len()
                + m.artist.len()
                + m.album.len()
                + m.genre.len()
                + metadata.len();
            exec(db,"INSERT INTO scan_stage(token,source_key,reference,source_revision,kind,title,artist,album,genre,metadata,byte_cost) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(token,source_key) DO UPDATE SET reference=excluded.reference,source_revision=excluded.source_revision,kind=excluded.kind,title=excluded.title,artist=excluded.artist,album=excluded.album,genre=excluded.genre,metadata=excluded.metadata,byte_cost=excluded.byte_cost",&[json!(token),json!(input.source.key),json!(reference),json!(input.source_revision),json!(input.kind.sql()),json!(m.title),json!(m.artist),json!(m.album),json!(m.genre),json!(metadata),json!(cost)])?;
        }
        let count = integer(&db.statement(
            "SELECT entries FROM scan_jobs WHERE token=?",
            &[json!(token)],
        )?)?;
        if count > MAX_SCAN_ENTRIES {
            return Err(invalid("scan entry budget exceeded"));
        }
        let bytes =
            integer(&db.statement("SELECT bytes FROM scan_jobs WHERE token=?", &[json!(token)])?)?;
        let total = integer(&db.statement("SELECT COALESCE(sum(bytes),0) FROM scan_jobs", &[])?)?;
        if bytes > MAX_SCAN_BYTES || total > MAX_TOTAL_SCAN_BYTES {
            return Err(crate::LibzciError::ResourceExhausted {
                detail: "managed scan staging byte budget exceeded".into(),
            });
        }
        Ok(count)
    })
}
pub(crate) fn cancel(db: &mut dyn SqlBridge, token: &str) -> Result<()> {
    text(token, 128, false)?;
    transaction(db, |db| {
        init(db)?;
        exec(db, "DELETE FROM scan_jobs WHERE token=?", &[json!(token)])
    })
}
/// Called inside the durable profile transaction. Even a failed final commit
/// restores the old catalog, ownership and TEMP staging for a safe retry.
pub(crate) fn finish(db: &mut dyn SqlBridge, token: &str) -> Result<ScanSummary> {
    let root = job(db, token)?;
    let collisions=db.statement("SELECT 1 FROM scan_stage s JOIN media m ON m.source_key=s.source_key WHERE s.token=? AND json_extract(s.reference,'$.kind')<>json_extract(m.reference,'$.kind') LIMIT 1",&[json!(token)])?;
    if !collisions.is_empty() {
        return Err(invalid("scan source identity collision"));
    }
    let entries = integer(&db.statement(
        "SELECT count(*) FROM scan_stage WHERE token=?",
        &[json!(token)],
    )?)?;
    let added=integer(&db.statement("SELECT count(*) FROM scan_stage s LEFT JOIN media m ON m.source_key=s.source_key WHERE s.token=? AND NOT EXISTS (SELECT 1 FROM root_memberships rm WHERE rm.root_id=? AND rm.media_id=m.id)",&[json!(token),json!(root.id)])?)?;
    let removed=integer(&db.statement("SELECT count(*) FROM root_memberships rm JOIN media m ON m.id=rm.media_id WHERE rm.root_id=? AND NOT EXISTS (SELECT 1 FROM scan_stage s WHERE s.token=? AND s.source_key=m.source_key)",&[json!(root.id),json!(token)])?)?;
    exec(db,"INSERT INTO media(source_key,reference,source_revision,kind,manual,title,artist,album,genre,metadata) SELECT source_key,reference,source_revision,kind,0,title,artist,album,genre,metadata FROM scan_stage WHERE token=? ON CONFLICT(source_key) DO UPDATE SET reference=excluded.reference,source_revision=excluded.source_revision,kind=excluded.kind,title=excluded.title,artist=excluded.artist,album=excluded.album,genre=excluded.genre,metadata=excluded.metadata",&[json!(token)])?;
    exec(
        db,
        "DELETE FROM root_memberships WHERE root_id=?",
        &[json!(root.id)],
    )?;
    exec(db,"INSERT INTO root_memberships(root_id,media_id) SELECT ?,m.id FROM scan_stage s JOIN media m ON m.source_key=s.source_key WHERE s.token=?",&[json!(root.id),json!(token)])?;
    exec(db, "DELETE FROM scan_jobs WHERE token=?", &[json!(token)])?;
    Ok(ScanSummary {
        root: root.id,
        entries,
        added,
        removed,
    })
}
