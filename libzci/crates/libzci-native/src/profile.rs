//! Native ownership and SQLite execution. SQL and queue policy stay in core.
use libzci::{
    profile::{Profile, ProfileOutcome},
    queue::QueueCommand,
    storage::{failure, SqlBridge},
    Result,
};
use rusqlite::{
    types::{Value as SqlValue, ValueRef},
    Connection,
};
use serde_json::Value;
use std::{
    fs::{File, OpenOptions},
    path::Path,
};
pub struct NativeDatabase {
    connection: Connection,
    _lock: File,
}
fn sql_error(e: rusqlite::Error) -> libzci::LibzciError {
    let code = match e.sqlite_error_code() {
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked) => "busy",
        Some(rusqlite::ErrorCode::DiskFull) => "quota",
        Some(rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase) => "corrupt",
        _ => "io",
    };
    failure(code, e)
}
impl NativeDatabase {
    pub fn open(path: &Path) -> Result<Self> {
        std::fs::create_dir_all(path).map_err(|e| failure("init", e))?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path.join("owner.lock"))
            .map_err(|e| failure("init", e))?;
        lock.try_lock().map_err(|e| {
            failure(
                "busy",
                format!("profile already owned or cannot be locked: {e}"),
            )
        })?;
        let connection = Connection::open(path.join("profile.sqlite3")).map_err(sql_error)?;
        connection
            .busy_timeout(std::time::Duration::ZERO)
            .map_err(sql_error)?;
        Ok(Self {
            connection,
            _lock: lock,
        })
    }
}
impl SqlBridge for NativeDatabase {
    fn statement(&mut self, sql: &str, bind: &[Value]) -> Result<Vec<Vec<Value>>> {
        let args: Vec<SqlValue> = bind
            .iter()
            .map(|v| match v {
                Value::Null => SqlValue::Null,
                Value::String(s) => SqlValue::Text(s.clone()),
                Value::Number(n) => n
                    .as_i64()
                    .map(SqlValue::Integer)
                    .unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap())),
                Value::Bool(v) => SqlValue::Integer(*v as i64),
                _ => SqlValue::Text(v.to_string()),
            })
            .collect();
        let mut statement = self.connection.prepare(sql).map_err(sql_error)?;
        let count = statement.column_count();
        let mut rows = statement
            .query(rusqlite::params_from_iter(args))
            .map_err(sql_error)?;
        let mut out = vec![];
        while let Some(row) = rows.next().map_err(sql_error)? {
            let mut values = vec![];
            for n in 0..count {
                values.push(match row.get_ref(n).map_err(sql_error)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => Value::from(n),
                    ValueRef::Real(n) => Value::from(n),
                    ValueRef::Text(s) => Value::String(String::from_utf8_lossy(s).into()),
                    ValueRef::Blob(_) => {
                        return Err(failure("corrupt", "unexpected blob in domain state"))
                    }
                });
            }
            out.push(values);
        }
        Ok(out)
    }
}
pub struct NativeProfile {
    pub core: Profile,
    db: Option<NativeDatabase>,
}
impl NativeProfile {
    pub fn transient() -> Self {
        Self {
            core: Profile::transient(),
            db: None,
        }
    }
    pub fn open(path: &Path) -> Result<Self> {
        let mut db = NativeDatabase::open(path)?;
        let core = Profile::open(&mut db)?;
        Ok(Self { core, db: Some(db) })
    }
    pub fn command(&mut self, command: QueueCommand) -> Result<ProfileOutcome> {
        self.core
            .command(command, self.db.as_mut().map(|db| db as &mut dyn SqlBridge))
    }
    pub fn catalog_request(
        &mut self,
        command: libzci::catalog::CatalogCommand,
        request: Option<&str>,
    ) -> Result<libzci::catalog::CatalogOutcome> {
        let db = self
            .db
            .as_mut()
            .ok_or_else(|| failure("unavailable", "catalog requires an open profile"))?;
        self.core.catalog_request(command, request, db)
    }
    pub fn catalog_query(
        &mut self,
        query: &libzci::catalog::CatalogQuery,
    ) -> Result<libzci::catalog::CatalogPage> {
        let db = self
            .db
            .as_mut()
            .ok_or_else(|| failure("unavailable", "catalog requires an open profile"))?;
        self.core.catalog_query(query, db)
    }
    pub fn catalog_groups(
        &mut self,
        by: libzci::catalog::CatalogGroupBy,
        query: &libzci::catalog::CatalogQuery,
    ) -> Result<libzci::catalog::CatalogGroupPage> {
        let db = self
            .db
            .as_mut()
            .ok_or_else(|| failure("unavailable", "catalog requires an open profile"))?;
        self.core.catalog_groups(by, query, db)
    }
    pub fn bookmarks(
        &mut self,
        media: u64,
        subsong: Option<u32>,
    ) -> Result<Vec<libzci::catalog::Bookmark>> {
        let db = self
            .db
            .as_mut()
            .ok_or_else(|| failure("unavailable", "catalog requires an open profile"))?;
        self.core.bookmarks(media, subsong, db)
    }
    pub fn managed_roots(&mut self) -> Result<Vec<libzci::catalog::ManagedRoot>> {
        let db = self
            .db
            .as_mut()
            .ok_or_else(|| failure("unavailable", "catalog requires an open profile"))?;
        self.core.managed_roots(db)
    }
    pub fn begin_scan(&mut self, root: u64) -> Result<libzci::catalog::ScanPlan> {
        let db = self
            .db
            .as_mut()
            .ok_or_else(|| failure("unavailable", "catalog requires an open profile"))?;
        self.core.begin_scan(root, db)
    }
    pub fn stage_scan(
        &mut self,
        token: &str,
        media: Vec<libzci::catalog::MediaInput>,
    ) -> Result<u64> {
        let db = self
            .db
            .as_mut()
            .ok_or_else(|| failure("unavailable", "catalog requires an open profile"))?;
        self.core.stage_scan(token, media, db)
    }
    pub fn cancel_scan(&mut self, token: &str) -> Result<()> {
        let db = self
            .db
            .as_mut()
            .ok_or_else(|| failure("unavailable", "catalog requires an open profile"))?;
        self.core.cancel_scan(token, db)
    }
    pub fn append_paths(&mut self, paths: &[std::path::PathBuf]) -> Result<ProfileOutcome> {
        let mut sources = vec![];
        for path in paths {
            sources.push(crate::source::native_reference(path)?);
        }
        self.command(QueueCommand::Append { sources })
    }
}
