//! Continuous-play qualification belongs to the session, not UI timers. Only
//! consumed output media frames earn credit; SQL owns the resulting user facts.
use crate::{catalog, queue::SourceReference, LibzciError, PlaybackProgress, Result};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
pub const MAX_PENDING_PLAYS: usize = 64;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PlayCountSettings {
    pub enabled: bool,
    pub threshold_seconds: u32,
}
impl Default for PlayCountSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            threshold_seconds: 15,
        }
    }
}
impl PlayCountSettings {
    pub fn validate(self) -> Result<()> {
        if !(1..=3600).contains(&self.threshold_seconds) {
            return Err(invalid("play-count threshold must be 1..3600 seconds"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlaybackContext {
    pub reference: SourceReference,
    /// Current Library identity, supplied by the profile's shared SQL query.
    /// Queue-only sources retain their reference but cannot earn count credit.
    pub library_media: Option<u64>,
}
impl PlaybackContext {
    pub fn validate(&self) -> Result<()> {
        self.reference.validate()?;
        if let Some(media) = self.library_media {
            catalog::id(media)?;
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QualifiedPlay {
    pub binding: String,
    pub sequence: u64,
    pub media: u64,
    pub source_key: String,
    pub subsong: Option<u32>,
    pub played_at_ms: u64,
}
pub(crate) fn validate_binding(binding: &str) -> Result<()> {
    if binding.len() != 32 || !binding.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(invalid("invalid play-count binding"));
    }
    Ok(())
}
impl QualifiedPlay {
    pub fn validate(&self) -> Result<()> {
        validate_binding(&self.binding)?;
        catalog::id(self.sequence)?;
        catalog::id(self.media)?;
        catalog::text(&self.source_key, 8192, false)?;
        if self.played_at_ms > catalog::MAX_ID {
            return Err(invalid("invalid play-count timestamp"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PlayCountSnapshot {
    pub settings: Option<PlayCountSettings>,
    pub credited_seconds: f64,
    pub pending: usize,
    /// A sustained persistence outage can exhaust the bounded pending queue.
    /// Keep playback responsive and report every skipped qualification visibly.
    pub overflowed: u64,
}
#[derive(Default)]
pub(crate) struct PlayCountTracker {
    binding: Option<String>,
    settings: PlayCountSettings,
    last_consumed: u64,
    rate: Option<u32>,
    credited: u64,
    counted: bool,
    anchor_next: bool,
    sequence: u64,
    acknowledged: u64,
    pending: VecDeque<QualifiedPlay>,
    overflowed: u64,
}
impl PlayCountTracker {
    pub fn bind(&mut self, binding: &str, settings: PlayCountSettings) -> Result<()> {
        validate_binding(binding)?;
        settings.validate()?;
        if self.binding.as_deref() != Some(binding) {
            if !self.pending.is_empty() {
                return Err(invalid("commit pending plays before rebinding"));
            }
            self.binding = Some(binding.into());
            self.sequence = 0;
            self.acknowledged = 0;
            self.fence();
        }
        if self.settings.enabled != settings.enabled {
            self.fence();
        }
        self.settings = settings;
        Ok(())
    }
    pub fn reset_continuity(&mut self) {
        self.credited = 0;
        self.counted = false;
    }
    pub fn fence(&mut self) {
        self.reset_continuity();
        self.anchor_next = true;
    }
    pub fn new_generation(&mut self, reset: bool) {
        self.last_consumed = 0;
        self.anchor_next = false;
        if reset {
            self.rate = None;
            self.reset_continuity();
        }
    }
    pub fn observe(
        &mut self,
        progress: PlaybackProgress,
        context: Option<&PlaybackContext>,
        subsong: Option<u32>,
        running: bool,
    ) -> Result<()> {
        if self.anchor_next {
            self.last_consumed = progress.consumed_frames;
            self.rate = Some(progress.output_rate);
            self.anchor_next = false;
            return Ok(());
        }
        let previous_rate = self.rate.replace(progress.output_rate);
        if previous_rate.is_some_and(|rate| rate != progress.output_rate)
            || progress.consumed_frames < self.last_consumed
        {
            self.last_consumed = progress.consumed_frames;
            self.reset_continuity();
            return Ok(());
        }
        let delta = progress.consumed_frames - self.last_consumed;
        self.last_consumed = progress.consumed_frames;
        let Some(context) = context.filter(|c| c.library_media.is_some()) else {
            self.reset_continuity();
            return Ok(());
        };
        if !running || !self.settings.enabled || self.binding.is_none() {
            self.reset_continuity();
            return Ok(());
        }
        let threshold = self.settings.threshold_seconds as u64 * progress.output_rate as u64;
        self.credited = self.credited.saturating_add(delta).min(threshold);
        if delta == 0 || self.counted || self.credited < threshold {
            return Ok(());
        }
        self.counted = true;
        if self.pending.len() == MAX_PENDING_PLAYS {
            self.overflowed = self.overflowed.saturating_add(1);
            return Ok(());
        }
        self.sequence = self
            .sequence
            .checked_add(1)
            .filter(|n| *n <= catalog::MAX_ID)
            .ok_or_else(|| invalid("play-count sequence exhausted"))?;
        self.pending.push_back(QualifiedPlay {
            binding: self.binding.clone().unwrap(),
            sequence: self.sequence,
            media: context.library_media.unwrap(),
            source_key: context.reference.key.clone(),
            subsong,
            played_at_ms: progress.observed_at_ms,
        });
        Ok(())
    }
    pub fn pending(&self) -> Vec<QualifiedPlay> {
        self.pending.iter().cloned().collect()
    }
    pub fn acknowledge(&mut self, binding: &str, sequence: u64) -> Result<()> {
        if self.binding.as_deref() != Some(binding) || sequence > self.sequence {
            return Err(invalid("invalid play-count acknowledgement"));
        }
        self.acknowledged = self.acknowledged.max(sequence);
        while self
            .pending
            .front()
            .is_some_and(|p| p.sequence <= self.acknowledged)
        {
            self.pending.pop_front();
        }
        Ok(())
    }
    pub fn snapshot(&self) -> PlayCountSnapshot {
        PlayCountSnapshot {
            settings: self.binding.as_ref().map(|_| self.settings),
            credited_seconds: self.credited as f64 / self.rate.unwrap_or(1) as f64,
            pending: self.pending.len(),
            overflowed: self.overflowed,
        }
    }
}
fn invalid(detail: &str) -> LibzciError {
    LibzciError::InvalidArgument {
        detail: detail.into(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn context(media: Option<u64>) -> PlaybackContext {
        PlaybackContext {
            reference: SourceReference {
                key: "same-file".into(),
                kind: crate::queue::SourceKind::Ephemeral,
                locator: "same-file".into(),
                display_path: "same.wav".into(),
            },
            library_media: media,
        }
    }
    fn progress(frames: u64, rate: u32) -> PlaybackProgress {
        PlaybackProgress {
            position_frames: 9_000_000 + frames * 2,
            consumed_frames: frames,
            output_rate: rate,
            observed_at_ms: frames * 1000 / rate as u64,
        }
    }
    fn tracker() -> PlayCountTracker {
        let mut t = PlayCountTracker::default();
        t.bind(&"a".repeat(32), PlayCountSettings::default())
            .unwrap();
        t.new_generation(true);
        t
    }
    #[test]
    fn threshold_uses_only_consumed_media_once_and_queue_only_sources_cannot_qualify() {
        let mut t = tracker();
        let c = context(Some(1));
        t.observe(progress(14 * 48000, 48000), Some(&c), None, true)
            .unwrap();
        assert!(t.pending().is_empty());
        let mut held = progress(14 * 48000, 48000);
        held.observed_at_ms = 1_000_000;
        held.position_frames = 100_000_000;
        t.observe(held, Some(&c), None, true).unwrap();
        assert!(t.pending().is_empty());
        t.observe(progress(15 * 48000, 48000), Some(&c), None, true)
            .unwrap();
        assert_eq!(t.pending().len(), 1);
        assert_eq!(t.pending()[0].played_at_ms, 15000);
        t.observe(progress(60 * 48000, 48000), Some(&c), None, true)
            .unwrap();
        assert_eq!(t.pending().len(), 1);
        let mut queue = tracker();
        queue
            .observe(
                progress(100 * 48000, 48000),
                Some(&context(None)),
                None,
                true,
            )
            .unwrap();
        assert!(queue.pending().is_empty());
        queue.fence();
        queue
            .observe(progress(101 * 48000, 48000), Some(&c), None, true)
            .unwrap();
        queue
            .observe(progress(115 * 48000, 48000), Some(&c), None, true)
            .unwrap();
        assert!(queue.pending().is_empty());
        queue
            .observe(progress(116 * 48000, 48000), Some(&c), None, true)
            .unwrap();
        assert_eq!(queue.pending().len(), 1);
    }
    #[test]
    fn pause_seek_repeat_and_subsong_boundaries_reset_credit_without_losing_earned_records() {
        let mut t = tracker();
        let c = context(Some(1));
        t.observe(progress(14 * 48000, 48000), Some(&c), Some(0), true)
            .unwrap();
        t.fence();
        t.observe(progress(20 * 48000, 48000), Some(&c), Some(0), false)
            .unwrap();
        t.observe(progress(34 * 48000, 48000), Some(&c), Some(0), true)
            .unwrap();
        assert!(t.pending().is_empty());
        t.observe(progress(35 * 48000, 48000), Some(&c), Some(0), true)
            .unwrap();
        assert_eq!(t.pending()[0].subsong, Some(0));
        for subsong in [Some(0), Some(1), None] {
            t.new_generation(true);
            t.observe(progress(14 * 44100, 44100), Some(&c), subsong, true)
                .unwrap();
            let before = t.pending().len();
            t.observe(progress(15 * 44100, 44100), Some(&c), subsong, true)
                .unwrap();
            assert_eq!(t.pending().len(), before + 1);
        }
        assert_eq!(
            t.pending().iter().map(|p| p.sequence).collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
    }
    #[test]
    fn parameter_generations_preserve_credit_but_output_rate_changes_and_disablement_do_not() {
        let mut t = tracker();
        let c = context(Some(1));
        t.observe(progress(14 * 48000, 48000), Some(&c), None, true)
            .unwrap();
        t.new_generation(false);
        t.observe(progress(48000, 48000), Some(&c), None, true)
            .unwrap();
        assert_eq!(t.pending().len(), 1);
        t.new_generation(true);
        t.observe(progress(14 * 48000, 48000), Some(&c), None, true)
            .unwrap();
        t.new_generation(false);
        t.observe(progress(44100, 44100), Some(&c), None, true)
            .unwrap();
        assert_eq!(t.pending().len(), 1);
        t.observe(progress(16 * 44100, 44100), Some(&c), None, true)
            .unwrap();
        assert_eq!(t.pending().len(), 2);
        t.bind(
            &"a".repeat(32),
            PlayCountSettings {
                enabled: false,
                ..Default::default()
            },
        )
        .unwrap();
        t.observe(progress(30 * 44100, 44100), Some(&c), None, true)
            .unwrap();
        t.observe(progress(60 * 44100, 44100), Some(&c), None, true)
            .unwrap();
        assert_eq!(t.pending().len(), 2);
        assert!(t
            .bind(&"b".repeat(32), PlayCountSettings::default())
            .is_err());
    }
    #[test]
    fn bounded_backlog_reports_overflow_and_acknowledgements_cannot_lose_uncommitted_records() {
        let mut t = tracker();
        let c = context(Some(1));
        for _ in 0..=MAX_PENDING_PLAYS {
            t.new_generation(true);
            t.observe(progress(15 * 48000, 48000), Some(&c), None, true)
                .unwrap();
        }
        assert_eq!(t.pending().len(), MAX_PENDING_PLAYS);
        assert_eq!(t.snapshot().overflowed, 1);
        assert!(t.acknowledge(&"b".repeat(32), 1).is_err());
        assert!(t.acknowledge(&"a".repeat(32), 65).is_err());
        assert_eq!(t.pending().len(), 64);
        t.acknowledge(&"a".repeat(32), 1).unwrap();
        t.new_generation(true);
        t.observe(progress(15 * 48000, 48000), Some(&c), None, true)
            .unwrap();
        assert_eq!(t.pending().last().unwrap().sequence, 65);
        t.acknowledge(&"a".repeat(32), 65).unwrap();
        t.acknowledge(&"a".repeat(32), 65).unwrap();
        assert!(t.pending().is_empty());
        assert!(PlayCountSettings {
            threshold_seconds: 0,
            ..Default::default()
        }
        .validate()
        .is_err());
        assert!(PlayCountSettings {
            threshold_seconds: 3601,
            ..Default::default()
        }
        .validate()
        .is_err());
    }
}
