//! Registers the user's configured global hotkeys with the OS.

use std::collections::BTreeMap;
use std::str::FromStr;

use capture_core::hotkey::{conflicts, HotkeyAction};
use capture_core::settings::CaptureMode;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use crate::capture::{self, CaptureRequest};
use crate::state::{lock, AppState};

/// Re-registers every configured hotkey, recording per-action errors
/// (unknown key, duplicate, or taken by Windows or another app).
pub fn apply(app: &AppHandle) {
    let state = app.state::<AppState>();
    let settings = state.settings();
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    // Build the maps locally: registering hops to the main thread, which may
    // be waiting on these locks inside `on_shortcut`.
    let mut actions = BTreeMap::new();
    let mut errors = BTreeMap::new();

    for (first, second, accel) in conflicts(&settings.hotkeys) {
        errors.insert(
            second,
            format!("{accel} is already used for \"{}\"", first.label()),
        );
    }
    for (action, accel) in &settings.hotkeys {
        if errors.contains_key(action) {
            continue;
        }
        let result = Shortcut::from_str(accel)
            .map_err(|e| format!("{accel} is not a valid shortcut: {e}"))
            .and_then(|shortcut| {
                gs.register(shortcut)
                    .map(|()| shortcut)
                    .map_err(|_| format!("{accel} is taken by Windows or another app"))
            });
        match result {
            Ok(shortcut) => {
                actions.insert(shortcut.id(), *action);
            }
            Err(e) => {
                errors.insert(*action, e);
            }
        }
    }
    *lock(&state.shortcut_actions) = actions;
    *lock(&state.hotkey_errors) = errors;
}

/// Unregisters everything, e.g. while the user records a new hotkey so
/// pressing it does not start a capture.
pub fn pause(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}

pub fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let state = app.state::<AppState>();
    let action = lock(&state.shortcut_actions).get(&shortcut.id()).copied();
    if let Some(action) = action {
        run_action(app, action);
    }
}

pub fn run_action(app: &AppHandle, action: HotkeyAction) {
    let mode = |m| capture::start(app, CaptureRequest::Mode(m));
    match action {
        HotkeyAction::Capture => {
            let m = app.state::<AppState>().settings().capture_mode;
            mode(m)
        }
        HotkeyAction::CaptureRegion => mode(CaptureMode::Region),
        HotkeyAction::CaptureWindow => mode(CaptureMode::Window),
        HotkeyAction::CaptureFullScreen => mode(CaptureMode::FullScreen),
        HotkeyAction::RepeatLast => capture::start(app, CaptureRequest::RepeatLast),
        HotkeyAction::ShowToolbox => crate::commands::show_toolbox(app),
    }
}
