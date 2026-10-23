//! The capture pipeline: freeze the desktop, show one overlay window per
//! monitor, then crop and hand the result to `output`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use capture_core::desktop::{DesktopSnapshot, MonitorInfo, WindowInfo};
use capture_core::geom::Rect;
use capture_core::settings::CaptureMode;
use serde::Serialize;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, UriSchemeContext,
    UriSchemeResponder, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry,
};

use crate::commands::{notify_toolbox, CaptureOutcome, TOOLBOX};
use crate::state::{lock, AppState, Session};
use crate::{editor, library, output, platform};

/// What the user asked to capture.
#[derive(Debug, Clone, Copy)]
pub enum CaptureRequest {
    Mode(CaptureMode),
    RepeatLast,
}

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

/// Which app windows were showing when a capture began, to bring back
/// when it ends.
#[derive(Debug, Clone, Copy)]
pub struct Restore {
    toolbox: bool,
    editor: bool,
}

/// Starts a capture on a background thread. Ignored if one is running.
///
/// Ownership of the `capturing` flag passes to the capture: it is released
/// exactly once, by [`release`], after the result is delivered, the user
/// cancels, or something fails.
pub fn start(app: &AppHandle, request: CaptureRequest) {
    let state = app.state::<AppState>();
    if state.capturing.swap(true, Ordering::SeqCst) {
        return;
    }
    let restore = Restore {
        toolbox: app
            .get_webview_window(TOOLBOX)
            .is_some_and(|w| w.is_visible().unwrap_or(false)),
        editor: editor::is_visible(app),
    };
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(message) = run(&app, request, restore) {
            close_session(&app);
            release(&app, restore);
            notify_toolbox(&app, CaptureOutcome::failed(message));
        }
    });
}

fn run(app: &AppHandle, request: CaptureRequest, restore: Restore) -> Result<(), String> {
    let state = app.state::<AppState>();
    let settings = state.settings();

    if settings.hide_toolbox_while_capturing {
        if let Some(w) = app.get_webview_window(TOOLBOX) {
            let _ = w.hide();
        }
        editor::hide(app);
        // Let the windows finish disappearing before grabbing the screen.
        std::thread::sleep(Duration::from_millis(250));
    }
    if settings.delay_secs > 0 {
        count_down(app, settings.delay_secs);
    }

    let snapshot = Arc::new(platform::grab_desktop()?);
    let cursor = app.cursor_position().ok().map(|p| (p.x as i32, p.y as i32));

    let mode = match request {
        CaptureRequest::RepeatLast => {
            // Copy the area out first: `deliver` locks `last_area` again.
            let last = *lock(&state.last_area);
            match last {
                Some(area) => return deliver(app, &snapshot, area, restore),
                // Nothing to repeat yet: fall back to choosing a region.
                None => CaptureMode::Region,
            }
        }
        CaptureRequest::Mode(mode) => mode,
    };

    if mode == CaptureMode::FullScreen {
        let (x, y) = cursor.unwrap_or((0, 0));
        let area = snapshot
            .monitor_at(x, y)
            .map(|m| m.bounds)
            .ok_or("No monitor found")?;
        return deliver(app, &snapshot, area, restore);
    }

    // Publish the session before any overlay loads, since each overlay asks
    // for it as soon as its page starts. Labels are recorded before the
    // window is built so a failure part-way still closes every overlay.
    let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    let monitors = snapshot.monitors.clone();
    *lock(&state.session) = Some(Session {
        id,
        snapshot,
        mode,
        overlay_labels: Vec::new(),
        restore,
    });
    for (index, monitor) in monitors.iter().enumerate() {
        let label = format!("overlay-{id}-{index}");
        if let Some(s) = lock(&state.session).as_mut() {
            s.overlay_labels.push(label.clone());
        }
        open_overlay(app, &label, index, monitor)?;
    }
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
        // Transparent so nothing (not even a dark background) shows before
        // the frozen screen is painted.
        .transparent(true)
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

const COUNTDOWN: &str = "countdown";
/// Size of the countdown window in logical pixels.
const COUNTDOWN_SIZE: f64 = 200.0;

/// Shows a countdown in the middle of the monitor under the cursor, waits
/// `secs` seconds, and removes it again before the screen is grabbed. The
/// countdown is cosmetic: if its window cannot be shown, the delay still runs.
fn count_down(app: &AppHandle, secs: u8) {
    let window = open_countdown(app, secs)
        .map_err(|e| log::warn!("countdown window: {e}"))
        .ok();
    for left in (1..=secs).rev() {
        let _ = app.emit_to(COUNTDOWN, "countdown-tick", left);
        std::thread::sleep(Duration::from_secs(1));
    }
    // Look the window up by label rather than trusting `window`: it may
    // exist even if setting it up failed part way.
    if let Some(w) = window.or_else(|| app.get_webview_window(COUNTDOWN)) {
        let _ = w.destroy();
        // Give the compositor a moment so the countdown is not captured.
        std::thread::sleep(Duration::from_millis(150));
    }
}

fn open_countdown(app: &AppHandle, secs: u8) -> tauri::Result<WebviewWindow> {
    let url = WebviewUrl::App(format!("countdown.html?secs={secs}").into());
    let window = WebviewWindowBuilder::new(app, COUNTDOWN, url)
        .title("capture-rs countdown")
        .inner_size(COUNTDOWN_SIZE, COUNTDOWN_SIZE)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .visible(false)
        .build()?;
    if let Err(e) = place_countdown(app, &window) {
        // Destroy it now so the fixed label is free for the next countdown.
        let _ = window.destroy();
        return Err(e);
    }
    Ok(window)
}

fn place_countdown(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let side = (COUNTDOWN_SIZE * m.scale_factor()) as i32;
        let (pos, size) = (m.position(), m.size());
        let x = pos.x + (size.width as i32 - side) / 2;
        let y = pos.y + (size.height as i32 - side) / 2;
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    // Clicks pass through to whatever is being set up for the capture.
    window.set_ignore_cursor_events(true)?;
    window.show()
}

/// Crops, saves and copies the capture, adds it to the library and opens
/// it in the editor, then releases the capture. On error nothing is
/// released; the caller does that.
fn deliver(
    app: &AppHandle,
    snapshot: &DesktopSnapshot,
    area: Rect,
    restore: Restore,
) -> Result<(), String> {
    let image = snapshot
        .crop(area)
        .ok_or("The selected area is outside the screen")?;
    let state = app.state::<AppState>();
    *lock(&state.last_area) = Some(area);
    let settings = state.settings();
    let mut outcome = output::deliver(app, &settings, &image);
    match library::add(app, &image, outcome.path.as_ref().map(PathBuf::from)) {
        Ok(id) => outcome.id = Some(id),
        Err(e) => {
            let note = format!("Could not add it to the editor's recent captures: {e}");
            outcome.message = Some(match outcome.message.take() {
                Some(m) => format!("{m} {note}"),
                None => note,
            });
        }
    }
    release(app, restore);
    if settings.open_in_editor {
        if let Some(id) = &outcome.id {
            editor::open(app, Some(id));
        }
    }
    notify_toolbox(app, outcome);
    Ok(())
}

/// Clears the session and closes its overlays. Does not end the capture.
fn close_session(app: &AppHandle) -> Option<Session> {
    let state = app.state::<AppState>();
    let session = lock(&state.session).take();
    if let Some(s) = &session {
        for label in &s.overlay_labels {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.destroy();
            }
        }
    }
    session
}

/// Ends the capture: lets a new one start and brings back the windows that
/// were showing when the capture began.
fn release(app: &AppHandle, restore: Restore) {
    app.state::<AppState>()
        .capturing
        .store(false, Ordering::SeqCst);
    if restore.toolbox {
        crate::commands::show_toolbox(app);
    }
    if restore.editor {
        editor::show(app);
    }
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
    show_magnifier: bool,
    show_crosshairs: bool,
}

#[tauri::command]
pub fn overlay_init(app: AppHandle, monitor: usize) -> Result<OverlayInit, String> {
    let state = app.state::<AppState>();
    let session = lock(&state.session);
    let s = session.as_ref().ok_or("No capture in progress")?;
    let settings = state.settings();
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
        show_magnifier: settings.show_magnifier,
        show_crosshairs: settings.show_crosshairs,
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
    let session = close_session(&app).ok_or("No capture in progress")?;
    let result = deliver(&app, &session.snapshot, area, session.restore);
    if let Err(message) = &result {
        release(&app, session.restore);
        notify_toolbox(&app, CaptureOutcome::failed(message.clone()));
    }
    result
}

#[tauri::command]
pub fn overlay_cancel(app: AppHandle) {
    // Only the call that takes the session ends the capture, so a stray
    // cancel from a closing overlay cannot release a newer capture.
    if let Some(session) = close_session(&app) {
        release(&app, session.restore);
        let _ = app.emit_to(TOOLBOX, "capture-cancelled", ());
    }
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
    library::encode_png_fast(&image)
}
