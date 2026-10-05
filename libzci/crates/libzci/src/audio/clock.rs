//! Audible output clock: media position from consumed frames.
//!
//! The core computes media position from the output's consumed-frame
//! count plus the loaded timeline — never from wall-clock or UI
//! timers, which must not claim progress while output is suspended.
//! Requested play state and actually-running output are distinct
//! observations; diagnostics expose both.

/// Requested transport state (what the session asked for).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RequestedState {
    /// Output held (paused/ready/stopped).
    Held,
    /// Output requested (playing).
    Running,
}

/// Actually-running output state (what the device reports).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RunningState {
    /// No stream (never opened, released, or failed).
    Closed,
    /// Stream open, consuming frames.
    Running,
    /// Stream open but suspended (device sleep, interruption).
    Suspended,
    /// Stream failed (see the typed error at the owner).
    Failed,
}

/// Frame-counted output clock at one device rate.
#[derive(Clone, Copy, Debug)]
pub struct OutputClock {
    /// Device sample rate in Hz.
    pub rate_hz: u32,
    /// Frames consumed by the device since stream start.
    pub consumed_frames: u64,
    /// Estimated output latency in frames (buffer + device).
    pub latency_frames: u64,
    /// What was requested last.
    pub requested: RequestedState,
    /// What the device reports.
    pub running: RunningState,
    /// Cumulative device underruns (ring ran dry).
    pub underruns: u64,
}

impl OutputClock {
    /// Create at a device rate with no consumption yet.
    pub fn new(rate_hz: u32) -> Self {
        Self {
            rate_hz: rate_hz.max(1),
            consumed_frames: 0,
            latency_frames: 0,
            requested: RequestedState::Held,
            running: RunningState::Closed,
            underruns: 0,
        }
    }

    /// Record `frames` consumed by one device callback.
    pub fn advance(&mut self, frames: u64) {
        self.consumed_frames = self.consumed_frames.saturating_add(frames);
    }

    /// Audible media time in seconds (consumed frames at device rate,
    /// minus latency while running).
    pub fn media_time_secs(&self) -> f64 {
        let audible = self.consumed_frames.saturating_sub(match self.running {
            RunningState::Running => self.latency_frames,
            _ => 0,
        });
        audible as f64 / self.rate_hz as f64
    }

    /// Convert consumed device frames to provider-timeline frames at
    /// `source_rate_hz` (for position reports before resamplingPolicy
    /// refinements land with gapless preparation).
    pub fn to_source_frames(&self, consumed: u64, source_rate_hz: u32) -> u64 {
        (consumed as f64 * source_rate_hz as f64 / self.rate_hz as f64).round() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_distinguishes_requested_from_running() {
        let mut clock = OutputClock::new(48_000);
        clock.requested = RequestedState::Running;
        assert_eq!(clock.running, RunningState::Closed);
        clock.running = RunningState::Running;
        clock.latency_frames = 480;
        clock.advance(48_480);
        assert!((clock.media_time_secs() - 1.0).abs() < 1e-9);
        // Suspended output stops claiming latency-adjusted progress.
        clock.running = RunningState::Suspended;
        assert!((clock.media_time_secs() - 1.01).abs() < 1e-9);
    }
}
