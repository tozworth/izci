use eframe::egui;
use libzci::{Normalization, ReplayGainMode, ReplayGainSettings};

pub fn draw(ui: &mut egui::Ui, settings: &mut ReplayGainSettings, effective: Normalization) {
    ui.collapsing("ReplayGain / R128", |ui| {
        ui.horizontal(|ui| {
            egui::ComboBox::from_id_salt("replay-gain-mode")
                .selected_text(format!("{:?}", settings.mode))
                .show_ui(ui, |ui| {
                    for mode in [
                        ReplayGainMode::Off,
                        ReplayGainMode::Track,
                        ReplayGainMode::Album,
                    ] {
                        ui.selectable_value(&mut settings.mode, mode, format!("{mode:?}"));
                    }
                });
            ui.checkbox(&mut settings.fallback, "Fall back to other tag");
            ui.checkbox(
                &mut settings.prevent_clipping,
                "Prevent clipping with peak tags",
            );
        });
        ui.horizontal(|ui| {
            ui.label("Tagged preamp");
            ui.add(
                egui::DragValue::new(&mut settings.preamp_db)
                    .range(-24.0..=24.0)
                    .speed(0.1)
                    .suffix(" dB"),
            );
            ui.label("Missing tags");
            ui.add(
                egui::DragValue::new(&mut settings.missing_gain_db)
                    .range(-60.0..=24.0)
                    .speed(0.1)
                    .suffix(" dB"),
            );
            ui.label("R128 target");
            ui.add(
                egui::DragValue::new(&mut settings.r128_target_lufs)
                    .range(-30.0..=-5.0)
                    .speed(0.1)
                    .suffix(" LUFS"),
            );
        });
        ui.label(format!(
            "Effective {:?}: {:.2} dB · ×{:.4}{}",
            effective.origin,
            effective.gain_db,
            effective.linear,
            if effective.clipping_limited {
                " · peak limited"
            } else {
                ""
            }
        ));
    });
}
