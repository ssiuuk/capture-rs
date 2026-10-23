use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard};

use capture_core::desktop::DesktopSnapshot;
use capture_core::geom::Rect;
use capture_core::hotkey::HotkeyAction;
use capture_core::settings::{CaptureMode, Settings};
use tauri::{AppHandle, Manager};

/// A capture in progress: the frozen desktop the overlays are showing.
pub struct Session {
    pub id: u64,
    pub snapshot: Arc<DesktopSnapshot>,
    pub mode: CaptureMode,
    pub overlay_labels: Vec<String>,
    pub restore: crate::capture::Restore,
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub session: Mutex<Option<Session>>,
    /// Set while a capture runs, so a second hotkey press is ignored.
    pub capturing: AtomicBool,
    pub last_area: Mutex<Option<Rect>>,
    /// Registered shortcut id -> action.
    pub shortcut_actions: Mutex<BTreeMap<u32, HotkeyAction>>,
    /// Why a configured hotkey could not be registered, per action.
    pub hotkey_errors: Mutex<BTreeMap<HotkeyAction, String>>,
}

impl AppState {
    pub fn load(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let settings_path = app.path().app_config_dir()?.join("settings.json");
        Ok(Self {
            settings: Mutex::new(Settings::load(&settings_path)),
            settings_path,
            session: Mutex::new(None),
            capturing: AtomicBool::new(false),
            last_area: Mutex::new(None),
            shortcut_actions: Mutex::new(BTreeMap::new()),
            hotkey_errors: Mutex::new(BTreeMap::new()),
        })
    }

    pub fn settings(&self) -> Settings {
        lock(&self.settings).clone()
    }

    /// Changes the settings and writes them to disk. The lock is held
    /// throughout, so concurrent changes from different windows apply one
    /// after another and none is lost.
    pub fn modify_settings(
        &self,
        change: impl FnOnce(&Settings) -> Result<Settings, String>,
    ) -> Result<Settings, String> {
        let mut current = lock(&self.settings);
        let next = change(&current)?;
        next.save(&self.settings_path)
            .map_err(|e| format!("Could not save settings: {e}"))?;
        *current = next.clone();
        Ok(next)
    }
}

/// Locks a mutex, recovering the data if another thread panicked with it held.
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
