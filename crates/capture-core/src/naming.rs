//! File names for saved captures.

use std::path::{Path, PathBuf};

/// `capture-2026-10-21_013900.<extension>` for the given local date-time parts.
pub fn capture_file_name(
    (year, month, day): (i32, u32, u32),
    (hour, minute, second): (u32, u32, u32),
    extension: &str,
) -> String {
    format!("capture-{year:04}-{month:02}-{day:02}_{hour:02}{minute:02}{second:02}.{extension}")
}

/// Returns `dir/name`, or `dir/stem-2.ext`, `dir/stem-3.ext`, ... if taken.
pub fn unique_path(dir: &Path, name: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(name);
    if !exists(&first) {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s, format!(".{e}")),
        None => (name, String::new()),
    };
    (2..)
        .map(|n| dir.join(format!("{stem}-{n}{ext}")))
        .find(|p| !exists(p))
        .expect("unbounded range always finds a free name")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_is_sortable() {
        assert_eq!(
            capture_file_name((2026, 10, 21), (1, 39, 0), "jpg"),
            "capture-2026-10-21_013900.jpg"
        );
    }

    #[test]
    fn unique_path_adds_counter() {
        let dir = Path::new("/shots");
        let taken = [dir.join("a.png"), dir.join("a-2.png")];
        let p = unique_path(dir, "a.png", |p| taken.iter().any(|t| t == p));
        assert_eq!(p, dir.join("a-3.png"));
        assert_eq!(unique_path(dir, "b.png", |_| false), dir.join("b.png"));
    }
}
