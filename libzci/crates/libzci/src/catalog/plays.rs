//! Session-qualified plays become user facts atomically. The connection owns
//! fresh counting bindings and bounded retry receipts; reconnecting invalidates
//! old bindings instead of ever reapplying an evicted or reused request.
use crate::{
    catalog,
    play_counts::{validate_binding, QualifiedPlay, MAX_PENDING_PLAYS},
    storage::{exec, failure, SqlBridge},
    Result,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
const MAX_BINDINGS: u64 = 256;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayCountAcknowledgement {
    pub binding: String,
    pub sequence: u64,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayCountOutcome {
    pub revision: u64,
    pub catalog_revision: u64,
    pub counted: usize,
    pub ignored: usize,
    pub duplicates: usize,
    pub media: Vec<u64>,
    pub acknowledged: Vec<PlayCountAcknowledgement>,
}
fn integer(rows: &[Vec<Value>]) -> Result<u64> {
    rows.first()
        .and_then(|r| r.first())
        .and_then(Value::as_u64)
        .ok_or_else(|| failure("corrupt", "missing play-count integer"))
}
fn init(db: &mut dyn SqlBridge) -> Result<()> {
    exec(db,"CREATE TEMP TABLE IF NOT EXISTS play_count_bindings (token TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL DEFAULT 0)",&[])?;
    exec(db,"CREATE TEMP TABLE IF NOT EXISTS play_count_receipts (binding TEXT NOT NULL REFERENCES play_count_bindings(token) ON DELETE CASCADE,sequence INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(binding,sequence))",&[])
}
pub(crate) fn begin(db: &mut dyn SqlBridge) -> Result<String> {
    init(db)?;
    if integer(&db.statement("SELECT count(*) FROM play_count_bindings", &[])?)? >= MAX_BINDINGS {
        return Err(crate::LibzciError::ResourceExhausted {
            detail: "active play-count binding budget exceeded".into(),
        });
    }
    let nonce = db.statement("SELECT lower(hex(randomblob(16)))", &[])?;
    let nonce = nonce
        .first()
        .and_then(|r| r.first())
        .and_then(Value::as_str)
        .ok_or_else(|| failure("io", "missing play-count nonce"))?;
    validate_binding(nonce)?;
    exec(
        db,
        "INSERT INTO play_count_bindings(token) VALUES(?)",
        &[json!(nonce)],
    )?;
    Ok(nonce.into())
}
pub(crate) fn close(db: &mut dyn SqlBridge, binding: &str) -> Result<()> {
    validate_binding(binding)?;
    init(db)?;
    exec(
        db,
        "DELETE FROM play_count_bindings WHERE token=?",
        &[json!(binding)],
    )
}
pub(crate) fn eligible(db: &mut dyn SqlBridge, key: &str) -> Result<Option<u64>> {
    catalog::text(key, 8192, false)?;
    let rows=db.statement("SELECT m.id FROM media m WHERE m.source_key=? AND m.kind IN ('audio','module','video') AND (m.manual=1 OR EXISTS (SELECT 1 FROM root_memberships rm WHERE rm.media_id=m.id))",&[json!(key)])?;
    rows.first()
        .map(|r| {
            r[0].as_u64()
                .ok_or_else(|| failure("corrupt", "invalid eligible media ID"))
        })
        .transpose()
}
pub(crate) fn apply(db: &mut dyn SqlBridge, plays: &[QualifiedPlay]) -> Result<PlayCountOutcome> {
    init(db)?;
    let mut outcome = PlayCountOutcome::default();
    let mut media = BTreeSet::new();
    let mut acks = BTreeMap::new();
    for play in plays {
        play.validate()?;
        let rows = db.statement(
            "SELECT last_sequence FROM play_count_bindings WHERE token=?",
            &[json!(play.binding)],
        )?;
        if rows.is_empty() {
            return Err(failure(
                "count-binding",
                "play-count binding is closed or belongs to another connection",
            ));
        }
        let last = integer(&rows)?;
        let payload = format!("{:x}", Sha256::digest(serde_json::to_vec(play).unwrap()));
        if play.sequence <= last {
            let receipt = db.statement(
                "SELECT payload FROM play_count_receipts WHERE binding=? AND sequence=?",
                &[json!(play.binding), json!(play.sequence)],
            )?;
            if receipt
                .first()
                .and_then(|r| r.first())
                .and_then(Value::as_str)
                != Some(payload.as_str())
            {
                return Err(failure(
                    "count-receipt",
                    "stale play count or sequence reused with different facts",
                ));
            }
            outcome.duplicates += 1;
        } else {
            if play.sequence != last + 1 {
                return Err(failure(
                    "count-sequence",
                    "commit qualified plays in sequence",
                ));
            }
            let row=db.statement("SELECT m.source_key,m.kind,(m.manual=1 OR EXISTS (SELECT 1 FROM root_memberships rm WHERE rm.media_id=m.id)) FROM media m WHERE m.id=?",&[json!(play.media)])?;
            if row
                .first()
                .is_some_and(|r| r[0].as_str() != Some(play.source_key.as_str()))
            {
                return Err(failure(
                    "count-source",
                    "qualified play no longer matches its media identity",
                ));
            }
            let eligible = row.first().is_some_and(|r| {
                r[2].as_u64() == Some(1) && r[1].as_str().is_some_and(|k| k != "image")
            });
            if eligible {
                for subsong in std::iter::once(None).chain(play.subsong.map(Some)) {
                    let rows=db.statement("INSERT INTO user_facts(media_id,subsong,play_count,last_played_ms) VALUES(?,?,1,?) ON CONFLICT(media_id,subsong) DO UPDATE SET play_count=user_facts.play_count+1,last_played_ms=MAX(COALESCE(user_facts.last_played_ms,0),excluded.last_played_ms) WHERE user_facts.play_count<9007199254740991 RETURNING play_count",&[json!(play.media),json!(catalog::subsong(subsong)),json!(play.played_at_ms)])?;
                    if rows.is_empty() {
                        return Err(crate::LibzciError::ResourceExhausted {
                            detail: "library play count exhausted".into(),
                        });
                    }
                }
                outcome.counted += 1;
                media.insert(play.media);
            } else {
                outcome.ignored += 1;
            }
            exec(
                db,
                "INSERT INTO play_count_receipts(binding,sequence,payload) VALUES(?,?,?)",
                &[json!(play.binding), json!(play.sequence), json!(payload)],
            )?;
            exec(
                db,
                "UPDATE play_count_bindings SET last_sequence=? WHERE token=?",
                &[json!(play.sequence), json!(play.binding)],
            )?;
            exec(
                db,
                "DELETE FROM play_count_receipts WHERE binding=? AND sequence<=?",
                &[
                    json!(play.binding),
                    json!(play.sequence.saturating_sub(MAX_PENDING_PLAYS as u64)),
                ],
            )?;
        }
        acks.entry(play.binding.clone())
            .and_modify(|n: &mut u64| *n = (*n).max(play.sequence))
            .or_insert(play.sequence);
    }
    outcome.media = media.into_iter().collect();
    outcome.acknowledged = acks
        .into_iter()
        .map(|(binding, sequence)| PlayCountAcknowledgement { binding, sequence })
        .collect();
    Ok(outcome)
}
