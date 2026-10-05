use gtk::prelude::*;
use tauri::{Manager, WebviewWindow};

pub async fn pick_paths(
    window: WebviewWindow,
    folder: bool,
) -> Result<Option<Vec<String>>, String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let app = window.app_handle().clone();
    app.run_on_main_thread(move || {
        let owner = match window.gtk_window() {
            Ok(owner) => owner,
            Err(error) => {
                let _ = sender.try_send(Err(error.to_string()));
                return;
            }
        };
        let dialog = gtk::FileChooserNative::new(
            Some(if folder { "Open folder" } else { "Open files" }),
            Some(&owner),
            if folder {
                gtk::FileChooserAction::SelectFolder
            } else {
                gtk::FileChooserAction::Open
            },
            Some("Open"),
            Some("Cancel"),
        );
        dialog.set_select_multiple(!folder);
        dialog.set_modal(true);
        dialog.connect_response(move |dialog, response| {
            let result = if response == gtk::ResponseType::Accept {
                dialog
                    .filenames()
                    .iter()
                    .map(|path| crate::native_filesystem::canonical_path(path, folder))
                    .collect::<Result<Vec<_>, _>>()
                    .map(Some)
            } else {
                Ok(None)
            };
            let _ = sender.try_send(result);
            dialog.destroy();
        });
        dialog.show();
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("The file picker was interrupted")?
}
