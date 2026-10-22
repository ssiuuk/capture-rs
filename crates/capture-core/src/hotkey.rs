//! Global hotkey actions and accelerator strings.
//!
//! Accelerators are stored in a canonical, human-readable form such as
//! `Ctrl+Shift+R` or `PrintScreen`. The key names match what the
//! `global-hotkey` crate (used by `tauri-plugin-global-shortcut`) parses.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

/// Something a global hotkey can trigger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyAction {
    /// Capture using the mode selected in the toolbox.
    Capture,
    CaptureRegion,
    CaptureWindow,
    CaptureFullScreen,
    /// Capture the same region as last time, without the overlay.
    RepeatLast,
    ShowToolbox,
}

impl HotkeyAction {
    pub const ALL: [HotkeyAction; 6] = [
        HotkeyAction::Capture,
        HotkeyAction::CaptureRegion,
        HotkeyAction::CaptureWindow,
        HotkeyAction::CaptureFullScreen,
        HotkeyAction::RepeatLast,
        HotkeyAction::ShowToolbox,
    ];

    pub fn label(self) -> &'static str {
        match self {
            HotkeyAction::Capture => "Capture (toolbox settings)",
            HotkeyAction::CaptureRegion => "Capture region",
            HotkeyAction::CaptureWindow => "Capture window",
            HotkeyAction::CaptureFullScreen => "Capture full screen",
            HotkeyAction::RepeatLast => "Repeat last capture",
            HotkeyAction::ShowToolbox => "Show toolbox",
        }
    }

    pub fn default_accelerator(self) -> Option<&'static str> {
        match self {
            HotkeyAction::Capture => Some("PrintScreen"),
            HotkeyAction::CaptureRegion => Some("Shift+PrintScreen"),
            HotkeyAction::CaptureWindow => Some("Alt+PrintScreen"),
            HotkeyAction::CaptureFullScreen => Some("Ctrl+PrintScreen"),
            HotkeyAction::RepeatLast => Some("Ctrl+Shift+PrintScreen"),
            HotkeyAction::ShowToolbox => None,
        }
    }
}

/// Assigned accelerator per action. A missing entry means "no hotkey".
pub type HotkeyMap = BTreeMap<HotkeyAction, String>;

pub fn default_hotkeys() -> HotkeyMap {
    HotkeyAction::ALL
        .iter()
        .filter_map(|a| a.default_accelerator().map(|k| (*a, k.to_string())))
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeyError {
    Empty,
    UnknownKey(String),
    NoKey,
    TooManyKeys,
    /// Plain letters, digits and similar keys would block normal typing.
    NeedsModifier(String),
}

impl fmt::Display for HotkeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HotkeyError::Empty => write!(f, "no keys given"),
            HotkeyError::UnknownKey(k) => write!(f, "\"{k}\" is not a supported key"),
            HotkeyError::NoKey => write!(f, "add a key after the modifiers"),
            HotkeyError::TooManyKeys => write!(f, "use only one non-modifier key"),
            HotkeyError::NeedsModifier(k) => {
                write!(
                    f,
                    "\"{k}\" needs Ctrl, Alt, Shift or Win, or it would block typing"
                )
            }
        }
    }
}

impl std::error::Error for HotkeyError {}

const MODIFIERS: [&str; 4] = ["Ctrl", "Alt", "Shift", "Super"];

/// Keys that may be used without any modifier.
fn allowed_alone(key: &str) -> bool {
    matches!(key, "PrintScreen" | "Pause" | "ScrollLock" | "Insert")
        || (key.starts_with('F') && key.len() > 1 && key[1..].chars().all(|c| c.is_ascii_digit()))
}

fn modifier(token: &str) -> Option<&'static str> {
    match token.to_ascii_lowercase().as_str() {
        "ctrl" | "control" | "cmdorctrl" | "commandorcontrol" => Some("Ctrl"),
        "alt" | "option" => Some("Alt"),
        "shift" => Some("Shift"),
        "super" | "win" | "windows" | "meta" | "cmd" | "command" => Some("Super"),
        _ => None,
    }
}

/// Maps a key token, either a browser `KeyboardEvent.code` ("KeyR",
/// "Digit4", "ArrowUp") or a short name ("r", "4", "up"), to its canonical
/// name.
fn key_name(token: &str) -> Option<String> {
    let t = token.trim();
    let bare = t
        .strip_prefix("Key")
        .or_else(|| t.strip_prefix("Digit"))
        .filter(|rest| rest.len() == 1)
        .unwrap_or(t);
    if bare.len() == 1 {
        let c = bare.chars().next()?;
        if c.is_ascii_alphanumeric() {
            return Some(c.to_ascii_uppercase().to_string());
        }
    }
    let upper = bare.to_ascii_uppercase();
    if let Some(n) = upper.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()) {
        return (1..=24).contains(&n).then(|| format!("F{n}"));
    }
    if let Some(n) = upper
        .strip_prefix("NUMPAD")
        .and_then(|n| n.parse::<u8>().ok())
        .filter(|n| *n <= 9)
    {
        return Some(format!("Numpad{n}"));
    }
    const NAMED: [&str; 34] = [
        "PrintScreen",
        "Pause",
        "ScrollLock",
        "Insert",
        "Delete",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
        "Tab",
        "Enter",
        "Backspace",
        "Backquote",
        "Minus",
        "Equal",
        "BracketLeft",
        "BracketRight",
        "Backslash",
        "Semicolon",
        "Quote",
        "Comma",
        "Period",
        "Slash",
        "NumpadAdd",
        "NumpadSubtract",
        "NumpadMultiply",
        "NumpadDivide",
        "NumpadDecimal",
        "NumpadEnter",
    ];
    let alias = match upper.as_str() {
        "PRTSC" | "PRINT" | "SNAPSHOT" => "PRINTSCREEN",
        "UP" => "ARROWUP",
        "DOWN" => "ARROWDOWN",
        "LEFT" => "ARROWLEFT",
        "RIGHT" => "ARROWRIGHT",
        "DEL" => "DELETE",
        "INS" => "INSERT",
        other => other,
    };
    NAMED
        .iter()
        .find(|n| n.eq_ignore_ascii_case(alias))
        .map(|n| n.to_string())
}

/// Every key `normalize` accepts, in canonical spelling and in the order a
/// key picker should list them.
pub fn supported_keys() -> Vec<String> {
    let mut keys: Vec<String> = [
        "PrintScreen",
        "Pause",
        "ScrollLock",
        "Insert",
        "Delete",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "Space",
        "Tab",
        "Enter",
        "Backspace",
    ]
    .iter()
    .map(|k| k.to_string())
    .collect();
    keys.extend((1..=24).map(|n| format!("F{n}")));
    keys.extend(('A'..='Z').chain('0'..='9').map(String::from));
    keys.extend(
        [
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Backquote",
            "Minus",
            "Equal",
            "BracketLeft",
            "BracketRight",
            "Backslash",
            "Semicolon",
            "Quote",
            "Comma",
            "Period",
            "Slash",
        ]
        .iter()
        .map(|k| k.to_string()),
    );
    keys.extend((0..=9).map(|n| format!("Numpad{n}")));
    keys.extend(
        [
            "NumpadAdd",
            "NumpadSubtract",
            "NumpadMultiply",
            "NumpadDivide",
            "NumpadDecimal",
            "NumpadEnter",
        ]
        .iter()
        .map(|k| k.to_string()),
    );
    keys
}

/// Parses an accelerator in any accepted spelling and returns it in
/// canonical form: modifiers in the order Ctrl, Alt, Shift, Super, then
/// the key, joined by `+`.
pub fn normalize(accelerator: &str) -> Result<String, HotkeyError> {
    let tokens: Vec<&str> = accelerator
        .split('+')
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        return Err(HotkeyError::Empty);
    }
    let mut mods = [false; 4];
    let mut key = None;
    for token in tokens {
        if let Some(m) = modifier(token) {
            mods[MODIFIERS.iter().position(|x| *x == m).unwrap()] = true;
        } else if key.is_some() {
            return Err(HotkeyError::TooManyKeys);
        } else {
            key = Some(key_name(token).ok_or_else(|| HotkeyError::UnknownKey(token.to_string()))?);
        }
    }
    let key = key.ok_or(HotkeyError::NoKey)?;
    let has_mod = mods.iter().any(|m| *m);
    if !has_mod && !allowed_alone(&key) {
        return Err(HotkeyError::NeedsModifier(key));
    }
    let mut parts: Vec<&str> = MODIFIERS
        .iter()
        .zip(mods)
        .filter(|(_, on)| *on)
        .map(|(m, _)| *m)
        .collect();
    parts.push(&key);
    Ok(parts.join("+"))
}

/// Pairs of actions that were given the same accelerator.
pub fn conflicts(map: &HotkeyMap) -> Vec<(HotkeyAction, HotkeyAction, String)> {
    let mut seen: BTreeMap<String, HotkeyAction> = BTreeMap::new();
    let mut out = Vec::new();
    for (action, accel) in map {
        let key = normalize(accel).unwrap_or_else(|_| accel.clone());
        if let Some(first) = seen.get(&key) {
            out.push((*first, *action, key));
        } else {
            seen.insert(key, *action);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_browser_codes_and_aliases() {
        assert_eq!(normalize("shift+ctrl+KeyR").unwrap(), "Ctrl+Shift+R");
        assert_eq!(normalize("Win + Digit4").unwrap(), "Super+4");
        assert_eq!(normalize("PrintScreen").unwrap(), "PrintScreen");
        assert_eq!(normalize("alt+prtsc").unwrap(), "Alt+PrintScreen");
        assert_eq!(normalize("Control+up").unwrap(), "Ctrl+ArrowUp");
        assert_eq!(normalize("f13").unwrap(), "F13");
        assert_eq!(normalize("Ctrl+Numpad7").unwrap(), "Ctrl+Numpad7");
    }

    #[test]
    fn rejects_bad_accelerators() {
        assert_eq!(normalize(""), Err(HotkeyError::Empty));
        assert_eq!(normalize("Ctrl+Shift"), Err(HotkeyError::NoKey));
        assert_eq!(normalize("Ctrl+A+B"), Err(HotkeyError::TooManyKeys));
        assert_eq!(normalize("R"), Err(HotkeyError::NeedsModifier("R".into())));
        assert_eq!(normalize("F25"), Err(HotkeyError::UnknownKey("F25".into())));
        assert!(matches!(
            normalize("Ctrl+Hyper"),
            Err(HotkeyError::UnknownKey(_))
        ));
    }

    #[test]
    fn defaults_are_canonical_and_conflict_free() {
        let map = default_hotkeys();
        for accel in map.values() {
            assert_eq!(&normalize(accel).unwrap(), accel);
        }
        assert!(conflicts(&map).is_empty());
    }

    #[test]
    fn finds_conflicts_across_spellings() {
        let mut map = HotkeyMap::new();
        map.insert(HotkeyAction::CaptureRegion, "Ctrl+Shift+R".into());
        map.insert(HotkeyAction::CaptureWindow, "shift+control+KeyR".into());
        let found = conflicts(&map);
        assert_eq!(
            found,
            vec![(
                HotkeyAction::CaptureRegion,
                HotkeyAction::CaptureWindow,
                "Ctrl+Shift+R".into()
            )]
        );
    }

    #[test]
    fn every_supported_key_is_accepted_once() {
        let keys = supported_keys();
        let unique: std::collections::BTreeSet<_> = keys.iter().collect();
        assert_eq!(unique.len(), keys.len());
        for key in &keys {
            assert_eq!(
                normalize(&format!("Ctrl+{key}")).unwrap(),
                format!("Ctrl+{key}")
            );
        }
        assert!(keys.contains(&"F24".to_string()) && keys.contains(&"Minus".to_string()));
    }
}
