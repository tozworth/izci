use gtk::prelude::*;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
struct Placement {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    maximized: bool,
}

#[derive(Default)]
pub struct WindowState(Mutex<Option<Placement>>);

fn path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("window-state.json"))
}

fn decode(value: &str) -> Option<Placement> {
    let placement: Placement = serde_json::from_str(value).ok()?;
    ((240..=32768).contains(&placement.width) && (240..=32768).contains(&placement.height))
        .then_some(placement)
}

fn capture(
    saved: &mut Option<Placement>,
    normal: Placement,
    flags: gtk::gdk::WindowState,
    visible: bool,
) {
    if visible
        && !flags.intersects(
            gtk::gdk::WindowState::MAXIMIZED
                | gtk::gdk::WindowState::FULLSCREEN
                | gtk::gdk::WindowState::ICONIFIED,
        )
        && normal.width >= 240
        && normal.height >= 240
    {
        *saved = Some(normal);
    }
}

fn capture_mode(saved: &mut Option<Placement>, flags: gtk::gdk::WindowState) {
    if !flags.intersects(gtk::gdk::WindowState::FULLSCREEN | gtk::gdk::WindowState::ICONIFIED) {
        if let Some(placement) = saved.as_mut() {
            placement.maximized = flags.contains(gtk::gdk::WindowState::MAXIMIZED);
        }
    }
}

// GTK geometry is in logical desktop coordinates, independent of page zoom.
// Fit to the monitor with the most overlap, or the primary after unplugging it.
fn fit(mut placement: Placement, areas: &[[i32; 4]], primary: usize) -> Placement {
    let overlap = |area: &[i32; 4]| {
        let [x, y, width, height] = area.map(i64::from);
        let left = i64::from(placement.x).max(x);
        let top = i64::from(placement.y).max(y);
        let right = (i64::from(placement.x) + i64::from(placement.width)).min(x + width);
        let bottom = (i64::from(placement.y) + i64::from(placement.height)).min(y + height);
        (right - left).max(0) * (bottom - top).max(0)
    };
    let best = areas
        .iter()
        .enumerate()
        .max_by_key(|(_, area)| overlap(area));
    let area = match best {
        Some((_, area)) if overlap(area) > 0 => area,
        _ => match areas.get(primary) {
            Some(area) => area,
            None => return placement,
        },
    };
    let [x, y, width, height] = *area;
    placement.width = placement.width.min(width.max(240));
    placement.height = placement.height.min(height.max(240));
    placement.x = i64::from(placement.x).clamp(
        i64::from(x),
        i64::from(x) + i64::from((width - placement.width).max(0)),
    ) as i32;
    placement.y = i64::from(placement.y).clamp(
        i64::from(y),
        i64::from(y) + i64::from((height - placement.height).max(0)),
    ) as i32;
    placement
}

pub fn attach(window: &WebviewWindow) -> tauri::Result<()> {
    let gtk = window.gtk_window()?;
    let app = window.app_handle();
    if let Some(saved) = path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|value| decode(&value))
    {
        let display = gtk::prelude::WidgetExt::display(&gtk);
        let mut primary = 0;
        let areas: Vec<_> = (0..display.n_monitors())
            .filter_map(|index| display.monitor(index))
            .enumerate()
            .map(|(index, monitor)| {
                if monitor.is_primary() {
                    primary = index;
                }
                let area = monitor.workarea();
                [area.x(), area.y(), area.width(), area.height()]
            })
            .collect();
        let saved = fit(saved, &areas, primary);
        gtk.set_default_size(saved.width, saved.height);
        gtk.resize(saved.width, saved.height);
        gtk.move_(saved.x, saved.y);
        if saved.maximized {
            gtk.maximize();
        }
        *app.state::<WindowState>().0.lock().unwrap() = Some(saved);
    }
    let app = app.clone();
    gtk.connect_configure_event(move |window, _| {
        let Some(surface) = gtk::prelude::WidgetExt::window(window) else {
            return false;
        };
        // Keep the normal rectangle while maximized, minimized, hidden, or in
        // Oda/video fullscreen. Restoring must not reopen a theater-sized app.
        let (x, y) = window.position();
        let (width, height) = window.size();
        capture(
            &mut app.state::<WindowState>().0.lock().unwrap(),
            Placement {
                x,
                y,
                width,
                height,
                maximized: false,
            },
            surface.state(),
            gtk::prelude::WidgetExt::is_visible(window),
        );
        false
    });
    let app = window.app_handle().clone();
    gtk.connect_window_state_event(move |_, event| {
        capture_mode(
            &mut app.state::<WindowState>().0.lock().unwrap(),
            event.new_window_state(),
        );
        gtk::glib::Propagation::Proceed
    });
    Ok(())
}

pub fn save(app: &AppHandle) {
    let saved = *app.state::<WindowState>().0.lock().unwrap();
    let Some(saved) = saved else { return };
    let Some(path) = path(app) else { return };
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        std::fs::create_dir_all(path.parent().unwrap())?;
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec(&saved)?)?;
        std::fs::rename(temporary, path)?;
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("Could not save window placement: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fullscreen_minimized_and_hidden_windows_keep_the_last_ordinary_placement() {
        use gtk::gdk::WindowState as Flags;
        let normal = Placement {
            x: 40,
            y: 60,
            width: 1000,
            height: 700,
            maximized: false,
        };
        let expanded = Placement {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            maximized: false,
        };
        let mut saved = None;
        capture(&mut saved, normal, Flags::empty(), true);
        capture_mode(&mut saved, Flags::MAXIMIZED);
        for flags in [Flags::MAXIMIZED, Flags::FULLSCREEN, Flags::ICONIFIED] {
            capture(&mut saved, expanded, flags, true);
        }
        capture(&mut saved, expanded, Flags::empty(), false);
        capture_mode(&mut saved, Flags::FULLSCREEN);
        capture_mode(&mut saved, Flags::ICONIFIED);
        assert_eq!(
            saved,
            Some(Placement {
                maximized: true,
                ..normal
            })
        );
        capture_mode(&mut saved, Flags::empty());
        let moved = Placement {
            x: -800,
            width: 800,
            ..normal
        };
        capture(&mut saved, moved, Flags::empty(), true);
        assert_eq!(saved, Some(moved));
    }

    #[test]
    fn placement_validates_sizes_and_accepts_negative_positions() {
        let saved =
            decode(r#"{"x":-1100,"y":40,"width":1000,"height":700,"maximized":true}"#).unwrap();
        assert_eq!(saved.x, -1100);
        assert!(saved.maximized);
        for value in [
            "invalid",
            "{}",
            r#"{"x":0,"y":0,"width":10,"height":700,"maximized":false}"#,
        ] {
            assert!(decode(value).is_none());
        }
    }

    #[test]
    fn fit_keeps_negative_monitor_coordinates_and_recovers_unplugged_monitors() {
        let saved = Placement {
            x: -1100,
            y: 40,
            width: 1000,
            height: 700,
            maximized: true,
        };
        let areas = [[-1920, 0, 1920, 1040], [0, 0, 1280, 720]];
        assert_eq!(fit(saved, &areas, 1).x, -1100);
        let fitted = fit(saved, &areas[1..], 0);
        assert_eq!(
            (fitted.x, fitted.y, fitted.width, fitted.height),
            (0, 20, 1000, 700)
        );
        assert!(fitted.maximized);
        let fitted = fit(
            Placement {
                width: 2000,
                height: 2000,
                ..saved
            },
            &areas[1..],
            0,
        );
        assert_eq!(
            (fitted.x, fitted.y, fitted.width, fitted.height),
            (0, 0, 1280, 720)
        );
    }
}
