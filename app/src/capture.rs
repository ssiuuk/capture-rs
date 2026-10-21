//! The capture pipeline: freeze the desktop, show one overlay window per
//! monitor, then crop and hand the result to `output`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use capture_core::desktop::{DesktopSnapshot, MonitorInfo, WindowInfo};
use capture_core::geom::Rect;
use capture_core::settings::CaptureMode;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::ImageEncoder;
use serde::Serialize;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, UriSchemeContext,
    UriSchemeResponder, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry,
};

use crate::commands::{notify_toolbox, CaptureOutcome, TOOLBOX};
use crate::state::{lock, AppState, Session};
use crate::{output, platform};

/// What the user asked to capture.
#[derive(Debug, Clone, Copy)]
pub enum CaptureRequest {
    Mode(CaptureMode),
    RepeatLast,
}

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

/// Starts a capture on a background thread. Ignored if one is running.
pub fn start(app: &AppHandle, request: CaptureRequest) {
    let state = app.state::<AppState>();
    if state.capturing.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(message) = run(&app, request) {
            finish_session(&app);
            notify_toolbox(&app, CaptureOutcome::failed(message));
        }
    });
}

fn run(app: &AppHandle, request: CaptureRequest) -> Result<(), String> {
    let state = app.state::<AppState>();
    let settings = state.settings();

    let toolbox = app.get_webview_window(TOOLBOX);
    let toolbox_was_visible = toolbox
        .as_ref()
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    if let Some(w) = &toolbox {
        let _ = w.hide();
    }
    // Let the toolbox finish disappearing, then honour the delay setting.
    std::thread::sleep(
        Duration::from_millis(250) + Duration::from_secs(settings.delay_secs.into()),
    );

    let snapshot = Arc::new(platform::grab_desktop()?);
    let cursor = app.cursor_position().ok().map(|p| (p.x as i32, p.y as i32));

    let mode = match request {
        CaptureRequest::RepeatLast => match *lock(&state.last_area) {
            Some(area) => {
                return deliver(app, &snapshot, area, toolbox_was_visible);
            }
            // Nothing to repeat yet: fall back to choosing a region.
            None => CaptureMode::Region,
        },
        CaptureRequest::Mode(mode) => mode,
    };

    if mode == CaptureMode::FullScreen {
        let (x, y) = cursor.unwrap_or((0, 0));
        let area = snapshot
            .monitor_at(x, y)
            .map(|m| m.bounds)
            .ok_or("No monitor found")?;
        return deliver(app, &snapshot, area, toolbox_was_visible);
    }

    let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    let mut labels = Vec::new();
    for (index, monitor) in snapshot.monitors.iter().enumerate() {
        let label = format!("overlay-{id}-{index}");
        open_overlay(app, &label, index, monitor)?;
        labels.push(label);
    }
    *lock(&state.session) = Some(Session {
        id,
        snapshot,
        mode,
        overlay_labels: labels,
        toolbox_was_visible,
    });
    Ok(())
}

fn open_overlay(
    app: &AppHandle,
    label: &str,
    index: usize,
    monitor: &MonitorInfo,
) -> Result<(), String> {
    let url = WebviewUrl::App(format!("overlay.html?monitor={index}").into());
    let window = WebviewWindowBuilder::new(app, label, url)
        .title("capture-rs overlay")
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .shadow(false)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| format!("Could not open the capture overlay: {e}"))?;
    // Position first so the window adopts the monitor's DPI, then size it.
    let b = monitor.bounds;
    window
        .set_position(PhysicalPosition::new(b.x, b.y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(PhysicalSize::new(b.width, b.height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Crops, saves and copies the capture, then cleans up.
fn deliver(
    app: &AppHandle,
    snapshot: &DesktopSnapshot,
    area: Rect,
    show_toolbox: bool,
) -> Result<(), String> {
    let image = snapshot
        .crop(area)
        .ok_or("The selected area is outside the screen")?;
    let state = app.state::<AppState>();
    *lock(&state.last_area) = Some(area);
    let outcome = output::deliver(app, &state.settings(), &image);
    state.capturing.store(false, Ordering::SeqCst);
    if show_toolbox {
        crate::commands::show_toolbox(app);
    }
    notify_toolbox(app, outcome);
    Ok(())
}

/// Closes every overlay and clears the session. Returns the session.
fn finish_session(app: &AppHandle) -> Option<Session> {
    let state = app.state::<AppState>();
    let session = lock(&state.session).take();
    if let Some(s) = &session {
        for label in &s.overlay_labels {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.destroy();
            }
        }
    }
    state.capturing.store(false, Ordering::SeqCst);
    session
}

#[derive(Serialize)]
pub struct OverlayInit {
    session: u64,
    monitor: MonitorInfo,
    monitor_count: usize,
    desktop: Rect,
    windows: Vec<WindowInfo>,
    mode: CaptureMode,
    /// Path to pass to `convertFileSrc(path, 'snapshot')`.
    image_path: String,
}

#[tauri::command]
pub fn overlay_init(app: AppHandle, monitor: usize) -> Result<OverlayInit, String> {
    let state = app.state::<AppState>();
    let session = lock(&state.session);
    let s = session.as_ref().ok_or("No capture in progress")?;
    let info = s
        .snapshot
        .monitors
        .get(monitor)
        .ok_or("Unknown monitor")?
        .clone();
    Ok(OverlayInit {
        session: s.id,
        monitor: info,
        monitor_count: s.snapshot.monitors.len(),
        desktop: s.snapshot.bounds,
        windows: s.snapshot.windows.clone(),
        mode: s.mode,
        image_path: format!("s{}-m{monitor}.png", s.id),
    })
}

/// Called once an overlay has drawn the frozen image; shows it and gives
/// keyboard focus to the overlay under the cursor.
#[tauri::command]
pub fn overlay_ready(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    let under_cursor = match (
        app.cursor_position(),
        window.outer_position(),
        window.outer_size(),
    ) {
        (Ok(c), Ok(p), Ok(s)) => {
            Rect::new(p.x, p.y, s.width, s.height).contains(c.x as i32, c.y as i32)
        }
        _ => false,
    };
    if under_cursor {
        let _ = window.set_focus();
    }
    Ok(())
}

/// The user picked an area (virtual-desktop pixels).
#[tauri::command]
pub async fn overlay_finish(app: AppHandle, area: Rect) -> Result<(), String> {
    let session = finish_session(&app).ok_or("No capture in progress")?;
    deliver(&app, &session.snapshot, area, session.toolbox_was_visible)
}

#[tauri::command]
pub fn overlay_cancel(app: AppHandle) {
    if let Some(session) = finish_session(&app) {
        if session.toolbox_was_visible {
            crate::commands::show_toolbox(&app);
        }
    }
    let _ = app.emit_to(TOOLBOX, "capture-cancelled", ());
}

/// Serves `snapshot://localhost/s<session>-m<monitor>.png`: the frozen image
/// of one monitor, encoded off the main thread.
pub fn serve_snapshot(
    ctx: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let path = request.uri().path().trim_start_matches('/').to_string();
    std::thread::spawn(move || {
        let response = match encode_monitor(&app, &path) {
            Ok(png) => Response::builder()
                .header(header::CONTENT_TYPE, "image/png")
                // The overlay reads pixels for the magnifier, so the image
                // must not taint its canvas.
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CACHE_CONTROL, "no-store")
                .body(png),
            Err(msg) => Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(msg.into_bytes()),
        };
        responder.respond(response.expect("static response parts are valid"));
    });
}

fn encode_monitor(app: &AppHandle, path: &str) -> Result<Vec<u8>, String> {
    let (session_id, monitor) = path
        .strip_prefix('s')
        .and_then(|p| p.strip_suffix(".png"))
        .and_then(|p| p.split_once("-m"))
        .and_then(|(s, m)| Some((s.parse::<u64>().ok()?, m.parse::<usize>().ok()?)))
        .ok_or_else(|| format!("bad snapshot path {path}"))?;
    let snapshot = {
        let state = app.state::<AppState>();
        let session = lock(&state.session);
        let s = session
            .as_ref()
            .filter(|s| s.id == session_id)
            .ok_or("capture already finished")?;
        Arc::clone(&s.snapshot)
    };
    let bounds = snapshot
        .monitors
        .get(monitor)
        .ok_or("unknown monitor")?
        .bounds;
    let image = snapshot.crop(bounds).ok_or("monitor outside desktop")?;
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
