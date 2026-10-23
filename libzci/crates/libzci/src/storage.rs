//! SQL/schema/transactions live here. Adapters only execute bound statements.
use crate::{
    profile::ProfileState,
    queue::{Queue, SourceReference},
    LibzciError, Result,
};
use serde_json::{json, Value};
pub trait SqlBridge {
    fn statement(&mut self, sql: &str, bind: &[Value]) -> Result<Vec<Vec<Value>>>;
}
pub fn failure(code: &str, detail: impl ToString) -> LibzciError {
    LibzciError::StorageFailure {
        code: code.into(),
        detail: detail.to_string(),
    }
}
fn exec(db: &mut dyn SqlBridge, sql: &str, bind: &[Value]) -> Result<()> {
    db.statement(sql, bind).map(|_| ())
}
fn transaction<T>(
    db: &mut dyn SqlBridge,
    f: impl FnOnce(&mut dyn SqlBridge) -> Result<T>,
) -> Result<T> {
    exec(db, "BEGIN IMMEDIATE", &[])?;
    let result = f(db).and_then(|v| {
        exec(db, "COMMIT", &[])?;
        Ok(v)
    });
    if result.is_err() {
        let _ = exec(db, "ROLLBACK", &[]);
    }
    result
}
fn decode<T: serde::de::DeserializeOwned>(v: &Value) -> Result<T> {
    serde_json::from_str(
        v.as_str()
            .ok_or_else(|| failure("corrupt", "expected JSON text"))?,
    )
    .map_err(|e| failure("corrupt", e))
}
pub fn open(db: &mut dyn SqlBridge) -> Result<ProfileState> {
    exec(db, "PRAGMA foreign_keys=ON", &[])?;
    let version = db.statement("PRAGMA user_version", &[])?;
    let version = version
        .first()
        .and_then(|r| r.first())
        .and_then(Value::as_u64)
        .ok_or_else(|| failure("init", "missing schema version"))?;
    if version != 0 && version != 1 {
        return Err(failure(
            "schema",
            format!("unsupported libzci schema {version}; existing data preserved"),
        ));
    }
    if version == 0 {
        if !db
            .statement(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
                &[],
            )?
            .is_empty()
        {
            return Err(failure("schema", "unrecognized nonempty database"));
        }
        transaction(db, |db| {
            for sql in ["CREATE TABLE source_references (key TEXT PRIMARY KEY, reference TEXT NOT NULL)","CREATE TABLE queue_occurrences (id INTEGER PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, source_key TEXT NOT NULL REFERENCES source_references(key), subsong INTEGER)","CREATE TABLE sessions (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, navigation TEXT NOT NULL, position_seconds REAL NOT NULL)","CREATE TABLE domain_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)","PRAGMA user_version=1"] {exec(db,sql,&[])?;}
            write(db, &ProfileState::default())
        })?;
    }
    // Reopen consistently even if an adapter is used without the profile lock.
    transaction(db, |db| {
        let rows = db.statement(
            "SELECT revision,navigation,position_seconds FROM sessions WHERE id=1",
            &[],
        )?;
        let r = rows
            .first()
            .filter(|r| r.len() == 3)
            .ok_or_else(|| failure("corrupt", "missing session"))?;
        let mut state = ProfileState {
            revision: r[0]
                .as_u64()
                .ok_or_else(|| failure("corrupt", "revision"))?,
            queue: decode(&r[1])?,
            position_seconds: r[2]
                .as_f64()
                .ok_or_else(|| failure("corrupt", "position"))?,
            ..Default::default()
        };
        for row in db.statement("SELECT reference FROM source_references ORDER BY key", &[])? {
            state.sources.push(decode::<SourceReference>(&row[0])?);
        }
        for row in db.statement(
            "SELECT id,source_key,subsong FROM queue_occurrences ORDER BY ordinal",
            &[],
        )? {
            state.queue.items.push(crate::queue::Occurrence {
                id: row[0]
                    .as_u64()
                    .ok_or_else(|| failure("corrupt", "occurrence"))?,
                source_key: row[1]
                    .as_str()
                    .ok_or_else(|| failure("corrupt", "source key"))?
                    .into(),
                subsong: if row[2].is_null() {
                    None
                } else {
                    Some(
                        row[2]
                            .as_u64()
                            .and_then(|n| u32::try_from(n).ok())
                            .ok_or_else(|| failure("corrupt", "subsong"))?,
                    )
                },
            });
        }
        let settings = db.statement(
            "SELECT value FROM domain_settings WHERE key='playback'",
            &[],
        )?;
        state.settings = decode(
            settings
                .first()
                .and_then(|r| r.first())
                .ok_or_else(|| failure("corrupt", "missing settings"))?,
        )?;
        state.validate().map_err(|e| failure("corrupt", e))?;
        Ok(state)
    })
}
fn write(db: &mut dyn SqlBridge, state: &ProfileState) -> Result<()> {
    exec(db, "DELETE FROM queue_occurrences", &[])?;
    exec(db, "DELETE FROM source_references", &[])?;
    for s in &state.sources {
        exec(
            db,
            "INSERT INTO source_references(key,reference) VALUES(?,?)",
            &[json!(s.key), json!(serde_json::to_string(s).unwrap())],
        )?;
    }
    for (n, i) in state.queue.items.iter().enumerate() {
        exec(
            db,
            "INSERT INTO queue_occurrences(id,ordinal,source_key,subsong) VALUES(?,?,?,?)",
            &[json!(i.id), json!(n), json!(i.source_key), json!(i.subsong)],
        )?;
    }
    let navigation = Queue {
        items: vec![],
        ..state.queue.clone()
    };
    exec(
        db,
        "INSERT OR REPLACE INTO sessions(id,revision,navigation,position_seconds) VALUES(1,?,?,?)",
        &[
            json!(state.revision),
            json!(serde_json::to_string(&navigation).unwrap()),
            json!(state.position_seconds),
        ],
    )?;
    exec(
        db,
        "INSERT OR REPLACE INTO domain_settings(key,value) VALUES('playback',?)",
        &[json!(serde_json::to_string(&state.settings).unwrap())],
    )
}
pub fn commit(db: &mut dyn SqlBridge, state: &ProfileState, previous: u64) -> Result<()> {
    transaction(db, |db| {
        let row = db.statement("SELECT revision FROM sessions WHERE id=1", &[])?;
        if row.first().and_then(|r| r.first()).and_then(Value::as_u64) != Some(previous) {
            return Err(failure(
                "busy",
                "profile revision changed; reopen before retrying",
            ));
        }
        write(db, state)
    })
}
