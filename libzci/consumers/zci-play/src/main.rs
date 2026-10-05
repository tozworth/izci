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
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

use libzci::{CancelFlag, Command, DecoderInstance, LibzciError, RequestId};
use libzci_codecs::{HivelyFactory, HivelyInstance, OpenmptFactory, OpenmptInstance, OpusFactory};
use libzci_native::{NativeFileSource, NativeRuntime, OutputSpec};

/// Parsed CLI inputs (units documented in `usage`).
struct Args {
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
        "  --volume V        master volume, linear 0.0..=1.0 (default 1.0)",
        "  --start SECONDS   start position in seconds, >= 0.0 (default 0.0)",
        "  --subsong N       subsong index for module content (default: first)",
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
            argv.get(*i).cloned().ok_or_else(|| UsageError(format!("{arg} needs a value")))
        };
        match arg {
            "--help" => return Err(UsageError("help".into())),
            "--device" => args.device = Some(value_of(&mut i)?),
            "--volume" => {
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
            other if other.starts_with("--") => return Err(UsageError(format!("unknown flag {other}"))),
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
        LibzciError::Unsupported { .. } => "unsupported or unrecognized media for the registered providers",
        LibzciError::Corrupt { .. } => "the file claims a supported format but does not decode",
        LibzciError::DecoderFailure { .. } => "the decoder failed mid-stream",
        LibzciError::DeviceUnavailable { .. } => "no usable output device (try --device or --render-pcm)",
        LibzciError::Cancelled => "cancelled",
        LibzciError::InvalidArgument { .. } => "invalid argument",
        LibzciError::ResourceExhausted { .. } => "resource limit reached",
    };
    eprintln!("zci-play: {}: {error} ({hint})", path.display());
    std::process::exit(2);
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
                std::process::exit(0);
            }
            eprintln!("zci-play: {message}\n\n{}", usage());
            std::process::exit(2);
        }
    };

    let interrupted = Arc::new(AtomicBool::new(false));
    {
        let flag = Arc::clone(&interrupted);
        let _ = ctrlc::set_handler(move || flag.store(true, Ordering::SeqCst));
    }

    let runtime = NativeRuntime::new();
    runtime.register_provider(Arc::new(OpusFactory::default())).unwrap_or_else(|e| report(&e, &args.path));
    runtime.register_provider(Arc::new(OpenmptFactory::default())).unwrap_or_else(|e| report(&e, &args.path));
    runtime.register_provider(Arc::new(HivelyFactory::default())).unwrap_or_else(|e| report(&e, &args.path));
    let cancel = CancelFlag::default();

    // Register the runtime source (bounded native file, verbatim path).
    let file = NativeFileSource::open(&args.path).unwrap_or_else(|e| report(&e, &args.path));
    let display_path = file.display_path();
    let source = runtime.insert_source(Arc::new(file));
    let session = runtime.create_session();
    let hint = extension_hint(&args.path);

    // Open through provider selection — or, with --subsong on module
    // content, through a concrete instance with the subsong applied
    // before the session takes over.
    if args.subsong.is_none() {
        if let Err(e) = runtime.load(session, source, hint.as_deref(), &cancel) {
            report(&e, &args.path);
        }
    } else if let Some(subsong) = args.subsong {
        let _ = open_with_subsong(&runtime, session, source, subsong, &cancel, &args);
    }
    let snapshot = runtime.snapshot(session).unwrap_or_else(|e| report(&e, &args.path));
    let provider = snapshot.provider.unwrap_or_else(|| {
        report(&LibzciError::Unsupported { detail: "no provider claimed the source".into() }, &args.path)
    });
    let snapshot = runtime.snapshot(session).unwrap_or_else(|e| report(&e, &args.path));
    let started_at_frame = (args.start_secs * 48_000.0).round() as u64;
    if started_at_frame > 0 {
        match runtime.submit(
            &Command::Seek { request_id: RequestId::fresh(), session, frame: started_at_frame },
            &cancel,
        ) {
            Ok(_) => {}
            Err(e) => report(&e, &args.path),
        }
    }

    if args.diagnostics {
        eprintln!(
            "zci-play: {} provider={:?}/{} total={:?} start_frame={} volume={}",
            display_path,
            provider.id.0,
            provider.version,
            snapshot.total_frames,
            started_at_frame,
            args.volume
        );
    }

    if let Some(render_path) = args.render_pcm.clone() {
        render_to_file(&runtime, session, &render_path, &args, &cancel, &interrupted);
        return;
    }

    // Request play through a core command, then feed the device.
    match runtime.submit(&Command::Play { request_id: RequestId::fresh(), session }, &cancel) {
        Ok(_) => {}
        Err(e) => report(&e, &args.path),
    }
    let spec = OutputSpec { device_name: args.device.clone(), rate_hz: None };
    let output = match runtime.start_output(session, &spec, args.volume) {
        Ok(id) => id,
        Err(e) => report(&e, &args.path),
    };
    if args.diagnostics {
        if let Some(state) = runtime.output_state(output) {
            eprintln!(
                "zci-play: device={} rate={} latency_frames={}",
                state.device_label, state.rate_hz, state.latency_frames
            );
        }
    }
    eprintln!("zci-play: playing {display_path}");
    let deadline = Instant::now() + Duration::from_secs(3600 * 12);
    loop {
        if interrupted.load(Ordering::SeqCst) {
            let _ = runtime.stop_output(output);
            eprintln!("zci-play: interrupted");
            std::process::exit(130);
        }
        let state = runtime.output_state(output).unwrap_or_else(|| {
            eprintln!("zci-play: output lost");
            std::process::exit(2);
        });
        if args.diagnostics {
            eprintln!(
                "zci-play: decoded={} consumed={} hungry={} drained={} finished={}",
                state.decoded_position, state.consumed_frames, state.hungry_pops, state.drained, state.finished
            );
        }
        if state.finished {
            break;
        }
        if Instant::now() > deadline {
            eprintln!("zci-play: playback deadline exceeded");
            std::process::exit(2);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = runtime.stop_output(output);
    eprintln!("zci-play: done {display_path}");
}

/// Open module content with a subsong applied before session load.
/// Non-module content with --subsong is an actionable usage error.
fn open_with_subsong(
    runtime: &Arc<NativeRuntime>,
    session: libzci::SessionId,
    source: libzci::SourceId,
    subsong: u32,
    cancel: &CancelFlag,
    args: &Args,
) {
    let src = runtime.get_source(source).unwrap_or_else(|| {
        report(&LibzciError::Unavailable { detail: "source vanished".into() }, &args.path)
    });
    // Peek at the family through the centralized sniff (bounded read).
    let mut header = vec![0u8; 8192];
    let n = src.read_at(0, &mut header, cancel).unwrap_or(0);
    header.truncate(n);
    match libzci::sniff_module_family(&header) {
        Some(libzci::ModuleFamily::Openmpt) => {
            let mut instance = OpenmptInstance::open(src, Default::default(), cancel)
                .unwrap_or_else(|e| report(&e, &args.path));
            let selected = instance.select_subsong(subsong, cancel).unwrap_or_else(|e| report(&e, &args.path));
            if args.diagnostics {
                eprintln!("zci-play: subsong {selected} selected");
            }
            let info = instance.info();
            runtime.load_opened(session, info, Box::new(instance), cancel).unwrap_or_else(|e| report(&e, &args.path));
        }
        Some(libzci::ModuleFamily::Hively(_)) => {
            let mut instance = HivelyInstance::open(src, Default::default(), cancel)
                .unwrap_or_else(|e| report(&e, &args.path));
            let selected = instance.select_subsong(subsong, cancel).unwrap_or_else(|e| report(&e, &args.path));
            if args.diagnostics {
                eprintln!("zci-play: subsong {selected} selected");
            }
            let info = instance.info();
            runtime.load_opened(session, info, Box::new(instance), cancel).unwrap_or_else(|e| report(&e, &args.path));
        }
        _ => report(
            &LibzciError::InvalidArgument { detail: "--subsong needs module (MOD/Hively) content".into() },
            &args.path,
        ),
    }
}

/// Explicit stereo-float render path (no device opened).
fn render_to_file(
    runtime: &Arc<NativeRuntime>,
    session: libzci::SessionId,
    render_path: &Path,
    args: &Args,
    cancel: &CancelFlag,
    interrupted: &Arc<AtomicBool>,
) {
    use std::io::Write;
    // Request play so EOF semantics flow through the core path.
    match runtime.submit(&Command::Play { request_id: RequestId::fresh(), session }, cancel) {
        Ok(_) => {}
        Err(e) => report(&e, &args.path),
    }
    let (samples, rate) = runtime
        .render_to_vec(session, 48_000, args.volume, u64::MAX, cancel)
        .unwrap_or_else(|e| {
            if interrupted.load(Ordering::SeqCst) {
                eprintln!("zci-play: interrupted");
                std::process::exit(130);
            }
            report(&e, &args.path)
        });
    let mut file = std::fs::File::create(render_path).unwrap_or_else(|e| {
        eprintln!("zci-play: cannot write {}: {e}", render_path.display());
        std::process::exit(2);
    });
    for sample in &samples {
        file.write_all(&sample.to_le_bytes()).unwrap_or_else(|e| {
            eprintln!("zci-play: cannot write {}: {e}", render_path.display());
            std::process::exit(2);
        });
    }
    eprintln!(
        "zci-play: rendered {} frames stereo f32le @ {} Hz to {}",
        samples.len() / 2,
        rate,
        render_path.display()
    );
}
