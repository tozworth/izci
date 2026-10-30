use super::*;
use crate::storage::{decode, exec, failure, SqlBridge};
use serde_json::{json, Value};

pub(crate) fn require(db: &mut dyn SqlBridge, media: u64) -> Result<()> {
    id(media)?;
    if db
        .statement("SELECT id FROM media WHERE id=?", &[json!(media)])?
        .is_empty()
    {
        return Err(invalid("unknown media identity"));
    }
    Ok(())
}

/// All statements run within the profile owner's transaction. SQLite row IDs
/// are used only after successful writes and are never recycled after removal.
pub(crate) fn upsert(db: &mut dyn SqlBridge, input: &MediaInput, manual: bool) -> Result<u64> {
    input.validate()?;
    let rows = db.statement(
        "SELECT id,reference FROM media WHERE source_key=?",
        &[json!(input.source.key)],
    )?;
    if let Some(row) = rows.first() {
        let old: SourceReference = decode(&row[1])?;
        // The platform key is authoritative; a different kind cannot take it
        // over. Locator/display spelling may change (e.g. a case-only rename).
        if old.kind != input.source.kind {
            return Err(invalid("catalog source identity collision"));
        }
    }
    let metadata = &input.metadata;
    db.statement(
        "INSERT INTO media(source_key,reference,source_revision,kind,manual,title,artist,album,genre,metadata) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET reference=excluded.reference,source_revision=excluded.source_revision,kind=excluded.kind,manual=MAX(media.manual,excluded.manual),title=excluded.title,artist=excluded.artist,album=excluded.album,genre=excluded.genre,metadata=excluded.metadata",
        &[json!(input.source.key), json!(serde_json::to_string(&input.source).unwrap()), json!(input.source_revision),json!(input.kind.sql()),json!(manual),json!(metadata.title),json!(metadata.artist),json!(metadata.album),json!(metadata.genre),json!(serde_json::to_string(metadata).unwrap())],
    )?;
    let rows = db.statement(
        "SELECT id FROM media WHERE source_key=?",
        &[json!(input.source.key)],
    )?;
    rows.first()
        .and_then(|r| r.first())
        .and_then(Value::as_u64)
        .ok_or_else(|| failure("corrupt", "missing media after upsert"))
}

pub(crate) fn apply(
    db: &mut dyn SqlBridge,
    command: CatalogCommand,
    revision: u64,
) -> Result<CatalogOutcome> {
    let mut outcome = CatalogOutcome {
        duplicate: false,
        revision,
        media: vec![],
        bookmark: None,
        root: None,
        scan: None,
    };
    match command {
        CatalogCommand::Root { root } => {
            outcome.root = Some(super::scans::put_root(db, &root, revision)?)
        }
        CatalogCommand::RemoveRoot { root } => {
            super::scans::root(db, root)?;
            super::scans::invalidate_root(db, root)?;
            exec(db, "DELETE FROM managed_roots WHERE id=?", &[json!(root)])?;
            outcome.root = Some(root);
        }
        CatalogCommand::FinishScan { token } => {
            let summary = super::scans::finish(db, &token)?;
            outcome.root = Some(summary.root);
            outcome.scan = Some(summary);
        }
        CatalogCommand::Add { media } => {
            if media.is_empty() || media.len() > MAX_BATCH {
                return Err(invalid("catalog batch must contain 1..256 entries"));
            }
            for input in media {
                outcome.media.push(upsert(db, &input, true)?);
            }
        }
        CatalogCommand::Remove { media } => {
            if media.is_empty() || media.len() > MAX_BATCH {
                return Err(invalid("catalog batch must contain 1..256 entries"));
            }
            for n in media {
                require(db, n)?;
                // Removal drops membership only, preserving facts and identity.
                exec(db, "UPDATE media SET manual=0 WHERE id=?", &[json!(n)])?;
                exec(
                    db,
                    "DELETE FROM root_memberships WHERE media_id=?",
                    &[json!(n)],
                )?;
                outcome.media.push(n);
            }
        }
        CatalogCommand::Favorite {
            media,
            subsong: n,
            favorite,
        } => {
            require(db, media)?;
            exec(db,"INSERT INTO user_facts(media_id,subsong,favorite) VALUES(?,?,?) ON CONFLICT(media_id,subsong) DO UPDATE SET favorite=excluded.favorite", &[json!(media),json!(subsong(n)),json!(favorite)])?;
            outcome.media.push(media);
        }
        CatalogCommand::Rate {
            media,
            subsong: n,
            rating,
        } => {
            require(db, media)?;
            if rating > 10 {
                return Err(invalid("rating must be a half-star step in 0..10"));
            }
            exec(db,"INSERT INTO user_facts(media_id,subsong,rating) VALUES(?,?,?) ON CONFLICT(media_id,subsong) DO UPDATE SET rating=excluded.rating", &[json!(media),json!(subsong(n)),json!(rating)])?;
            outcome.media.push(media);
        }
        CatalogCommand::Bookmark {
            media,
            subsong: n,
            position_seconds,
            label,
        } => {
            require(db, media)?;
            crate::MediaTime(position_seconds).validate()?;
            text(&label, 4096, true)?;
            let count = db.statement(
                "SELECT count(*) FROM bookmarks WHERE media_id=?",
                &[json!(media)],
            )?;
            if count[0][0].as_u64().unwrap_or(u64::MAX) >= 10_000 {
                return Err(invalid("media bookmark budget exceeded"));
            }
            exec(
                db,
                "INSERT INTO bookmarks(media_id,subsong,position_seconds,label) VALUES(?,?,?,?)",
                &[
                    json!(media),
                    json!(subsong(n)),
                    json!(position_seconds),
                    json!(label),
                ],
            )?;
            outcome.bookmark = db
                .statement("SELECT last_insert_rowid()", &[])?
                .first()
                .and_then(|r| r.first())
                .and_then(Value::as_u64);
            outcome.media.push(media);
        }
        CatalogCommand::RemoveBookmark { id: n } => {
            id(n)?;
            let rows = db.statement("SELECT media_id FROM bookmarks WHERE id=?", &[json!(n)])?;
            let media = rows
                .first()
                .and_then(|r| r.first())
                .and_then(Value::as_u64)
                .ok_or_else(|| invalid("unknown bookmark"))?;
            exec(db, "DELETE FROM bookmarks WHERE id=?", &[json!(n)])?;
            outcome.media.push(media);
        }
    }
    Ok(outcome)
}
