use image::ImageEncoder;
use libzci::{images::*, *};
use sha2::{Digest, Sha256};
fn key(n: u64) -> String {
    format!("{n:064x}")
}
#[test]
fn deterministic_lru_admission_replacement_and_budgets() {
    let limits = CacheBudget {
        bytes: 120,
        entries: 2,
    };
    let entries = vec![
        CacheEntry {
            key: key(1),
            bytes: 50,
            touched: 1,
        },
        CacheEntry {
            key: key(2),
            bytes: 50,
            touched: 2,
        },
    ];
    let p = plan_cache(&entries, &key(3), 60, limits).unwrap();
    assert!(p.store);
    assert_eq!(p.evict, vec![key(1)]);
    assert_eq!(p.touch, 3);
    let p = plan_cache(&entries, &key(1), 70, limits).unwrap();
    assert!(p.store);
    assert!(p.evict.is_empty());
    let p = plan_cache(&entries, &key(1), 121, limits).unwrap();
    assert!(!p.store);
    assert_eq!(p.evict, vec![key(1)]);
    let p = plan_cache(
        &entries,
        &key(3),
        10,
        CacheBudget {
            bytes: 0,
            entries: 0,
        },
    )
    .unwrap();
    assert!(!p.store);
    assert_eq!(p.evict, vec![key(1), key(2)]);
    let mut duplicate = entries.clone();
    duplicate.push(entries[0].clone());
    assert!(plan_cache(&duplicate, &key(3), 1, limits).is_err());
    assert!(plan_cache(&entries, "bad", 1, limits).is_err());
    assert!(plan_cache(&entries, &key(3), 0, limits).is_err());
    assert!(plan_cache(
        &entries,
        &key(3),
        1,
        CacheBudget {
            bytes: 257 * 1024 * 1024,
            entries: 2
        }
    )
    .is_err());
    let mut overflow = entries.clone();
    overflow[0].touched = 9_007_199_254_740_991;
    assert!(plan_cache(&overflow, &key(3), 1, limits).is_err());
}
#[test]
fn identity_separates_source_revision_purpose_and_pipeline_spec() {
    let image = ImageJobRequest::Image {
        spec: RenditionSpec { max_edge: 64 },
    };
    let a = rendition_cache_key("A", "1", &image).unwrap();
    for (source, revision, request) in [
        ("a", "1", image.clone()),
        ("A", "2", image.clone()),
        (
            "A",
            "1",
            ImageJobRequest::Artwork {
                spec: RenditionSpec { max_edge: 64 },
            },
        ),
        (
            "A",
            "1",
            ImageJobRequest::Image {
                spec: RenditionSpec { max_edge: 128 },
            },
        ),
    ] {
        assert_ne!(a, rendition_cache_key(source, revision, &request).unwrap());
    }
    assert!(rendition_cache_key("", "1", &image).is_err());
    assert!(rendition_cache_key("A", "1", &ImageJobRequest::Inspect).is_err());
}
fn png(orientation: u8) -> Vec<u8> {
    let mut out = vec![];
    let mut encoder = image::codecs::png::PngEncoder::new(&mut out);
    let mut exif = b"II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
    exif.extend([orientation, 0, 0, 0, 0, 0, 0, 0]);
    encoder.set_exif_metadata(exif).unwrap();
    encoder
        .write_image(
            &[255, 0, 0, 255, 0, 255, 0, 255],
            2,
            1,
            image::ExtendedColorType::Rgba8,
        )
        .unwrap();
    out
}
#[test]
fn cached_pixels_restore_once_preserve_source_facts_and_reject_corruption() {
    let cancel = CancelFlag::default();
    let spec = RenditionSpec { max_edge: 8 };
    let r = render_image_bytes(&png(6), spec, &cancel).unwrap();
    let meta = CachedRendition::from_rendition(&r, spec).unwrap();
    assert!(meta.validate_for(RenditionSpec { max_edge: 16 }).is_err());
    let restored = restore_cached_rendition(meta.clone(), r.png.clone(), &cancel).unwrap();
    assert_eq!(restored.source, r.source);
    assert_eq!(restored.source.orientation, 6);
    assert_eq!((restored.width, restored.height), (1, 2));
    assert_eq!(restored.rgba, r.rgba);
    assert_eq!(restored.png, r.png);
    let mut bad = r.png.clone();
    bad[30] ^= 1;
    assert!(restore_cached_rendition(meta.clone(), bad, &cancel).is_err());
    let mut bad = meta.clone();
    bad.width = 2;
    assert!(restore_cached_rendition(bad, r.png.clone(), &cancel).is_err());
    assert!(restore_cached_rendition(meta, r.png.clone(), &CancelFlag::cancelled()).is_err());
    let r = render_image_bytes(&png(2), spec, &cancel).unwrap();
    let mut meta = CachedRendition::from_rendition(&r, spec).unwrap();
    let tagged = png(2);
    meta.bytes = tagged.len();
    meta.sha256 = format!("{:x}", Sha256::digest(&tagged));
    assert!(restore_cached_rendition(meta, tagged, &cancel).is_err());
}
