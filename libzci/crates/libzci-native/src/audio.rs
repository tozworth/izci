//! Native audio output over CPAL.
//!
//! Adapter-owned execution mechanism: opens default/selected output
//! devices, feeds them from a preallocated lock-free ring, and reports
//! the consumed-frame clock, latency estimates, and underruns. The
//! device callback pops the ring and renders silence on underrun —
//! no SQL, file I/O, decode, allocation, or control locks inside.
//!
//! Requested play state and actually-running output stay distinct:
//! opening can fail with typed [`LibzciError::DeviceUnavailable`]
//! (no device, unknown name, unsupported format), which callers
//! surface instead of claiming playback.

use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use libzci::{LibzciError, PcmRing, Result};

/// Output device selection.
#[derive(Clone, Debug, Default)]
pub struct OutputSpec {
    /// Device name substring, or `None` for the default device.
    pub device_name: Option<String>,
    /// Preferred sample rate, or `None` for the device default.
    /// The engine resamples to whatever rate is negotiated.
    pub rate_hz: Option<u32>,
}

/// Live counters shared with the device callback (all atomic).
#[derive(Debug, Default)]
pub struct OutputStats {
    /// Device frames consumed since stream start.
    pub consumed_frames: AtomicU64,
    /// Callback pops that found data (informational).
    pub filled_pops: AtomicU64,
    /// Callback pops that found the ring empty (silence rendered).
    pub hungry_pops: AtomicU64,
}

/// One open native output: stream, ring feed, and clock facts.
pub struct DeviceOutput {
    /// Feed decoded/processed stereo frames here (device rate).
    pub ring: Arc<PcmRing>,
    /// Live callback counters.
    pub stats: Arc<OutputStats>,
    /// Negotiated device rate in Hz.
    pub rate_hz: u32,
    /// Estimated output latency in device frames (buffer + device).
    pub latency_frames: u64,
    /// Device description for diagnostics.
    pub device_label: String,
    _stream: cpal::Stream,
}

impl DeviceOutput {
    /// Negotiated rate.
    pub fn rate_hz(&self) -> u32 {
        self.rate_hz
    }

    /// Consumed frames so far (audible clock source).
    pub fn consumed_frames(&self) -> u64 {
        self.stats.consumed_frames.load(Ordering::Relaxed)
    }

    /// Rendered-silence pops so far.
    pub fn hungry_pops(&self) -> u64 {
        self.stats.hungry_pops.load(Ordering::Relaxed)
    }

    /// Pause the device stream (consumption halts; buffered audio kept).
    pub fn pause_stream(&self) -> Result<()> {
        self._stream.pause().map_err(|e| LibzciError::DeviceUnavailable {
            detail: format!("cannot pause output stream: {e}"),
        })
    }

    /// Resume a paused device stream.
    pub fn resume_stream(&self) -> Result<()> {
        self._stream.play().map_err(|e| LibzciError::DeviceUnavailable {
            detail: format!("cannot resume output stream: {e}"),
        })
    }
}

/// List output device names (empty when the host has none).
pub fn list_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.output_devices()
        .map(|devices| {
            devices
                .filter_map(|d| d.description().ok().map(|desc| desc.name().to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn device_name(device: &cpal::Device) -> String {
    use cpal::traits::DeviceTrait;
    device
        .description()
        .map(|desc| desc.name().to_string())
        .unwrap_or_else(|_| "<unknown>".into())
}

/// Open the selected output with an F32 stereo stream.
///
/// Ring capacity is preallocated for ~2 s at the negotiated rate.
/// Format negotiation is explicit: F32 stereo is required, and anything
/// else is a typed failure (no silent fallback chain that could hide
/// a broken device).
pub fn open_output(spec: &OutputSpec, ring_seconds: f32) -> Result<DeviceOutput> {
    let host = cpal::default_host();
    let device = match &spec.device_name {
        Some(want) => host
            .output_devices()
            .map_err(|e| LibzciError::DeviceUnavailable {
                detail: format!("cannot enumerate output devices: {e}"),
            })?
            .find(|d| device_name(d).contains(want.as_str()))
            .ok_or_else(|| LibzciError::DeviceUnavailable {
                detail: format!("output device not found: {want}"),
            })?,
        None => host.default_output_device().ok_or_else(|| LibzciError::DeviceUnavailable {
            detail: "no default output device".into(),
        })?,
    };
    let device_label = device_name(&device);
    let supported = device.default_output_config().map_err(|e| LibzciError::DeviceUnavailable {
        detail: format!("device {device_label} has no default output config: {e}"),
    })?;
    if supported.sample_format() != cpal::SampleFormat::F32 || supported.channels() != 2 {
        return Err(LibzciError::DeviceUnavailable {
            detail: format!(
                "device {device_label} default is {:?}/{}ch (this build requires F32 stereo)",
                supported.sample_format(),
                supported.channels()
            ),
        });
    }
    let mut config: cpal::StreamConfig = supported.into();
    if let Some(rate) = spec.rate_hz {
        if !(8000..=192000).contains(&rate) {
            return Err(LibzciError::InvalidArgument {
                detail: format!("output rate {rate} out of range"),
            });
        }
        config.sample_rate = rate;
    }
    let rate_hz = config.sample_rate;
    let capacity_frames = ((rate_hz as f32 * ring_seconds).max(512.0) as usize).max(2);
    let ring = Arc::new(PcmRing::new(capacity_frames));
    let stats = Arc::new(OutputStats::default());
    // Rough latency: two device buffers plus a small device term.
    let latency_frames = match config.buffer_size.clone() {
        cpal::BufferSize::Fixed(n) => n as u64 * 2,
        cpal::BufferSize::Default => (rate_hz as u64 / 50).max(256),
    } + rate_hz as u64 / 200;
    let feed_ring = Arc::clone(&ring);
    let feed_stats = Arc::clone(&stats);
    let channels = config.channels as usize;
    let stream = device
        .build_output_stream(
            config,
            move |out: &mut [f32], _| {
                // Device callback: pop, render silence on underrun,
                // count everything. No locks, no allocation.
                let got = feed_ring.pop(out);
                if got < out.len() {
                    out[got..].fill(0.0);
                    feed_stats.hungry_pops.fetch_add(1, Ordering::Relaxed);
                } else {
                    feed_stats.filled_pops.fetch_add(1, Ordering::Relaxed);
                }
                feed_stats
                    .consumed_frames
                    .fetch_add(out.len() as u64 / channels.max(1) as u64, Ordering::Relaxed);
            },
            |err| {
                // Device errors are reported, not hidden; the owner
                // observes them via hungry pops and stream state.
                eprintln!("libzci output stream error: {err}");
            },
            None,
        )
        .map_err(|e| LibzciError::DeviceUnavailable {
            detail: format!("cannot open output stream on {device_label}: {e}"),
        })?;
    stream.play().map_err(|e| LibzciError::DeviceUnavailable {
        detail: format!("cannot start output stream on {device_label}: {e}"),
    })?;
    Ok(DeviceOutput {
        ring,
        stats,
        rate_hz,
        latency_frames,
        device_label,
        _stream: stream,
    })
    // Note: dropping DeviceOutput drops the stream, which stops and
    // releases the device (defined shutdown outcome).
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_outcome_is_typed() {
        // Either a device opens (real output path) or the failure is a
        // typed DeviceUnavailable — never a panic or silent success.
        match open_output(&OutputSpec::default(), 0.25) {
            Ok(output) => {
                assert!(output.rate_hz() >= 8000);
                assert!(output.ring.capacity_frames() >= 512);
                eprintln!(
                    "output device available: {} @ {} Hz (latency {} frames)",
                    output.device_label, output.rate_hz, output.latency_frames
                );
            }
            Err(LibzciError::DeviceUnavailable { detail }) => {
                eprintln!("no output device in this environment: {detail}");
            }
            Err(other) => panic!("expected DeviceUnavailable, got {}", other.kind()),
        }
        // Unknown names fail the same typed way.
        match open_output(
            &OutputSpec { device_name: Some("no-such-libzci-device-xyz".into()), rate_hz: None },
            0.25,
        ) {
            Err(LibzciError::DeviceUnavailable { .. }) => {}
            Err(e) => panic!("expected DeviceUnavailable, got {}", e.kind()),
            Ok(_) => panic!("expected DeviceUnavailable, opened successfully"),
        }
    }
}
