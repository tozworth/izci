use crate::controller::Controller;
use eframe::egui;
use libzci::queue::{QueueCommand, Repeat};
pub fn draw(ui: &mut egui::Ui, controller: &mut Controller) {
    let s = controller.profile.core.snapshot().clone();
    let mut command = None;
    ui.separator();
    ui.label(format!(
        "Queue · profile revision {} · restores paused",
        s.revision
    ));
    let mut settings = s.settings.clone();
    ui.horizontal(|ui| {
        if ui.button("Previous").clicked() {
            let p = controller.snapshot();
            command = Some(QueueCommand::Previous {
                position_seconds: libzci::MediaTime::from_frames(
                    p.position_frames,
                    p.layout.map_or(1, |l| l.sample_rate),
                )
                .0,
            });
        }
        if ui.button("Next").clicked() {
            command = Some(QueueCommand::Next { ended: false });
        }
        ui.checkbox(&mut settings.shuffle, "Shuffle");
        egui::ComboBox::from_id_salt("repeat")
            .selected_text(format!("Repeat {:?}", settings.repeat))
            .show_ui(ui, |ui| {
                for repeat in [Repeat::Off, Repeat::All, Repeat::One] {
                    ui.selectable_value(&mut settings.repeat, repeat, format!("{repeat:?}"));
                }
            });
        ui.label("Previous restarts after");
        ui.add(
            egui::DragValue::new(&mut settings.previous_restart_seconds)
                .range(0.0..=600.0)
                .suffix(" s"),
        );
        if ui.button("Clear up-next").clicked() {
            command = Some(QueueCommand::ClearUpNext);
        }
    });
    if settings != s.settings {
        command = Some(QueueCommand::Settings { settings });
    }
    egui::ScrollArea::vertical()
        .id_salt("queue")
        .max_height(160.)
        .show(ui, |ui| {
            for (n, item) in s.queue.items.iter().enumerate() {
                ui.horizontal(|ui| {
                    let name = s
                        .sources
                        .iter()
                        .find(|r| r.key == item.source_key)
                        .map_or("?", |r| r.display_path.as_str());
                    if ui
                        .selectable_label(
                            s.queue.current == Some(item.id),
                            format!("#{} {name}", item.id),
                        )
                        .clicked()
                    {
                        command = Some(QueueCommand::Play { id: item.id });
                    }
                    if ui.button("Up-next").clicked() {
                        command = Some(QueueCommand::UpNext { id: item.id });
                    }
                    if ui.add_enabled(n > 0, egui::Button::new("↑")).clicked() {
                        command = Some(QueueCommand::Move {
                            id: item.id,
                            index: n - 1,
                        });
                    }
                    if ui
                        .add_enabled(n + 1 < s.queue.items.len(), egui::Button::new("↓"))
                        .clicked()
                    {
                        command = Some(QueueCommand::Move {
                            id: item.id,
                            index: n + 1,
                        });
                    }
                    if ui.button("Remove").clicked() {
                        command = Some(QueueCommand::Remove { id: item.id });
                    }
                });
            }
        });
    ui.label(format!("Up-next: {:?}", s.queue.up_next));
    if let Some(command) = command {
        controller.queue_command(command);
    }
}
