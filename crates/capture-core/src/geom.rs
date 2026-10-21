//! Integer rectangles in physical (device) pixels.

use serde::{Deserialize, Serialize};

/// An axis-aligned rectangle. `x`/`y` may be negative because monitors left
/// of or above the primary monitor have negative virtual-desktop coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    pub const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// The rectangle spanned by two corner points, in any order. Both points
    /// are treated as inclusive pixels, so dragging from (5,5) to (5,5)
    /// selects a single pixel.
    pub fn from_corners(a: (i32, i32), b: (i32, i32)) -> Self {
        let (x0, x1) = (a.0.min(b.0), a.0.max(b.0));
        let (y0, y1) = (a.1.min(b.1), a.1.max(b.1));
        Self::new(x0, y0, (x1 - x0 + 1) as u32, (y1 - y0 + 1) as u32)
    }

    pub fn right(&self) -> i32 {
        self.x + self.width as i32
    }

    pub fn bottom(&self) -> i32 {
        self.y + self.height as i32
    }

    pub fn is_empty(&self) -> bool {
        self.width == 0 || self.height == 0
    }

    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && px < self.right() && py >= self.y && py < self.bottom()
    }

    pub fn intersect(&self, other: &Rect) -> Option<Rect> {
        let x0 = self.x.max(other.x);
        let y0 = self.y.max(other.y);
        let x1 = self.right().min(other.right());
        let y1 = self.bottom().min(other.bottom());
        (x1 > x0 && y1 > y0).then(|| Rect::new(x0, y0, (x1 - x0) as u32, (y1 - y0) as u32))
    }

    pub fn union(&self, other: &Rect) -> Rect {
        let x0 = self.x.min(other.x);
        let y0 = self.y.min(other.y);
        let x1 = self.right().max(other.right());
        let y1 = self.bottom().max(other.bottom());
        Rect::new(x0, y0, (x1 - x0) as u32, (y1 - y0) as u32)
    }

    pub fn offset(&self, dx: i32, dy: i32) -> Rect {
        Rect::new(self.x + dx, self.y + dy, self.width, self.height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_corners_normalises_drag_direction() {
        let r = Rect::from_corners((10, 20), (4, 2));
        assert_eq!(r, Rect::new(4, 2, 7, 19));
        assert_eq!(Rect::from_corners((5, 5), (5, 5)), Rect::new(5, 5, 1, 1));
    }

    #[test]
    fn intersect_and_union() {
        let a = Rect::new(0, 0, 10, 10);
        let b = Rect::new(5, -5, 10, 10);
        assert_eq!(a.intersect(&b), Some(Rect::new(5, 0, 5, 5)));
        assert_eq!(a.union(&b), Rect::new(0, -5, 15, 15));
        assert_eq!(a.intersect(&Rect::new(10, 0, 5, 5)), None);
    }

    #[test]
    fn contains_is_half_open() {
        let r = Rect::new(-10, -10, 10, 10);
        assert!(r.contains(-10, -10));
        assert!(r.contains(-1, -1));
        assert!(!r.contains(0, 0));
    }
}
