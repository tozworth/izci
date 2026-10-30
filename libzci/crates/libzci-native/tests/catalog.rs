use libzci::{catalog::*, profile::Profile, queue::*, storage::SqlBridge};
use libzci_native::profile::{NativeDatabase, NativeProfile};
use serde_json::{json, Value};

struct Temp(std::path::PathBuf);
impl Temp {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!(
            "libzci-catalog-{}-{}",
            std::process::id(),
            libzci::RequestId::fresh().0
        )))
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn input(path: &str) -> MediaInput {
    MediaInput {
        source: SourceReference {
            key: path.into(),
            kind: SourceKind::NativePath,
            locator: path.into(),
            display_path: path.into(),
        },
        kind: MediaKind::Audio,
        source_revision: "size:10,mtime:1".into(),
        metadata: Metadata {
            title: path.into(),
            artist: "Artist".into(),
            album: "Album".into(),
            ..Default::default()
        },
    }
}
fn run(p: &mut NativeProfile, command: CatalogCommand) -> CatalogOutcome {
    p.catalog_request(command, None).unwrap()
}

#[test]
fn identity_and_facts_survive_revision_membership_queue_and_reopen() {
    let dir = Temp::new();
    let mut p = NativeProfile::open(&dir.0).unwrap();
    let a = input("/a.wav");
    let ids = run(
        &mut p,
        CatalogCommand::Add {
            media: vec![a.clone(), input("/b.wav"), a.clone()],
        },
    )
    .media;
    assert_eq!(ids[0], ids[2]);
    assert_ne!(ids[0], ids[1]);
    let id = ids[0];
    p.command(QueueCommand::Append {
        sources: vec![a.source.clone(); 3],
    })
    .unwrap();
    run(
        &mut p,
        CatalogCommand::Favorite {
            media: id,
            subsong: None,
            favorite: true,
        },
    );
    run(
        &mut p,
        CatalogCommand::Rate {
            media: id,
            subsong: None,
            rating: 7,
        },
    );
    run(
        &mut p,
        CatalogCommand::Rate {
            media: id,
            subsong: Some(0),
            rating: 3,
        },
    );
    run(
        &mut p,
        CatalogCommand::Bookmark {
            media: id,
            subsong: None,
            position_seconds: 1.25,
            label: "Intro".into(),
        },
    );
    run(
        &mut p,
        CatalogCommand::Bookmark {
            media: id,
            subsong: Some(0),
            position_seconds: 2.,
            label: "Subsong zero".into(),
        },
    );
    let mut updated = a;
    updated.source_revision = "size:20,mtime:2".into();
    updated.metadata.title = "Updated".into();
    assert_eq!(
        run(
            &mut p,
            CatalogCommand::Add {
                media: vec![updated]
            }
        )
        .media,
        vec![id]
    );
    run(&mut p, CatalogCommand::Remove { media: vec![id] });
    assert_eq!(p.catalog_query(&CatalogQuery::default()).unwrap().total, 1);
    let page = p
        .catalog_query(&CatalogQuery {
            collection: Collection::Favorites,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.rows[0].id, id);
    assert!(!page.rows[0].in_library);
    assert_eq!(page.rows[0].facts.rating, 7);
    assert_eq!(page.rows[0].source_revision, "size:20,mtime:2");
    assert_eq!(page.rows[0].metadata.title, "Updated");
    assert_eq!(p.core.snapshot().queue.items.len(), 3);
    let revision = p.core.snapshot().revision;
    drop(p);
    let mut p = NativeProfile::open(&dir.0).unwrap();
    assert_eq!(p.core.snapshot().revision, revision);
    assert_eq!(p.bookmarks(id, None).unwrap()[0].position_seconds, 1.25);
    assert_eq!(p.bookmarks(id, Some(0)).unwrap()[0].label, "Subsong zero");
    let page = p
        .catalog_query(&CatalogQuery {
            collection: Collection::All,
            subsong: Some(0),
            search: "Updated".into(),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(page.rows[0].facts.rating, 3);
    assert!(!page.rows[0].facts.favorite);
    for n in 1..=3 {
        p.command(QueueCommand::Remove { id: n }).unwrap();
    }
    assert!(p.core.snapshot().sources.is_empty());
    assert_eq!(
        p.catalog_query(&CatalogQuery {
            collection: Collection::Favorites,
            ..Default::default()
        })
        .unwrap()
        .rows[0]
            .id,
        id
    );
    let bookmark = p.bookmarks(id, None).unwrap()[0].id;
    run(&mut p, CatalogCommand::RemoveBookmark { id: bookmark });
    assert!(p.bookmarks(id, None).unwrap().is_empty());
}

struct Fault<'a> {
    db: &'a mut NativeDatabase,
    at: &'static str,
}
impl SqlBridge for Fault<'_> {
    fn statement(&mut self, sql: &str, bind: &[Value]) -> libzci::Result<Vec<Vec<Value>>> {
        if sql.starts_with(self.at) {
            Err(libzci::storage::failure("quota", "injected"))
        } else {
            self.db.statement(sql, bind)
        }
    }
}
#[test]
fn catalog_transactions_receipts_and_shared_revision_reject_partial_or_stale_writes() {
    let dir = Temp::new();
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let command = CatalogCommand::Add {
        media: vec![input("/a.wav")],
    };
    let a = p
        .catalog_request(command.clone(), Some("0:add"), &mut db)
        .unwrap();
    let mut stale = Profile::open(&mut db).unwrap();
    let b = p
        .catalog_request(command.clone(), Some("0:add"), &mut db)
        .unwrap();
    assert!(b.duplicate);
    assert_eq!(a.revision, b.revision);
    assert_eq!(a.media, b.media);
    assert!(p
        .catalog_request(
            CatalogCommand::Remove {
                media: a.media.clone()
            },
            Some("0:add"),
            &mut db
        )
        .is_err());
    assert!(p
        .request(
            QueueCommand::Mute { mute: true },
            Some("0:add"),
            Some(&mut db)
        )
        .is_err());
    let before = p.snapshot().clone();
    for at in [
        "INSERT INTO media",
        "INSERT INTO request_receipts",
        "COMMIT",
    ] {
        let mut fault = Fault { db: &mut db, at };
        assert!(p
            .catalog_request(
                CatalogCommand::Add {
                    media: vec![input("/b.wav")]
                },
                Some("1:b"),
                &mut fault
            )
            .is_err());
        assert_eq!(p.snapshot(), &before);
        assert_eq!(
            p.catalog_query(&CatalogQuery::default(), &mut db)
                .unwrap()
                .total,
            1
        );
        assert_eq!(
            db.statement("SELECT count(*) FROM request_receipts", &[])
                .unwrap(),
            vec![vec![json!(1)]]
        );
    }
    assert!(p
        .catalog_request(
            CatalogCommand::Add {
                media: vec![
                    input("/new.wav"),
                    MediaInput {
                        source_revision: String::new(),
                        ..input("/bad.wav")
                    }
                ]
            },
            None,
            &mut db
        )
        .is_err());
    assert_eq!(
        p.catalog_query(&CatalogQuery::default(), &mut db)
            .unwrap()
            .total,
        1
    );
    p.catalog_request(
        CatalogCommand::Rate {
            media: a.media[0],
            subsong: None,
            rating: 9,
        },
        None,
        &mut db,
    )
    .unwrap();
    assert!(stale
        .command(QueueCommand::Mute { mute: true }, Some(&mut db))
        .is_err());
    assert!(stale.catalog_request(command, None, &mut db).is_err());
    let mut reopened = Profile::open(&mut db).unwrap();
    let b = reopened
        .catalog_request(
            CatalogCommand::Add {
                media: vec![input("/a.wav")],
            },
            Some("0:add"),
            &mut db,
        )
        .unwrap();
    assert!(b.duplicate);
    assert_eq!(
        reopened
            .catalog_query(&CatalogQuery::default(), &mut db)
            .unwrap()
            .rows[0]
            .facts
            .rating,
        9
    );
}

#[test]
fn bounded_queries_sort_filter_and_page_large_corpus_without_copying_it_to_snapshots() {
    let dir = Temp::new();
    let mut p = NativeProfile::open(&dir.0).unwrap();
    for batch in 0..8 {
        run(
            &mut p,
            CatalogCommand::Add {
                media: (0..MAX_BATCH)
                    .map(|n| {
                        let mut m = input(&format!("/{:05}.wav", batch * MAX_BATCH + n));
                        m.metadata.title = "Same title".into();
                        m
                    })
                    .collect(),
            },
        );
    }
    assert!(p.core.snapshot().sources.is_empty());
    let query = CatalogQuery {
        limit: 137,
        ..Default::default()
    };
    let first = p.catalog_query(&query).unwrap();
    assert_eq!(first.total, 2048);
    assert_eq!(first.rows.len(), 137);
    let next = p
        .catalog_query(&CatalogQuery {
            offset: 137,
            revision: Some(first.revision),
            ..query.clone()
        })
        .unwrap();
    assert!(first.rows.last().unwrap().id < next.rows[0].id);
    for sort in [
        CatalogSort::Title,
        CatalogSort::Artist,
        CatalogSort::Album,
        CatalogSort::Path,
        CatalogSort::Rating,
        CatalogSort::PlayCount,
    ] {
        assert_eq!(
            p.catalog_query(&CatalogQuery {
                sort,
                descending: true,
                limit: 1,
                ..Default::default()
            })
            .unwrap()
            .rows[0]
                .id,
            2048
        );
    }
    assert_eq!(
        p.catalog_query(&CatalogQuery {
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            search: "sAMe".into(),
            ..Default::default()
        })
        .unwrap()
        .total,
        2048
    );
    for search in ["%", "_", "' OR 1=1 --"] {
        assert_eq!(
            p.catalog_query(&CatalogQuery {
                search: search.into(),
                ..Default::default()
            })
            .unwrap()
            .total,
            0
        );
    }
    run(
        &mut p,
        CatalogCommand::Rate {
            media: 1,
            subsong: None,
            rating: 10,
        },
    );
    assert!(p
        .catalog_query(&CatalogQuery {
            revision: Some(first.revision),
            ..query
        })
        .is_err());
    assert_eq!(
        p.catalog_query(&CatalogQuery {
            sort: CatalogSort::Rating,
            descending: true,
            limit: 1,
            ..Default::default()
        })
        .unwrap()
        .rows[0]
            .id,
        1
    );
    assert!(p
        .catalog_query(&CatalogQuery {
            limit: MAX_PAGE + 1,
            ..Default::default()
        })
        .is_err());
    assert!(p
        .catalog_query(&CatalogQuery {
            limit: 0,
            ..Default::default()
        })
        .is_err());
    let revision = p.core.snapshot().revision;
    assert!(p
        .catalog_request(
            CatalogCommand::Rate {
                media: 1,
                subsong: None,
                rating: 11
            },
            None
        )
        .is_err());
    assert_eq!(p.core.snapshot().revision, revision);
}

#[test]
fn grouped_queries_share_filters_revisions_and_exact_album_artist_identity() {
    let dir = Temp::new();
    let mut p = NativeProfile::open(&dir.0).unwrap();
    let mut media = vec![];
    for (name, artist, album, genre, kind) in [
        ("/a", "First", "Same album", "Jazz", MediaKind::Audio),
        ("/b", "First", "Same album", "Jazz", MediaKind::Audio),
        ("/c", "Second", "Same album", "Rock", MediaKind::Module),
        ("/d", "", "", "", MediaKind::Image),
    ] {
        let mut m = input(name);
        m.kind = kind;
        m.metadata.artist = artist.into();
        m.metadata.album = album.into();
        m.metadata.genre = genre.into();
        media.push(m);
    }
    let ids = run(&mut p, CatalogCommand::Add { media }).media;
    let query = CatalogQuery::default();
    let albums = p.catalog_groups(CatalogGroupBy::Album, &query).unwrap();
    assert_eq!(albums.total, 3);
    assert_eq!(albums.groups.iter().map(|g| g.count).sum::<u64>(), 4);
    assert!(albums
        .groups
        .iter()
        .any(|g| g.key == vec!["First", "Same album"] && g.count == 2));
    assert!(albums
        .groups
        .iter()
        .any(|g| g.key == vec!["Second", "Same album"] && g.count == 1));
    for by in [
        CatalogGroupBy::Artist,
        CatalogGroupBy::Genre,
        CatalogGroupBy::Kind,
    ] {
        let groups = p
            .catalog_groups(
                by,
                &CatalogQuery {
                    limit: 1,
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(groups.total, 3);
        assert_eq!(groups.groups.len(), 1);
    }
    let filtered = p
        .catalog_groups(
            CatalogGroupBy::Album,
            &CatalogQuery {
                genre: Some("Jazz".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(filtered.total, 1);
    assert_eq!(filtered.groups[0].count, 2);
    let source = p
        .catalog_query(&CatalogQuery {
            source_key: Some("/c".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(source.rows[0].id, ids[2]);
    assert_eq!(
        p.catalog_query(&CatalogQuery {
            media: Some(ids[3]),
            ..Default::default()
        })
        .unwrap()
        .rows[0]
            .kind,
        MediaKind::Image
    );
    run(
        &mut p,
        CatalogCommand::Favorite {
            media: ids[2],
            subsong: None,
            favorite: true,
        },
    );
    let favorites = p
        .catalog_groups(
            CatalogGroupBy::Artist,
            &CatalogQuery {
                collection: Collection::Favorites,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(favorites.groups[0].key, vec!["Second"]);
    assert!(p
        .catalog_groups(
            CatalogGroupBy::Album,
            &CatalogQuery {
                revision: Some(albums.revision),
                ..Default::default()
            }
        )
        .is_err());
}
