//! Device-free public render API checks. Test-owned Vec sinks are deliberate.
use libzci::{provider::FakeFactory, *};
use libzci_native::{render::*, NativeRuntime};
use std::sync::Arc;
fn render(total: u64, rate: u32, mode: ProcessingMode) -> (Vec<f32>, RenderProgress) {
    let rt = NativeRuntime::new();
    rt.register_provider(Arc::new(FakeFactory::new(total, PcmLayout::mono48k())))
        .unwrap();
    let source = rt.insert_source(Arc::new(MemSource::new(b"FAKE".to_vec())));
    let mut job = rt
        .start_render(
            source,
            None,
            RenderOptions {
                output_rate: rate,
                processing: mode,
                ..Default::default()
            },
            &CancelFlag::default(),
        )
        .unwrap();
    let mut out = Vec::new();
    loop {
        match job.next().unwrap() {
            RenderStep::Data { samples, .. } => out.extend(samples),
            RenderStep::Pending => (),
            RenderStep::Complete(r) => {
                assert_eq!(r.output_frames as usize, out.len() / 2);
                return (out, job.progress());
            }
        }
    }
}
#[test]
fn render_counts_mapping_conversion_and_fixed_memory() {
    for rate in [48_000, 44_100, 96_000] {
        let (short, a) = render(10_003, rate, ProcessingMode::Raw);
        let (long, b) = render(100_003, rate, ProcessingMode::Raw);
        assert_eq!(
            short.len() / 2,
            (10_003u64 * rate as u64).div_ceil(48_000) as usize
        );
        assert_eq!(
            long.len() / 2,
            (100_003u64 * rate as u64).div_ceil(48_000) as usize
        );
        assert_eq!(a.retained_bytes, b.retained_bytes);
        assert!(long.iter().all(|s| s.is_finite()));
        assert!(long.chunks_exact(2).all(|p| p[0] == p[1]));
    }
}
#[test]
fn explicit_raw_master_and_mute() {
    let (raw, _) = render(8000, 48_000, ProcessingMode::Raw);
    let (half, _) = render(
        8000,
        48_000,
        ProcessingMode::Master {
            volume: 0.5,
            mute: false,
        },
    );
    assert_eq!(half, raw.iter().map(|v| v * 0.5).collect::<Vec<_>>());
    let (mute, _) = render(
        8000,
        48_000,
        ProcessingMode::Master {
            volume: 0.5,
            mute: true,
        },
    );
    assert!(mute.iter().all(|v| *v == 0.0));
}
#[test]
fn cancellation_is_connected_to_streaming_job_and_releases_runtime() {
    let rt = NativeRuntime::new();
    let weak = Arc::downgrade(&rt);
    rt.register_provider(Arc::new(FakeFactory::new(u64::MAX, PcmLayout::mono48k())))
        .unwrap();
    let source = rt.insert_source(Arc::new(MemSource::new(b"FAKE".to_vec())));
    let cancel = CancelFlag::default();
    let mut job = rt
        .start_render(source, None, RenderOptions::default(), &cancel)
        .unwrap();
    assert!(matches!(job.next().unwrap(), RenderStep::Data { .. }));
    cancel.cancel();
    assert!(matches!(job.next(), Err(LibzciError::Cancelled)));
    drop(rt);
    drop(job);
    assert!(weak.upgrade().is_none());
}
