use super::*;
use crate::storage::{decode, failure, transaction, SqlBridge};
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Collection {
    #[default]
    Library,
    Favorites,
    All,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogSort {
    #[default]
    Title,
    Artist,
    Album,
    Rating,
    PlayCount,
    Path,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CatalogQuery {
    pub collection: Collection,
    pub kind: Option<MediaKind>,
    pub subsong: Option<u32>,
    pub search: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub sort: CatalogSort,
    pub descending: bool,
    pub offset: u32,
    pub limit: usize,
    /// Reject page concatenation across mutations instead of silently skipping
    /// or repeating identities as an indexed sort changes beneath the shell.
    pub revision: Option<u64>,
}
impl Default for CatalogQuery {
    fn default() -> Self {
        Self {
            collection: Collection::Library,
            kind: None,
            subsong: None,
            search: String::new(),
            artist: None,
            album: None,
            sort: CatalogSort::Title,
            descending: false,
            offset: 0,
            limit: 100,
            revision: None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CatalogRow {
    pub id: u64,
    pub source: SourceReference,
    pub source_revision: String,
    pub kind: MediaKind,
    pub in_library: bool,
    pub metadata: Metadata,
    pub facts: UserFacts,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CatalogPage {
    pub revision: u64,
    pub total: u64,
    pub rows: Vec<CatalogRow>,
}

fn number(v: &Value) -> Result<u64> {
    v.as_u64()
        .ok_or_else(|| failure("corrupt", "expected catalog integer"))
}

pub(crate) fn query(db: &mut dyn SqlBridge, query: &CatalogQuery) -> Result<CatalogPage> {
    if query.limit == 0 || query.limit > MAX_PAGE {
        return Err(invalid("catalog page limit must be 1..500"));
    }
    text(&query.search, 1024, true)?;
    for s in [&query.artist, &query.album].into_iter().flatten() {
        text(s, 4096, true)?;
    }
    let mut conditions = vec![];
    let mut bind = vec![json!(subsong(query.subsong))];
    match query.collection {
        Collection::Library => conditions.push("m.manual=1"),
        Collection::Favorites => conditions.push("f.favorite=1"),
        Collection::All => {}
    }
    if let Some(kind) = query.kind {
        conditions.push("m.kind=?");
        bind.push(json!(kind.sql()));
    }
    if !query.search.is_empty() {
        // Literal substring, not SQL LIKE wildcard syntax. Bind all user input.
        conditions.push("(instr(lower(m.title),lower(?))>0 OR instr(lower(m.artist),lower(?))>0 OR instr(lower(m.album),lower(?))>0)");
        for _ in 0..3 {
            bind.push(json!(query.search));
        }
    }
    if let Some(artist) = &query.artist {
        conditions.push("m.artist=?");
        bind.push(json!(artist));
    }
    if let Some(album) = &query.album {
        conditions.push("m.album=?");
        bind.push(json!(album));
    }
    let filter = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };
    let from =
        format!(" FROM media m LEFT JOIN user_facts f ON f.media_id=m.id AND f.subsong=?{filter}");
    let sort = match query.sort {
        CatalogSort::Title => vec!["m.title COLLATE NOCASE"],
        CatalogSort::Artist => vec!["m.artist COLLATE NOCASE", "m.album COLLATE NOCASE"],
        CatalogSort::Album => vec!["m.album COLLATE NOCASE"],
        CatalogSort::Rating => vec!["COALESCE(f.rating,0)"],
        CatalogSort::PlayCount => vec!["COALESCE(f.play_count,0)"],
        CatalogSort::Path => vec!["json_extract(m.reference,'$.display_path') COLLATE NOCASE"],
    };
    let direction = if query.descending { "DESC" } else { "ASC" };
    // Each term gets the same direction; ID is a stable tie breaker.
    let order = sort
        .into_iter()
        .map(|s| format!("{s} {direction}"))
        .collect::<Vec<_>>()
        .join(",");
    transaction(db, |db| {
        let revision =
            number(&db.statement("SELECT catalog_revision FROM sessions WHERE id=1", &[])?[0][0])?;
        if query.revision.is_some_and(|r| r != revision) {
            return Err(failure(
                "stale-query",
                "catalog changed; restart pagination",
            ));
        }
        let total = number(&db.statement(&format!("SELECT count(*){from}"), &bind)?[0][0])?;
        let mut args = bind.clone();
        args.extend([json!(query.limit), json!(query.offset)]);
        let rows=db.statement(&format!("SELECT m.id,m.reference,m.source_revision,m.kind,m.manual,m.metadata,COALESCE(f.favorite,0),COALESCE(f.rating,0),COALESCE(f.play_count,0),f.last_played_ms{from} ORDER BY {order},m.id {direction} LIMIT ? OFFSET ?"),&args)?;
        let rows = rows
            .into_iter()
            .map(|r| {
                Ok(CatalogRow {
                    id: number(&r[0])?,
                    source: decode(&r[1])?,
                    source_revision: r[2]
                        .as_str()
                        .ok_or_else(|| failure("corrupt", "source revision"))?
                        .into(),
                    kind: serde_json::from_value(r[3].clone())
                        .map_err(|e| failure("corrupt", e))?,
                    in_library: number(&r[4])? != 0,
                    metadata: decode(&r[5])?,
                    facts: UserFacts {
                        favorite: number(&r[6])? != 0,
                        rating: u8::try_from(number(&r[7])?).map_err(|e| failure("corrupt", e))?,
                        play_count: number(&r[8])?,
                        last_played_ms: if r[9].is_null() {
                            None
                        } else {
                            Some(number(&r[9])?)
                        },
                    },
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(CatalogPage {
            revision,
            total,
            rows,
        })
    })
}

pub(crate) fn bookmarks(
    db: &mut dyn SqlBridge,
    media: u64,
    song: Option<u32>,
) -> Result<Vec<Bookmark>> {
    super::mutation::require(db, media)?;
    db.statement("SELECT id,position_seconds,label FROM bookmarks WHERE media_id=? AND subsong=? ORDER BY position_seconds,id",&[json!(media),json!(subsong(song))])?.into_iter().map(|r|Ok(Bookmark {id:number(&r[0])?,media,subsong:song,position_seconds:r[1].as_f64().ok_or_else(||failure("corrupt","bookmark position"))?,label:r[2].as_str().ok_or_else(||failure("corrupt","bookmark label"))?.into()})).collect()
}
