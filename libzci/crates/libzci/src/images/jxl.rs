//! The JPEG XL Project decoder behind the existing image job boundary. Keep
//! codestream orientation in facts; apply it exactly once in shared rendering.
use super::*;
use ::jxl::api::*;
use image::{ColorType, ExtendedColorType, ImageResult};
use std::io::{BufReader, Read, Seek};
pub(super) struct Decoder<R> {
    input: BufReader<R>,
    decoder: JxlDecoder,
    size: (u32, u32),
    color: ColorType,
    original: ExtendedColorType,
    orientation: image::metadata::Orientation,
}
fn error(e: impl std::fmt::Display) -> image::ImageError {
    image::ImageError::Decoding(image::error::DecodingError::new(
        image::error::ImageFormatHint::Name("JPEG XL".into()),
        e.to_string(),
    ))
}
fn codec_error(e: ::jxl::error::Error) -> image::ImageError {
    match e {
        ::jxl::error::Error::ImageOutOfMemory(..)
        | ::jxl::error::Error::ImageSizeTooLarge(..)
        | ::jxl::error::Error::ImageDimensionTooLarge(..)
        | ::jxl::error::Error::IccTooLarge => image::ImageError::Limits(
            image::error::LimitError::from_kind(image::error::LimitErrorKind::InsufficientMemory),
        ),
        _ => error(e),
    }
}
impl<R: Read + Seek> Decoder<R> {
    pub fn new(reader: R) -> ImageResult<Self> {
        let mut options = JxlDecoderOptions::default();
        options.adjust_orientation = false;
        options.alpha_mode = AlphaMode::Unpremultiplied;
        // The codec rejects >= its sample limit; our public pixel limit is inclusive.
        options.sample_limit = Some(MAX_IMAGE_PIXELS as usize * 4 + 1);
        let mut decoder = JxlDecoder::new(options);
        let mut input = BufReader::with_capacity(32768, reader);
        if decoder
            .process(&mut input, None, None)
            .map_err(codec_error)?
            != Event::BasicInfo
        {
            return Err(error("incomplete JPEG XL header"));
        }
        let info = decoder
            .basic_info()
            .ok_or_else(|| error("missing JPEG XL facts"))?
            .clone();
        let size = (
            u32::try_from(info.size.0).map_err(error)?,
            u32::try_from(info.size.1).map_err(error)?,
        );
        if dimensions(size.0, size.1).is_err() {
            return Err(image::ImageError::Limits(
                image::error::LimitError::from_kind(
                    image::error::LimitErrorKind::InsufficientMemory,
                ),
            ));
        }
        let format = decoder
            .current_pixel_format()
            .ok_or_else(|| error("missing JPEG XL pixel format"))?;
        let gray = format.color_type.is_grayscale();
        let alpha = info
            .extra_channels
            .iter()
            .any(|c| c.ec_type == ExtraChannel::Alpha);
        if info
            .extra_channels
            .iter()
            .any(|c| c.ec_type == ExtraChannel::Black)
        {
            return Err(image::ImageError::Unsupported(
                image::error::UnsupportedError::from_format_and_kind(
                    image::error::ImageFormatHint::Name("JPEG XL".into()),
                    image::error::UnsupportedErrorKind::GenericFeature("CMYK JPEG XL".into()),
                ),
            ));
        }
        let (color, color_type) = match (gray, alpha) {
            (true, false) => (ColorType::L8, JxlColorType::Grayscale),
            (true, true) => (ColorType::La8, JxlColorType::GrayscaleAlpha),
            (false, false) => (ColorType::Rgb8, JxlColorType::Rgb),
            (false, true) => (ColorType::Rgba8, JxlColorType::Rgba),
        };
        let bits = match info.bit_depth {
            JxlBitDepth::Int { bits_per_sample }
            | JxlBitDepth::Float {
                bits_per_sample, ..
            } => bits_per_sample,
        };
        let total_bits = bits.saturating_mul(color.channel_count() as u32);
        if !(1..=128).contains(&total_bits) {
            return Err(error("unsupported JPEG XL sample depth"));
        }
        let original = ExtendedColorType::Unknown(total_bits as u8);
        decoder
            .set_pixel_format(JxlPixelFormat {
                color_type,
                color_data_format: Some(JxlDataFormat::U8 { bit_depth: 8 }),
                extra_channel_format: vec![None; info.extra_channels.len()],
            })
            .map_err(error)?;
        let orientation = image::metadata::Orientation::from_exif(info.orientation as u8)
            .ok_or_else(|| error("invalid JPEG XL orientation"))?;
        Ok(Self {
            input,
            decoder,
            size,
            color,
            original,
            orientation,
        })
    }
}
impl<R: Read + Seek> ImageDecoder for Decoder<R> {
    fn dimensions(&self) -> (u32, u32) {
        self.size
    }
    fn color_type(&self) -> ColorType {
        self.color
    }
    fn original_color_type(&self) -> ExtendedColorType {
        self.original
    }
    fn orientation(&mut self) -> ImageResult<image::metadata::Orientation> {
        Ok(self.orientation)
    }
    fn icc_profile(&mut self) -> ImageResult<Option<Vec<u8>>> {
        let profile = self
            .decoder
            .output_color_profile()
            .and_then(|p| p.try_as_icc())
            .ok_or_else(|| error("JPEG XL output profile unavailable"))?;
        if profile.len() > MAX_ICC_BYTES {
            return Err(image::ImageError::Limits(
                image::error::LimitError::from_kind(
                    image::error::LimitErrorKind::InsufficientMemory,
                ),
            ));
        }
        Ok(Some(profile.into_owned()))
    }
    fn read_image(mut self, buf: &mut [u8]) -> ImageResult<()> {
        if buf.len() as u64 != self.total_bytes() {
            return Err(error("invalid JPEG XL output buffer"));
        }
        let mut output = JxlOutputBuffer::new(
            buf,
            self.size.1 as usize,
            self.size.0 as usize * self.color.bytes_per_pixel() as usize,
        );
        loop {
            match self
                .decoder
                .process(
                    &mut self.input,
                    Some(std::slice::from_mut(&mut output)),
                    None,
                )
                .map_err(codec_error)?
            {
                Event::FrameHeader => (),
                Event::FrameComplete { .. } => return Ok(()),
                _ => return Err(error("incomplete JPEG XL frame")),
            }
        }
    }
    fn read_image_boxed(self: Box<Self>, buf: &mut [u8]) -> ImageResult<()> {
        (*self).read_image(buf)
    }
}
