//! A frozen snapshot of the whole virtual desktop.
//!
//! Every monitor is grabbed once when a capture starts. The images are
//! pasted into one canvas in virtual-desktop pixel coordinates so that a
//! region, a window or a full monitor can be cut from the same frozen frame,
//! even when a window spans two monitors.

use image::{imageops, Rgba, RgbaImage};
use serde::Serialize;

use crate::geom::Rect;

/// One monitor as seen at capture time.
#[derive(Debug, Clone, Serialize)]
pub struct MonitorInfo {
    pub name: String,
    /// Position and size in physical pixels on the virtual desktop.
    pub bounds: Rect,
    /// Windows display scale (1.0 = 100 %, 1.5 = 150 %).
    pub scale_factor: f32,
    pub is_primary: bool,
}

/// A top-level window that can be picked in window mode.
#[derive(Debug, Clone, Serialize)]
pub struct WindowInfo {
    pub title: String,
    pub app_name: String,
    pub bounds: Rect,
}

pub struct DesktopSnapshot {
    pub monitors: Vec<MonitorInfo>,
    /// Top-level windows, front-most first.
    pub windows: Vec<WindowInfo>,
    /// Virtual-desktop area covered by `image`.
    pub bounds: Rect,
    pub image: RgbaImage,
}

impl DesktopSnapshot {
    /// Builds a snapshot from per-monitor images. Areas of the bounding box
    /// that no monitor covers (uneven monitor layouts) stay transparent.
    pub fn compose(captures: Vec<(MonitorInfo, RgbaImage)>, windows: Vec<WindowInfo>) -> Self {
        let bounds = captures
            .iter()
            .map(|(m, _)| m.bounds)
            .reduce(|a, b| a.union(&b))
            .unwrap_or(Rect::new(0, 0, 0, 0));
        let mut image = RgbaImage::from_pixel(bounds.width, bounds.height, Rgba([0, 0, 0, 0]));
        let mut monitors = Vec::with_capacity(captures.len());
        for (info, shot) in captures {
            let dx = (info.bounds.x - bounds.x) as i64;
            let dy = (info.bounds.y - bounds.y) as i64;
            imageops::replace(&mut image, &shot, dx, dy);
            monitors.push(info);
        }
        let windows = windows
            .into_iter()
            .filter_map(|mut w| {
                w.bounds = w.bounds.intersect(&bounds)?;
                Some(w)
            })
            .collect();
        Self {
            monitors,
            windows,
            bounds,
            image,
        }
    }

    /// Cuts `area` (virtual-desktop coordinates) out of the snapshot,
    /// clipped to the captured desktop. Returns `None` if nothing is left.
    pub fn crop(&self, area: Rect) -> Option<RgbaImage> {
        let clipped = area.intersect(&self.bounds)?;
        let local = clipped.offset(-self.bounds.x, -self.bounds.y);
        Some(
            imageops::crop_imm(
                &self.image,
                local.x as u32,
                local.y as u32,
                local.width,
                local.height,
            )
            .to_image(),
        )
    }

    /// The monitor containing a virtual-desktop point, falling back to the
    /// primary monitor (or the first one).
    pub fn monitor_at(&self, x: i32, y: i32) -> Option<&MonitorInfo> {
        self.monitors
            .iter()
            .find(|m| m.bounds.contains(x, y))
            .or_else(|| self.monitors.iter().find(|m| m.is_primary))
            .or_else(|| self.monitors.first())
    }

    /// The front-most window under a virtual-desktop point.
    pub fn window_at(&self, x: i32, y: i32) -> Option<&WindowInfo> {
        self.windows.iter().find(|w| w.bounds.contains(x, y))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(name: &str, bounds: Rect, primary: bool) -> MonitorInfo {
        MonitorInfo {
            name: name.into(),
            bounds,
            scale_factor: 1.0,
            is_primary: primary,
        }
    }

    fn solid(w: u32, h: u32, v: u8) -> RgbaImage {
        RgbaImage::from_pixel(w, h, Rgba([v, v, v, 255]))
    }

    /// Primary 4x2 at the origin, a second 2x2 monitor to its left and
    /// shifted down by one row.
    fn two_monitors() -> DesktopSnapshot {
        DesktopSnapshot::compose(
            vec![
                (
                    monitor("main", Rect::new(0, 0, 4, 2), true),
                    solid(4, 2, 100),
                ),
                (
                    monitor("left", Rect::new(-2, 1, 2, 2), false),
                    solid(2, 2, 200),
                ),
            ],
            vec![
                WindowInfo {
                    title: "front".into(),
                    app_name: "a".into(),
                    bounds: Rect::new(0, 0, 2, 2),
                },
                WindowInfo {
                    title: "back".into(),
                    app_name: "b".into(),
                    bounds: Rect::new(-5, 0, 20, 20),
                },
            ],
        )
    }

    #[test]
    fn compose_places_monitors_at_their_offsets() {
        let s = two_monitors();
        assert_eq!(s.bounds, Rect::new(-2, 0, 6, 3));
        assert_eq!(
            s.image.get_pixel(0, 0)[3],
            0,
            "uncovered corner is transparent"
        );
        assert_eq!(s.image.get_pixel(0, 1)[0], 200);
        assert_eq!(s.image.get_pixel(2, 0)[0], 100);
    }

    #[test]
    fn crop_spans_monitors_and_clips_to_desktop() {
        let s = two_monitors();
        let img = s.crop(Rect::new(-1, 1, 3, 1)).unwrap();
        assert_eq!(img.dimensions(), (3, 1));
        assert_eq!(img.get_pixel(0, 0)[0], 200);
        assert_eq!(img.get_pixel(2, 0)[0], 100);
        assert_eq!(
            s.crop(Rect::new(3, 1, 10, 10)).unwrap().dimensions(),
            (1, 2)
        );
        assert!(s.crop(Rect::new(50, 50, 5, 5)).is_none());
    }

    #[test]
    fn hit_testing() {
        let s = two_monitors();
        assert_eq!(s.window_at(1, 1).unwrap().title, "front");
        assert_eq!(s.window_at(3, 1).unwrap().title, "back");
        assert_eq!(s.windows[1].bounds, s.bounds, "window clipped to desktop");
        assert_eq!(s.monitor_at(-1, 2).unwrap().name, "left");
        assert_eq!(s.monitor_at(-100, -100).unwrap().name, "main");
    }
}
