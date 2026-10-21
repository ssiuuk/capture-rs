//! Platform-independent core of capture-rs.
//!
//! Nothing in this crate touches Windows APIs, so it builds and is tested on
//! any platform. The Tauri app in `app/` wires it to the OS.

pub mod desktop;
pub mod geom;
pub mod hotkey;
pub mod naming;
pub mod settings;
