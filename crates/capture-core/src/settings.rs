//! User settings, stored as JSON in the app's config folder.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::format::{ImageFormat, DEFAULT_JPEG_QUALITY};
use crate::hotkey::{default_hotkeys, HotkeyMap};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureMode {
    /// Show the Region / Window / Full screen chooser on every capture.
    #[default]
    Ask,
    Region,
    Window,
    FullScreen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    /// Follow the Windows light/dark setting.
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub capture_mode: CaptureMode,
    pub copy_to_clipboard: bool,
    /// Reserved for the editor; has no effect yet.
    pub preview_in_editor: bool,
    pub capture_cursor: bool,
    /// Seconds to wait before grabbing the screen; 0 = no delay.
    pub delay_secs: u8,
    pub save_to_file: bool,
    /// Folder for saved captures; `None` = Pictures\capture-rs.
    pub save_dir: Option<PathBuf>,
    pub image_format: ImageFormat,
    /// JPEG quality, 1-100.
    pub jpeg_quality: u8,
    /// Hide the toolbox while capturing so it is not in the shot.
    pub hide_toolbox_while_capturing: bool,
    pub show_magnifier: bool,
    /// Full-screen crosshair lines while aiming a region.
    pub show_crosshairs: bool,
    /// Start hidden in the tray when launched at Windows sign-in.
    pub start_minimized: bool,
    pub theme: Theme,
    pub hotkeys: HotkeyMap,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            capture_mode: CaptureMode::Ask,
            copy_to_clipboard: true,
            preview_in_editor: false,
            capture_cursor: false,
            delay_secs: 0,
            save_to_file: true,
            save_dir: None,
            image_format: ImageFormat::Png,
            jpeg_quality: DEFAULT_JPEG_QUALITY,
            hide_toolbox_while_capturing: true,
            show_magnifier: true,
            show_crosshairs: true,
            start_minimized: true,
            theme: Theme::System,
            hotkeys: default_hotkeys(),
        }
    }
}

pub const MAX_DELAY_SECS: u8 = 10;

impl Settings {
    /// Loads settings, falling back to defaults if the file is missing or
    /// unreadable so a bad file never stops the app from starting.
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
            .map(Settings::sanitized)
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_string_pretty(self).map_err(std::io::Error::other)?;
        // Write then rename so a crash mid-write cannot corrupt the file.
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(tmp, path)
    }

    pub fn sanitized(mut self) -> Self {
        self.delay_secs = self.delay_secs.min(MAX_DELAY_SECS);
        self.jpeg_quality = self.jpeg_quality.clamp(1, 100);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hotkey::HotkeyAction;

    #[test]
    fn missing_fields_take_defaults() {
        let s: Settings =
            serde_json::from_str(r#"{"capture_mode":"window","delay_secs":99,"jpeg_quality":0}"#)
                .unwrap();
        let s = s.sanitized();
        assert_eq!(s.jpeg_quality, 1);
        assert_eq!(s.image_format, ImageFormat::Png);
        assert!(s.show_magnifier);
        assert_eq!(s.capture_mode, CaptureMode::Window);
        assert_eq!(s.delay_secs, MAX_DELAY_SECS);
        assert_eq!(
            s.hotkeys.get(&HotkeyAction::Capture).map(String::as_str),
            Some("PrintScreen")
        );
    }

    #[test]
    fn round_trips_through_disk_and_survives_garbage() {
        let dir = std::env::temp_dir().join(format!("capture-rs-test-{}", std::process::id()));
        let path = dir.join("settings.json");
        let mut s = Settings {
            copy_to_clipboard: false,
            ..Default::default()
        };
        s.hotkeys
            .insert(HotkeyAction::ShowToolbox, "Ctrl+Alt+S".into());
        s.save(&path).unwrap();
        assert_eq!(Settings::load(&path), s);
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(Settings::load(&path), Settings::default());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
