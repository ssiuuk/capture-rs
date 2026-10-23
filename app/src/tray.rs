use capture_core::hotkey::HotkeyAction;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

use crate::hotkeys::run_action;
use crate::{commands, editor};

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let menu = Menu::with_items(
        app,
        &[
            &item("capture", "Capture")?,
            &item("region", "Capture region")?,
            &item("window", "Capture window")?,
            &item("fullscreen", "Capture full screen")?,
            &PredefinedMenuItem::separator(app)?,
            &item("toolbox", "Show toolbox")?,
            &item("editor", "Open editor")?,
            &item("preferences", "Preferences...")?,
            &PredefinedMenuItem::separator(app)?,
            &item("quit", "Quit capture-rs")?,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("capture-rs")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "capture" => run_action(app, HotkeyAction::Capture),
            "region" => run_action(app, HotkeyAction::CaptureRegion),
            "window" => run_action(app, HotkeyAction::CaptureWindow),
            "fullscreen" => run_action(app, HotkeyAction::CaptureFullScreen),
            "toolbox" => commands::show_toolbox(app),
            "editor" => editor::open(app, None),
            "preferences" => commands::show_preferences(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                commands::show_toolbox(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
