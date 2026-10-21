//! OS-specific screen grabbing. Only Windows is implemented; other
//! platforms compile but report an error, which keeps `cargo check` usable
//! everywhere.

use capture_core::desktop::DesktopSnapshot;

#[cfg(windows)]
pub fn grab_desktop() -> Result<DesktopSnapshot, String> {
    use capture_core::desktop::{MonitorInfo, WindowInfo};
    use capture_core::geom::Rect;

    let err = |what: &str, e: xcap::XCapError| format!("{what}: {e}");

    let mut captures = Vec::new();
    for m in xcap::Monitor::all().map_err(|e| err("Could not list monitors", e))? {
        let info = MonitorInfo {
            name: m.friendly_name().or_else(|_| m.name()).unwrap_or_default(),
            bounds: Rect::new(
                m.x().map_err(|e| err("Monitor position", e))?,
                m.y().map_err(|e| err("Monitor position", e))?,
                m.width().map_err(|e| err("Monitor size", e))?,
                m.height().map_err(|e| err("Monitor size", e))?,
            ),
            scale_factor: m.scale_factor().unwrap_or(1.0),
            is_primary: m.is_primary().unwrap_or(false),
        };
        let image = m
            .capture_image()
            .map_err(|e| err("Could not capture the screen", e))?;
        captures.push((info, image));
    }

    // Window list is front-most first. Our own windows are hidden while
    // capturing, but skip them anyway in case one is still fading out.
    let own_pid = std::process::id();
    let windows = xcap::Window::all()
        .map(|all| {
            all.into_iter()
                .filter(|w| w.pid().map_or(true, |p| p != own_pid))
                .filter(|w| !w.is_minimized().unwrap_or(true))
                .filter_map(|w| {
                    let bounds =
                        Rect::new(w.x().ok()?, w.y().ok()?, w.width().ok()?, w.height().ok()?);
                    (!bounds.is_empty()).then(|| WindowInfo {
                        title: w.title().unwrap_or_default(),
                        app_name: w.app_name().unwrap_or_default(),
                        bounds,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(DesktopSnapshot::compose(captures, windows))
}

#[cfg(not(windows))]
pub fn grab_desktop() -> Result<DesktopSnapshot, String> {
    Err("Screen capture is only implemented on Windows so far.".into())
}

#[cfg(windows)]
pub fn copy_image_to_clipboard(image: &image::RgbaImage) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: image.width() as usize,
            height: image.height() as usize,
            bytes: std::borrow::Cow::Borrowed(image.as_raw()),
        })
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn copy_image_to_clipboard(_image: &image::RgbaImage) -> Result<(), String> {
    Err("Clipboard copy is only implemented on Windows so far.".into())
}

/// Whether Windows is set to open Snipping Tool on Print Screen, which
/// takes the key before any app hotkey sees it.
#[cfg(windows)]
pub fn print_screen_opens_snipping_tool() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("reg")
        .args([
            "query",
            r"HKCU\Control Panel\Keyboard",
            "/v",
            "PrintScreenKeyForSnippingEnabled",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match out {
        // On Windows 11 the setting defaults to on when the value is absent.
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).contains("0x1"),
        _ => true,
    }
}

#[cfg(not(windows))]
pub fn print_screen_opens_snipping_tool() -> bool {
    false
}

pub fn open_in_file_manager(path: &std::path::Path) -> Result<(), String> {
    let program = if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(program)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn open_url(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", "", url]).creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}
