//! Native CPAL mechanism: negotiate PCM formats and convert explicitly. No codec,
//! control locks, allocation, or logging on the device callback.
use crate::pcm_transport::{pcm_transport, OutputMonitor, PcmConsumer, PcmProducer, BLOCK_FRAMES};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use libzci::{Generation, LibzciError, Result};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
#[derive(Clone, Debug, Default)]
pub struct OutputSpec {
    pub device_name: Option<String>,
    pub rate_hz: Option<u32>,
}
#[derive(Debug, Default)]
pub struct OutputStats {
    pub consumed_frames: AtomicU64,
    pub filled_pops: AtomicU64,
    pub hungry_pops: AtomicU64,
    pub failed: AtomicBool,
    pub latency_frames: AtomicU64,
}
pub struct DeviceOutput {
    _stream: cpal::Stream,
    pub producer: Option<PcmProducer>,
    pub transport: Arc<OutputMonitor>,
    pub stats: Arc<OutputStats>,
    pub rate_hz: u32,
    pub latency_frames: u64,
    pub device_label: String,
}
impl DeviceOutput {
    pub fn rate_hz(&self) -> u32 {
        self.rate_hz
    }
    pub fn consumed_frames(&self) -> u64 {
        self.stats.consumed_frames.load(Ordering::Relaxed)
    }
    pub fn hungry_pops(&self) -> u64 {
        self.stats.hungry_pops.load(Ordering::Relaxed)
    }
}
fn device_name(device: &cpal::Device) -> String {
    device
        .description()
        .map(|d| d.name().to_owned())
        .unwrap_or_else(|_| "<unknown>".into())
}
pub fn list_devices() -> Vec<String> {
    cpal::default_host()
        .output_devices()
        .map(|ds| ds.map(|d| device_name(&d)).collect())
        .unwrap_or_default()
}
fn usable(format: cpal::SampleFormat) -> bool {
    use cpal::SampleFormat::*;
    matches!(
        format,
        F32 | F64 | I8 | I16 | I24 | I32 | I64 | U8 | U16 | U24 | U32 | U64
    )
}
fn device_error(detail: impl ToString) -> LibzciError {
    LibzciError::DeviceUnavailable {
        detail: detail.to_string(),
    }
}
pub fn open_output(spec: &OutputSpec, seconds: f32) -> Result<DeviceOutput> {
    if spec.rate_hz.is_some_and(|r| !(8000..=192000).contains(&r))
        || !seconds.is_finite()
        || !(0.01..=2.0).contains(&seconds)
    {
        return Err(LibzciError::InvalidArgument {
            detail: "invalid output rate or queue duration".into(),
        });
    }
    let host = cpal::default_host();
    let device = match &spec.device_name {
        Some(want) => host
            .output_devices()
            .map_err(device_error)?
            .find(|d| device_name(d).contains(want))
            .ok_or_else(|| device_error(format!("output device not found: {want}")))?,
        None => host
            .default_output_device()
            .ok_or_else(|| device_error("no default output device"))?,
    };
    let label = device_name(&device);
    let default = device.default_output_config().map_err(device_error)?;
    let desired_rate = spec.rate_hz.unwrap_or(default.sample_rate());
    let supported = if spec.rate_hz.is_none()
        && usable(default.sample_format())
        && (1..=32).contains(&default.channels())
    {
        default
    } else {
        let mut ranges: Vec<_> = device
            .supported_output_configs()
            .map_err(device_error)?
            .filter(|r| usable(r.sample_format()) && (1..=32).contains(&r.channels()))
            .collect();
        ranges.sort_by_key(|r| {
            (
                r.channels() != 2,
                r.sample_format() != cpal::SampleFormat::F32,
                r.channels(),
            )
        });
        let range = ranges
            .iter()
            .find(|r| r.min_sample_rate() <= desired_rate && desired_rate <= r.max_sample_rate())
            .or_else(|| {
                if spec.rate_hz.is_none() {
                    ranges.first()
                } else {
                    None
                }
            })
            .ok_or_else(|| device_error("no supported PCM configuration for requested rate"))?;
        range.with_sample_rate(desired_rate.clamp(range.min_sample_rate(), range.max_sample_rate()))
    };
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let rate = config.sample_rate;
    let capacity = (rate as f32 * seconds).ceil() as usize;
    let (producer, consumer, transport) = pcm_transport(
        capacity.max(512).div_ceil(BLOCK_FRAMES),
        Generation::INITIAL,
    );
    transport.set_held(true);
    let stats = Arc::new(OutputStats::default());
    let latency = (rate as u64 / 40).max(256);
    stats.latency_frames.store(latency, Ordering::Relaxed);
    macro_rules! stream {
        ($t:ty) => {
            make_stream::<$t>(&device, config.clone(), consumer, stats.clone(), latency)
        };
    }
    use cpal::SampleFormat::*;
    let stream = match format {
        F32 => stream!(f32),
        F64 => stream!(f64),
        I8 => stream!(i8),
        I16 => stream!(i16),
        I24 => stream!(cpal::I24),
        I32 => stream!(i32),
        I64 => stream!(i64),
        U8 => stream!(u8),
        U16 => stream!(u16),
        U24 => stream!(cpal::U24),
        U32 => stream!(u32),
        U64 => stream!(u64),
        _ => return Err(device_error("unsupported non-PCM sample format")),
    }
    .map_err(device_error)?;
    stream.play().map_err(device_error)?;
    Ok(DeviceOutput {
        _stream: stream,
        producer: Some(producer),
        transport,
        stats,
        rate_hz: rate,
        latency_frames: latency,
        device_label: format!("{label} ({format:?}, {}ch)", config.channels),
    })
}
fn make_stream<T: cpal::SizedSample + cpal::FromSample<f32>>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    mut consumer: PcmConsumer,
    stats: Arc<OutputStats>,
    _fallback_latency: u64,
) -> std::result::Result<cpal::Stream, cpal::Error> {
    let channels = config.channels as usize;
    let rate = config.sample_rate;
    let errors = stats.clone();
    device.build_output_stream(
        config,
        move |out: &mut [T], info| {
            let stamp = info.timestamp();
            let latency = (stamp.playback.duration_since(stamp.callback).as_secs_f64()
                * rate as f64)
                .ceil() as u64;
            stats.latency_frames.store(latency, Ordering::Relaxed);
            let mut scratch = [0.0f32; 512];
            let mut offset = 0usize;
            let mut valid = 0;
            for chunk in out.chunks_mut(256 * channels) {
                let count = chunk.len() / channels;
                // Timestamp is for the first sample of this callback, not each chunk.
                valid += consumer.render_with_latency(
                    &mut scratch[..count * 2],
                    latency + offset as u64 + count as u64,
                );
                map_samples(&scratch[..count * 2], chunk, channels);
                offset += count;
            }
            if valid < out.len() / channels {
                stats.hungry_pops.fetch_add(1, Ordering::Relaxed);
            } else {
                stats.filled_pops.fetch_add(1, Ordering::Relaxed);
            }
            stats
                .consumed_frames
                .fetch_add((out.len() / channels) as u64, Ordering::Relaxed);
        },
        move |_| {
            errors.failed.store(true, Ordering::Release);
        },
        None,
    )
}
fn map_samples<T: cpal::SizedSample + cpal::FromSample<f32>>(
    input: &[f32],
    output: &mut [T],
    channels: usize,
) {
    for (stereo, frame) in input.chunks_exact(2).zip(output.chunks_exact_mut(channels)) {
        for (channel, sample) in frame.iter_mut().enumerate() {
            let value = if channels == 1 {
                (stereo[0] + stereo[1]) * 0.5
            } else {
                match channel {
                    0 => stereo[0],
                    1 => stereo[1],
                    _ => 0.0,
                }
            };
            *sample = T::from_sample(value.clamp(-1.0, 1.0));
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn converts_integer_unsigned_mono_and_surround() {
        let mut mono = [0i16; 2];
        map_samples(&[0.5, 0.5, -0.5, -0.5], &mut mono, 1);
        assert_eq!(mono, [16384, -16384]);
        let mut surround = [0u16; 6];
        map_samples(&[0.5, -0.5], &mut surround, 6);
        assert_eq!(surround, [49152, 16384, 32768, 32768, 32768, 32768]);
    }
    #[test]
    #[ignore = "requires authorized device access"]
    fn device_outcome_is_typed() {
        let output =
            open_output(&OutputSpec::default(), 0.25).expect("real output device required");
        eprintln!("{} @ {} Hz", output.device_label, output.rate_hz());
    }
}
