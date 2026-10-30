//! Reference controls over shared catalog APIs. Only selection/view state and
//! adapter job wiring live here; SQL, identity and reconciliation stay in core.
use crate::controller::Controller;
use eframe::egui;
use libzci::{catalog::*, queue::QueueCommand, CancelFlag, Result};
use libzci_native::{
    scan::{NativeScanJob, ScanEvent},
    source::native_reference,
};
use std::collections::VecDeque;

#[derive(Default)]
pub struct CatalogView {
    query: CatalogQuery,
    page: Option<CatalogPage>,
    roots: Vec<ManagedRoot>,
    scan: Option<(ScanPlan, NativeScanJob)>,
    launch: VecDeque<u64>,
    initialized: bool,
    selected: Option<CatalogRow>,
    bookmarks: Vec<Bookmark>,
    marker: String,
    status: String,
    observed_revision: Option<u64>,
}
impl CatalogView {
    pub fn init(&mut self, c: &mut Controller) {
        self.initialized = true;
        let result = (|| -> Result<()> {
            self.roots = c.profile.managed_roots()?;
            self.launch = self
                .roots
                .iter()
                .filter(|r| r.config.settings.scan_on_launch)
                .map(|r| r.id)
                .collect();
            self.refresh(c)
        })();
        self.record(result);
    }
    fn record<T>(&mut self, result: Result<T>) {
        if let Err(e) = result {
            self.status = e.to_string();
        }
    }
    fn refresh(&mut self, c: &mut Controller) -> Result<()> {
        self.page = Some(c.profile.catalog_query(&self.query)?);
        self.roots = c.profile.managed_roots()?;
        self.observed_revision = Some(c.profile.core.snapshot().catalog_revision);
        if let Some(selected) = &self.selected {
            self.bookmarks = c.profile.bookmarks(selected.id, None)?;
        }
        Ok(())
    }
    fn mutate(&mut self, c: &mut Controller, command: CatalogCommand) {
        let result = c.profile.catalog_request(command, None).map(|_| ());
        self.record(result);
    }
    fn start(&mut self, c: &mut Controller, root: u64) {
        self.cancel(c);
        let result = (|| -> Result<()> {
            let plan = c.profile.begin_scan(root)?;
            let job = c.runtime.start_root_scan(&plan, &CancelFlag::default())?;
            self.status = format!("Scanning {}", plan.root.config.source.display_path);
            self.scan = Some((plan, job));
            Ok(())
        })();
        self.record(result);
    }
    fn cancel(&mut self, c: &mut Controller) {
        if let Some((plan, job)) = self.scan.take() {
            job.cancel();
            let result = c.profile.cancel_scan(&plan.token);
            self.record(result);
            self.status = "Scan cancelled; prior Library preserved".into();
        }
    }
    pub fn tick(&mut self, c: &mut Controller) {
        if !self.initialized {
            return;
        }
        if self.scan.is_none() {
            if let Some(root) = self.launch.pop_front() {
                self.start(c, root);
            }
        }
        if let Some((plan, job)) = &mut self.scan {
            let mut batch = vec![];
            let mut terminal = None;
            for _ in 0..MAX_BATCH {
                match job.poll() {
                    Some(ScanEvent::Media(media)) => batch.push(media),
                    Some(event) => {
                        terminal = Some(event);
                        break;
                    }
                    None => break,
                }
            }
            let stage = if batch.is_empty() {
                Ok(0)
            } else {
                c.profile.stage_scan(&plan.token, batch)
            };
            if let Err(e) = stage {
                self.cancel(c);
                self.status = e.to_string();
            } else if let Some(event) = terminal {
                let (plan, _) = self.scan.take().unwrap();
                match event {
                    ScanEvent::Complete(progress) => match c.profile.catalog_request(
                        CatalogCommand::FinishScan {
                            token: plan.token.clone(),
                        },
                        None,
                    ) {
                        Ok(o) => {
                            let s = o.scan.unwrap();
                            self.status = format!(
                                "Scan complete: {} media, {} added, {} removed ({} ignored)",
                                s.entries, s.added, s.removed, progress.ignored
                            );
                        }
                        Err(e) => {
                            let _ = c.profile.cancel_scan(&plan.token);
                            self.status = e.to_string();
                        }
                    },
                    ScanEvent::Failed(e) => {
                        let _ = c.profile.cancel_scan(&plan.token);
                        self.status = e.to_string();
                    }
                    ScanEvent::Media(_) => unreachable!(),
                }
            }
        }
        if self.observed_revision != Some(c.profile.core.snapshot().catalog_revision) {
            let result = self.refresh(c);
            self.record(result);
        }
    }
    pub fn draw(&mut self, ui: &mut egui::Ui, c: &mut Controller) {
        egui::CollapsingHeader::new("Library / managed folders")
            .default_open(false)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    if ui.button("Add folder…").clicked() {
                        if let Some(path) = rfd::FileDialog::new().pick_folder() {
                            let result = (|| -> Result<u64> {
                                let source = native_reference(&path)?;
                                Ok(c.profile
                                    .catalog_request(
                                        CatalogCommand::Root {
                                            root: RootInput {
                                                source,
                                                settings: ScanSettings::default(),
                                            },
                                        },
                                        None,
                                    )?
                                    .root
                                    .unwrap())
                            })();
                            match result {
                                Ok(root) => self.start(c, root),
                                Err(e) => self.status = e.to_string(),
                            }
                        }
                    }
                    if ui.button("Cancel scan").clicked() {
                        self.launch.clear();
                        self.cancel(c);
                    }
                    ui.label(&self.status);
                });
                for root in self.roots.clone() {
                    ui.horizontal(|ui| {
                        ui.label(&root.config.source.display_path);
                        if ui.button("Rescan").clicked() {
                            self.start(c, root.id);
                        }
                        if ui.button("Remove root").clicked() {
                            self.mutate(c, CatalogCommand::RemoveRoot { root: root.id });
                        }
                        let mut config = root.config.clone();
                        let changed = ui
                            .checkbox(&mut config.settings.recursive, "Recursive")
                            .changed()
                            | ui.checkbox(&mut config.settings.scan_on_launch, "At launch")
                                .changed()
                            | ui.checkbox(&mut config.settings.verify_unknown, "Verify unknown")
                                .changed()
                            | ui.add(
                                egui::DragValue::new(&mut config.settings.probe_concurrency)
                                    .range(1..=8)
                                    .prefix("Probes "),
                            )
                            .changed();
                        if changed {
                            self.mutate(c, CatalogCommand::Root { root: config });
                        }
                    });
                }
                let mut changed = false;
                ui.horizontal(|ui| {
                    changed |= ui
                        .selectable_value(
                            &mut self.query.collection,
                            Collection::Library,
                            "Library",
                        )
                        .changed();
                    changed |= ui
                        .selectable_value(
                            &mut self.query.collection,
                            Collection::Favorites,
                            "Favorites",
                        )
                        .changed();
                    changed |= ui.text_edit_singleline(&mut self.query.search).changed();
                    egui::ComboBox::from_id_salt("catalog-sort")
                        .selected_text(format!("{:?}", self.query.sort))
                        .show_ui(ui, |ui| {
                            for sort in [
                                CatalogSort::Title,
                                CatalogSort::Artist,
                                CatalogSort::Album,
                                CatalogSort::Rating,
                                CatalogSort::Path,
                            ] {
                                changed |= ui
                                    .selectable_value(
                                        &mut self.query.sort,
                                        sort,
                                        format!("{sort:?}"),
                                    )
                                    .changed();
                            }
                        });
                    changed |= ui
                        .checkbox(&mut self.query.descending, "Descending")
                        .changed();
                    if ui.button("Previous page").clicked() {
                        self.query.offset =
                            self.query.offset.saturating_sub(self.query.limit as u32);
                        changed = true;
                    }
                    if ui.button("Next page").clicked() {
                        self.query.offset =
                            self.query.offset.saturating_add(self.query.limit as u32);
                        changed = true;
                    }
                });
                if changed {
                    let result = self.refresh(c);
                    self.record(result);
                }
                if let Some(page) = self.page.clone() {
                    ui.label(format!(
                        "{} items · catalog revision {} · offset {}",
                        page.total, page.revision, self.query.offset
                    ));
                    egui::ScrollArea::vertical()
                        .id_salt("catalog-rows")
                        .max_height(180.)
                        .show(ui, |ui| {
                            for row in page.rows {
                                ui.horizontal(|ui| {
                                    if ui
                                        .selectable_label(
                                            self.selected.as_ref().is_some_and(|r| r.id == row.id),
                                            format!(
                                                "{} · {} · {}",
                                                row.metadata.title,
                                                row.metadata.artist,
                                                row.source.display_path
                                            ),
                                        )
                                        .clicked()
                                    {
                                        self.selected = Some(row.clone());
                                        self.bookmarks =
                                            c.profile.bookmarks(row.id, None).unwrap_or_default();
                                    }
                                    if row.kind != MediaKind::Image
                                        && ui.button("Append to Queue").clicked()
                                    {
                                        c.queue_command(QueueCommand::Append {
                                            sources: vec![row.source.clone()],
                                        });
                                    }
                                    let mut favorite = row.facts.favorite;
                                    if ui.checkbox(&mut favorite, "Favorite").changed() {
                                        self.mutate(
                                            c,
                                            CatalogCommand::Favorite {
                                                media: row.id,
                                                subsong: None,
                                                favorite,
                                            },
                                        );
                                    }
                                    let mut rating = row.facts.rating;
                                    if ui
                                        .add(
                                            egui::DragValue::new(&mut rating)
                                                .range(0..=10)
                                                .prefix("½★ "),
                                        )
                                        .changed()
                                    {
                                        self.mutate(
                                            c,
                                            CatalogCommand::Rate {
                                                media: row.id,
                                                subsong: None,
                                                rating,
                                            },
                                        );
                                    }
                                    if ui.button("Remove").clicked() {
                                        self.mutate(
                                            c,
                                            CatalogCommand::Remove {
                                                media: vec![row.id],
                                            },
                                        );
                                    }
                                });
                            }
                        });
                }
                if let Some(row) = self.selected.clone() {
                    ui.label(format!(
                        "Selected {} · duration {:?} · source revision {}",
                        row.metadata.title, row.metadata.duration_seconds, row.source_revision
                    ));
                    ui.horizontal(|ui| {
                        ui.text_edit_singleline(&mut self.marker);
                        let s = c.snapshot();
                        let position =
                            s.position_frames as f64 / s.layout.map_or(1, |l| l.sample_rate) as f64;
                        let current = c
                            .profile
                            .core
                            .snapshot()
                            .restore()
                            .is_some_and(|load| load.source.key == row.source.key);
                        if ui
                            .add_enabled(current, egui::Button::new("Bookmark at audible position"))
                            .clicked()
                        {
                            self.mutate(
                                c,
                                CatalogCommand::Bookmark {
                                    media: row.id,
                                    subsong: None,
                                    position_seconds: position,
                                    label: self.marker.clone(),
                                },
                            );
                        }
                        for marker in self.bookmarks.clone() {
                            if ui
                                .button(format!(
                                    "Remove {} @ {:.2}s",
                                    marker.label, marker.position_seconds
                                ))
                                .clicked()
                            {
                                self.mutate(c, CatalogCommand::RemoveBookmark { id: marker.id });
                            }
                        }
                    });
                }
            });
    }
}
