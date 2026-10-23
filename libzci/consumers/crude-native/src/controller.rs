//! Consumer assembly/jobs. Domain and transport decisions remain in libzci.
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
    pub profile: libzci_native::profile::NativeProfile,
    ended_generation: Option<Generation>,
    checkpoint: std::time::Instant,
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
}
impl Controller {
    pub fn new() -> Self {
        Self::assemble(libzci_native::profile::NativeProfile::transient())
    }
    pub fn with_profile(path: &Path) -> Result<Self> {
        let profile = libzci_native::profile::NativeProfile::open(path)?;
        let mut controller = Self::assemble(profile);
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
            profile,
            ended_generation: None,
            checkpoint: std::time::Instant::now(),
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
        }
    }
    pub fn open(&mut self, path: &Path) {
        let result = (|| -> Result<()> {
            self.profile.append_paths(&[path.to_path_buf()])?;
            let id = self.profile.core.snapshot().queue.items.last().unwrap().id;
            let outcome = self
                .profile
                .command(libzci::queue::QueueCommand::Play { id })?;
            let mut load=outcome.load.unwrap();load.autoplay=false;
            self.load_occurrence(load)
        })();
        self.record(result);
    }
    fn load_occurrence(&mut self, load: libzci::profile::QueueLoad) -> Result<()> {
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
                },
            },
            &CancelFlag::default(),
        )?;
        if let Some(old) = self.source.replace(source) {
            self.runtime.release_source(old);
        }
        self.hint = hint;
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
        ] {
            self.runtime.submit(&command, &CancelFlag::default())?;
        }
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
    pub fn queue_command(&mut self, command: libzci::queue::QueueCommand) {
        let result = (|| -> Result<()> {
            let outcome = self.profile.command(command)?;
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
        let mut settings = self.profile.core.snapshot().settings.clone();
        match &command {
            Command::SetVolume { volume, .. } => settings.volume = *volume,
            Command::SetMute { mute, .. } => settings.mute = *mute,
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
        let s = self.snapshot();
        if s.state == TransportState::Ended && self.ended_generation != Some(s.generation) {
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
        self.cancel_jobs();
        self.runtime.dispose_session(self.session);
        self.output = None;
        if let Some(s) = self.source.take() {
            self.runtime.release_source(s);
        }
        self.session = self.runtime.create_session();
    }
    pub fn output(&self) -> Option<OutputObservation> {
        self.output.and_then(|id| self.runtime.output_state(id))
    }
    fn save_position(&mut self) {
        let s = self.snapshot();
        if self.profile.core.snapshot().queue.current.is_some()
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
impl Drop for Controller {
    fn drop(&mut self) {
        self.save_position();
        self.cancel_jobs();
        self.runtime.dispose_session(self.session);
    }
}
