//! Consumer assembly/jobs. Domain and transport decisions remain in libzci.
use libzci::catalog::{CatalogCommand, CatalogQuery, Collection, MediaKind};
use libzci::*;
use libzci_native::{
    probe::ProbeJob,
    render::{RenderOptions, RenderStep},
    *,
};
use std::{
    path::Path,
    sync::{
        mpsc::{self, Receiver},
        Arc,
    },
};
pub struct Controller {
    pub image_cache: Option<Arc<libzci_native::rendition_cache::RenditionCache>>,
    pub profile: libzci_native::profile::NativeProfile,
    playback: Option<libzci::profile::ProfilePlayback>,
    ended_generation: Option<Generation>,
    checkpoint: std::time::Instant,
    active_occurrence: Option<u64>,
    pub runtime: Arc<NativeRuntime>,
    pub session: SessionId,
    pub source: Option<SourceId>,
    pub hint: Option<String>,
    output: Option<OutputId>,
    pub error: String,
    pub probe: Option<ProbeJob>,
    pub inspection: Option<Inspection>,
    pub render: Option<(CancelFlag, Receiver<Result<u64>>)>,
    pub render_status: String,
    pending_image_open: Option<(libzci::images::ImageSequence, u64)>,
}
impl Controller {
    pub fn new() -> Self {
        Self::assemble(libzci_native::profile::NativeProfile::transient())
    }
    pub fn with_profile(path: &Path) -> Result<Self> {
        let profile = libzci_native::profile::NativeProfile::open(path)?;
        let mut controller = Self::assemble(profile);
        match libzci_native::rendition_cache::RenditionCache::open(path, Default::default()) {
            Ok(cache) => controller.image_cache = Some(Arc::new(cache)),
            Err(e) => controller.error = format!("Rendition cache unavailable: {e}"),
        }
        controller.playback = Some(
            controller
                .profile
                .attach_playback(&controller.runtime, controller.session)?,
        );
        controller.sync_playback()?;
        if let Some(load) = controller.profile.core.snapshot().restore() {
            let result = controller.load_occurrence(load);
            controller.record(result);
        }
        Ok(controller)
    }
    fn assemble(profile: libzci_native::profile::NativeProfile) -> Self {
        let runtime = NativeRuntime::new();
        runtime
            .register_provider(Arc::new(libzci_codecs::OpusFactory::default()))
            .unwrap();
        runtime
            .register_provider(Arc::new(libzci_symphonia::SymphoniaFactory))
            .unwrap();
        runtime
            .register_provider(Arc::new(libzci_codecs::OpenmptFactory::default()))
            .unwrap();
        runtime
            .register_provider(Arc::new(libzci_codecs::HivelyFactory::default()))
            .unwrap();
        let session = runtime.create_session();
        Self {
            image_cache: None,
            profile,
            playback: None,
            ended_generation: None,
            checkpoint: std::time::Instant::now(),
            active_occurrence: None,
            runtime,
            session,
            source: None,
            hint: None,
            output: None,
            error: String::new(),
            probe: None,
            inspection: None,
            render: None,
            render_status: String::new(),
            pending_image_open: None,
        }
    }
    pub fn open(&mut self, path: &Path) {
        self.pending_image_open = None;
        let result = (|| -> Result<()> {
            if native_header_is_image(path)? {
                return self.open_image(path);
            }
            self.profile.append_paths(&[path.to_path_buf()])?;
            let id = self.profile.core.snapshot().queue.items.last().unwrap().id;
            let outcome = self
                .profile
                .command(libzci::queue::QueueCommand::Play { id })?;
            let mut load = outcome.load.unwrap();
            load.autoplay = false;
            self.load_occurrence(load)
        })();
        self.record(result);
    }
    fn open_image(&mut self, path: &Path) -> Result<()> {
        let media = libzci_native::images::inspect_native_image(path, &CancelFlag::default())?;
        let outcome = self
            .profile
            .catalog_request(CatalogCommand::Add { media: vec![media] }, None)?;
        let id = outcome
            .media
            .first()
            .copied()
            .ok_or_else(|| LibzciError::Unavailable {
                detail: "catalog did not return the opened image".into(),
            })?;
        let sequence = self.profile.image_sequence(&CatalogQuery {
            collection: Collection::All,
            kind: Some(MediaKind::Image),
            ..Default::default()
        })?;
        self.pending_image_open = Some((sequence, id));
        Ok(())
    }
    pub fn take_image_open(&mut self) -> Option<(libzci::images::ImageSequence, u64)> {
        self.pending_image_open.take()
    }
    pub fn append(&mut self, paths: &[std::path::PathBuf]) {
        let result = self.profile.append_paths(paths).map(|_| ());
        self.record(result);
    }
    fn load_occurrence(&mut self, load: libzci::profile::QueueLoad) -> Result<()> {
        self.active_occurrence = None;
        if self.snapshot().state != TransportState::Idle {
            self.runtime.submit(
                &Command::Stop {
                    session: self.session,
                    request_id: RequestId::fresh(),
                },
                &CancelFlag::default(),
            )?;
        }
        let path = Path::new(&load.source.locator);
        let source = self
            .runtime
            .insert_source(Arc::new(NativeFileSource::open(path)?));
        let hint = path
            .extension()
            .and_then(|s| s.to_str())
            .map(str::to_ascii_lowercase);
        self.runtime.submit(
            &Command::Load {
                session: self.session,
                request_id: RequestId::fresh(),
                source,
                extension_hint: hint.clone(),
                options: LoadOptions {
                    start_time: MediaTime(load.position_seconds),
                    subsong: load.subsong,
                    context: Some(PlaybackContext {
                        reference: load.source.clone(),
                        library_media: None,
                    }),
                },
            },
            &CancelFlag::default(),
        )?;
        if let Some(old) = self.source.replace(source) {
            self.runtime.release_source(old);
        }
        self.hint = hint;
        self.active_occurrence = Some(load.occurrence);
        self.sync_playback()?;
        if load.autoplay {
            self.runtime.submit(
                &Command::Play {
                    session: self.session,
                    request_id: RequestId::fresh(),
                },
                &CancelFlag::default(),
            )?;
        }
        Ok(())
    }
    fn sync_playback(&mut self) -> Result<()> {
        if let Some(binding) = self.playback.as_mut() {
            self.profile
                .sync_playback(binding, &self.runtime, self.session)?;
            return Ok(());
        }
        let settings = self.profile.core.snapshot().settings.clone();
        for command in [
            Command::SetVolume {
                session: self.session,
                request_id: RequestId::fresh(),
                volume: settings.volume,
            },
            Command::SetMute {
                session: self.session,
                request_id: RequestId::fresh(),
                mute: settings.mute,
            },
            Command::SetReplayGain {
                session: self.session,
                request_id: RequestId::fresh(),
                settings: settings.replay_gain,
            },
        ] {
            self.runtime.submit(&command, &CancelFlag::default())?;
        }
        Ok(())
    }
    fn close_playback(&mut self) {
        let _ = self.runtime.submit(
            &Command::Pause {
                session: self.session,
                request_id: RequestId::fresh(),
            },
            &CancelFlag::default(),
        );
        if let Err(e) = self.sync_playback() {
            self.error = e.to_string();
            return;
        }
        if let Some(mut binding) = self.playback.take() {
            if let Err(e) = self.profile.close_playback(&mut binding) {
                self.error = e.to_string();
            }
        }
    }
    pub fn queue_command(&mut self, command: libzci::queue::QueueCommand) {
        let result = (|| -> Result<()> {
            let outcome = self.profile.command(command)?;
            self.sync_playback()?;
            if outcome.stop {
                self.runtime.submit(
                    &Command::Stop {
                        session: self.session,
                        request_id: RequestId::fresh(),
                    },
                    &CancelFlag::default(),
                )?;
            }
            if let Some(load) = outcome.load {
                self.load_occurrence(load)?;
            }
            Ok(())
        })();
        self.record(result);
    }
    pub fn command(&mut self, make: impl FnOnce(SessionId, RequestId) -> Command) {
        let command = make(self.session, RequestId::fresh());
        if matches!(command, Command::Play { .. })
            && self.profile.core.snapshot().queue.current.is_none()
        {
            self.queue_command(libzci::queue::QueueCommand::Next { ended: false });
            return;
        }
        if matches!(command, Command::Play { .. })
            && self.active_occurrence != self.profile.core.snapshot().queue.current
        {
            if let Some(load) = self.profile.core.snapshot().restore() {
                if let Err(e) = self.load_occurrence(load) {
                    self.record(Err(e));
                    return;
                }
            }
        }
        if matches!(command, Command::Play { .. }) && self.active_occurrence.is_none() {
            self.queue_command(libzci::queue::QueueCommand::Next { ended: false });
            return;
        }
        let mut settings = self.profile.core.snapshot().settings.clone();
        match &command {
            Command::SetVolume { volume, .. } => settings.volume = *volume,
            Command::SetMute { mute, .. } => settings.mute = *mute,
            Command::SetReplayGain {
                settings: replay_gain,
                ..
            } => settings.replay_gain = *replay_gain,
            _ => {}
        }
        if settings != self.profile.core.snapshot().settings {
            if let Err(e) = self
                .profile
                .command(libzci::queue::QueueCommand::Settings { settings })
            {
                self.record(Err(e));
                return;
            }
        }
        let result = self
            .runtime
            .submit(&command, &CancelFlag::default())
            .map(|_| ());
        self.record(result);
    }
    pub fn module(&mut self, control: ModuleControl) {
        self.command(|session, request_id| Command::Module {
            session,
            request_id,
            control,
        });
    }
    pub fn snapshot(&self) -> Snapshot {
        self.runtime.snapshot(self.session).unwrap()
    }
    fn record(&mut self, r: Result<()>) {
        match r {
            Ok(()) => self.error.clear(),
            Err(e) => self.error = format!("{}: {e}", e.kind()),
        }
    }
    pub fn tick(&mut self) {
        if let Err(e) = self.sync_playback() {
            self.error = e.to_string();
        }
        let s = self.snapshot();
        if s.state == TransportState::Ended && self.ended_generation != Some(s.generation) {
            self.save_position();
            self.ended_generation = Some(s.generation);
            self.queue_command(libzci::queue::QueueCommand::Next { ended: true });
        }
        if self.checkpoint.elapsed() > std::time::Duration::from_secs(2) {
            self.checkpoint = std::time::Instant::now();
            self.save_position();
        }
        if self.output.is_none() && s.layout.is_some() && !s.pending_operation && s.error.is_none()
        {
            match self
                .runtime
                .start_output(self.session, &OutputSpec::default())
            {
                Ok(id) => self.output = Some(id),
                Err(e) => self.error = e.to_string(),
            }
        }
        if let Some(p) = &self.probe {
            if let Some(result) = p.poll() {
                match result {
                    Ok(i) => self.inspection = Some(i),
                    Err(e) => self.error = e.to_string(),
                };
                self.probe = None;
            }
        }
        if let Some((_, rx)) = &self.render {
            if let Ok(result) = rx.try_recv() {
                self.render_status = match result {
                    Ok(n) => format!("Rendered {n} stereo frames at 48000 Hz"),
                    Err(e) => e.to_string(),
                };
                self.render = None;
            }
        }
    }
    pub fn inspect(&mut self, verify_unknown: bool) {
        if let Some(source) = self.source {
            let result = self.runtime.start_probe(
                source,
                self.hint.as_deref(),
                verify_unknown,
                &CancelFlag::default(),
            );
            match result {
                Ok(job) => self.probe = Some(job),
                Err(e) => self.error = e.to_string(),
            }
        }
    }
    pub fn render(&mut self, path: &Path) {
        self.cancel_jobs();
        let Some(source) = self.source else { return };
        let runtime = self.runtime.clone();
        let hint = self.hint.clone();
        let path = path.to_owned();
        let cancel = CancelFlag::default();
        let token = cancel.clone();
        let (tx, rx) = mpsc::sync_channel(1);
        self.render = Some((cancel, rx));
        self.render_status = "Rendering independent source…".into();
        std::thread::spawn(move || {
            let result = (|| -> Result<u64> {
                use std::io::Write;
                let mut job = runtime.start_render(
                    source,
                    hint.as_deref(),
                    RenderOptions::default(),
                    &token,
                )?;
                let mut file =
                    std::fs::File::create(path).map_err(|e| LibzciError::Unavailable {
                        detail: e.to_string(),
                    })?;
                loop {
                    match job.next_step()? {
                        RenderStep::Data { samples, .. } => {
                            for sample in samples {
                                file.write_all(&sample.to_le_bytes()).map_err(|e| {
                                    LibzciError::Unavailable {
                                        detail: e.to_string(),
                                    }
                                })?;
                            }
                        }
                        RenderStep::Pending => std::thread::yield_now(),
                        RenderStep::Complete(result) => return Ok(result.output_frames),
                    }
                }
            })();
            let _ = tx.send(result);
        });
    }
    pub fn cancel_jobs(&mut self) {
        self.probe = None;
        if let Some((c, _)) = self.render.take() {
            c.cancel();
            self.render_status = "Cancelled".into();
        }
    }
    pub fn dispose(&mut self) {
        let durable = self.playback.is_some();
        self.active_occurrence = None;
        self.cancel_jobs();
        self.close_playback();
        self.runtime.dispose_session(self.session);
        self.output = None;
        if let Some(s) = self.source.take() {
            self.runtime.release_source(s);
        }
        self.session = self.runtime.create_session();
        if durable {
            match self.profile.attach_playback(&self.runtime, self.session) {
                Ok(binding) => self.playback = Some(binding),
                Err(e) => self.error = e.to_string(),
            };
        }
    }
    pub fn output(&self) -> Option<OutputObservation> {
        self.output.and_then(|id| self.runtime.output_state(id))
    }
    fn save_position(&mut self) {
        let s = self.snapshot();
        if self.active_occurrence.is_some()
            && self.active_occurrence == self.profile.core.snapshot().queue.current
            && !s.pending_operation
            && s.error.is_none()
        {
            let result = self
                .profile
                .command(libzci::queue::QueueCommand::Checkpoint {
                    position_seconds: MediaTime::from_frames(
                        s.position_frames,
                        s.layout.map_or(1, |l| l.sample_rate),
                    )
                    .0,
                    subsong: s.module.as_ref().map(|m| m.selected_subsong),
                })
                .map(|_| ());
            if let Err(e) = result {
                self.error = e.to_string();
            }
        }
    }
}
fn native_header_is_image(path: &Path) -> Result<bool> {
    use libzci::RuntimeSource;
    let source = NativeFileSource::open(path)?;
    let mut header = [0; 32];
    let length = source.len().unwrap_or(32).min(32) as usize;
    source.read_exact_at(0, &mut header[..length], &CancelFlag::default())?;
    Ok(libzci::artwork::raster_mime(&header[..length]).is_some())
}

impl Drop for Controller {
    fn drop(&mut self) {
        self.save_position();
        self.cancel_jobs();
        self.close_playback();
        self.runtime.dispose_session(self.session);
    }
}
