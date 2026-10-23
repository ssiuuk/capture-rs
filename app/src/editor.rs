//! The image editor window and the commands it uses to copy and save the
//! edited image. The editor renders the finished image itself and sends it
//! here as PNG bytes in the request body.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::commands::{notify_toolbox, CaptureOutcome};
use crate::library::{self, decode_png, header};
use crate::state::AppState;
use crate::{output, platform};

pub const EDITOR: &str = "editor";

/// Shows the editor, creating it if needed, with capture `select` chosen.
pub fn open(app: &AppHandle, select: Option<&str>) {
    if let Some(w) = app.get_webview_window(EDITOR) {
        if let Some(id) = select {
            let _ = app.emit_to(EDITOR, "editor-select", id);
        }
        show(app);
        let _ = w.set_focus();
        return;
    }
    let url = match select {
        Some(id) => format!("editor.html?select={id}"),
        None => "editor.html".into(),
    };
    let built = WebviewWindowBuilder::new(app, EDITOR, WebviewUrl::App(url.into()))
        .title("capture-rs editor")
        .inner_size(1280.0, 820.0)
        .min_inner_size(900.0, 560.0)
        .center()
        .build();
    match built {
        Ok(w) => {
            let _ = w.set_focus();
        }
        Err(e) => notify_toolbox(
            app,
            CaptureOutcome::failed(format!("Could not open the editor: {e}")),
        ),
    }
}

/// Brings back an editor hidden during a capture.
pub fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(EDITOR) {
        let _ = w.unminimize();
        let _ = w.show();
    }
}

pub fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(EDITOR)
        .is_some_and(|w| w.is_visible().unwrap_or(false))
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(EDITOR) {
        let _ = w.hide();
    }
}

#[tauri::command]
pub async fn open_editor(app: AppHandle) {
    open(&app, None);
}

/// Copies the edited image to the clipboard.
#[tauri::command]
pub async fn editor_copy(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let image = decode_png(&request)?;
    platform::copy_image_to_clipboard(&image)
        .map_err(|e| format!("Could not copy to the clipboard: {e}"))
}

/// Saves the edited image over the file the capture was saved as, or as a
/// new file in the capture folder if it has none. Returns the path.
#[tauri::command]
pub async fn editor_save(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let id = header(&request, "x-capture-id")?;
    let image = decode_png(&request)?;
    let settings = app.state::<AppState>().settings();
    let path = match library::entry(&app, id)?.saved_path {
        Some(p) => p,
        None => output::new_file_path(&app, &settings)?,
    };
    output::write_image(&path, &settings, &image)?;
    library::set_saved_path(&app, id, &path)?;
    Ok(path.display().to_string())
}

/// Asks where to save the edited image; `None` if the user cancels.
#[tauri::command]
pub async fn editor_save_as(
    app: AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let id = header(&request, "x-capture-id")?;
    let image = decode_png(&request)?;
    let settings = app.state::<AppState>().settings();
    let entry = library::entry(&app, id)?;
    let (dir, name) = match &entry.saved_path {
        Some(p) => (
            p.parent().map(PathBuf::from),
            p.file_name().map(|n| n.to_string_lossy().into_owned()),
        ),
        None => (
            output::capture_dir(&app, &settings).ok(),
            Some(output::new_file_name(&settings)),
        ),
    };
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save image as")
        .set_parent(&window)
        .add_filter("PNG", &["png"])
        .add_filter("JPEG", &["jpg", "jpeg"])
        .add_filter("BMP", &["bmp"])
        .add_filter("TIFF", &["tif", "tiff"]);
    if let Some(dir) = dir.filter(|d| d.is_dir()) {
        dialog = dialog.set_directory(dir);
    }
    if let Some(name) = name {
        dialog = dialog.set_file_name(name);
    }
    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let mut path = picked.into_path().map_err(|e| e.to_string())?;
    if capture_core::format::ImageFormat::from_path(&path).is_none() {
        let mut with_ext = path.into_os_string();
        with_ext.push(".");
        with_ext.push(settings.image_format.extension());
        path = with_ext.into();
    }
    output::write_image(&path, &settings, &image)?;
    library::set_saved_path(&app, id, &path)?;
    Ok(Some(path.display().to_string()))
}

/// Opens the folder holding a saved file.
#[tauri::command]
pub fn reveal_file(path: PathBuf) -> Result<(), String> {
    let dir = path.parent().ok_or("no folder")?;
    platform::open_in_file_manager(dir)
}
