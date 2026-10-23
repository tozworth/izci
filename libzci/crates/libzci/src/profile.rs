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
            if request.is_empty() || request.len() > 256 {
                return Err(invalid("invalid durable request identity"));
            }
            if let Some(db) = db.as_mut() {
                if let Some(mut outcome) = storage::receipt(*db, request, &payload)? {
                    outcome.duplicate = true;
                    outcome.load = None;
                    outcome.stop = false;
                    return Ok(outcome);
                }
            }
        }
        let mut next = self.state.clone();
        let outcome = next.apply(command)?;
        if let Some(db) = db {
            storage::commit(
                db,
                &next,
                &self.state,
                request.map(|id| (id, payload.as_str(), &outcome)),
            )?;
        }
        self.state = next;
        Ok(outcome)
    }
}
