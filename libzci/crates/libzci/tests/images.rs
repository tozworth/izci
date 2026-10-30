use image::ImageEncoder;
use libzci::{images::*, *};
use std::sync::atomic::{AtomicUsize, Ordering};
fn exif(orientation: u8) -> Vec<u8> {
    let mut bytes = b"II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
    bytes.extend([orientation, 0, 0, 0, 0, 0, 0, 0]);
    bytes
}
fn png(pixels: &[u8], width: u32, height: u32, orientation: u8, icc: Option<Vec<u8>>) -> Vec<u8> {
    let mut bytes = vec![];
    let mut encoder = image::codecs::png::PngEncoder::new(&mut bytes);
    encoder.set_exif_metadata(exif(orientation)).unwrap();
    if let Some(icc) = icc {
        encoder.set_icc_profile(icc).unwrap();
    }
    encoder
        .write_image(pixels, width, height, image::ExtendedColorType::Rgba8)
        .unwrap();
    bytes
}
#[test]
fn all_exif_orientations_are_applied_once_and_removed_from_renditions() {
    let pixels = (1u8..=6)
        .flat_map(|n| [n * 30, 0, 0, 255])
        .collect::<Vec<_>>();
    let expected = [
        vec![1, 2, 3, 4, 5, 6],
        vec![2, 1, 4, 3, 6, 5],
        vec![6, 5, 4, 3, 2, 1],
        vec![5, 6, 3, 4, 1, 2],
        vec![1, 3, 5, 2, 4, 6],
        vec![5, 3, 1, 6, 4, 2],
        vec![6, 4, 2, 5, 3, 1],
        vec![2, 4, 6, 1, 3, 5],
    ];
    for orientation in 1..=8 {
        let bytes = png(&pixels, 2, 3, orientation, None);
        let source = MemSource::new(bytes.clone());
        let facts = inspect_image(&source, &CancelFlag::default()).unwrap();
        assert_eq!(facts.orientation, orientation);
        assert_eq!((facts.width, facts.height), (2, 3));
        assert_eq!(
            (facts.display_width, facts.display_height),
            if orientation <= 4 { (2, 3) } else { (3, 2) }
        );
        let rendition = render_image(
            &source,
            RenditionSpec { max_edge: 8 },
            &CancelFlag::default(),
        )
        .unwrap();
        let output = image::load_from_memory(&rendition.png)
            .unwrap()
            .into_rgba8();
        assert_eq!(
            (output.width(), output.height()),
            (facts.display_width, facts.display_height)
        );
        assert_eq!(
            output
                .as_raw()
                .chunks_exact(4)
                .map(|p| p[0] / 30)
                .collect::<Vec<_>>(),
            expected[orientation as usize - 1]
        );
        let final_facts =
            inspect_image(&MemSource::new(rendition.png), &CancelFlag::default()).unwrap();
        assert_eq!(final_facts.orientation, 1);
        assert_eq!(
            render_image_bytes(
                &bytes,
                RenditionSpec { max_edge: 8 },
                &CancelFlag::default()
            )
            .unwrap()
            .source,
            facts
        );
    }
}
#[test]
fn scaling_preserves_aspect_alpha_and_premultiplied_edges_without_upscaling() {
    let bytes = png(&[255, 0, 0, 255, 0, 0, 255, 0], 2, 1, 1, None);
    let rendition = render_image_bytes(
        &bytes,
        RenditionSpec { max_edge: 1 },
        &CancelFlag::default(),
    )
    .unwrap();
    assert_eq!((rendition.width, rendition.height), (1, 1));
    let output = image::load_from_memory(&rendition.png)
        .unwrap()
        .into_rgba8();
    let p = output.get_pixel(0, 0).0;
    assert!(
        p[0] >= 250 && p[2] == 0 && p[3] > 100 && p[3] < 160,
        "transparent blue must not bleed: {p:?}"
    );
    let bytes = png(&vec![220; 7 * 3 * 4], 7, 3, 1, None);
    let output = render_image_bytes(
        &bytes,
        RenditionSpec { max_edge: 5 },
        &CancelFlag::default(),
    )
    .unwrap();
    assert_eq!((output.width, output.height), (5, 2));
    assert!(render_image_bytes(
        &bytes,
        RenditionSpec { max_edge: 0 },
        &CancelFlag::default()
    )
    .is_err());
    assert!(render_image_bytes(
        &bytes,
        RenditionSpec { max_edge: 2049 },
        &CancelFlag::default()
    )
    .is_err());
}
#[test]
fn icc_is_converted_to_srgb_and_only_bounded_profile_facts_escape() {
    let profile = moxcms::ColorProfile::new_srgb().encode().unwrap();
    let pixels = vec![128, 50, 180, 117];
    let bytes = png(&pixels, 1, 1, 1, Some(profile.clone()));
    let rendition = render_image_bytes(&bytes, Default::default(), &CancelFlag::default()).unwrap();
    assert_eq!(rendition.source.icc_bytes, profile.len());
    assert_eq!(rendition.source.icc_sha256.as_ref().unwrap().len(), 64);
    let output = image::load_from_memory(&rendition.png)
        .unwrap()
        .into_rgba8();
    for (actual, expected) in output.as_raw().iter().zip(pixels) {
        assert!((*actual as i32 - expected as i32).abs() <= 1);
    }
    assert_eq!(
        inspect_image(&MemSource::new(rendition.png), &CancelFlag::default())
            .unwrap()
            .icc_bytes,
        0
    );
    let bytes = png(
        &[100, 100, 100, 255],
        1,
        1,
        1,
        Some(b"invalid ICC".to_vec()),
    );
    assert_eq!(
        render_image_bytes(&bytes, Default::default(), &CancelFlag::default())
            .unwrap_err()
            .kind(),
        "corrupt"
    );
}
#[derive(Debug)]
struct Source {
    inner: MemSource,
    read: AtomicUsize,
    deny: bool,
    len: Option<u64>,
}
impl RuntimeSource for Source {
    fn id(&self) -> SourceId {
        self.inner.id()
    }
    fn revision(&self) -> u64 {
        1
    }
    fn caps(&self) -> SourceCaps {
        SourceCaps::seekable_stream(self.len)
    }
    fn read_at(&self, offset: u64, buffer: &mut [u8], cancel: &CancelFlag) -> Result<usize> {
        assert!(buffer.len() <= 32768);
        self.read.fetch_add(1, Ordering::Relaxed);
        if self.deny && buffer.len() > 32 {
            return Err(LibzciError::AccessRequired {
                detail: "test image grant revoked".into(),
            });
        }
        let count = buffer.len().min(17);
        self.inner.read_at(offset, &mut buffer[..count], cancel)
    }
}
#[test]
fn ranged_sources_preserve_access_cancellation_and_reject_input_budgets_before_reads() {
    let bytes = png(&[5, 6, 7, 255], 1, 1, 1, None);
    let source = Source {
        len: Some(bytes.len() as u64),
        inner: MemSource::new(bytes),
        read: AtomicUsize::new(0),
        deny: false,
    };
    let output = render_image(&source, Default::default(), &CancelFlag::default()).unwrap();
    assert_eq!((output.width, output.height), (1, 1));
    assert!(source.read.load(Ordering::Relaxed) > 3);
    let source = Source {
        deny: true,
        ..source
    };
    assert_eq!(
        render_image(&source, Default::default(), &CancelFlag::default())
            .unwrap_err()
            .kind(),
        "access-required"
    );
    let source = Source {
        len: Some(MAX_IMAGE_SOURCE_BYTES + 1),
        read: AtomicUsize::new(0),
        ..source
    };
    assert_eq!(
        inspect_image(&source, &CancelFlag::default())
            .unwrap_err()
            .kind(),
        "resource-exhausted"
    );
    assert_eq!(source.read.load(Ordering::Relaxed), 0);
    assert_eq!(
        inspect_image(&source, &CancelFlag::cancelled())
            .unwrap_err()
            .kind(),
        "cancelled"
    );
    let source = Source {
        len: None,
        ..source
    };
    assert_eq!(
        inspect_image(&source, &CancelFlag::default())
            .unwrap_err()
            .kind(),
        "unsupported"
    );
}
#[test]
fn changing_source_revision_cannot_publish_facts_from_an_obsolete_snapshot() {
    #[derive(Debug)]
    struct Changed(Source);
    impl RuntimeSource for Changed {
        fn id(&self) -> SourceId {
            self.0.id()
        }
        fn revision(&self) -> u64 {
            if self.0.read.load(Ordering::Relaxed) == 0 {
                1
            } else {
                2
            }
        }
        fn caps(&self) -> SourceCaps {
            self.0.caps()
        }
        fn read_at(&self, offset: u64, out: &mut [u8], cancel: &CancelFlag) -> Result<usize> {
            self.0.read_at(offset, out, cancel)
        }
    }
    let bytes = png(&[1, 2, 3, 255], 1, 1, 1, None);
    let source = Changed(Source {
        len: Some(bytes.len() as u64),
        inner: MemSource::new(bytes),
        read: AtomicUsize::new(0),
        deny: false,
    });
    assert_eq!(
        inspect_image(&source, &CancelFlag::default())
            .unwrap_err()
            .kind(),
        "unavailable"
    );
}
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in bytes {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ if crc & 1 != 0 { 0xedb88320 } else { 0 };
        }
    }
    !crc
}
#[test]
fn png_jpeg_webp_share_facts_and_decompression_bombs_are_rejected() {
    for format in [
        image::ImageFormat::Png,
        image::ImageFormat::Jpeg,
        image::ImageFormat::WebP,
    ] {
        let mut bytes = std::io::Cursor::new(vec![]);
        image::DynamicImage::new_rgb8(12, 7)
            .write_to(&mut bytes, format)
            .unwrap();
        let source = MemSource::new(bytes.into_inner());
        let facts = inspect_image(&source, &CancelFlag::default()).unwrap();
        assert_eq!((facts.width, facts.height), (12, 7));
        assert_eq!(
            (
                render_image(&source, Default::default(), &CancelFlag::default())
                    .unwrap()
                    .width,
                facts.height
            ),
            (12, 7)
        );
    }
    let mut bytes = png(&[1, 2, 3, 255], 1, 1, 1, None);
    bytes[16..20].copy_from_slice(&32768u32.to_be_bytes());
    bytes[20..24].copy_from_slice(&32768u32.to_be_bytes());
    let crc = crc32(&bytes[12..29]);
    bytes[29..33].copy_from_slice(&crc.to_be_bytes());
    assert_eq!(
        render_image_bytes(&bytes, Default::default(), &CancelFlag::default())
            .unwrap_err()
            .kind(),
        "resource-exhausted"
    );
}
