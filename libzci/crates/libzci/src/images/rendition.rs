use super::*;
use image::{ImageEncoder, RgbaImage};
use moxcms::{ColorProfile, DataColorSpace, Layout};
use std::io::{self, Write};
pub const MAX_RENDITION_BYTES: usize = 8 * 1024 * 1024;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenditionSpec {
    pub max_edge: u32,
}
impl Default for RenditionSpec {
    fn default() -> Self {
        Self { max_edge: 512 }
    }
}
impl RenditionSpec {
    pub fn validate(self) -> Result<()> {
        if !(1..=2048).contains(&self.max_edge) {
            Err(invalid("rendition edge must be 1..2048"))
        } else {
            Ok(())
        }
    }
}
#[derive(Clone, Debug)]
pub struct ImageRendition {
    pub source: ImageFacts,
    pub width: u32,
    pub height: u32,
    pub png: Vec<u8>,
    /// Oriented sRGB RGBA8 for native surface upload. Transient; cache only PNG.
    pub rgba: Vec<u8>,
}
pub(super) fn srgb_pixels(
    image: DynamicImage,
    icc: Option<&[u8]>,
    cancel: &CancelFlag,
) -> Result<RgbaImage> {
    let Some(icc) = icc.filter(|p| !p.is_empty()) else {
        return Ok(image.into_rgba8());
    };
    let profile = ColorProfile::new_from_slice(icc).map_err(|e| LibzciError::Corrupt {
        detail: format!("ICC profile: {e}"),
    })?;
    let (width, height) = (image.width(), image.height());
    let (layout, pixels) = match profile.color_space {
        DataColorSpace::Rgb => (Layout::Rgba, image.into_rgba8().into_raw()),
        DataColorSpace::Gray => (Layout::GrayAlpha, image.into_luma_alpha8().into_raw()),
        _ => {
            return Err(unsupported(
                "image rendition requires an RGB or grayscale ICC profile",
            ))
        }
    };
    let transform = profile
        .create_transform_8bit(
            layout,
            &ColorProfile::new_srgb(),
            Layout::Rgba,
            Default::default(),
        )
        .map_err(|e| unsupported(&format!("ICC transform: {e}")))?;
    let channels = if layout == Layout::Rgba { 4 } else { 2 };
    let mut out = RgbaImage::new(width, height);
    for (input, output) in pixels
        .chunks_exact(width as usize * channels)
        .zip(out.as_mut().chunks_exact_mut(width as usize * 4))
    {
        cancel.check()?;
        transform
            .transform(input, output)
            .map_err(|e| LibzciError::Corrupt {
                detail: format!("ICC pixels: {e}"),
            })?;
    }
    Ok(out)
}
struct BoundedPng {
    bytes: Vec<u8>,
    full: bool,
}
impl Write for BoundedPng {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        if data.len() > MAX_RENDITION_BYTES.saturating_sub(self.bytes.len()) {
            self.full = true;
            return Err(io::Error::other("rendition exceeds 8 MiB"));
        }
        self.bytes.extend(data);
        Ok(data.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
pub(super) fn render(
    source: ImageFacts,
    mut pixels: RgbaImage,
    spec: RenditionSpec,
    cancel: &CancelFlag,
) -> Result<ImageRendition> {
    let (width, height) = (pixels.width(), pixels.height());
    let edge = width.max(height);
    if edge > spec.max_edge {
        // Interpolate premultiplied color so invisible RGB cannot create halos.
        for row in pixels.as_mut().chunks_exact_mut(width as usize * 4) {
            cancel.check()?;
            for p in row.chunks_exact_mut(4) {
                for c in 0..3 {
                    p[c] = ((p[c] as u16 * p[3] as u16 + 127) / 255) as u8;
                }
            }
        }
        let w =
            ((width as u64 * spec.max_edge as u64 + edge as u64 / 2) / edge as u64).max(1) as u32;
        let h =
            ((height as u64 * spec.max_edge as u64 + edge as u64 / 2) / edge as u64).max(1) as u32;
        pixels = image::imageops::resize(&pixels, w, h, image::imageops::FilterType::Triangle);
        for row in pixels.as_mut().chunks_exact_mut(w as usize * 4) {
            cancel.check()?;
            for p in row.chunks_exact_mut(4) {
                for c in 0..3 {
                    p[c] = if p[3] == 0 {
                        0
                    } else {
                        ((p[c] as u32 * 255 + p[3] as u32 / 2) / p[3] as u32).min(255) as u8
                    };
                }
            }
        }
    }
    cancel.check()?;
    let (width, height) = (pixels.width(), pixels.height());
    let mut output = BoundedPng {
        bytes: vec![],
        full: false,
    };
    let result = image::codecs::png::PngEncoder::new_with_quality(
        &mut output,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Adaptive,
    )
    .write_image(
        pixels.as_raw(),
        width,
        height,
        image::ExtendedColorType::Rgba8,
    );
    if output.full {
        return Err(budget("encoded rendition exceeds 8 MiB"));
    }
    result.map_err(map_error)?;
    cancel.check()?;
    Ok(ImageRendition {
        source,
        width,
        height,
        png: output.bytes,
        rgba: pixels.into_raw(),
    })
}
