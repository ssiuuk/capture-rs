// Hide the console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;
mod commands;
mod hotkeys;
mod output;
mod platform;
mod state;
mod tray;

use tauri::{Manager, WindowEvent};

use crate::state::AppState;

/// Passed by the Windows startup entry so we know we were not opened by hand.
const AUTOSTART_ARG: &str = "--autostart";

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            commands::show_toolbox(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(hotkeys::on_shortcut)
                .build(),
        )
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([AUTOSTART_ARG])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("snapshot", capture::serve_snapshot)
        .setup(|app| {
            app.manage(AppState::load(app.handle())?);
            tray::create(app.handle())?;
            hotkeys::apply(app.handle());
            let settings = app.state::<AppState>().settings();
            commands::apply_theme(app.handle(), settings.theme);
            // Launched at Windows sign-in: optionally stay in the tray.
            let at_sign_in = std::env::args().any(|a| a == AUTOSTART_ARG);
            if !(at_sign_in && settings.start_minimized) {
                commands::show_toolbox(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the toolbox hides it to the tray; Quit lives in the tray menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == commands::TOOLBOX {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::start_capture,
            commands::open_preferences,
            commands::pick_save_folder,
            commands::get_capture_folder,
            commands::get_autostart,
            commands::set_autostart,
            commands::open_capture_folder,
            commands::get_hotkeys,
            commands::set_hotkey,
            commands::reset_hotkeys,
            commands::pause_hotkeys,
            commands::open_windows_keyboard_settings,
            commands::quit,
            capture::overlay_init,
            capture::overlay_ready,
            capture::overlay_finish,
            capture::overlay_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running capture-rs");
}
