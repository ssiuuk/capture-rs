//! The library of recent captures the editor shows along its bottom edge.
//!
//! Each capture is kept as a few files named after its id in one folder:
//! `<id>.png` is the untouched capture, `<id>.json` its [`Entry`],
//! `<id>.thumb.png` a small preview and `<id>.doc.json` the editor's
//! annotations, so edits stay editable and never change the original.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// How many captures the library keeps; older ones are removed.
pub const MAX_ENTRIES: usize = 100;

/// Longest side of a thumbnail, in pixels.
pub const THUMB_SIZE: u32 = 320;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub width: u32,
    pub height: u32,
    /// Milliseconds since the Unix epoch.
    pub created_ms: u64,
    /// The image file this capture was last saved as, if any. Saving from
    /// the editor overwrites it.
    #[serde(default)]
    pub saved_path: Option<PathBuf>,
}

/// The files that make up one library entry.
pub enum Part {
    Image,
    Meta,
    Thumb,
    Doc,
}

impl Part {
    const ALL: [Part; 4] = [Part::Image, Part::Meta, Part::Thumb, Part::Doc];

    fn suffix(&self) -> &'static str {
        match self {
            Part::Image => ".png",
            Part::Meta => ".json",
            Part::Thumb => ".thumb.png",
            Part::Doc => ".doc.json",
        }
    }
}

/// Ids are `c` followed by the creation time in milliseconds and, when two
/// captures land in the same millisecond, `-<n>`. Anything else is
/// rejected, so an id can never name a file outside the library.
pub fn is_valid_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix('c') else {
        return false;
    };
    let (millis, n) = match rest.split_once('-') {
        Some((m, n)) => (m, Some(n)),
        None => (rest, None),
    };
    let digits = |s: &str| !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit());
    digits(millis) && n.is_none_or(digits)
}

/// A new id for a capture made at `now_ms`, unique among `taken`.
pub fn new_id(now_ms: u64, taken: impl Fn(&str) -> bool) -> String {
    let base = format!("c{now_ms:013}");
    if !taken(&base) {
        return base;
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|id| !taken(id))
        .expect("some suffix is free")
}

/// The path of one part of an entry, or `None` for an invalid id.
pub fn part_path(dir: &Path, id: &str, part: Part) -> Option<PathBuf> {
    is_valid_id(id).then(|| dir.join(format!("{id}{}", part.suffix())))
}

/// Parses a file name served to the editor (`<id>.png` or
/// `<id>.thumb.png`) into its id and part.
pub fn parse_image_name(name: &str) -> Option<(&str, Part)> {
    let (id, part) = match name.strip_suffix(Part::Thumb.suffix()) {
        Some(id) => (id, Part::Thumb),
        None => (name.strip_suffix(Part::Image.suffix())?, Part::Image),
    };
    is_valid_id(id).then_some((id, part))
}

/// Ids in `dir`, newest first.
pub fn ids(dir: &Path) -> Vec<String> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = read
        .filter_map(|e| {
            let name = e.ok()?.file_name().into_string().ok()?;
            let id = name.strip_suffix(Part::Meta.suffix())?;
            is_valid_id(id).then(|| id.to_string())
        })
        .collect();
    ids.sort_by_key(|id| std::cmp::Reverse(sort_key(id)));
    ids
}

fn sort_key(id: &str) -> (u64, u64) {
    let rest = &id[1..];
    let (millis, n) = rest.split_once('-').unwrap_or((rest, "1"));
    (millis.parse().unwrap_or(0), n.parse().unwrap_or(0))
}

/// Entries in `dir`, newest first. Unreadable entries are skipped.
pub fn list(dir: &Path) -> Vec<Entry> {
    ids(dir)
        .iter()
        .filter_map(|id| read_entry(dir, id).ok())
        .collect()
}

pub fn read_entry(dir: &Path, id: &str) -> Result<Entry, String> {
    let path = part_path(dir, id, Part::Meta).ok_or("invalid capture id")?;
    let text = std::fs::read_to_string(&path).map_err(|e| format!("capture {id}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("capture {id}: {e}"))
}

pub fn write_entry(dir: &Path, entry: &Entry) -> Result<(), String> {
    let path = part_path(dir, &entry.id, Part::Meta).ok_or("invalid capture id")?;
    let json = serde_json::to_vec_pretty(entry).map_err(|e| e.to_string())?;
    write_atomic(&path, &json)
}

/// Writes through a temporary file, so a crash mid-write cannot leave a
/// half-written file behind.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

/// Removes every file of one entry.
pub fn remove(dir: &Path, id: &str) -> Result<(), String> {
    for part in Part::ALL {
        let path = part_path(dir, id, part).ok_or("invalid capture id")?;
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Could not remove {}: {e}", path.display())),
        }
    }
    Ok(())
}

/// Removes the oldest entries so at most `keep` remain; returns the ids
/// removed.
pub fn prune(dir: &Path, keep: usize) -> Vec<String> {
    ids(dir)
        .into_iter()
        .skip(keep)
        .filter(|id| remove(dir, id).is_ok())
        .collect()
}

/// Size of a thumbnail that fits in [`THUMB_SIZE`] and keeps the aspect.
pub fn thumb_size(width: u32, height: u32) -> (u32, u32) {
    let longest = width.max(height).max(1);
    if longest <= THUMB_SIZE {
        return (width.max(1), height.max(1));
    }
    let scale =
        |v: u32| ((u64::from(v) * u64::from(THUMB_SIZE) / u64::from(longest)) as u32).max(1);
    (scale(width), scale(height))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("capture-rs-lib-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn add(dir: &Path, id: &str) {
        std::fs::write(dir.join(format!("{id}.png")), b"png").unwrap();
        std::fs::write(dir.join(format!("{id}.thumb.png")), b"png").unwrap();
        std::fs::write(dir.join(format!("{id}.doc.json")), b"{}").unwrap();
        write_entry(
            dir,
            &Entry {
                id: id.into(),
                width: 4,
                height: 3,
                created_ms: 1,
                saved_path: None,
            },
        )
        .unwrap();
    }

    #[test]
    fn ids_are_validated() {
        assert!(is_valid_id("c1761178000000"));
        assert!(is_valid_id("c1761178000000-2"));
        for bad in [
            "", "c", "c12-", "c-1", "x123", "c12/../x", "c12.png", "c1-2-3", "c１",
        ] {
            assert!(!is_valid_id(bad), "{bad}");
        }
        assert!(part_path(Path::new("lib"), "../c1", Part::Image).is_none());
    }

    #[test]
    fn new_ids_are_unique_and_valid() {
        assert_eq!(new_id(5, |_| false), "c0000000000005");
        let id = new_id(5, |id| id == "c0000000000005" || id == "c0000000000005-2");
        assert_eq!(id, "c0000000000005-3");
        assert!(is_valid_id(&id));
    }

    #[test]
    fn image_names_parse() {
        assert!(matches!(
            parse_image_name("c12.png"),
            Some(("c12", Part::Image))
        ));
        assert!(matches!(
            parse_image_name("c12-2.thumb.png"),
            Some(("c12-2", Part::Thumb))
        ));
        assert!(parse_image_name("c12.json").is_none());
        assert!(parse_image_name("../c12.png").is_none());
    }

    #[test]
    fn lists_newest_first_and_prunes_the_oldest() {
        let dir = temp_dir("list");
        for id in [
            "c0000000000010",
            "c0000000000030",
            "c0000000000020",
            "c0000000000020-2",
        ] {
            add(&dir, id);
        }
        std::fs::write(dir.join("stray.json"), b"{}").unwrap();
        assert_eq!(
            ids(&dir),
            [
                "c0000000000030",
                "c0000000000020-2",
                "c0000000000020",
                "c0000000000010"
            ]
        );
        assert_eq!(list(&dir).len(), 4);
        assert_eq!(prune(&dir, 2), ["c0000000000020", "c0000000000010"]);
        assert_eq!(ids(&dir), ["c0000000000030", "c0000000000020-2"]);
        assert!(!dir.join("c0000000000010.png").exists());
        assert!(!dir.join("c0000000000010.doc.json").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn thumbnails_fit_and_keep_aspect() {
        assert_eq!(thumb_size(100, 50), (100, 50));
        assert_eq!(thumb_size(3840, 2160), (320, 180));
        assert_eq!(thumb_size(10, 6400), (1, 320));
        assert_eq!(thumb_size(0, 0), (1, 1));
    }
}
