//! Shared bounded still-image inspection, color conversion and renditions.
//! Image jobs are independent of music transport. Original pixels/profile bytes
//! remain transient; only bounded facts and rebuildable renditions may persist.
mod reader;
mod rendition;
use crate::{CancelFlag, LibzciError, Result, RuntimeSource};
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
pub use rendition::{ImageRendition, RenditionSpec};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{BufRead, Seek};
pub const MAX_IMAGE_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_IMAGE_PIXELS: u64 = 16 * 1024 * 1024;
pub const MAX_IMAGE_DIMENSION: u32 = 32768;
const MAX_DECODE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ICC_BYTES: usize = 1024 * 1024;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageFacts {
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub display_width: u32,
    pub display_height: u32,
    pub orientation: u8,
    pub bits_per_pixel: u16,
    pub alpha: bool,
    pub icc_bytes: usize,
    pub icc_sha256: Option<String>,
}
impl ImageFacts {
    pub fn validate(&self) -> Result<()> {
        dimensions(self.width, self.height)?;
        let rotated = matches!(self.orientation, 5..=8);
        if !(1..=8).contains(&self.orientation)
            || self.display_width != if rotated { self.height } else { self.width }
            || self.display_height != if rotated { self.width } else { self.height }
            || !(1..=128).contains(&self.bits_per_pixel)
            || !["image/png", "image/jpeg", "image/webp"].contains(&self.mime.as_str())
            || self.icc_bytes > MAX_ICC_BYTES
            || self
                .icc_sha256
                .as_ref()
                .is_some_and(|s| s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()))
            || (self.icc_bytes == 0) != self.icc_sha256.is_none()
        {
            return Err(invalid("invalid image facts"));
        }
        Ok(())
    }
}
pub(crate) fn invalid(detail: &str) -> LibzciError {
    LibzciError::InvalidArgument {
        detail: detail.into(),
    }
}
pub(crate) fn budget(detail: &str) -> LibzciError {
    LibzciError::ResourceExhausted {
        detail: detail.into(),
    }
}
fn unsupported(detail: &str) -> LibzciError {
    LibzciError::Unsupported {
        detail: detail.into(),
    }
}
fn map_error(error: image::ImageError) -> LibzciError {
    match error {
        image::ImageError::Limits(_) => budget(&error.to_string()),
        image::ImageError::Unsupported(_) => unsupported(&error.to_string()),
        _ => LibzciError::Corrupt {
            detail: format!("image: {error}"),
        },
    }
}
fn dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 {
        return Err(LibzciError::Corrupt {
            detail: "zero image dimensions".into(),
        });
    }
    if width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || width as u64 * height as u64 > MAX_IMAGE_PIXELS
    {
        return Err(budget("image dimensions exceed decode budget"));
    }
    Ok(())
}
fn format(mime: &str) -> Result<ImageFormat> {
    match mime {
        "image/png" => Ok(ImageFormat::Png),
        "image/jpeg" => Ok(ImageFormat::Jpeg),
        "image/webp" => Ok(ImageFormat::WebP),
        _ => Err(unsupported("no shared image decoder for this format")),
    }
}
fn decode_reader<R: BufRead + Seek>(
    reader: R,
    mime: &str,
    spec: Option<RenditionSpec>,
    cancel: &CancelFlag,
) -> Result<(ImageFacts, Option<ImageRendition>)> {
    cancel.check()?;
    let mut reader = ImageReader::with_format(reader, format(mime)?);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(map_error)?;
    let (width, height) = decoder.dimensions();
    dimensions(width, height)?;
    // ImageReader's allocator limit is best effort. Always check total pixel
    // storage ourselves before DynamicImage::from_decoder allocates it.
    if decoder.total_bytes() > MAX_DECODE_BYTES {
        return Err(budget("decoded image exceeds 128 MiB"));
    }
    let orientation = decoder.orientation().map_err(map_error)?;
    let icc = decoder.icc_profile().map_err(map_error)?;
    if icc.as_ref().is_some_and(|p| p.len() > MAX_ICC_BYTES) {
        return Err(budget("image ICC profile exceeds 1 MiB"));
    }
    let rotated = matches!(orientation.to_exif(), 5..=8);
    let facts = ImageFacts {
        mime: mime.into(),
        width,
        height,
        display_width: if rotated { height } else { width },
        display_height: if rotated { width } else { height },
        orientation: orientation.to_exif(),
        bits_per_pixel: decoder.original_color_type().bits_per_pixel(),
        alpha: decoder.color_type().has_alpha(),
        icc_bytes: icc.as_ref().map_or(0, Vec::len),
        icc_sha256: icc
            .as_ref()
            .filter(|p| !p.is_empty())
            .map(|p| format!("{:x}", Sha256::digest(p))),
    };
    facts.validate()?;
    cancel.check()?;
    let Some(spec) = spec else {
        return Ok((facts, None));
    };
    spec.validate()?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(map_error)?;
    cancel.check()?;
    image.apply_orientation(orientation);
    cancel.check()?;
    let pixels = rendition::srgb_pixels(image, icc.as_deref(), cancel)?;
    let result = rendition::render(facts.clone(), pixels, spec, cancel)?;
    Ok((facts, Some(result)))
}
pub fn inspect_image(source: &dyn RuntimeSource, cancel: &CancelFlag) -> Result<ImageFacts> {
    reader::with_source(source, cancel, |reader, mime| {
        decode_reader(reader, mime, None, cancel)
    })
    .map(|(facts, _)| facts)
}
pub fn render_image(
    source: &dyn RuntimeSource,
    spec: RenditionSpec,
    cancel: &CancelFlag,
) -> Result<ImageRendition> {
    spec.validate()?;
    reader::with_source(source, cancel, |reader, mime| {
        decode_reader(reader, mime, Some(spec), cancel)
    })
    .map(|(_, result)| result.unwrap())
}
pub fn render_image_bytes(
    bytes: &[u8],
    spec: RenditionSpec,
    cancel: &CancelFlag,
) -> Result<ImageRendition> {
    spec.validate()?;
    cancel.check()?;
    if bytes.len() as u64 > MAX_IMAGE_SOURCE_BYTES {
        return Err(budget("encoded image exceeds 64 MiB"));
    }
    let mime = crate::artwork::raster_mime(bytes)
        .ok_or_else(|| unsupported("unrecognized raster image"))?;
    decode_reader(std::io::Cursor::new(bytes), mime, Some(spec), cancel)
        .map(|(_, result)| result.unwrap())
}
