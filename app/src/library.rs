//! The recent-captures library on disk, and the commands the editor uses
//! to read and update it. File layout is described in
//! [`capture_core::library`].

use std::path::{Path, PathBuf};

use capture_core::library::{self, Entry, Part};
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ImageEncoder, RgbaImage};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::ipc::InvokeBody;
use tauri::{AppHandle, Emitter, Manager, UriSchemeContext, UriSchemeResponder, Wry};

pub fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|d| d.join("library"))
        .map_err(|e| format!("Could not find the app data folder: {e}"))
}

fn part(app: &AppHandle, id: &str, part: Part) -> Result<PathBuf, String> {
    library::part_path(&dir(app)?, id, part).ok_or_else(|| format!("bad capture id {id}"))
}

/// PNG with fast settings: library files are written on every capture.
pub fn encode_png_fast(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut png = Vec::with_capacity(image.as_raw().len() / 4);
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::NoFilter)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| e.to_string())?;
    Ok(png)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Adds an image to the library and returns its id. The oldest captures
/// beyond [`library::MAX_ENTRIES`] are removed.
pub fn add(
    app: &AppHandle,
    image: &RgbaImage,
    saved_path: Option<PathBuf>,
) -> Result<String, String> {
    let dir = dir(app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let id = library::new_id(now_ms(), |id| {
        library::part_path(&dir, id, Part::Meta).is_some_and(|p| p.exists())
    });
    let path = |p| library::part_path(&dir, &id, p).expect("new ids are valid");

    library::write_atomic(&path(Part::Image), &encode_png_fast(image)?)?;
    let (w, h) = library::thumb_size(image.width(), image.height());
    let thumb = image::imageops::thumbnail(image, w, h);
    library::write_atomic(&path(Part::Thumb), &encode_png_fast(&thumb)?)?;
    // The entry goes last: listing only sees captures whose files exist.
    library::write_entry(
        &dir,
        &Entry {
            id: id.clone(),
            width: image.width(),
            height: image.height(),
            created_ms: now_ms(),
            saved_path,
        },
    )?;
    library::prune(&dir, library::MAX_ENTRIES);
    let _ = app.emit("library-changed", ());
    Ok(id)
}

pub fn entry(app: &AppHandle, id: &str) -> Result<Entry, String> {
    library::read_entry(&dir(app)?, id)
}

pub fn set_saved_path(app: &AppHandle, id: &str, path: &Path) -> Result<(), String> {
    let dir = dir(app)?;
    let mut entry = library::read_entry(&dir, id)?;
    entry.saved_path = Some(path.to_path_buf());
    library::write_entry(&dir, &entry)
}

#[tauri::command]
pub fn library_list(app: AppHandle) -> Result<Vec<Entry>, String> {
    Ok(library::list(&dir(&app)?))
}

/// The editor's saved annotations for a capture, or null if it has none.
#[tauri::command]
pub fn library_get_doc(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(part(&app, &id, Part::Doc)?) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn library_save_doc(
    app: AppHandle,
    id: String,
    doc: serde_json::Value,
) -> Result<(), String> {
    // Only for captures still in the library, so a late save cannot
    // recreate files for one that was just deleted.
    entry(&app, &id)?;
    let bytes = serde_json::to_vec(&doc).map_err(|e| e.to_string())?;
    library::write_atomic(&part(&app, &id, Part::Doc)?, &bytes)
}

/// Replaces a capture's thumbnail with PNG bytes sent as the request body.
#[tauri::command]
pub async fn library_save_thumb(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let id = header(&request, "x-capture-id")?;
    let bytes = png_bytes(&request)?;
    entry(&app, id)?;
    library::write_atomic(&part(&app, id, Part::Thumb)?, bytes)
}

#[tauri::command]
pub fn library_delete(app: AppHandle, id: String) -> Result<(), String> {
    library::remove(&dir(&app)?, &id)?;
    let _ = app.emit("library-changed", ());
    Ok(())
}

/// Adds image files to the library, from `paths` or, if that is `None`,
/// from a file picker. Returns the new ids in order.
#[tauri::command]
pub async fn library_import(
    app: AppHandle,
    window: tauri::WebviewWindow,
    paths: Option<Vec<PathBuf>>,
) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let paths = match paths {
        Some(p) => p,
        None => app
            .dialog()
            .file()
            .set_title("Open images")
            .set_parent(&window)
            .add_filter("Images", &["png", "jpg", "jpeg", "bmp", "tif", "tiff"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .collect(),
    };
    let mut ids = Vec::new();
    let mut problems = Vec::new();
    for path in paths {
        let name = path.display().to_string();
        match image::open(&path) {
            Ok(img) => {
                // Saving writes back to the file only if we can encode its type.
                let saved = capture_core::format::ImageFormat::from_path(&path).map(|_| path);
                ids.push(add(&app, &img.to_rgba8(), saved)?);
            }
            Err(e) => problems.push(format!("Could not open {name}: {e}")),
        }
    }
    if ids.is_empty() && !problems.is_empty() {
        return Err(problems.join(" "));
    }
    Ok(ids)
}

pub fn header<'a>(request: &'a tauri::ipc::Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("missing {name}"))
}

/// The PNG the editor sent as a raw request body.
pub fn png_bytes<'a>(request: &'a tauri::ipc::Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) if bytes.starts_with(b"\x89PNG") => Ok(bytes),
        _ => Err("expected PNG image data".into()),
    }
}

pub fn decode_png(request: &tauri::ipc::Request<'_>) -> Result<RgbaImage, String> {
    image::load_from_memory_with_format(png_bytes(request)?, image::ImageFormat::Png)
        .map(|i| i.to_rgba8())
        .map_err(|e| format!("Could not read the edited image: {e}"))
}

/// Serves `library://localhost/<id>.png` and `<id>.thumb.png` to the editor.
pub fn serve(
    ctx: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let name = request.uri().path().trim_start_matches('/').to_string();
    std::thread::spawn(move || {
        let file = library::parse_image_name(&name)
            .ok_or_else(|| "not found".to_string())
            .and_then(|(id, p)| part(&app, id, p))
            .and_then(|path| std::fs::read(path).map_err(|e| e.to_string()));
        let builder = Response::builder()
            // The editor reads pixels back from its canvas, so the image
            // must not taint it.
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "no-store");
        let response = match file {
            Ok(bytes) => builder
                .header(header::CONTENT_TYPE, "image/png")
                .body(bytes),
            Err(msg) => builder.status(StatusCode::NOT_FOUND).body(msg.into_bytes()),
        };
        responder.respond(response.expect("static response parts are valid"));
    });
}
