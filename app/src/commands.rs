//! Commands the web UI calls, plus helpers for showing app windows.

use capture_core::hotkey::{default_hotkeys, normalize, HotkeyAction};
use capture_core::settings::{CaptureMode, Settings};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::capture::{self, CaptureRequest};
use crate::state::{lock, AppState};
use crate::{hotkeys, output, platform};

pub const TOOLBOX: &str = "toolbox";
const SETTINGS: &str = "settings";

/// Result of a capture, shown in the toolbox status line.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CaptureOutcome {
    pub ok: bool,
    pub path: Option<String>,
    pub copied: bool,
    pub width: u32,
    pub height: u32,
    pub message: Option<String>,
}

impl CaptureOutcome {
    pub fn failed(message: String) -> Self {
        Self {
            ok: false,
            message: Some(message),
            ..Default::default()
        }
    }
}

pub fn notify_toolbox(app: &AppHandle, outcome: CaptureOutcome) {
    let _ = app.emit_to(TOOLBOX, "capture-done", outcome);
}

pub fn show_toolbox(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(TOOLBOX) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn show_hotkey_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App("settings.html".into()))
        .title("capture-rs hotkeys")
        .inner_size(600.0, 470.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center()
        .build();
    if let Err(e) = built {
        notify_toolbox(
            app,
            CaptureOutcome::failed(format!("Could not open hotkey settings: {e}")),
        );
    }
}

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, AppState>) -> Settings {
    state.settings()
}

/// Saves toolbox options. Hotkeys are managed by `set_hotkey` and are kept
/// as they are, so the two windows cannot overwrite each other.
#[tauri::command]
pub fn update_settings(
    state: tauri::State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    let mut next = settings.sanitized();
    next.hotkeys = state.settings().hotkeys;
    state.save_settings(next.clone())?;
    Ok(next)
}

/// `mode` = None uses the toolbox's selected mode.
#[tauri::command]
pub async fn start_capture(app: AppHandle, mode: Option<CaptureMode>) {
    let mode = mode.unwrap_or_else(|| app.state::<AppState>().settings().capture_mode);
    capture::start(&app, CaptureRequest::Mode(mode));
}

#[tauri::command]
pub async fn open_hotkey_settings(app: AppHandle) {
    show_hotkey_settings(&app);
}

#[tauri::command]
pub fn open_capture_folder(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let dir = output::capture_dir(&app, &state.settings())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    platform::open_in_file_manager(&dir)
}

#[derive(Serialize)]
pub struct HotkeyRow {
    action: HotkeyAction,
    label: &'static str,
    accelerator: Option<String>,
    default: Option<&'static str>,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct HotkeyStatus {
    rows: Vec<HotkeyRow>,
    /// Print Screen is assigned but Windows sends it to Snipping Tool.
    print_screen_taken_by_windows: bool,
}

fn hotkey_status(state: &AppState) -> HotkeyStatus {
    let settings = state.settings();
    let errors = lock(&state.hotkey_errors).clone();
    let uses_print_screen = settings.hotkeys.values().any(|k| k == "PrintScreen");
    HotkeyStatus {
        rows: HotkeyAction::ALL
            .iter()
            .map(|a| HotkeyRow {
                action: *a,
                label: a.label(),
                accelerator: settings.hotkeys.get(a).cloned(),
                default: a.default_accelerator(),
                error: errors.get(a).cloned(),
            })
            .collect(),
        print_screen_taken_by_windows: uses_print_screen
            && platform::print_screen_opens_snipping_tool(),
    }
}

#[tauri::command]
pub fn get_hotkeys(state: tauri::State<'_, AppState>) -> HotkeyStatus {
    hotkey_status(&state)
}

/// Assigns (or with `None`, clears) one action's hotkey and re-registers
/// all of them. A malformed accelerator is rejected without saving.
#[tauri::command]
pub async fn set_hotkey(
    app: AppHandle,
    action: HotkeyAction,
    accelerator: Option<String>,
) -> Result<HotkeyStatus, String> {
    let state = app.state::<AppState>();
    let mut settings = state.settings();
    match accelerator {
        Some(a) => {
            let canonical = normalize(&a).map_err(|e| e.to_string())?;
            settings.hotkeys.insert(action, canonical);
        }
        None => {
            settings.hotkeys.remove(&action);
        }
    }
    state.save_settings(settings)?;
    hotkeys::apply(&app);
    let _ = app.emit("hotkeys-changed", ());
    Ok(hotkey_status(&state))
}

#[tauri::command]
pub async fn reset_hotkeys(app: AppHandle) -> Result<HotkeyStatus, String> {
    let state = app.state::<AppState>();
    let mut settings = state.settings();
    settings.hotkeys = default_hotkeys();
    state.save_settings(settings)?;
    hotkeys::apply(&app);
    let _ = app.emit("hotkeys-changed", ());
    Ok(hotkey_status(&state))
}

/// Suspends global hotkeys while the settings page records a key.
#[tauri::command]
pub async fn pause_hotkeys(app: AppHandle, paused: bool) {
    if paused {
        hotkeys::pause(&app);
    } else {
        hotkeys::apply(&app);
    }
}

#[tauri::command]
pub fn open_windows_keyboard_settings() -> Result<(), String> {
    platform::open_url("ms-settings:easeofaccess-keyboard")
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}
