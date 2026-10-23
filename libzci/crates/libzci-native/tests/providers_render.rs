//! Native provider integration over the same incremental rendering API.
use libzci::*;
use libzci_codecs::OpusFactory;
use libzci_native::{render::*, NativeFileSource, NativeRuntime};
use std::{path::PathBuf, sync::Arc};
fn path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.local/libzci/media/r3")
        .join(name)
}
#[test]
fn opus_streams_exact_long_timeline_start_tails_and_converted_output() {
    for (start, rate) in [
        (0.0, 48_000),
        (15.5, 48_000),
        (30.000125, 48_000),
        (0.0, 44_100),
    ] {
        let rt = NativeRuntime::new();
        rt.register_provider(Arc::new(OpusFactory::default()))
            .unwrap();
        let source = rt.insert_source(Arc::new(
            NativeFileSource::open(&path("long.opus")).unwrap(),
        ));
        let mut job = rt
            .start_render(
                source,
                Some("opus"),
                RenderOptions {
                    load: LoadOptions {
                        start_time: MediaTime(start),
                        subsong: None,
                    },
                    output_rate: rate,
                    processing: ProcessingMode::Raw,
                },
                &CancelFlag::default(),
            )
            .unwrap();
        let mut frames = 0;
        let mut max = 0;
        loop {
            match job.next_step().unwrap() {
                RenderStep::Data { block, samples } => {
                    assert!(samples.len() <= 8192);
                    assert!(samples.iter().all(|v| v.is_finite()));
                    frames += block.valid_frames as u64;
                    max = max.max(job.progress().retained_bytes);
                }
                RenderStep::Pending => (),
                RenderStep::Complete(result) => {
                    assert_eq!(result.output_frames, frames);
                    break;
                }
            }
        }
        assert_eq!(
            frames,
            ((1_440_006 - MediaTime(start).frames(48_000).unwrap()) * rate as u64).div_ceil(48_000)
        );
        assert!(max < 1_000_000);
        eprintln!(
            "start={start}s rate={rate}: {frames} frames, preparation+decode bound {max} bytes"
        );
    }
}
