use crate::controller::Controller;
use eframe::egui;
use libzci::{
    lyrics::{LyricsDocument, MAX_LYRICS_BYTES},
    CancelFlag, Command, MediaTime,
};
use libzci_native::{lyrics::LyricsJob, source::native_reference};
pub struct LyricsView {
    job: Option<LyricsJob>,
    document: Option<LyricsDocument>,
    source: Option<String>,
    delay: f64,
    follow: bool,
    last: Option<usize>,
    status: String,
}
impl Default for LyricsView {
    fn default() -> Self {
        Self {
            job: None,
            document: None,
            source: None,
            delay: 0.,
            follow: true,
            last: None,
            status: String::new(),
        }
    }
}
impl LyricsView {
    fn current(c: &Controller) -> Option<String> {
        c.source?;
        c.profile
            .core
            .snapshot()
            .restore()
            .map(|load| load.source.key)
    }
    pub fn tick(&mut self) {
        if let Some(result) = self.job.as_ref().and_then(LyricsJob::poll) {
            self.job = None;
            match result {
                Ok(document) => {
                    self.document = document;
                    self.status = if self.document.is_some() {
                        "Loaded transient lyrics".into()
                    } else {
                        "No embedded lyrics".into()
                    };
                }
                Err(e) => self.status = e.to_string(),
            }
        }
    }
    pub fn draw(&mut self, ui: &mut egui::Ui, c: &mut Controller) {
        egui::CollapsingHeader::new("Lyrics").show(ui, |ui| {
            ui.horizontal(|ui| {
                if ui.button("Read current source").clicked() {
                    self.job = None;
                    self.document = None;
                    self.source = Self::current(c);
                    self.last = None;
                    match c
                        .source
                        .map(|source| c.runtime.start_lyrics(source, &CancelFlag::default()))
                    {
                        Some(Ok(job)) => {
                            self.job = Some(job);
                            self.status = "Reading…".into();
                        }
                        Some(Err(e)) => self.status = e.to_string(),
                        None => self.status = "Load a source first".into(),
                    }
                }
                if ui.button("Read media file…").clicked() {
                    if let Some(path) = rfd::FileDialog::new().pick_file() {
                        self.job = None;
                        self.document = None;
                        self.last = None;
                        self.source = native_reference(&path).ok().map(|source| source.key);
                        match LyricsJob::from_path(&path, &CancelFlag::default()) {
                            Ok(job) => {
                                self.job = Some(job);
                                self.status = "Reading…".into();
                            }
                            Err(e) => self.status = e.to_string(),
                        }
                    }
                }
                if ui.button("Open UTF-8 text / LRC…").clicked() {
                    if let Some(path) = rfd::FileDialog::new()
                        .add_filter("Lyrics", &["lrc", "txt"])
                        .pick_file()
                    {
                        use std::io::Read;
                        self.job = None;
                        self.document = None;
                        self.source = Self::current(c);
                        self.last = None;
                        let result = (|| -> Result<LyricsDocument, String> {
                            let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
                            let mut raw = String::new();
                            file.take(MAX_LYRICS_BYTES as u64 + 1)
                                .read_to_string(&mut raw)
                                .map_err(|e| e.to_string())?;
                            LyricsDocument::parse(&raw).map_err(|e| e.to_string())
                        })();
                        match result {
                            Ok(doc) => {
                                self.document = Some(doc);
                                self.status = "Loaded sidecar lyrics".into();
                            }
                            Err(e) => self.status = e,
                        }
                    }
                }
                if ui.button("Cancel").clicked() {
                    self.job = None;
                    self.status = "Cancelled".into();
                }
            });
            ui.horizontal(|ui| {
                ui.checkbox(&mut self.follow, "Follow active cue");
                ui.add(
                    egui::DragValue::new(&mut self.delay)
                        .range(-30.0..=30.0)
                        .speed(0.1)
                        .prefix("Display delay (s) "),
                );
                ui.label(&self.status);
            });
            let Some(document) = &self.document else {
                return;
            };
            let current = self.source.is_some() && self.source == Self::current(c);
            let snapshot = c.snapshot();
            let time = snapshot.position_frames as f64
                / snapshot.layout.map_or(1, |layout| layout.sample_rate) as f64
                - self.delay;
            let active = if current { document.active(time) } else { None };
            if !current {
                ui.label("Lyrics for a different source; timeline highlighting is paused.");
            }
            if document.lines.is_empty() {
                egui::ScrollArea::vertical()
                    .max_height(160.)
                    .show(ui, |ui| {
                        ui.label(&document.plain);
                    });
                return;
            }
            let height = ui.text_style_height(&egui::TextStyle::Body);
            let mut scroll = egui::ScrollArea::vertical()
                .id_salt("lyrics")
                .max_height(160.);
            if self.follow && self.last != active.as_ref().map(|r| r.start) {
                if let Some(range) = &active {
                    scroll = scroll.vertical_scroll_offset(range.start as f32 * height);
                }
                self.last = active.as_ref().map(|r| r.start);
            }
            scroll.show_rows(ui, height, document.lines.len(), |ui, range| {
                for index in range {
                    let line = &document.lines[index];
                    if ui
                        .selectable_label(
                            active.as_ref().is_some_and(|range| range.contains(&index)),
                            format!("{:.3}s  {}", line.time_ms as f64 / 1000., line.text),
                        )
                        .clicked()
                        && current
                    {
                        let time = MediaTime((line.time_ms as f64 / 1000. + self.delay).max(0.));
                        c.command(|session, request_id| Command::Seek {
                            session,
                            request_id,
                            time,
                        });
                    }
                }
            });
        });
    }
}
