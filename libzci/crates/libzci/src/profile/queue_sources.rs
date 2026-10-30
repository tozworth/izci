use crate::{storage::SqlBridge, LibzciError, Result};
use serde_json::Value;
/// Called inside the queue commit transaction. Catalog identities already known
/// to be images cannot be smuggled into playback by changing their filename.
pub(super) fn require_playable(db: &mut dyn SqlBridge, keys: &[String]) -> Result<()> {
    for chunk in keys.chunks(256) {
        let sql = format!(
            "SELECT id FROM media WHERE kind='image' AND source_key IN ({}) LIMIT 1",
            vec!["?"; chunk.len()].join(",")
        );
        let bind = chunk
            .iter()
            .map(|key| Value::String(key.clone()))
            .collect::<Vec<_>>();
        if !db.statement(&sql, &bind)?.is_empty() {
            return Err(LibzciError::Unsupported {
                detail: "catalog images cannot enter the music queue".into(),
            });
        }
    }
    Ok(())
}
