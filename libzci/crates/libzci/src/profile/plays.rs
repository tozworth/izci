use super::Profile;
use crate::{
    catalog::{self, plays::PlayCountOutcome},
    play_counts::{QualifiedPlay, MAX_PENDING_PLAYS},
    storage::{self, failure, SqlBridge},
    Result,
};
use serde_json::Value;
impl Profile {
    pub fn begin_play_counting(&self, db: &mut dyn SqlBridge) -> Result<String> {
        catalog::plays::begin(db)
    }
    pub fn close_play_counting(&self, binding: &str, db: &mut dyn SqlBridge) -> Result<()> {
        catalog::plays::close(db, binding)
    }
    pub fn play_count_eligibility(&self, key: &str, db: &mut dyn SqlBridge) -> Result<Option<u64>> {
        catalog::plays::eligible(db, key)
    }
    pub fn commit_qualified_plays(
        &mut self,
        plays: &[QualifiedPlay],
        db: &mut dyn SqlBridge,
    ) -> Result<PlayCountOutcome> {
        if plays.is_empty() || plays.len() > MAX_PENDING_PLAYS {
            return Err(crate::queue::invalid(
                "play-count batch must contain 1..64 entries",
            ));
        }
        for play in plays {
            play.validate()?;
        }
        let previous = &self.state;
        let mut next = previous.clone();
        let outcome = storage::transaction(db, |db| {
            let revision = db.statement("SELECT revision FROM sessions WHERE id=1", &[])?;
            if revision
                .first()
                .and_then(|r| r.first())
                .and_then(Value::as_u64)
                != Some(previous.revision)
            {
                return Err(failure(
                    "busy",
                    "profile revision changed; reopen before recording plays",
                ));
            }
            let mut outcome = catalog::plays::apply(db, plays)?;
            if outcome.counted > 0 {
                next.revision = next
                    .revision
                    .checked_add(1)
                    .ok_or_else(|| crate::queue::invalid("revision exhausted"))?;
                next.catalog_revision = next
                    .catalog_revision
                    .checked_add(1)
                    .ok_or_else(|| crate::queue::invalid("catalog revision exhausted"))?;
                next.validate()?;
                storage::write(db, &next, Some(previous))?;
            }
            outcome.revision = next.revision;
            outcome.catalog_revision = next.catalog_revision;
            Ok(outcome)
        })?;
        self.state = next;
        Ok(outcome)
    }
}
