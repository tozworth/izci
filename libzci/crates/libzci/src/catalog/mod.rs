//! Profile-owned catalog. SQL and identity/fact policy are shared by all adapters.
//! Query pages contain references and bounded metadata, never media/artwork blobs.
mod metadata;
pub(crate) mod mutation;
pub(crate) mod plays;
pub use plays::{PlayCountAcknowledgement, PlayCountOutcome};
pub(crate) mod query;
pub(crate) mod scans;
mod text;
pub use query::{CatalogGroup, CatalogGroupBy, CatalogGroupPage};
pub use query::{CatalogPage, CatalogQuery, CatalogRow, CatalogSort, Collection};
pub use scans::{ManagedRoot, RootInput, ScanPlan, ScanSettings, ScanSummary};

use crate::{
    queue::{invalid, SourceReference},
    Result,
};
use serde::{Deserialize, Serialize};

pub const MAX_BATCH: usize = 256;
pub const MAX_PAGE: usize = 500;
pub const MAX_ID: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Audio,
    Module,
    Video,
    Image,
}
impl MediaKind {
    pub(crate) fn sql(self) -> &'static str {
        match self {
            Self::Audio => "audio",
            Self::Module => "module",
            Self::Video => "video",
            Self::Image => "image",
        }
    }
}

/// Supplemental facts must be bounded and rebuildable. Embedded payloads are
/// read on demand, not stored here. User facts are independent of this revision.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Metadata {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub year: Option<u32>,
    pub track: Option<u32>,
    pub disc: Option<u32>,
    pub duration_seconds: Option<f64>,
    pub replay_gain: crate::replay_gain::ReplayGainMetadata,
    pub image: Option<crate::images::ImageFacts>,
}
impl Metadata {
    fn validate(&self) -> Result<()> {
        for s in [&self.title, &self.artist, &self.album, &self.genre] {
            text(s, 4096, true)?;
        }
        if let Some(n) = self.duration_seconds {
            crate::MediaTime(n).validate()?;
        }
        self.replay_gain.validate()?;
        if let Some(image) = &self.image {
            image.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaInput {
    /// key is a stable platform identity (canonical path under platform case
    /// rules, or real capability identity). It is not a content hash. Adapters
    /// must reuse it when reopening the same File System Access entry.
    pub source: SourceReference,
    pub kind: MediaKind,
    /// Opaque size/mtime or provider revision. A change invalidates derived
    /// facts/cache jobs but never the media ID, favorites, ratings or bookmarks.
    pub source_revision: String,
    pub metadata: Metadata,
}
impl MediaInput {
    pub fn validate(&self) -> Result<()> {
        self.source.validate()?;
        text(&self.source_revision, 1024, false)?;
        self.metadata.validate()?;
        if self.kind != MediaKind::Image && self.metadata.image.is_some() {
            return Err(invalid("image facts require image catalog kind"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserFacts {
    pub favorite: bool,
    /// 0 clears the rating; 1..10 are half-star steps.
    pub rating: u8,
    pub play_count: u64,
    pub last_played_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bookmark {
    pub id: u64,
    pub media: u64,
    pub subsong: Option<u32>,
    pub position_seconds: f64,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CatalogCommand {
    Root {
        root: RootInput,
    },
    RemoveRoot {
        root: u64,
    },
    FinishScan {
        token: String,
    },
    Add {
        media: Vec<MediaInput>,
    },
    Remove {
        media: Vec<u64>,
    },
    Favorite {
        media: u64,
        subsong: Option<u32>,
        favorite: bool,
    },
    Rate {
        media: u64,
        subsong: Option<u32>,
        rating: u8,
    },
    Bookmark {
        media: u64,
        subsong: Option<u32>,
        position_seconds: f64,
        label: String,
    },
    RemoveBookmark {
        id: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CatalogOutcome {
    pub duplicate: bool,
    pub revision: u64,
    /// Ordered add results, including duplicate identities. Other commands
    /// return touched identities. Consumers refresh queries at this revision.
    pub media: Vec<u64>,
    pub bookmark: Option<u64>,
    pub root: Option<u64>,
    pub scan: Option<ScanSummary>,
}

pub(crate) fn text(s: &str, limit: usize, empty: bool) -> Result<()> {
    if (!empty && s.is_empty()) || s.len() > limit || s.contains('\0') {
        return Err(invalid("invalid catalog text"));
    }
    Ok(())
}
pub(crate) fn id(n: u64) -> Result<()> {
    if n == 0 || n > MAX_ID {
        return Err(invalid("invalid catalog identity"));
    }
    Ok(())
}
pub(crate) fn subsong(n: Option<u32>) -> i64 {
    n.map_or(-1, i64::from)
}

pub(crate) const SCHEMA: &[&str] = &[
    "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id<=9007199254740991), source_key TEXT NOT NULL UNIQUE, reference TEXT NOT NULL, source_revision TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('audio','module','video','image')), manual INTEGER NOT NULL CHECK(manual IN (0,1)), title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL, genre TEXT NOT NULL, metadata TEXT NOT NULL, title_key TEXT NOT NULL, artist_key TEXT NOT NULL, album_key TEXT NOT NULL, genre_key TEXT NOT NULL, path_key TEXT NOT NULL)",
    "CREATE INDEX media_title ON media(title_key,id)",
    "CREATE INDEX media_artist ON media(artist_key,album_key,id)",
    "CREATE INDEX media_album ON media(album_key,id)",
    "CREATE INDEX media_genre ON media(genre_key,id)",
    "CREATE INDEX media_path ON media(path_key,id)",
    "CREATE TABLE user_facts (media_id INTEGER NOT NULL REFERENCES media(id), subsong INTEGER NOT NULL CHECK(subsong>=-1), favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)), rating INTEGER NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 10), play_count INTEGER NOT NULL DEFAULT 0 CHECK(play_count>=0), last_played_ms INTEGER, PRIMARY KEY(media_id,subsong))",
    "CREATE INDEX favorites ON user_facts(subsong,favorite,media_id)",
    "CREATE TABLE bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id<=9007199254740991), media_id INTEGER NOT NULL REFERENCES media(id), subsong INTEGER NOT NULL CHECK(subsong>=-1), position_seconds REAL NOT NULL CHECK(position_seconds>=0), label TEXT NOT NULL)",
    "CREATE INDEX media_bookmarks ON bookmarks(media_id,subsong,position_seconds,id)",
    "CREATE TABLE managed_roots (id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id<=9007199254740991), source_key TEXT NOT NULL UNIQUE, config TEXT NOT NULL, revision INTEGER NOT NULL)",
    "CREATE TABLE root_memberships (root_id INTEGER NOT NULL REFERENCES managed_roots(id) ON DELETE CASCADE, media_id INTEGER NOT NULL REFERENCES media(id), PRIMARY KEY(root_id,media_id))",
    "CREATE INDEX media_roots ON root_memberships(media_id,root_id)",
    "CREATE INDEX media_capabilities ON media(json_extract(reference,'$.kind'),json_extract(reference,'$.locator'))",
    "CREATE INDEX root_capabilities ON managed_roots(json_extract(config,'$.source.kind'),json_extract(config,'$.source.locator'))",
];
