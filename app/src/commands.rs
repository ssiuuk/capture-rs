//! Commands the web UI calls, plus helpers for showing app windows.

use capture_core::hotkey::{default_hotkeys, normalize, supported_keys, HotkeyAction};
use capture_core::settings::{CaptureMode, Settings, Theme};
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

/// Applies the light/dark choice to every window, current and future.
pub fn apply_theme(app: &AppHandle, theme: Theme) {
    app.set_theme(match theme {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    });
}

pub fn show_preferences(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App("settings.html".into()))
        .title("capture-rs preferences")
        .inner_size(560.0, 600.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center()
        .build();
    if let Err(e) = built {
        notify_toolbox(
            app,
            CaptureOutcome::failed(format!("Could not open preferences: {e}")),
        );
    }
}

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, AppState>) -> Settings {
    state.settings()
}

/// Changes only the fields in `patch` (a JSON object), merged into the
/// current settings, so windows never send back stale values for fields
/// they did not touch. Hotkeys are managed by `set_hotkey`. Every window is
/// sent the result.
#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    patch: serde_json::Value,
) -> Result<Settings, String> {
    let mut previous_theme = None;
    let next = state.modify_settings(|current| {
        previous_theme = Some(current.theme);
        current.patched(&patch)
    })?;
    if previous_theme != Some(next.theme) {
        apply_theme(&app, next.theme);
    }
    let _ = app.emit("settings-changed", &next);
    Ok(next)
}

/// Shows a folder picker for the save location; `None` if cancelled.
#[tauri::command]
pub async fn pick_save_folder(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let current = output::capture_dir(&app, &app.state::<AppState>().settings())?;
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save captures to")
        .set_parent(&window);
    if current.is_dir() {
        dialog = dialog.set_directory(&current);
    }
    match dialog.blocking_pick_folder() {
        Some(path) => path
            .into_path()
            .map(|p| Some(p.display().to_string()))
            .map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

/// The folder captures are saved to, after applying the default.
#[tauri::command]
pub fn get_capture_folder(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    output::capture_dir(&app, &state.settings()).map(|p| p.display().to_string())
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Adds or removes capture-rs from the programs Windows runs at sign-in.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|e| format!("Could not change the Windows startup setting: {e}"))?;
    launcher.is_enabled().map_err(|e| e.to_string())
}

/// `mode` = None uses the toolbox's selected mode.
#[tauri::command]
pub async fn start_capture(app: AppHandle, mode: Option<CaptureMode>) {
    let mode = mode.unwrap_or_else(|| app.state::<AppState>().settings().capture_mode);
    capture::start(&app, CaptureRequest::Mode(mode));
}

#[tauri::command]
pub async fn open_preferences(app: AppHandle) {
    show_preferences(&app);
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
    /// Every key the picker can offer, in display order.
    keys: Vec<String>,
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
        keys: supported_keys(),
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
    let canonical = accelerator
        .map(|a| normalize(&a).map_err(|e| e.to_string()))
        .transpose()?;
    state.modify_settings(|current| {
        let mut next = current.clone();
        match canonical {
            Some(a) => next.hotkeys.insert(action, a),
            None => next.hotkeys.remove(&action),
        };
        Ok(next)
    })?;
    hotkeys::apply(&app);
    let _ = app.emit("hotkeys-changed", ());
    Ok(hotkey_status(&state))
}

#[tauri::command]
pub async fn reset_hotkeys(app: AppHandle) -> Result<HotkeyStatus, String> {
    let state = app.state::<AppState>();
    state.modify_settings(|current| {
        Ok(Settings {
            hotkeys: default_hotkeys(),
            ..current.clone()
        })
    })?;
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
