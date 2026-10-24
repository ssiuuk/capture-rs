# capture-rs

A screen capture tool for Windows, written in Rust with a [Tauri 2](https://tauri.app) UI.

> Early work in progress.

## Features

- **Capture toolbox**: pick a capture mode, choose whether to save and/or copy, set a delay, and press Capture.
- **Region, window or full screen.** With *Ask each time* (the default) a chooser appears after clicking Capture: Region (R), Window (W), Full screen (F), or All screens (A) on multi-monitor setups.
- **Region selection** on a frozen copy of the screen. Drag an area, or click to take the window under the cursor. Arrow keys nudge the selection, Shift+arrows resize it, Enter or double-click captures, Esc or right-click starts over.
- **Magnifier** that follows the cursor at 8x zoom, with a crosshair on the exact pixel, its screen position and its colour as hex.
- **Configurable global hotkeys** for capture, region, window, full screen, repeat last capture and show toolbox. Conflicts and keys already taken by Windows are flagged.
- **Tray icon.** Closing the toolbox hides it to the tray.
- Captures are saved as PNG, JPEG, BMP or TIFF to `Pictures\capture-rs` (or a folder you choose) and/or copied to the clipboard.
- **Image editor** that opens after each capture with the new capture selected (turn off with *Open in editor*). Tools: Move, Arrow, Line, Text, Callout, Shape (rectangle, rounded, ellipse), Stamp, Step numbers, Blur/Pixelate, Magnify, Pen, Highlighter, Eraser, Fill, Selection (move, copy, delete or blur part of the image) and Crop. A properties panel sets colour, thickness, fonts, shadows and so on for the selected object or tool. Undo/redo, zoom, Copy, Save (overwrites the capture's file), Save as, and paste or drop images onto it.
- **Recent captures** along the bottom of the editor. The last 100 captures are kept with their annotations, which stay editable; the original capture is never changed.
- **Preferences** window (toolbox link or tray menu): start with Windows, save folder and format, theme, magnifier and crosshair options, and hotkeys.

Planned: cursor capture, scrolling capture, video recording.

### Default hotkeys

| Action | Hotkey |
| --- | --- |
| Capture (toolbox settings) | Print Screen |
| Capture region | Shift+Print Screen |
| Capture window | Alt+Print Screen |
| Capture full screen | Ctrl+Print Screen |
| Repeat last capture | Ctrl+Shift+Print Screen |

On Windows 11, Print Screen opens Snipping Tool by default. Turn off **Settings > Accessibility > Keyboard > Use the Print screen key to open screen capture**, or pick other hotkeys in Preferences > Hotkeys.

## Download

Each [GitHub release](https://github.com/ssiuuk/capture-rs/releases) has a setup installer and a portable .exe, built by the Release workflow when the release is published. See the [code signing policy](#code-signing-policy).

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
| `crates/capture-core` | Platform-independent logic: geometry, desktop snapshot compositing and cropping, settings, hotkey parsing, the recent-captures library layout. Tested on any OS. |
| `app` | The Tauri app: tray, global hotkeys, screen grabbing (via `xcap`), overlay windows, saving and clipboard, the capture library and the editor's save/copy commands. |
| `ui` | Web pages for the toolbox, the capture overlay, the countdown, Preferences and the editor (`editor.js` for the window, `editor-draw.js` for drawing the annotations). |

Recent captures live in `%LOCALAPPDATA%\io.github.ssiuuk.capture-rs\library`: `<id>.png` is the capture as taken, `<id>.doc.json` holds its annotations, plus a thumbnail and a small metadata file.

### Editor shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S / Ctrl+Shift+S | Save / save as |
| Ctrl+C | Copy the selection, or the whole image |
| Ctrl+Shift+C | Copy the whole image |
| Ctrl+V | Paste an image as an object |
| Ctrl+D | Duplicate the selected object |
| Delete | Delete the selected object or selected area |
| Arrow keys | Nudge the selected object (Shift: 10 px) |
| Enter | Apply the crop, or edit the selected text |
| Esc | Cancel crop, clear the selection |
| Ctrl+0 / Ctrl+1 | Zoom to fit / 100% |
| Ctrl+wheel, Space+drag | Zoom, pan |
| Shift while drawing | Straight lines at 45° steps, squares and circles |

`node --test ui/tests/*.test.mjs` (Node 22) runs the tests for the editor's text wrapping and autosave queue.

On Linux or macOS, `cargo test -p capture-core` runs the core tests, and `cargo check -p capture-rs --target x86_64-pc-windows-gnu` type-checks the Windows app.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Only the setup installer and portable .exe that the Release workflow builds from this repository's source are signed, and each release is approved by hand before it is signed.

Team roles:

- Committers and reviewers: [ssiuuk](https://github.com/ssiuuk)
- Approvers: [ssiuuk](https://github.com/ssiuuk)

Privacy policy: this program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
