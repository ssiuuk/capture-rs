//! Where a finished capture goes: an image file and/or the clipboard.

use std::path::PathBuf;

use capture_core::naming::{capture_file_name, unique_path};
use capture_core::settings::Settings;
use image::RgbaImage;
use tauri::{AppHandle, Manager};

use crate::commands::CaptureOutcome;
use crate::platform;

pub fn capture_dir(app: &AppHandle, settings: &Settings) -> Result<PathBuf, String> {
    match &settings.save_dir {
        Some(dir) => Ok(dir.clone()),
        None => app
            .path()
            .picture_dir()
            .map(|p| p.join("capture-rs"))
            .map_err(|e| format!("Could not find the Pictures folder: {e}")),
    }
}

pub fn deliver(app: &AppHandle, settings: &Settings, image: &RgbaImage) -> CaptureOutcome {
    let mut outcome = CaptureOutcome {
        ok: true,
        width: image.width(),
        height: image.height(),
        ..Default::default()
    };
    let mut problems = Vec::new();

    if settings.save_to_file {
        match save_file(app, settings, image) {
            Ok(path) => outcome.path = Some(path.display().to_string()),
            Err(e) => problems.push(e),
        }
    }
    if settings.copy_to_clipboard {
        match platform::copy_image_to_clipboard(image) {
            Ok(()) => outcome.copied = true,
            Err(e) => problems.push(format!("Could not copy to the clipboard: {e}")),
        }
    }
    if !problems.is_empty() {
        outcome.ok = outcome.path.is_some() || outcome.copied;
        outcome.message = Some(problems.join(" "));
    }
    outcome
}

fn save_file(app: &AppHandle, settings: &Settings, image: &RgbaImage) -> Result<PathBuf, String> {
    let dir = capture_dir(app, settings)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let format = settings.image_format;
    let bytes = format
        .encode(image, settings.jpeg_quality)
        .map_err(|e| format!("Could not encode the capture: {e}"))?;
    let now = local_now();
    let name = capture_file_name(
        (now.0, now.1, now.2),
        (now.3, now.4, now.5),
        format.extension(),
    );
    let path = unique_path(&dir, &name, |p| p.exists());
    std::fs::write(&path, bytes).map_err(|e| format!("Could not save {}: {e}", path.display()))?;
    Ok(path)
}

/// Local date and time as (year, month, day, hour, minute, second).
#[cfg(windows)]
fn local_now() -> (i32, u32, u32, u32, u32, u32) {
    #[repr(C)]
    #[derive(Default)]
    struct SystemTime {
        year: u16,
        month: u16,
        day_of_week: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        millis: u16,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetLocalTime(time: *mut SystemTime);
    }
    let mut t = SystemTime::default();
    // SAFETY: GetLocalTime only writes a SYSTEMTIME into the pointer we pass.
    unsafe { GetLocalTime(&mut t) };
    (
        t.year as i32,
        t.month as u32,
        t.day as u32,
        t.hour as u32,
        t.minute as u32,
        t.second as u32,
    )
}

/// UTC fallback for non-Windows builds, which cannot capture anyway.
#[cfg(not(windows))]
fn local_now() -> (i32, u32, u32, u32, u32, u32) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    // Civil-from-days, Howard Hinnant's algorithm.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = (yoe + era * 400 + i64::from(month <= 2)) as i32;
    (
        year,
        month,
        day,
        (rem / 3600) as u32,
        (rem % 3600 / 60) as u32,
        (rem % 60) as u32,
    )
}
