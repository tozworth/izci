//! Explicit visual work requests. Adapters schedule these on independent workers;
//! none of the operations create, select or command a music playback session.
use super::*;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ImageJobRequest {
    Inspect,
    Image {
        spec: RenditionSpec,
    },
    Artwork {
        spec: RenditionSpec,
    },
    Cached {
        metadata: CachedRendition,
        spec: RenditionSpec,
    },
}
impl ImageJobRequest {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Inspect => Ok(()),
            Self::Image { spec } | Self::Artwork { spec } => spec.validate(),
            Self::Cached { metadata, spec } => metadata.validate_for(*spec),
        }
    }
    pub fn rendition_spec(&self) -> Option<RenditionSpec> {
        match self {
            Self::Image { spec } | Self::Artwork { spec } => Some(*spec),
            Self::Cached { spec, .. } => Some(*spec),
            Self::Inspect => None,
        }
    }
}
pub enum ImageJobResult {
    Facts(ImageFacts),
    Rendition(Option<ImageRendition>),
}
impl ImageJobResult {
    pub fn facts(&self) -> Option<&ImageFacts> {
        match self {
            Self::Facts(facts) => Some(facts),
            Self::Rendition(resource) => resource.as_ref().map(|r| &r.source),
        }
    }
}
pub fn run_image_job(
    source: &dyn RuntimeSource,
    request: ImageJobRequest,
    cancel: &CancelFlag,
) -> Result<ImageJobResult> {
    cancel.check()?;
    request.validate()?;
    match request {
        ImageJobRequest::Cached { metadata, .. } => {
            source.verify_snapshot()?;
            if source.len() != Some(metadata.bytes as u64) {
                return Err(invalid("cached rendition length mismatch"));
            }
            let mut png = vec![0; metadata.bytes];
            for (i, block) in png.chunks_mut(32768).enumerate() {
                source.read_exact_at((i * 32768) as u64, block, cancel)?;
            }
            source.verify_snapshot()?;
            restore_cached_rendition(metadata, png, cancel)
                .map(|r| ImageJobResult::Rendition(Some(r)))
        }
        ImageJobRequest::Inspect => inspect_image(source, cancel).map(ImageJobResult::Facts),
        ImageJobRequest::Image { spec } => {
            render_image(source, spec, cancel).map(|r| ImageJobResult::Rendition(Some(r)))
        }
        ImageJobRequest::Artwork { spec } => {
            let art = crate::artwork::read_embedded_artwork(source, cancel)?;
            let rendition = art
                .map(|a| render_image_bytes(&a.bytes, spec, cancel))
                .transpose()?;
            Ok(ImageJobResult::Rendition(rendition))
        }
    }
}
