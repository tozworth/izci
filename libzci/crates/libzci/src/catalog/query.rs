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
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogGroupBy {
    Artist,
    Album,
    Genre,
    Kind,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CatalogGroup {
    pub key: Vec<String>,
    pub count: u64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CatalogGroupPage {
    pub revision: u64,
    pub total: u64,
    pub groups: Vec<CatalogGroup>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CatalogQuery {
    pub collection: Collection,
    pub kind: Option<MediaKind>,
    pub root: Option<u64>,
    pub media: Option<u64>,
    pub source_key: Option<String>,
    pub subsong: Option<u32>,
    pub search: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
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
            root: None,
            media: None,
            source_key: None,
            subsong: None,
            search: String::new(),
            artist: None,
            album: None,
            genre: None,
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

fn filtered(query: &CatalogQuery) -> Result<(String, Vec<Value>)> {
    if query.limit == 0 || query.limit > MAX_PAGE {
        return Err(invalid("catalog page limit must be 1..500"));
    }
    text(&query.search, 1024, true)?;
    for s in [&query.artist, &query.album, &query.genre]
        .into_iter()
        .flatten()
    {
        text(s, 4096, true)?;
    }
    let mut conditions = vec![];
    let mut bind = vec![json!(subsong(query.subsong))];
    match query.collection {
        Collection::Library => conditions.push(LIBRARY_MEMBERSHIP),
        Collection::Favorites => conditions.push("f.favorite=1"),
        Collection::All => {}
    }
    if let Some(media) = query.media {
        id(media)?;
        conditions.push("m.id=?");
        bind.push(json!(media));
    }
    if let Some(key) = &query.source_key {
        text(key, 8192, false)?;
        conditions.push("m.source_key=?");
        bind.push(json!(key));
    }
    if let Some(root) = query.root {
        id(root)?;
        conditions.push(
            "EXISTS (SELECT 1 FROM root_memberships rm WHERE rm.media_id=m.id AND rm.root_id=?)",
        );
        bind.push(json!(root));
    }
    if let Some(kind) = query.kind {
        conditions.push("m.kind=?");
        bind.push(json!(kind.sql()));
    }
    if !query.search.is_empty() {
        // Literal substring, not SQL LIKE wildcard syntax. Bind all user input.
        conditions
            .push("(instr(m.title_key,?)>0 OR instr(m.artist_key,?)>0 OR instr(m.album_key,?)>0)");
        let key = super::text::key(&query.search);
        for _ in 0..3 {
            bind.push(json!(key));
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
    if let Some(genre) = &query.genre {
        conditions.push("m.genre=?");
        bind.push(json!(genre));
    }
    let filter = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };
    Ok((
        format!(" FROM media m LEFT JOIN user_facts f ON f.media_id=m.id AND f.subsong=?{filter}"),
        bind,
    ))
}
fn revision(db: &mut dyn SqlBridge, expected: Option<u64>) -> Result<u64> {
    let revision =
        number(&db.statement("SELECT catalog_revision FROM sessions WHERE id=1", &[])?[0][0])?;
    if expected.is_some_and(|r| r != revision) {
        return Err(failure(
            "stale-query",
            "catalog changed; restart pagination",
        ));
    }
    Ok(revision)
}
fn ordering(query: &CatalogQuery) -> String {
    let sort = match query.sort {
        CatalogSort::Title => vec!["m.title_key"],
        CatalogSort::Artist => vec!["m.artist_key", "m.album_key"],
        CatalogSort::Album => vec!["m.album_key"],
        CatalogSort::Rating => vec!["COALESCE(f.rating,0)"],
        CatalogSort::PlayCount => vec!["COALESCE(f.play_count,0)"],
        CatalogSort::Path => vec!["m.path_key"],
    };
    let direction = if query.descending { "DESC" } else { "ASC" };
    // Each term gets the same direction; ID is a stable tie breaker.
    let order = sort
        .into_iter()
        .map(|s| format!("{s} {direction}"))
        .collect::<Vec<_>>()
        .join(",");
    format!("{order},m.id {direction}")
}
pub(crate) fn image_sequence(
    db: &mut dyn SqlBridge,
    query: &CatalogQuery,
) -> Result<crate::images::ImageSequence> {
    if query.kind.is_some_and(|kind| kind != MediaKind::Image) {
        return Err(invalid("originating query excludes images"));
    }
    let mut query = query.clone();
    query.kind = Some(MediaKind::Image);
    let (from, mut bind) = filtered(&query)?;
    let order = ordering(&query);
    transaction(db, |db| {
        let revision = revision(db, query.revision)?;
        bind.push(json!(crate::images::MAX_IMAGE_SEQUENCE + 1));
        let rows = db.statement(
            &format!("SELECT m.id{from} ORDER BY {order} LIMIT ?"),
            &bind,
        )?;
        let sequence = crate::images::ImageSequence {
            revision,
            media: rows
                .iter()
                .map(|r| number(&r[0]))
                .collect::<Result<Vec<_>>>()?,
        };
        sequence.validate()?;
        Ok(sequence)
    })
}
pub(crate) fn query(db: &mut dyn SqlBridge, query: &CatalogQuery) -> Result<CatalogPage> {
    let (from, bind) = filtered(query)?;
    let order = ordering(query);
    transaction(db, |db| {
        let revision = revision(db, query.revision)?;
        let total = number(&db.statement(&format!("SELECT count(*){from}"), &bind)?[0][0])?;
        let mut args = bind.clone();
        args.extend([json!(query.limit), json!(query.offset)]);
        let rows=db.statement(&format!("SELECT m.id,m.reference,m.source_revision,m.kind,({LIBRARY_MEMBERSHIP}),m.metadata,COALESCE(f.favorite,0),COALESCE(f.rating,0),COALESCE(f.play_count,0),f.last_played_ms{from} ORDER BY {order} LIMIT ? OFFSET ?"),&args)?;
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
pub(crate) fn groups(
    db: &mut dyn SqlBridge,
    by: CatalogGroupBy,
    query: &CatalogQuery,
) -> Result<CatalogGroupPage> {
    let (from, mut bind) = filtered(query)?;
    let columns = match by {
        CatalogGroupBy::Artist => vec!["m.artist"],
        CatalogGroupBy::Album => vec!["m.artist", "m.album"],
        CatalogGroupBy::Genre => vec!["m.genre"],
        CatalogGroupBy::Kind => vec!["m.kind"],
    };
    // Exact labels remain distinct groups. Every row in such a group has the
    // same shared folded key; MIN exposes it for deterministic SQL ordering.
    let keys = columns
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let key = if by == CatalogGroupBy::Kind {
                c.to_string()
            } else {
                format!("{c}_key")
            };
            format!("MIN({key}) AS sort{i}")
        })
        .collect::<Vec<_>>();
    let grouped = format!(
        "SELECT {},count(*) AS item_count,{}{from} GROUP BY {}",
        columns.join(","),
        keys.join(","),
        columns.join(",")
    );
    let direction = if query.descending { "DESC" } else { "ASC" };
    // Binary label tie breakers keep distinct exact groups stable when their
    // canonical full case-folded keys compare equally.
    let order = columns
        .iter()
        .enumerate()
        .flat_map(|(i, c)| [format!("sort{i} {direction}"), format!("{c} {direction}")])
        .collect::<Vec<_>>()
        .join(",");
    transaction(db, |db| {
        let revision = revision(db, query.revision)?;
        let total =
            number(&db.statement(&format!("SELECT count(*) FROM ({grouped})"), &bind)?[0][0])?;
        bind.extend([json!(query.limit), json!(query.offset)]);
        let rows = db.statement(
            &format!("{grouped} ORDER BY {order} LIMIT ? OFFSET ?"),
            &bind,
        )?;
        let groups = rows
            .into_iter()
            .map(|r| {
                Ok(CatalogGroup {
                    key: r[..columns.len()]
                        .iter()
                        .map(|v| {
                            v.as_str()
                                .map(str::to_owned)
                                .ok_or_else(|| failure("corrupt", "expected group text"))
                        })
                        .collect::<Result<Vec<_>>>()?,
                    count: number(&r[columns.len()])?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(CatalogGroupPage {
            revision,
            total,
            groups,
        })
    })
}
const LIBRARY_MEMBERSHIP: &str =
    "(m.manual=1 OR EXISTS (SELECT 1 FROM root_memberships rm WHERE rm.media_id=m.id))";

pub(crate) fn bookmarks(
    db: &mut dyn SqlBridge,
    media: u64,
    song: Option<u32>,
) -> Result<Vec<Bookmark>> {
    super::mutation::require(db, media)?;
    db.statement("SELECT id,position_seconds,label FROM bookmarks WHERE media_id=? AND subsong=? ORDER BY position_seconds,id",&[json!(media),json!(subsong(song))])?.into_iter().map(|r|Ok(Bookmark {id:number(&r[0])?,media,subsong:song,position_seconds:r[1].as_f64().ok_or_else(||failure("corrupt","bookmark position"))?,label:r[2].as_str().ok_or_else(||failure("corrupt","bookmark label"))?.into()})).collect()
}
