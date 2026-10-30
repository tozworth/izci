//! Presentation-owned texture; all inspection/decoding/renditions use libzci.
use crate::controller::Controller;
use eframe::egui;
use libzci::{
    images::{ImageJobRequest, ImageJobResult, RenditionSpec},
    CancelFlag,
};
use libzci_native::images::ImageJob;
pub struct ArtworkView {
    job: Option<ImageJob>,
    texture: Option<egui::TextureHandle>,
    edge: u32,
    status: String,
}
impl Default for ArtworkView {
    fn default() -> Self {
        Self {
            job: None,
            texture: None,
            edge: 512,
            status: String::new(),
        }
    }
}
impl ArtworkView {
    fn close(&mut self) {
        self.job = None;
        self.texture = None;
        self.status.clear();
    }
    fn start(&mut self, result: libzci::Result<ImageJob>) {
        self.close();
        match result {
            Ok(job) => {
                self.job = Some(job);
                self.status = "Loading…".into();
            }
            Err(e) => self.status = e.to_string(),
        }
    }
    pub fn tick(&mut self, ctx: &egui::Context) {
        let Some(result) = self.job.as_ref().and_then(ImageJob::poll) else {
            return;
        };
        self.job = None;
        match result {
            Ok(ImageJobResult::Rendition(Some(r))) => {
                self.status = format!("{} × {}", r.source.display_width, r.source.display_height);
                self.texture = Some(ctx.load_texture(
                    "artwork-preview",
                    egui::ColorImage::from_rgba_unmultiplied(
                        [r.width as usize, r.height as usize],
                        &r.rgba,
                    ),
                    egui::TextureOptions::LINEAR,
                ));
            }
            Ok(_) => self.status = "No embedded artwork".into(),
            Err(e) => self.status = e.to_string(),
        }
    }
    pub fn draw(&mut self, ui: &mut egui::Ui, c: &Controller) {
        egui::CollapsingHeader::new("Artwork / images").show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label("Preview edge");
                ui.add(
                    egui::DragValue::new(&mut self.edge)
                        .range(1..=2048)
                        .suffix(" px"),
                );
                let spec = RenditionSpec {
                    max_edge: self.edge,
                };
                if ui
                    .add_enabled(c.source.is_some(), egui::Button::new("Current artwork"))
                    .clicked()
                {
                    self.start(c.runtime.start_image_job(
                        c.source.unwrap(),
                        ImageJobRequest::Artwork { spec },
                        &CancelFlag::default(),
                    ));
                }
                if ui.button("Artwork from media…").clicked() {
                    if let Some(path) = rfd::FileDialog::new().pick_file() {
                        self.start(ImageJob::from_path(
                            &path,
                            ImageJobRequest::Artwork { spec },
                            &CancelFlag::default(),
                        ));
                    }
                }
                if ui.button("Open image…").clicked() {
                    if let Some(path) = rfd::FileDialog::new()
                        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
                        .pick_file()
                    {
                        self.start(ImageJob::from_path(
                            &path,
                            ImageJobRequest::Image { spec },
                            &CancelFlag::default(),
                        ));
                    }
                }
                if ui.button("Close preview").clicked() {
                    self.close();
                }
                ui.label(&self.status);
            });
            if let Some(texture) = &self.texture {
                ui.add(egui::Image::new(texture).max_size(egui::vec2(384., 384.)));
            }
        });
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_rendition_uploads_one_texture_and_close_releases_it_without_transport_changes() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../.local/libzci/media/m3/artwork.opus");
        let c = Controller::new();
        let before = c.snapshot();
        let mut view = ArtworkView::default();
        view.start(ImageJob::from_path(
            &path,
            ImageJobRequest::Artwork {
                spec: RenditionSpec { max_edge: 64 },
            },
            &CancelFlag::default(),
        ));
        let ctx = egui::Context::default();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut uploads = vec![];
        while view.job.is_some() {
            let frame = ctx.run(Default::default(), |ctx| view.tick(ctx));
            uploads.extend(frame.textures_delta.set.into_iter().map(|(id, _)| id));
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        let texture = view.texture.as_ref().expect(&view.status);
        assert_eq!(texture.size(), [64, 64]);
        let id = texture.id();
        assert!(uploads.contains(&id));
        let after = c.snapshot();
        assert_eq!(before.generation, after.generation);
        assert_eq!(before.revision, after.revision);
        assert_eq!(before.state, after.state);
        view.close();
        assert!(view.texture.is_none());
        let frame = ctx.run(Default::default(), |_| {});
        assert!(frame.textures_delta.free.contains(&id));
    }
}
