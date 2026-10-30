//! Rebuildable rendition identity, validation and LRU policy. Backends apply a
//! plan atomically with payload writes in storage separate from domain state.
use super::*;
pub const MAX_CACHE_ENTRIES: usize = 4096;
const MAX_CLOCK: u64 = 9_007_199_254_740_991;
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CacheBudget {
    pub bytes: u64,
    pub entries: usize,
}
impl Default for CacheBudget {
    fn default() -> Self {
        Self {
            bytes: 64 * 1024 * 1024,
            entries: 256,
        }
    }
}
impl CacheBudget {
    pub fn validate(self) -> Result<()> {
        if self.bytes > 256 * 1024 * 1024 || self.entries > MAX_CACHE_ENTRIES {
            return Err(budget(
                "rendition cache budget exceeds 256 MiB / 4096 entries",
            ));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CacheEntry {
    pub key: String,
    pub bytes: u64,
    pub touched: u64,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct CachePlan {
    pub evict: Vec<String>,
    pub touch: u64,
    pub store: bool,
}
fn valid_key(key: &str) -> bool {
    key.len() == 64
        && key
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
/// Revision is obtained from the opened source, never stale catalog metadata.
pub fn rendition_cache_key(
    source_key: &str,
    revision: &str,
    request: &ImageJobRequest,
) -> Result<String> {
    request.validate()?;
    if source_key.is_empty()
        || source_key.len() > 8192
        || revision.is_empty()
        || revision.len() > 256
        || !matches!(
            request,
            ImageJobRequest::Image { .. } | ImageJobRequest::Artwork { .. }
        )
    {
        return Err(invalid("invalid rendition cache identity"));
    }
    let encoded = serde_json::to_vec(&("libzci-rendition-v1", source_key, revision, request))
        .map_err(|e| invalid(&e.to_string()))?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
}
pub fn plan_cache(
    entries: &[CacheEntry],
    key: &str,
    bytes: u64,
    limits: CacheBudget,
) -> Result<CachePlan> {
    limits.validate()?;
    if entries.len() > MAX_CACHE_ENTRIES
        || !valid_key(key)
        || bytes == 0
        || bytes > rendition::MAX_RENDITION_BYTES as u64
    {
        return Err(invalid("invalid rendition cache admission"));
    }
    let mut keys = std::collections::HashSet::new();
    let mut clock = 0;
    for e in entries {
        if !valid_key(&e.key)
            || e.bytes == 0
            || e.bytes > rendition::MAX_RENDITION_BYTES as u64
            || e.touched >= MAX_CLOCK
            || !keys.insert(&e.key)
        {
            return Err(invalid("invalid rendition cache manifest"));
        }
        clock = clock.max(e.touched);
    }
    let store = bytes <= limits.bytes && limits.entries > 0;
    let mut remaining = entries.iter().filter(|e| e.key != key).collect::<Vec<_>>();
    remaining.sort_unstable_by(|a, b| (a.touched, &a.key).cmp(&(b.touched, &b.key)));
    let mut total = remaining.iter().map(|e| e.bytes).sum::<u64>() + if store { bytes } else { 0 };
    let mut count = remaining.len() + usize::from(store);
    let mut evict = vec![];
    if !store && entries.iter().any(|e| e.key == key) {
        evict.push(key.into());
    }
    for e in remaining {
        if total <= limits.bytes && count <= limits.entries {
            break;
        }
        total -= e.bytes;
        count -= 1;
        evict.push(e.key.clone());
    }
    Ok(CachePlan {
        evict,
        touch: clock + 1,
        store,
    })
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CachedRendition {
    pub spec: RenditionSpec,
    pub source: ImageFacts,
    pub width: u32,
    pub height: u32,
    pub bytes: usize,
    pub sha256: String,
}
impl CachedRendition {
    pub fn validate_for(&self, spec: RenditionSpec) -> Result<()> {
        self.validate()?;
        if self.spec != spec {
            return Err(invalid("cached rendition does not match requested size"));
        }
        Ok(())
    }
    pub fn from_rendition(r: &ImageRendition, spec: RenditionSpec) -> Result<Self> {
        let meta = Self {
            spec,
            source: r.source.clone(),
            width: r.width,
            height: r.height,
            bytes: r.png.len(),
            sha256: format!("{:x}", Sha256::digest(&r.png)),
        };
        meta.validate()?;
        Ok(meta)
    }
    pub fn validate(&self) -> Result<()> {
        self.spec.validate()?;
        self.source.validate()?;
        let (w, h) = (self.source.display_width, self.source.display_height);
        let edge = w.max(h);
        let max = self.spec.max_edge;
        let expected = if edge > max {
            (
                ((w as u64 * max as u64 + edge as u64 / 2) / edge as u64).max(1) as u32,
                ((h as u64 * max as u64 + edge as u64 / 2) / edge as u64).max(1) as u32,
            )
        } else {
            (w, h)
        };
        if (self.width, self.height) != expected
            || self.bytes == 0
            || self.bytes > rendition::MAX_RENDITION_BYTES
            || !valid_key(&self.sha256)
        {
            return Err(invalid("invalid cached rendition metadata"));
        }
        Ok(())
    }
}
/// Cached pixels have already been oriented/converted. Decode them directly;
/// applying original EXIF/ICC a second time would corrupt the presentation.
pub fn restore_cached_rendition(
    meta: CachedRendition,
    png: Vec<u8>,
    cancel: &CancelFlag,
) -> Result<ImageRendition> {
    cancel.check()?;
    meta.validate()?;
    if png.len() != meta.bytes || format!("{:x}", Sha256::digest(&png)) != meta.sha256 {
        return Err(invalid("cached rendition checksum mismatch"));
    }
    let mut reader = ImageReader::with_format(std::io::Cursor::new(&png), ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(2048);
    limits.max_image_height = Some(2048);
    limits.max_alloc = Some(32 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(map_error)?;
    if decoder.dimensions() != (meta.width, meta.height)
        || decoder.total_bytes() > 16 * 1024 * 1024
        || decoder.orientation().map_err(map_error)?.to_exif() != 1
        || decoder
            .icc_profile()
            .map_err(map_error)?
            .is_some_and(|p| !p.is_empty())
    {
        return Err(invalid("cached rendition pixels disagree with metadata"));
    }
    cancel.check()?;
    let rgba = DynamicImage::from_decoder(decoder)
        .map_err(map_error)?
        .into_rgba8()
        .into_raw();
    cancel.check()?;
    Ok(ImageRendition {
        source: meta.source,
        width: meta.width,
        height: meta.height,
        png,
        rgba,
    })
}
