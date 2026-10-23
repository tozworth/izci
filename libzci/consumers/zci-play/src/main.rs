//! `zci-play`: aplay-style native CLI over libzci.
//!
//! Opens one media source, plays it through the shared
//! decode/process/resample/feed pipeline, and terminates cleanly on
//! EOF or interruption. Transient by default: no database, no profile
//! (`--profile` arrives with storage in Phase 3.2; the ordinary
//! player's profile is never touched).
//!
//! Argument parsing only converts CLI inputs to core commands —
//! selection, transport, and DSP policy live in libzci. Diagnostics go
//! to stderr; nothing is printed to stdout.
//!
//! Exit status: 0 on EOF success, 2 on usage/media errors, 130 on
//! Ctrl-C interruption.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use libzci::{CancelFlag, Command, LibzciError, LoadOptions, MediaTime, RequestId, TransportState};
use libzci_codecs::OpusFactory;
use libzci_native::render::{ProcessingMode, RenderOptions, RenderStep};
use libzci_native::{NativeFileSource, NativeRuntime, OutputSpec};

/// Parsed CLI inputs (units documented in `usage`).
struct Args {
    profile: Option<PathBuf>,
    volume_explicit: bool,
    /// Media path to play.
    path: PathBuf,
    /// Output device name substring (default device when absent).
    device: Option<String>,
    /// Master volume, linear 0.0..=1.0 (default 1.0).
    volume: f32,
    /// Start position in seconds (default 0.0).
    start_secs: f64,
    /// Subsong index for module content (none by default).
    subsong: Option<u32>,
    /// Verbose stderr diagnostics.
    diagnostics: bool,
    /// Render stereo float PCM to this file instead of playing.
    render_pcm: Option<PathBuf>,
}

fn usage() -> String {
    [
        "usage: zci-play [options] <path>",
        "",
        "Play one media file through the libzci engine (transient, no profile).",
        "",
        "options:",
        "  --device NAME     output device name substring (default: system default)",
        "  --profile DIR     durable libzci queue/settings in DIR (default: transient)",
        "  --volume V        master volume, linear 0.0..=1.0 (default 1.0)",
        "  --start SECONDS   start position in seconds, >= 0.0 (default 0.0)",
        "  --subsong N       module subsong index (requires a build with modules)",
        "  --diagnostics     verbose stderr diagnostics (provider, device, clock)",
        "  --render-pcm FILE render stereo float32 LE PCM at 48000 Hz to FILE, no device",
        "  --help            this text",
        "",
        "exit status: 0 EOF success · 2 usage/media/device failure · 130 interrupted (Ctrl-C)",
    ]
    .join("\n")
}

#[derive(Debug)]
struct UsageError(String);

fn parse_args(argv: &[String]) -> Result<Args, UsageError> {
    let mut args = Args {
        profile: None,
        volume_explicit: false,
        path: PathBuf::new(),
        device: None,
        volume: 1.0,
        start_secs: 0.0,
        subsong: None,
        diagnostics: false,
        render_pcm: None,
    };
    let mut positional: Option<PathBuf> = None;
    let mut i = 1;
    while i < argv.len() {
        let arg = argv[i].as_str();
        let value_of = |i: &mut usize| -> Result<String, UsageError> {
            *i += 1;
            argv.get(*i)
                .cloned()
                .ok_or_else(|| UsageError(format!("{arg} needs a value")))
        };
        match arg {
            "--help" => return Err(UsageError("help".into())),
            "--device" => args.device = Some(value_of(&mut i)?),
            "--profile" => args.profile = Some(PathBuf::from(value_of(&mut i)?)),
            "--volume" => {
                args.volume_explicit = true;
                args.volume = value_of(&mut i)?
                    .parse::<f32>()
                    .map_err(|_| UsageError("--volume needs a number 0.0..=1.0".into()))?;
                if !(0.0..=1.0).contains(&args.volume) || !args.volume.is_finite() {
                    return Err(UsageError("--volume out of range 0.0..=1.0".into()));
                }
            }
            "--start" => {
                args.start_secs = value_of(&mut i)?
                    .parse::<f64>()
                    .map_err(|_| UsageError("--start needs seconds >= 0.0".into()))?;
                if !(0.0..).contains(&args.start_secs) || !args.start_secs.is_finite() {
                    return Err(UsageError("--start out of range".into()));
                }
            }
            "--subsong" => {
                args.subsong = Some(
                    value_of(&mut i)?
                        .parse::<u32>()
                        .map_err(|_| UsageError("--subsong needs an integer index".into()))?,
                );
            }
            "--diagnostics" => args.diagnostics = true,
            "--render-pcm" => args.render_pcm = Some(PathBuf::from(value_of(&mut i)?)),
            other if other.starts_with("--") => {
                return Err(UsageError(format!("unknown flag {other}")))
            }
            positional_arg => {
                if positional.is_some() {
                    return Err(UsageError("only one <path> is accepted".into()));
                }
                positional = Some(PathBuf::from(positional_arg));
            }
        }
        i += 1;
    }
    args.path = positional.ok_or_else(|| UsageError("missing <path>".into()))?;
    Ok(args)
}

/// Actionable one-line failure for stderr (plus exit 2).
fn report(error: &LibzciError, path: &Path) -> ! {
    let hint = match error {
        LibzciError::AccessRequired { .. } => "grant file access and retry",
        LibzciError::Unavailable { .. } => "check the path still exists",
        LibzciError::Unsupported { .. } => {
            "unsupported or unrecognized media for the registered providers"
        }
        LibzciError::Corrupt { .. } => "the file claims a supported format but does not decode",
        LibzciError::DecoderFailure { .. } => "the decoder failed mid-stream",
        LibzciError::DeviceUnavailable { .. } => {
            "no usable output device (try --device or --render-pcm)"
        }
        LibzciError::Cancelled => "cancelled",
        LibzciError::InvalidArgument { .. } => "invalid argument",
        LibzciError::ResourceExhausted { .. } => "resource limit reached",
        LibzciError::StorageFailure { .. } => "check profile ownership and storage access",
    };
    eprintln!("zci-play: {}: {error} ({hint})", path.display());
    std::process::exit(if error.is_cancelled() { 130 } else { 2 });
}

fn extension_hint(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    let args = match parse_args(&argv) {
        Ok(args) => args,
        Err(UsageError(message)) => {
            if message == "help" {
                eprintln!("{}", usage());
                return;
            }
            eprintln!("zci-play: {message}\n\n{}", usage());
            std::process::exit(2);
        }
    };
    let cancel = CancelFlag::default();
    let signal = cancel.clone();
    ctrlc::set_handler(move || signal.cancel()).unwrap_or_else(|e| {
        eprintln!("zci-play: cannot install interruption handler: {e}");
        std::process::exit(2);
    });
    let outcome = run(&args, &cancel);
    if let Err(error) = outcome {
        report(&error, &args.path);
    }
}
fn run(args: &Args, cancel: &CancelFlag) -> libzci::Result<()> {
    use libzci::queue::QueueCommand;
    let mut profile = args
        .profile
        .as_ref()
        .map(|p| libzci_native::profile::NativeProfile::open(p))
        .transpose()?;
    let volume = if args.volume_explicit {
        args.volume
    } else {
        profile
            .as_ref()
            .map_or(args.volume, |p| p.core.snapshot().settings.volume)
    };
    if let Some(p) = &mut profile {
        p.append_paths(&[args.path.clone()])?;
        let id = p.core.snapshot().queue.items.last().unwrap().id;
        p.command(QueueCommand::Play { id })?;
        let mut settings = p.core.snapshot().settings.clone();
        settings.volume = volume;
        p.command(QueueCommand::Settings { settings })?;
        p.command(QueueCommand::Checkpoint {
            position_seconds: args.start_secs,
            subsong: args.subsong,
        })?;
    }
    let runtime = NativeRuntime::new();
    runtime.register_provider(Arc::new(OpusFactory::default()))?;
    runtime.register_provider(Arc::new(libzci_symphonia::SymphoniaFactory))?;
    #[cfg(feature = "modules")]
    {
        runtime.register_provider(Arc::new(libzci_codecs::OpenmptFactory::default()))?;
        runtime.register_provider(Arc::new(libzci_codecs::HivelyFactory::default()))?;
    }
    cancel.check()?;
    let source = runtime.insert_source(Arc::new(NativeFileSource::open(&args.path)?));
    let hint = extension_hint(&args.path);
    let options = LoadOptions {
        start_time: MediaTime(args.start_secs),
        subsong: args.subsong,
    };
    if let Some(path) = &args.render_pcm {
        if std::fs::canonicalize(path).ok() == std::fs::canonicalize(&args.path).ok() {
            return Err(LibzciError::InvalidArgument {
                detail: "render output must differ from input".into(),
            });
        }
        let mut job = runtime.start_render(
            source,
            hint.as_deref(),
            RenderOptions {
                load: options,
                processing: ProcessingMode::Master {
                    volume,
                    mute: false,
                },
                ..Default::default()
            },
            cancel,
        )?;
        use std::io::Write;
        let file = std::fs::File::create(path).map_err(|e| LibzciError::Unavailable {
            detail: format!("cannot create {}: {e}", path.display()),
        })?;
        let mut file = std::io::BufWriter::new(file);
        let mut bytes = Vec::with_capacity(4096 * 8);
        loop {
            cancel.check()?;
            match job.next_step()? {
                RenderStep::Data { samples, .. } => {
                    bytes.clear();
                    for sample in samples {
                        bytes.extend_from_slice(&sample.to_le_bytes());
                    }
                    file.write_all(&bytes)
                        .map_err(|e| LibzciError::Unavailable {
                            detail: format!("render write: {e}"),
                        })?;
                }
                RenderStep::Pending => std::thread::sleep(Duration::from_millis(2)),
                RenderStep::Complete(result) => {
                    file.flush().map_err(|e| LibzciError::Unavailable {
                        detail: format!("render flush: {e}"),
                    })?;
                    eprintln!(
                        "zci-play: rendered {} frames stereo f32le @ {} Hz to {}",
                        result.output_frames,
                        result.rate_hz,
                        path.display()
                    );
                    if args.diagnostics {
                        eprintln!("zci-play: render {:?}", job.progress());
                    }
                    return Ok(());
                }
            }
        }
    }
    let session = runtime.create_session();
    runtime.submit(
        &Command::Load {
            request_id: RequestId::fresh(),
            session,
            source,
            options,
            extension_hint: hint,
        },
        cancel,
    )?;
    let loaded = runtime.wait_ready(session, cancel)?;
    runtime.submit(
        &Command::SetVolume {
            request_id: RequestId::fresh(),
            session,
            volume,
        },
        cancel,
    )?;
    let output = runtime.start_output(
        session,
        &OutputSpec {
            device_name: args.device.clone(),
            rate_hz: None,
        },
    )?;
    runtime.submit(
        &Command::Play {
            request_id: RequestId::fresh(),
            session,
        },
        cancel,
    )?;
    if args.diagnostics {
        if let Some(device) = runtime.output_state(output) {
            eprintln!(
                "zci-play: device={} rate_hz={} latency_frames={}",
                device.device_label, device.rate_hz, device.latency_frames
            );
        }
    }
    eprintln!("zci-play: playing {}", args.path.display());
    if args.diagnostics {
        eprintln!(
            "zci-play: provider={:?} total={:?} start_frame={}",
            loaded.provider, loaded.total_frames, loaded.position_frames
        );
    }
    loop {
        let snapshot = runtime.snapshot(session)?;
        if let Some(p) = &mut profile {
            let seconds = MediaTime::from_frames(
                snapshot.position_frames,
                snapshot.layout.map_or(1, |l| l.sample_rate),
            )
            .0;
            if (seconds - p.core.snapshot().position_seconds).abs() >= 2.0
                || cancel.is_cancelled()
                || snapshot.state == TransportState::Ended
            {
                p.command(QueueCommand::Checkpoint {
                    position_seconds: seconds,
                    subsong: snapshot.module.as_ref().map(|m| m.selected_subsong),
                })?;
            }
        }
        cancel.check()?;
        if let Some(error) = snapshot.error {
            return Err(error);
        }
        if args.diagnostics {
            let state =
                runtime
                    .output_state(output)
                    .ok_or_else(|| LibzciError::DeviceUnavailable {
                        detail: "output lost".into(),
                    })?;
            eprintln!("zci-play: position={} decoded={} device_frames={} hungry={} drained={} finished={}", snapshot.position_frames, state.decoded_position, state.consumed_frames, state.hungry_pops, state.drained, state.finished);
        }
        if snapshot.state == TransportState::Ended {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    runtime.dispose_session(session);
    eprintln!("zci-play: done {}", args.path.display());
    Ok(())
}
