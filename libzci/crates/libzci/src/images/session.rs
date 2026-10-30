//! Session-only captured image navigation. It has no playback commands, queue
//! state or clock; presentation jobs are fenced independently of music.
use super::{invalid, ImageFacts};
use crate::{catalog, LibzciError, Result, SessionId};
use serde::{Deserialize, Serialize};
pub const MAX_IMAGE_SEQUENCE: usize = 100000;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageSequence {
    pub revision: u64,
    pub media: Vec<u64>,
}
impl ImageSequence {
    pub fn validate(&self) -> Result<()> {
        if self.revision > catalog::MAX_ID
            || self.media.is_empty()
            || self.media.len() > MAX_IMAGE_SEQUENCE
        {
            return Err(invalid("invalid image navigation sequence size/revision"));
        }
        let mut unique = std::collections::HashSet::with_capacity(self.media.len());
        for &media in &self.media {
            catalog::id(media)?;
            if !unique.insert(media) {
                return Err(invalid("duplicate image navigation identity"));
            }
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ImageNavigation {
    Refresh,
    Previous,
    Next,
    First,
    Last,
    Select { media: u64 },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ImageViewSnapshot {
    pub session: u64,
    pub generation: u64,
    pub origin_revision: Option<u64>,
    pub media: Option<u64>,
    pub index: Option<usize>,
    pub count: usize,
    pub facts: Option<ImageFacts>,
}
pub struct ImageSession {
    id: SessionId,
    generation: u64,
    sequence: Option<ImageSequence>,
    index: Option<usize>,
    facts: Option<ImageFacts>,
}
impl Default for ImageSession {
    fn default() -> Self {
        Self {
            id: SessionId::fresh(),
            generation: 0,
            sequence: None,
            index: None,
            facts: None,
        }
    }
}
impl ImageSession {
    fn bump(&mut self) -> Result<()> {
        self.generation = self
            .generation
            .checked_add(1)
            .filter(|g| *g <= catalog::MAX_ID)
            .ok_or_else(|| LibzciError::ResourceExhausted {
                detail: "image session generation exhausted".into(),
            })?;
        self.facts = None;
        Ok(())
    }
    pub fn open(&mut self, sequence: ImageSequence, media: u64) -> Result<ImageViewSnapshot> {
        sequence.validate()?;
        let index = sequence
            .media
            .iter()
            .position(|m| *m == media)
            .ok_or_else(|| invalid("selected image is outside its captured sequence"))?;
        self.bump()?;
        self.sequence = Some(sequence);
        self.index = Some(index);
        Ok(self.snapshot())
    }
    pub fn navigate(&mut self, command: ImageNavigation, wrap: bool) -> Result<ImageViewSnapshot> {
        let (Some(sequence), Some(index)) = (&self.sequence, self.index) else {
            return Err(invalid("image session is closed"));
        };
        let next = match command {
            ImageNavigation::Refresh => index,
            ImageNavigation::Previous => {
                if index == 0 {
                    if wrap {
                        sequence.media.len() - 1
                    } else {
                        0
                    }
                } else {
                    index - 1
                }
            }
            ImageNavigation::Next => {
                if index + 1 == sequence.media.len() {
                    if wrap {
                        0
                    } else {
                        index
                    }
                } else {
                    index + 1
                }
            }
            ImageNavigation::First => 0,
            ImageNavigation::Last => sequence.media.len() - 1,
            ImageNavigation::Select { media } => sequence
                .media
                .iter()
                .position(|m| *m == media)
                .ok_or_else(|| invalid("image is outside the captured sequence"))?,
        };
        if next != index || matches!(command, ImageNavigation::Refresh) {
            self.bump()?;
            self.index = Some(next);
        }
        Ok(self.snapshot())
    }
    pub fn complete(
        &mut self,
        session: u64,
        generation: u64,
        media: u64,
        facts: ImageFacts,
    ) -> Result<bool> {
        if session != self.id.0 || generation != self.generation || self.selected() != Some(media) {
            return Ok(false);
        }
        facts.validate()?;
        self.facts = Some(facts);
        Ok(true)
    }
    pub fn close(&mut self) -> Result<ImageViewSnapshot> {
        if self.sequence.is_some() {
            self.bump()?;
            self.sequence = None;
            self.index = None;
        }
        Ok(self.snapshot())
    }
    fn selected(&self) -> Option<u64> {
        self.sequence
            .as_ref()
            .zip(self.index)
            .map(|(s, i)| s.media[i])
    }
    pub fn snapshot(&self) -> ImageViewSnapshot {
        ImageViewSnapshot {
            session: self.id.0,
            generation: self.generation,
            origin_revision: self.sequence.as_ref().map(|s| s.revision),
            media: self.selected(),
            index: self.index,
            count: self.sequence.as_ref().map_or(0, |s| s.media.len()),
            facts: self.facts.clone(),
        }
    }
}
