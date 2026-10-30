//! Independent visual-session wiring. Navigation/fencing live in shared Rust;
//! the native view owns only jobs, surface upload and display preferences.
use crate::controller::Controller;
use eframe::egui;
use libzci::{
    catalog::{CatalogQuery, Collection, MediaKind},
    images::*,
    queue::SourceKind,
    *,
};
use libzci_native::images::ImageJob;
pub struct ImageView {
    session: ImageSession,
    job: Option<(ImageViewSnapshot, ImageJob)>,
    texture: Option<egui::TextureHandle>,
    edge: u32,
    wrap: bool,
    status: String,
}
impl Default for ImageView {
    fn default() -> Self {
        Self {
            session: Default::default(),
            job: None,
            texture: None,
            edge: 1024,
            wrap: false,
            status: String::new(),
        }
    }
}
impl ImageView {
    pub fn open(&mut self, sequence: ImageSequence, media: u64, c: &mut Controller) {
        match self.session.open(sequence, media) {
            Ok(_) => self.load(c),
            Err(e) => self.status = e.to_string(),
        }
    }
    fn load(&mut self, c: &mut Controller) {
        self.job = None;
        self.texture = None;
        let state = self.session.snapshot();
        let Some(media) = state.media else {
            return;
        };
        let result = (|| -> Result<ImageJob> {
            let row = c
                .profile
                .catalog_query(&CatalogQuery {
                    collection: Collection::All,
                    kind: Some(MediaKind::Image),
                    media: Some(media),
                    limit: 1,
                    ..Default::default()
                })?
                .rows
                .pop()
                .ok_or_else(|| LibzciError::Unavailable {
                    detail: "captured image is no longer available".into(),
                })?;
            if row.source.kind != SourceKind::NativePath {
                return Err(LibzciError::Unsupported {
                    detail: "image requires genuine native file access".into(),
                });
            }
            self.status = row.source.display_path.clone();
            ImageJob::from_path(
                std::path::Path::new(&row.source.locator),
                ImageJobRequest::Image {
                    spec: RenditionSpec {
                        max_edge: self.edge,
                    },
                },
                &CancelFlag::default(),
            )
        })();
        match result {
            Ok(job) => self.job = Some((state, job)),
            Err(e) => self.status = e.to_string(),
        }
    }
    fn navigate(&mut self, command: ImageNavigation, c: &mut Controller) {
        let before = self.session.snapshot();
        match self.session.navigate(command, self.wrap) {
            Ok(state) if state.generation != before.generation => self.load(c),
            Ok(_) => (),
            Err(e) => self.status = e.to_string(),
        }
    }
    pub fn close(&mut self) {
        self.job = None;
        self.texture = None;
        let _ = self.session.close();
        self.status.clear();
    }
    pub fn tick(&mut self, ctx: &egui::Context) {
        let Some(result) = self.job.as_ref().and_then(|(_, job)| job.poll()) else {
            return;
        };
        let (state, _) = self.job.take().unwrap();
        match result {
            Ok(ImageJobResult::Rendition(Some(r))) => match self.session.complete(
                state.session,
                state.generation,
                state.media.unwrap(),
                r.source.clone(),
            ) {
                Ok(true) => {
                    self.texture = Some(ctx.load_texture(
                        "image-viewer",
                        egui::ColorImage::from_rgba_unmultiplied(
                            [r.width as usize, r.height as usize],
                            &r.rgba,
                        ),
                        egui::TextureOptions::LINEAR,
                    ));
                }
                Ok(false) => (),
                Err(e) => self.status = e.to_string(),
            },
            Ok(_) => self.status = "Image rendition unavailable".into(),
            Err(e) => self.status = e.to_string(),
        }
    }
    pub fn draw(&mut self, ui: &mut egui::Ui, c: &mut Controller) {
        let state = self.session.snapshot();
        if state.media.is_none() {
            return;
        }
        ui.separator();
        ui.horizontal(|ui| {
            for (label, command) in [
                ("First", ImageNavigation::First),
                ("Previous image", ImageNavigation::Previous),
                ("Next image", ImageNavigation::Next),
                ("Last", ImageNavigation::Last),
                ("Reload image", ImageNavigation::Refresh),
            ] {
                if ui.button(label).clicked() {
                    self.navigate(command, c);
                }
            }
            if ui.button("Close image").clicked() {
                self.close();
            }
            ui.checkbox(&mut self.wrap, "Wrap image navigation");
            if ui
                .add(
                    egui::DragValue::new(&mut self.edge)
                        .range(1..=2048)
                        .prefix("Edge ")
                        .suffix(" px"),
                )
                .changed()
            {
                self.navigate(ImageNavigation::Refresh, c);
            }
        });
        ui.label(format!(
            "{} / {} · {}",
            state.index.unwrap() + 1,
            state.count,
            self.status
        ));
        if let Some(texture) = &self.texture {
            ui.add(egui::Image::new(texture).max_size(egui::vec2(ui.available_width(), 500.)));
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_viewer_keeps_captured_navigation_and_releases_jobs_and_texture_independently() {
        use libzci::catalog::{CatalogCommand, MediaInput, Metadata};
        let dir = std::env::temp_dir().join(format!(
            "libzci-image-view-{}-{}",
            std::process::id(),
            RequestId::fresh().0
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../.local/libzci/media/m3/artwork.png");
        for name in ["a.png", "b.png", "c.png"] {
            std::fs::copy(&fixture, dir.join(name)).unwrap();
        }
        let mut c = Controller::with_profile(&dir.join("profile")).unwrap();
        let input = |name: &str| {
            let source = libzci_native::NativeFileSource::open(&dir.join(name)).unwrap();
            MediaInput {
                source: libzci_native::source::native_reference(&dir.join(name)).unwrap(),
                source_revision: source.revision_key(),
                kind: MediaKind::Image,
                metadata: Metadata::from_image(
                    inspect_image(&source, &CancelFlag::default()).unwrap(),
                    name,
                )
                .unwrap(),
            }
        };
        let ids = c
            .profile
            .catalog_request(
                CatalogCommand::Add {
                    media: vec![input("a.png"), input("b.png")],
                },
                None,
            )
            .unwrap()
            .media;
        let query = CatalogQuery {
            sort: libzci::catalog::CatalogSort::Path,
            ..Default::default()
        };
        let sequence = c.profile.image_sequence(&query).unwrap();
        let before = c.snapshot();
        let mut view = ImageView {
            edge: 64,
            ..Default::default()
        };
        let ctx = egui::Context::default();
        let wait = |view: &mut ImageView| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while view.job.is_some() {
                let _ = ctx.run(Default::default(), |ctx| view.tick(ctx));
                assert!(std::time::Instant::now() < deadline);
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        };
        view.open(sequence, ids[0], &mut c);
        wait(&mut view);
        assert_eq!(view.texture.as_ref().unwrap().size(), [64, 64]);
        c.profile
            .catalog_request(
                CatalogCommand::Add {
                    media: vec![input("c.png")],
                },
                None,
            )
            .unwrap();
        view.navigate(ImageNavigation::Last, &mut c);
        view.navigate(ImageNavigation::First, &mut c);
        view.navigate(ImageNavigation::Next, &mut c);
        wait(&mut view);
        let state = view.session.snapshot();
        assert_eq!((state.media, state.count), (Some(ids[1]), 2));
        assert!(state.facts.is_some());
        assert!(view.texture.is_some());
        let after = c.snapshot();
        assert_eq!(before.generation, after.generation);
        assert_eq!(before.revision, after.revision);
        assert_eq!(before.state, after.state);
        view.close();
        assert!(view.job.is_none() && view.texture.is_none());
        assert_eq!(view.session.snapshot().count, 0);
        drop(c);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
