mod controller;
mod smoke;
mod queue_view;
use controller::Controller;
use eframe::egui;
use libzci::*;
use std::{path::Path, time::Duration};
struct App {
    controller: Controller,
    path: String,
    seek: f64,
    subsong: u32,
    interpolation: u32,
    ramping: i32,
    speed: f64,
    pitch: f64,
    loops: u32,
    channel: u32,
    verify_unknown: bool,
    smoke: Option<smoke::Smoke>,
}
impl Default for App {
    fn default() -> Self {
        Self {
            controller: Controller::new(),
            path: String::new(),
            seek: 0.,
            subsong: 0,
            interpolation: 4,
            ramping: -1,
            speed: 1.,
            pitch: 1.,
            loops: 0,
            channel: 0,
            verify_unknown: false,
            smoke: None,
        }
    }
}
impl App {
    fn draw(&mut self, ctx: &egui::Context) {
        let s = self.controller.snapshot();
        egui::CentralPanel::default().show(ctx,|ui| {
            ui.heading("libzci file player");
            ui.horizontal(|ui| {ui.text_edit_singleline(&mut self.path);
                if ui.button("Browse…").clicked() {if let Some(p)=rfd::FileDialog::new().pick_file() {self.path=p.display().to_string();}}
                if ui.button("Open").clicked() {self.controller.open(Path::new(&self.path));}
                if ui.button("Dispose").clicked() {self.controller.dispose();}
            });
            ui.horizontal(|ui| {
                if ui.button("Play").clicked() {self.controller.command(|session,request_id|Command::Play {session,request_id});}
                if ui.button("Pause").clicked() {self.controller.command(|session,request_id|Command::Pause {session,request_id});}
                if ui.button("Stop").clicked() {self.controller.command(|session,request_id|Command::Stop {session,request_id});}
                ui.add(egui::DragValue::new(&mut self.seek).range(0.0..=43200.0).suffix(" s"));
                if ui.button("Seek").clicked() {let time=MediaTime(self.seek);self.controller.command(|session,request_id|Command::Seek {session,request_id,time});}
                let mut volume=s.volume;if ui.add(egui::Slider::new(&mut volume,0.0..=1.0).text("Volume")).changed() {self.controller.command(|session,request_id|Command::SetVolume {session,request_id,volume});}
                let mut mute=s.mute;if ui.checkbox(&mut mute,"Mute").changed() {self.controller.command(|session,request_id|Command::SetMute {session,request_id,mute});}
            });
            ui.label(format!("Session {} / generation {}   {:?}   requested {:?} / output {:?}",s.session.0,s.generation.0,s.state,s.requested,s.running));
            queue_view::draw(ui,&mut self.controller);
            ui.label(format!("Provider: {:?}   audible {:.3} s / {:?} frames   pending {} / EOF {}",s.provider,MediaTime::from_frames(s.position_frames,s.layout.map_or(1,|l|l.sample_rate)).0,s.total_frames,s.pending_operation,s.decoding_eof));
            if let Some(o)=self.controller.output() {ui.label(format!("Decoded {} / consumed {} / queued {} / underruns {} · {}",o.decoded_position,o.consumed_frames,o.ring_fill_frames,o.hungry_pops,o.device_label));}
            let c=s.capabilities;
            ui.separator();ui.label("Module controls (unsupported controls are disabled)");
            ui.horizontal(|ui| {
                ui.add(egui::DragValue::new(&mut self.subsong).range(0..=c.subsongs.saturating_sub(1)));
                if ui.add_enabled(c.subsongs>0,egui::Button::new("Subsong")).clicked() {self.controller.module(ModuleControl::Subsong(self.subsong));}
                egui::ComboBox::from_id_salt("interpolation").selected_text(format!("{} taps",self.interpolation)).show_ui(ui,|ui|{for n in [1,2,4,8] {ui.selectable_value(&mut self.interpolation,n,format!("{n}"));}});
                if ui.add_enabled(c.interpolation,egui::Button::new("Interpolation")).clicked() {self.controller.module(ModuleControl::Interpolation(self.interpolation));}
                ui.add(egui::DragValue::new(&mut self.channel).range(0..=c.channels.saturating_sub(1)));
                if ui.add_enabled(c.channel_mute,egui::Button::new("Mute channel")).clicked() {self.controller.module(ModuleControl::ChannelMute {channel:self.channel,mute:true});}
                if ui.add_enabled(c.channel_mute,egui::Button::new("Unmute channel")).clicked() {self.controller.module(ModuleControl::ChannelMute {channel:self.channel,mute:false});}
            });
            ui.horizontal(|ui| {
                ui.add(egui::DragValue::new(&mut self.ramping).range(-1..=10));
                if ui.add_enabled(c.ramping,egui::Button::new("Ramping")).clicked() {self.controller.module(ModuleControl::Ramping(self.ramping));}
                ui.add(egui::DragValue::new(&mut self.speed).range(0.25..=4.).speed(0.05));
                if ui.add_enabled(c.speed,egui::Button::new("Speed ×")).clicked() {self.controller.module(ModuleControl::Speed(self.speed));}
                ui.add(egui::DragValue::new(&mut self.pitch).range(0.25..=4.).speed(0.05));
                if ui.add_enabled(c.pitch,egui::Button::new("Pitch ×")).clicked() {self.controller.module(ModuleControl::Pitch(self.pitch));}
                ui.add(egui::DragValue::new(&mut self.loops).range(0..=16));
                if ui.add_enabled(c.loop_limit,egui::Button::new("Repeat limit")).clicked() {self.controller.module(ModuleControl::LoopLimit(self.loops));}
            });
            if c.subsongs>0 && !c.speed {ui.label("This provider has no independent speed/pitch/ramping or repeat control; playback ends at the finite song limit.");}
            ui.horizontal(|ui| {
                ui.checkbox(&mut self.verify_unknown,"Verify unknown extensions");
                if ui.button("Independent probe").clicked() {self.controller.inspect(self.verify_unknown);}
                if ui.button("Render raw PCM…").clicked() {if let Some(p)=rfd::FileDialog::new().set_file_name("render.f32").save_file() {self.controller.render(&p);}}
                if ui.button("Cancel jobs").clicked() {self.controller.cancel_jobs();}
            });
            ui.label(&self.controller.render_status);
            egui::ScrollArea::vertical().show(ui,|ui| {
                if let Some(meta)=&s.metadata {for (key,value) in &meta.comments {ui.label(format!("{key}: {value}"));}}
                if let Some(p)=&s.module {ui.monospace(format!("Decoder order {} / pattern {} / row {}",p.order,p.pattern,p.row));
                    for (r,row) in p.cells.chunks(p.channels.max(1) as usize).enumerate() {ui.monospace(format!("{:02X} {}",p.first_row+r as u32,row.iter().map(|v|format!("{:02X?}",v)).collect::<Vec<_>>().join(" ")));}}
                if let Some(i)=&self.controller.inspection {ui.collapsing("Independent probe result",|ui|{ui.monospace(format!("{i:#?}"));});}
                if !self.controller.error.is_empty() {ui.colored_label(egui::Color32::RED,&self.controller.error);}
                if let Some(error)=s.error {ui.colored_label(egui::Color32::RED,error.to_string());}
            });
        });
        ctx.request_repaint_after(Duration::from_millis(50));
    }
}
impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.controller.tick();
        self.draw(ctx);
        if self
            .smoke
            .as_mut()
            .is_some_and(|s| s.step(&mut self.controller))
        {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
    }
}
fn main() -> eframe::Result {
    let args: Vec<String> = std::env::args().collect();
    let input = if args.get(1).is_some_and(|a| a == "--headless-test") {
        Some(
            args.get(2)
                .expect("--headless-test requires a media path")
                .clone(),
        )
    } else {
        None
    };
    let hidden = input.is_some();
    let profile_path=args.iter().position(|s|s=="--profile").map(|i|args.get(i+1).expect("--profile requires a directory").clone()).unwrap_or_else(||".local/libzci/profiles/crude-native".into());
    let persistent=if hidden {None}else{Some(Controller::with_profile(Path::new(&profile_path)).unwrap_or_else(|e|{eprintln!("{e}");std::process::exit(2)}))};
    let outcome: smoke::Outcome = Default::default();
    let observed = outcome.clone();
    eframe::run_native(
        "libzci crude",
        eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default()
                .with_inner_size([1050., 650.])
                .with_visible(!hidden),
            ..Default::default()
        },
        Box::new(move |_| {
            let mut app = App::default();
            if let Some(controller)=persistent {app.controller=controller;}
            if let Some(path) = input {
                app.path = path;
                app.controller.open(Path::new(&app.path));
                app.smoke = Some(smoke::Smoke::new(outcome));
            }
            Ok(Box::new(app))
        }),
    )?;
    if hidden {
        match observed.lock().unwrap().take() {Some(Ok(()))=>println!("passed: hidden egui window / muted native output / play / pause / seek / module control / probe / stop / dispose"),result=>{eprintln!("failed: {result:?}");std::process::exit(2);}}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn headless_egui_draw_and_public_controller_jobs() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../.local/libzci/media/m1");
        let mut app = App::default();
        app.controller.open(&root.join("tone.hvl"));
        app.controller
            .runtime
            .wait_ready(app.controller.session, &CancelFlag::default())
            .unwrap();
        let ctx = egui::Context::default();
        let frame = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1050., 650.),
                )),
                ..Default::default()
            },
            |ctx| app.draw(ctx),
        );
        assert!(!ctx
            .tessellate(frame.shapes, frame.pixels_per_point)
            .is_empty());
        let before = app.controller.snapshot();
        assert!(before.capabilities.patterns);
        app.controller.module(ModuleControl::Interpolation(2));
        app.controller
            .runtime
            .wait_ready(app.controller.session, &CancelFlag::default())
            .unwrap();
        let generation = app.controller.snapshot().generation;
        app.controller.inspect(false);
        let p = app.controller.probe.as_ref().unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(r) = p.poll() {
                assert_eq!(r.unwrap().metadata.info.id, ProviderId::HIVELY);
                break;
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::yield_now();
        }
        app.controller.render(&root.join("native-gui.f32"));
        let (_, rx) = app.controller.render.as_ref().unwrap();
        assert!(rx.recv_timeout(Duration::from_secs(3)).unwrap().unwrap() > 0);
        assert_eq!(app.controller.snapshot().generation, generation);
        app.controller.dispose();
        assert_eq!(app.controller.snapshot().state, TransportState::Idle);
    }
}
