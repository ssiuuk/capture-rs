# capture-rs

A screen capture tool for Windows, written in Rust with a [Tauri 2](https://tauri.app) UI.

> Early work in progress. The capture toolbox comes first; the annotation editor is planned next.

## Features

- **Capture toolbox**: pick a capture mode, choose whether to save and/or copy, set a delay, and press Capture.
- **Region, window or full screen.** With *Ask each time* (the default) a chooser appears after clicking Capture: Region (R), Window (W), Full screen (F), or All screens (A) on multi-monitor setups.
- **Region selection** on a frozen copy of the screen. Drag an area, or click to take the window under the cursor. Arrow keys nudge the selection, Shift+arrows resize it, Enter or double-click captures, Esc or right-click starts over.
- **Magnifier** that follows the cursor at 8x zoom, with a crosshair on the exact pixel, its screen position and its colour as hex.
- **Configurable global hotkeys** for capture, region, window, full screen, repeat last capture and show toolbox. Conflicts and keys already taken by Windows are flagged.
- **Tray icon.** Closing the toolbox hides it to the tray.
- Captures are saved as PNG to `Pictures\capture-rs` and/or copied to the clipboard.

Planned: annotation editor (arrows, shapes, text, blur, crop), cursor capture, scrolling capture, video recording.

### Default hotkeys

| Action | Hotkey |
| --- | --- |
| Capture (toolbox settings) | Print Screen |
| Capture region | Shift+Print Screen |
| Capture window | Alt+Print Screen |
| Capture full screen | Ctrl+Print Screen |
| Repeat last capture | Ctrl+Shift+Print Screen |

On Windows 11, Print Screen opens Snipping Tool by default. Turn off **Settings > Accessibility > Keyboard > Use the Print screen key to open screen capture**, or pick other hotkeys in the Hotkeys window.

## Building

Requirements: Windows 10 1903 or later, the Rust stable toolchain (MSVC), and the WebView2 runtime (preinstalled on Windows 11).

```powershell
cargo run -p capture-rs              # debug build
cargo build --release -p capture-rs  # target\release\capture-rs.exe
cd app; npx @tauri-apps/cli@2 build  # NSIS installer
```

The UI is plain HTML/CSS/JS in `ui/`, so no Node build step is needed to run the app.

## Layout

| Path | What it holds |
| --- | --- |
| `crates/capture-core` | Platform-independent logic: geometry, desktop snapshot compositing and cropping, settings, hotkey parsing. Tested on any OS. |
| `app` | The Tauri app: tray, global hotkeys, screen grabbing (via `xcap`), overlay windows, saving and clipboard. |
| `ui` | Web pages for the toolbox, the capture overlay and the hotkey settings. |

On Linux or macOS, `cargo test -p capture-core` runs the core tests, and `cargo check -p capture-rs --target x86_64-pc-windows-gnu` type-checks the Windows app.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
