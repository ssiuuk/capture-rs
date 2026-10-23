//! Image file formats a capture can be saved as.

use std::io::Cursor;

use image::codecs::bmp::BmpEncoder;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::codecs::tiff::TiffEncoder;
use image::{DynamicImage, ExtendedColorType, ImageEncoder, RgbaImage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageFormat {
    #[default]
    Png,
    Jpeg,
    Bmp,
    Tiff,
}

pub const DEFAULT_JPEG_QUALITY: u8 = 90;

impl ImageFormat {
    pub fn extension(self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Bmp => "bmp",
            ImageFormat::Tiff => "tif",
        }
    }

    /// The format a file name's extension asks for, ignoring case.
    pub fn from_path(path: &std::path::Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "png" => Some(ImageFormat::Png),
            "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
            "bmp" => Some(ImageFormat::Bmp),
            "tif" | "tiff" => Some(ImageFormat::Tiff),
            _ => None,
        }
    }

    /// Encodes `image` in this format. JPEG has no transparency, so its
    /// alpha channel is dropped; `jpeg_quality` (1-100) only affects JPEG.
    pub fn encode(self, image: &RgbaImage, jpeg_quality: u8) -> Result<Vec<u8>, String> {
        let (w, h) = image.dimensions();
        let mut out = Vec::with_capacity(image.as_raw().len() / 3);
        let result = match self {
            ImageFormat::Png => PngEncoder::new_with_quality(
                &mut out,
                CompressionType::Default,
                FilterType::Adaptive,
            )
            .write_image(image.as_raw(), w, h, ExtendedColorType::Rgba8),
            ImageFormat::Jpeg => {
                let rgb = DynamicImage::ImageRgba8(image.clone()).into_rgb8();
                JpegEncoder::new_with_quality(&mut out, jpeg_quality.clamp(1, 100)).write_image(
                    rgb.as_raw(),
                    w,
                    h,
                    ExtendedColorType::Rgb8,
                )
            }
            ImageFormat::Bmp => BmpEncoder::new(&mut out).write_image(
                image.as_raw(),
                w,
                h,
                ExtendedColorType::Rgba8,
            ),
            ImageFormat::Tiff => TiffEncoder::new(Cursor::new(&mut out)).write_image(
                image.as_raw(),
                w,
                h,
                ExtendedColorType::Rgba8,
            ),
        };
        result.map_err(|e| e.to_string())?;
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn every_format_round_trips_dimensions() {
        let img = RgbaImage::from_fn(7, 5, |x, y| Rgba([x as u8 * 30, y as u8 * 40, 200, 255]));
        for format in [
            ImageFormat::Png,
            ImageFormat::Jpeg,
            ImageFormat::Bmp,
            ImageFormat::Tiff,
        ] {
            let bytes = format.encode(&img, DEFAULT_JPEG_QUALITY).unwrap();
            let decoded = image::load_from_memory(&bytes).unwrap();
            assert_eq!((decoded.width(), decoded.height()), (7, 5), "{format:?}");
        }
    }

    #[test]
    fn formats_come_from_extensions() {
        use std::path::Path;
        assert_eq!(
            ImageFormat::from_path(Path::new("a/b.JPEG")),
            Some(ImageFormat::Jpeg)
        );
        assert_eq!(
            ImageFormat::from_path(Path::new("b.tif")),
            Some(ImageFormat::Tiff)
        );
        assert_eq!(ImageFormat::from_path(Path::new("b.gif")), None);
        assert_eq!(ImageFormat::from_path(Path::new("png")), None);
        for f in [
            ImageFormat::Png,
            ImageFormat::Jpeg,
            ImageFormat::Bmp,
            ImageFormat::Tiff,
        ] {
            let name = format!("x.{}", f.extension());
            assert_eq!(ImageFormat::from_path(Path::new(&name)), Some(f));
        }
    }

    #[test]
    fn lossless_formats_keep_pixels() {
        let img = RgbaImage::from_fn(3, 3, |x, y| Rgba([x as u8, y as u8, 9, 128]));
        for format in [ImageFormat::Png, ImageFormat::Bmp, ImageFormat::Tiff] {
            let bytes = format.encode(&img, 0).unwrap();
            assert_eq!(
                image::load_from_memory(&bytes).unwrap().to_rgba8(),
                img,
                "{format:?}"
            );
        }
    }
}
