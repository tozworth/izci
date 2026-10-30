//! Durable mutations publish a revision only after the shared SQL transaction commits.
use crate::{
    queue::*,
    storage::{self, SqlBridge},
    Result,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileState {
    pub revision: u64,
    pub catalog_revision: u64,
    pub sources: Vec<SourceReference>,
    pub queue: Queue,
    pub settings: QueueSettings,
    pub position_seconds: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QueueLoad {
    pub occurrence: u64,
    pub source: SourceReference,
    pub position_seconds: f64,
    pub subsong: Option<u32>,
    pub autoplay: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProfileOutcome {
    pub duplicate: bool,
    pub appended: Vec<u64>,
    pub revision: u64,
    pub load: Option<QueueLoad>,
    pub stop: bool,
}
impl ProfileState {
    pub fn validate(&self) -> Result<()> {
        if self.revision > 9_007_199_254_740_991
            || self.catalog_revision > crate::catalog::MAX_ID
            || self
                .sources
                .iter()
                .map(|s| s.key.len() + s.locator.len() + s.display_path.len())
                .sum::<usize>()
                > 8 * 1024 * 1024
        {
            return Err(invalid("profile reference/revision budget exceeded"));
        }
        self.settings.validate()?;
        crate::MediaTime(self.position_seconds).validate()?;
        if self.queue.items.len() > MAX_QUEUE
            || self.sources.len() > MAX_QUEUE
            || self.queue.up_next.len() > MAX_QUEUE
            || self.queue.history.len() > MAX_HISTORY
            || self.queue.forward.len() > MAX_HISTORY
            || self.queue.shuffle_remaining.len() > MAX_QUEUE
        {
            return Err(invalid("profile budget exceeded"));
        }
        let mut keys = std::collections::HashSet::new();
        for s in &self.sources {
            s.validate()?;
            if !keys.insert(&s.key) {
                return Err(invalid("duplicate source key"));
            }
        }
        let mut ids = std::collections::HashSet::new();
        for i in &self.queue.items {
            if i.id == 0
                || i.id >= self.queue.next_id
                || !ids.insert(i.id)
                || !keys.contains(&i.source_key)
            {
                return Err(invalid("invalid queue identity"));
            }
        }
        if self.queue.next_id > 9_007_199_254_740_991 || self.queue.random_state == 0 {
            return Err(invalid("queue identity exhausted"));
        }
        for id in self
            .queue
            .current
            .iter()
            .chain(&self.queue.up_next)
            .chain(&self.queue.history)
            .chain(&self.queue.forward)
            .chain(&self.queue.shuffle_remaining)
        {
            self.queue.require(*id)?;
        }
        Ok(())
    }
    pub fn restore(&self) -> Option<QueueLoad> {
        self.load(false)
    }
    fn load(&self, autoplay: bool) -> Option<QueueLoad> {
        let item = self
            .queue
            .items
            .iter()
            .find(|i| Some(i.id) == self.queue.current)?;
        Some(QueueLoad {
            occurrence: item.id,
            source: self
                .sources
                .iter()
                .find(|s| s.key == item.source_key)?
                .clone(),
            position_seconds: self.position_seconds,
            subsong: item.subsong,
            autoplay,
        })
    }
    fn apply(&mut self, command: QueueCommand) -> Result<ProfileOutcome> {
        let mut appended = vec![];
        let mut load = false;
        let mut stop = false;
        match command {
            QueueCommand::Volume { volume } => {
                self.settings.volume = volume;
                self.settings.validate()?;
            }
            QueueCommand::Mute { mute } => self.settings.mute = mute,
            QueueCommand::Append { sources } => {
                if self.queue.items.len() + sources.len() > MAX_QUEUE {
                    return Err(invalid("queue full"));
                }
                for source in sources {
                    source.validate()?;
                    if let Some(old) = self.sources.iter().find(|s| s.key == source.key) {
                        if old != &source {
                            return Err(invalid("source identity collision"));
                        }
                    } else {
                        self.sources.push(source.clone());
                    }
                    self.queue.items.push(Occurrence {
                        id: self.queue.next_id,
                        source_key: source.key,
                        subsong: None,
                    });
                    appended.push(self.queue.next_id);
                    if self.settings.shuffle {
                        self.queue.shuffle_remaining.push(self.queue.next_id);
                    }
                    self.queue.next_id += 1;
                }
            }
            QueueCommand::Remove { id } => {
                self.queue.require(id)?;
                self.queue.items.retain(|i| i.id != id);
                self.queue.history.retain(|v| *v != id);
                self.queue.forward.retain(|v| *v != id);
                self.queue.up_next.retain(|v| *v != id);
                self.queue.shuffle_remaining.retain(|v| *v != id);
                if self.queue.current == Some(id) {
                    self.queue.current = None;
                    self.position_seconds = 0.;
                    stop = true;
                }
                self.sources
                    .retain(|s| self.queue.items.iter().any(|i| i.source_key == s.key));
            }
            QueueCommand::Move { id, index } => {
                self.queue.require(id)?;
                if index >= self.queue.items.len() {
                    return Err(invalid("move index out of range"));
                }
                let old = self.queue.items.iter().position(|i| i.id == id).unwrap();
                let item = self.queue.items.remove(old);
                self.queue.items.insert(index, item);
            }
            QueueCommand::Play { id } => {
                self.queue.forward.clear();
                self.queue.activate(id)?;
                self.position_seconds = 0.;
                load = true;
            }
            QueueCommand::Next { ended } => {
                if let Some(id) = self.queue.next(&self.settings, ended) {
                    self.queue.activate(id)?;
                    self.position_seconds = 0.;
                    load = true;
                } else {
                    stop = !ended;
                }
            }
            QueueCommand::Previous { position_seconds } => {
                if let Some(id) = self.queue.previous(position_seconds, &self.settings)? {
                    self.queue.activate(id)?;
                    self.position_seconds = 0.;
                    load = true;
                }
            }
            QueueCommand::UpNext { id } => {
                self.queue.require(id)?;
                if self.queue.up_next.len() >= MAX_QUEUE {
                    return Err(invalid("up-next full"));
                }
                self.queue.up_next.push(id);
            }
            QueueCommand::ClearUpNext => self.queue.up_next.clear(),
            QueueCommand::Settings { settings } => {
                settings.validate()?;
                if settings.shuffle != self.settings.shuffle {
                    self.queue.forward.clear();
                    self.queue.shuffle_remaining = self
                        .queue
                        .items
                        .iter()
                        .map(|i| i.id)
                        .filter(|id| Some(*id) != self.queue.current)
                        .collect();
                }
                self.settings = settings;
            }
            QueueCommand::Checkpoint {
                position_seconds,
                subsong,
            } => {
                crate::MediaTime(position_seconds).validate()?;
                self.position_seconds = position_seconds;
                if let Some(i) = self
                    .queue
                    .items
                    .iter_mut()
                    .find(|i| Some(i.id) == self.queue.current)
                {
                    i.subsong = subsong;
                }
            }
        }
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or_else(|| invalid("revision exhausted"))?;
        self.validate()?;
        Ok(ProfileOutcome {
            duplicate: false,
            appended,
            revision: self.revision,
            load: if load { self.load(true) } else { None },
            stop,
        })
    }
}
pub struct Profile {
    state: ProfileState,
}
impl Profile {
    pub fn transient() -> Self {
        Self {
            state: ProfileState::default(),
        }
    }
    pub fn open(db: &mut dyn SqlBridge) -> Result<Self> {
        Ok(Self {
            state: storage::open(db)?,
        })
    }
    pub fn snapshot(&self) -> &ProfileState {
        &self.state
    }
    pub fn command(
        &mut self,
        command: QueueCommand,
        db: Option<&mut dyn SqlBridge>,
    ) -> Result<ProfileOutcome> {
        self.request(command, None, db)
    }
    pub fn request(
        &mut self,
        command: QueueCommand,
        request: Option<&str>,
        mut db: Option<&mut dyn SqlBridge>,
    ) -> Result<ProfileOutcome> {
        use sha2::{Digest, Sha256};
        let payload = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&command).unwrap())
        );
        if let Some(request) = request {
            validate_request(request)?;
            if let Some(db) = db.as_mut() {
                if let Some(mut outcome) =
                    storage::receipt::<ProfileOutcome>(*db, request, &payload)?
                {
                    outcome.duplicate = true;
                    outcome.load = None;
                    outcome.stop = false;
                    return Ok(outcome);
                }
            }
            // Browser envelopes retain the sender's observed revision across
            // reconnects. An evicted receipt is never permission to replay an
            // old mutation: fail visibly and require a fresh snapshot/request.
            validate_request_age(request, self.state.revision)?;
        }
        let mut next = self.state.clone();
        let outcome = next.apply(command)?;
        if let Some(db) = db {
            storage::commit_operation(
                db,
                &next,
                &self.state,
                request.map(|id| (id, payload.as_str())),
                |_| Ok(outcome.clone()),
            )?;
        }
        self.state = next;
        Ok(outcome)
    }

    /// Catalog mutations share the profile owner/revision and SQL transaction,
    /// without loading the catalog into the playback snapshot on every tick.
    pub fn catalog_request(
        &mut self,
        command: crate::catalog::CatalogCommand,
        request: Option<&str>,
        db: &mut dyn SqlBridge,
    ) -> Result<crate::catalog::CatalogOutcome> {
        use sha2::{Digest, Sha256};
        let payload = format!(
            "catalog:{:x}",
            Sha256::digest(serde_json::to_vec(&command).unwrap())
        );
        if let Some(request) = request {
            validate_request(request)?;
            if let Some(mut outcome) =
                storage::receipt::<crate::catalog::CatalogOutcome>(db, request, &payload)?
            {
                outcome.duplicate = true;
                return Ok(outcome);
            }
            validate_request_age(request, self.state.revision)?;
        }
        let mut next = self.state.clone();
        next.revision = next
            .revision
            .checked_add(1)
            .ok_or_else(|| invalid("revision exhausted"))?;
        next.catalog_revision = next
            .catalog_revision
            .checked_add(1)
            .ok_or_else(|| invalid("catalog revision exhausted"))?;
        next.validate()?;
        let outcome = storage::commit_operation(
            db,
            &next,
            &self.state,
            request.map(|id| (id, payload.as_str())),
            |db| crate::catalog::mutation::apply(db, command, next.catalog_revision),
        )?;
        self.state = next;
        Ok(outcome)
    }

    pub fn catalog_query(
        &self,
        query: &crate::catalog::CatalogQuery,
        db: &mut dyn SqlBridge,
    ) -> Result<crate::catalog::CatalogPage> {
        crate::catalog::query::query(db, query)
    }
    pub fn catalog_groups(
        &self,
        by: crate::catalog::CatalogGroupBy,
        query: &crate::catalog::CatalogQuery,
        db: &mut dyn SqlBridge,
    ) -> Result<crate::catalog::CatalogGroupPage> {
        crate::catalog::query::groups(db, by, query)
    }

    pub fn bookmarks(
        &self,
        media: u64,
        subsong: Option<u32>,
        db: &mut dyn SqlBridge,
    ) -> Result<Vec<crate::catalog::Bookmark>> {
        crate::catalog::query::bookmarks(db, media, subsong)
    }
    pub fn managed_roots(
        &self,
        db: &mut dyn SqlBridge,
    ) -> Result<Vec<crate::catalog::ManagedRoot>> {
        crate::catalog::scans::roots(db)
    }
    pub fn begin_scan(
        &self,
        root: u64,
        db: &mut dyn SqlBridge,
    ) -> Result<crate::catalog::ScanPlan> {
        crate::catalog::scans::begin(db, root)
    }
    pub fn stage_scan(
        &self,
        token: &str,
        media: Vec<crate::catalog::MediaInput>,
        db: &mut dyn SqlBridge,
    ) -> Result<u64> {
        crate::catalog::scans::stage(db, token, media)
    }
    pub fn cancel_scan(&self, token: &str, db: &mut dyn SqlBridge) -> Result<()> {
        crate::catalog::scans::cancel(db, token)
    }
    /// Capability GC asks core about durable references, including catalog-only
    /// files and roots. It must never infer liveness from the playback queue.
    pub fn references_browser_capability(
        &self,
        locator: &str,
        db: &mut dyn SqlBridge,
    ) -> Result<bool> {
        crate::catalog::text(locator, 8192, false)?;
        use serde_json::json;
        Ok(!db.statement("SELECT 1 FROM source_references WHERE json_extract(reference,'$.kind')='browser_handle' AND json_extract(reference,'$.locator')=? UNION ALL SELECT 1 FROM media WHERE json_extract(reference,'$.kind')='browser_handle' AND json_extract(reference,'$.locator')=? UNION ALL SELECT 1 FROM managed_roots WHERE json_extract(config,'$.source.kind')='browser_handle' AND json_extract(config,'$.source.locator')=? LIMIT 1",&[json!(locator),json!(locator),json!(locator)])?.is_empty())
    }
    pub fn references_source(&self, key: &str, db: &mut dyn SqlBridge) -> Result<bool> {
        crate::catalog::text(key, 8192, false)?;
        use serde_json::json;
        Ok(!db.statement("SELECT 1 FROM source_references WHERE key=? UNION ALL SELECT 1 FROM media WHERE source_key=? UNION ALL SELECT 1 FROM managed_roots WHERE source_key=? LIMIT 1",&[json!(key),json!(key),json!(key)])?.is_empty())
    }
}

fn validate_request(request: &str) -> Result<()> {
    if request.is_empty() || request.len() > 256 {
        return Err(invalid("invalid durable request identity"));
    }
    Ok(())
}
fn validate_request_age(request: &str, revision: u64) -> Result<()> {
    if let Some((base, _)) = request.split_once(':') {
        let base = base
            .parse::<u64>()
            .map_err(|_| invalid("invalid request revision"))?;
        if base > revision || revision - base > 128 {
            return Err(storage::failure(
                "request-expired",
                "request outcome expired; refresh the snapshot before issuing a new request",
            ));
        }
    }
    Ok(())
}
