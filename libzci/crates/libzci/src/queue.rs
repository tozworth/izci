//! Occurrence navigation, independent of source access, storage and output.
use crate::{LibzciError, Result};
use serde::{Deserialize, Serialize};

pub const MAX_QUEUE: usize = 10_000;
pub const MAX_HISTORY: usize = 1024;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    NativePath,
    BrowserHandle,
    Ephemeral,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceReference {
    pub key: String,
    pub kind: SourceKind,
    /// Real native path or capability-registry key; never file contents.
    pub locator: String,
    pub display_path: String,
}
impl SourceReference {
    pub fn validate(&self) -> Result<()> {
        if self.key.is_empty()
            || self.locator.is_empty()
            || self.display_path.is_empty()
            || [&self.key, &self.locator, &self.display_path]
                .iter()
                .any(|s| s.len() > 8192 || s.contains('\0'))
        {
            return Err(invalid("invalid source reference"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Occurrence {
    pub id: u64,
    pub source_key: String,
    pub subsong: Option<u32>,
}
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Repeat {
    #[default]
    Off,
    All,
    One,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueueSettings {
    pub shuffle: bool,
    pub repeat: Repeat,
    pub previous_restart_seconds: f64,
    pub volume: f32,
    pub mute: bool,
}
impl Default for QueueSettings {
    fn default() -> Self {
        Self {
            shuffle: false,
            repeat: Repeat::Off,
            previous_restart_seconds: 3.,
            volume: 1.,
            mute: false,
        }
    }
}
impl QueueSettings {
    pub fn validate(&self) -> Result<()> {
        if !self.previous_restart_seconds.is_finite()
            || !(0.0..=600.).contains(&self.previous_restart_seconds)
            || !self.volume.is_finite()
            || !(0.0..=1.).contains(&self.volume)
        {
            return Err(invalid("playback setting out of range"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Queue {
    pub items: Vec<Occurrence>,
    pub current: Option<u64>,
    pub up_next: Vec<u64>,
    pub history: Vec<u64>,
    pub forward: Vec<u64>,
    pub shuffle_remaining: Vec<u64>,
    pub next_id: u64,
    pub random_state: u32,
}
impl Default for Queue {
    fn default() -> Self {
        Self {
            items: vec![],
            current: None,
            up_next: vec![],
            history: vec![],
            forward: vec![],
            shuffle_remaining: vec![],
            next_id: 1,
            random_state: 0x6d2b79f5,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum QueueCommand {
    Volume {
        volume: f32,
    },
    Mute {
        mute: bool,
    },
    Append {
        sources: Vec<SourceReference>,
    },
    Remove {
        id: u64,
    },
    Move {
        id: u64,
        index: usize,
    },
    Play {
        id: u64,
    },
    Next {
        ended: bool,
    },
    Previous {
        position_seconds: f64,
    },
    UpNext {
        id: u64,
    },
    ClearUpNext,
    Settings {
        settings: QueueSettings,
    },
    Checkpoint {
        position_seconds: f64,
        subsong: Option<u32>,
    },
}
pub(crate) fn invalid(detail: &str) -> LibzciError {
    LibzciError::InvalidArgument {
        detail: detail.into(),
    }
}
impl Queue {
    pub fn contains(&self, id: u64) -> bool {
        self.items.iter().any(|i| i.id == id)
    }
    pub fn require(&self, id: u64) -> Result<()> {
        if self.contains(id) {
            Ok(())
        } else {
            Err(invalid("unknown queue occurrence"))
        }
    }
    pub fn activate(&mut self, id: u64) -> Result<()> {
        self.require(id)?;
        if let Some(old) = self.current.filter(|old| *old != id) {
            self.history.push(old);
            if self.history.len() > MAX_HISTORY {
                self.history.remove(0);
            }
        }
        self.current = Some(id);
        self.shuffle_remaining.retain(|v| *v != id);
        Ok(())
    }
    pub fn next(&mut self, settings: &QueueSettings, ended: bool) -> Option<u64> {
        if !self.up_next.is_empty() {
            self.forward.clear();
            return Some(self.up_next.remove(0));
        }
        if ended && settings.repeat == Repeat::One && self.current.is_some() {
            return self.current;
        }
        if self.items.is_empty() {
            return None;
        }
        if !ended && self.items.len() == 1 {
            return Some(self.items[0].id);
        }
        if settings.shuffle {
            if let Some(id) = self.forward.pop() {
                return Some(id);
            }
            if self.shuffle_remaining.is_empty() {
                // A consumed shuffle cycle ends unless repeat-all is enabled.
                if self.current.is_some() && settings.repeat != Repeat::All {
                    return None;
                }
                self.shuffle_remaining = self
                    .items
                    .iter()
                    .map(|i| i.id)
                    .filter(|id| Some(*id) != self.current)
                    .collect();
            }
            if self.shuffle_remaining.is_empty() {
                return (settings.repeat == Repeat::All).then_some(self.items[0].id);
            }
            self.random_state ^= self.random_state << 13;
            self.random_state ^= self.random_state >> 17;
            self.random_state ^= self.random_state << 5;
            return Some(
                self.shuffle_remaining
                    .remove(self.random_state as usize % self.shuffle_remaining.len()),
            );
        }
        match self
            .current
            .and_then(|id| self.items.iter().position(|i| i.id == id))
        {
            None => Some(self.items[0].id),
            Some(n) if n + 1 < self.items.len() => Some(self.items[n + 1].id),
            _ if settings.repeat == Repeat::All => Some(self.items[0].id),
            _ => None,
        }
    }
    pub fn previous(&mut self, seconds: f64, settings: &QueueSettings) -> Result<Option<u64>> {
        crate::MediaTime(seconds).validate()?;
        if seconds >= settings.previous_restart_seconds && self.current.is_some() {
            return Ok(self.current);
        }
        if let Some(id) = self.history.pop() {
            if let Some(current) = self.current {
                self.forward.push(current);
                if self.forward.len() > MAX_HISTORY {
                    self.forward.remove(0);
                }
            }
            self.current = Some(id);
            return Ok(Some(id));
        }
        let n = self
            .current
            .and_then(|id| self.items.iter().position(|i| i.id == id));
        Ok(match n {
            Some(n) if n > 0 => Some(self.items[n - 1].id),
            Some(_) if settings.repeat == Repeat::All => self.items.last().map(|i| i.id),
            _ => self.current,
        })
    }
}
