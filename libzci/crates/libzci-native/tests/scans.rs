use libzci::{catalog::*, profile::Profile, queue::*, storage::SqlBridge};
use libzci_native::profile::NativeDatabase;
use serde_json::{json, Value};

struct Temp(std::path::PathBuf);
impl Temp {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!(
            "libzci-scan-{}-{}",
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
fn source(key: &str) -> SourceReference {
    SourceReference {
        key: key.into(),
        kind: SourceKind::NativePath,
        locator: key.into(),
        display_path: key.into(),
    }
}
fn input(key: &str) -> MediaInput {
    MediaInput {
        source: source(key),
        kind: MediaKind::Audio,
        source_revision: "1".into(),
        metadata: Metadata {
            title: key.into(),
            ..Default::default()
        },
    }
}
fn root(p: &mut Profile, db: &mut dyn SqlBridge, key: &str) -> u64 {
    p.catalog_request(
        CatalogCommand::Root {
            root: RootInput {
                source: source(key),
                settings: ScanSettings::default(),
            },
        },
        None,
        db,
    )
    .unwrap()
    .root
    .unwrap()
}
fn finish(p: &mut Profile, db: &mut dyn SqlBridge, token: &str) -> CatalogOutcome {
    p.catalog_request(
        CatalogCommand::FinishScan {
            token: token.into(),
        },
        None,
        db,
    )
    .unwrap()
}
fn page(p: &Profile, db: &mut dyn SqlBridge) -> CatalogPage {
    p.catalog_query(
        &CatalogQuery {
            sort: CatalogSort::Path,
            ..Default::default()
        },
        db,
    )
    .unwrap()
}

#[test]
fn scans_commit_only_complete_batches_and_reconcile_only_root_owned_membership() {
    let dir = Temp::new();
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let a = root(&mut p, &mut db, "/a");
    let b = root(&mut p, &mut db, "/b");
    let scan = p.begin_scan(a, &mut db).unwrap();
    let rev = p.snapshot().clone();
    assert_eq!(
        p.stage_scan(
            &scan.token,
            vec![input("/shared.wav"), input("/a.wav")],
            &mut db
        )
        .unwrap(),
        2
    );
    assert_eq!(
        p.stage_scan(&scan.token, vec![input("/shared.wav")], &mut db)
            .unwrap(),
        2
    );
    assert_eq!(p.snapshot(), &rev);
    assert_eq!(page(&p, &mut db).total, 0);
    let result = finish(&mut p, &mut db, &scan.token).scan.unwrap();
    assert_eq!((result.entries, result.added, result.removed), (2, 2, 0));
    let before = page(&p, &mut db);
    assert_eq!(before.total, 2);
    let shared = before.rows[1].id;
    let a_id = before.rows[0].id;
    p.catalog_request(
        CatalogCommand::Favorite {
            media: a_id,
            subsong: None,
            favorite: true,
        },
        None,
        &mut db,
    )
    .unwrap();
    let scan = p.begin_scan(b, &mut db).unwrap();
    p.stage_scan(
        &scan.token,
        vec![input("/shared.wav"), input("/b.wav")],
        &mut db,
    )
    .unwrap();
    finish(&mut p, &mut db, &scan.token);
    p.catalog_request(
        CatalogCommand::Add {
            media: vec![input("/manual.wav")],
        },
        None,
        &mut db,
    )
    .unwrap();
    let scan = p.begin_scan(a, &mut db).unwrap();
    p.stage_scan(
        &scan.token,
        vec![MediaInput {
            source_revision: "2".into(),
            ..input("/shared.wav")
        }],
        &mut db,
    )
    .unwrap();
    let result = finish(&mut p, &mut db, &scan.token).scan.unwrap();
    assert_eq!((result.entries, result.added, result.removed), (1, 0, 1));
    let after = page(&p, &mut db);
    assert_eq!(after.total, 3);
    assert_eq!(after.rows[2].id, shared);
    assert_eq!(after.rows[2].source_revision, "2");
    let favorites = p
        .catalog_query(
            &CatalogQuery {
                collection: Collection::Favorites,
                ..Default::default()
            },
            &mut db,
        )
        .unwrap();
    assert_eq!(favorites.rows[0].id, a_id);
    assert!(!favorites.rows[0].in_library);
    p.catalog_request(CatalogCommand::RemoveRoot { root: a }, None, &mut db)
        .unwrap();
    assert_eq!(page(&p, &mut db).total, 3); // root b still owns shared and b
    let scan = p.begin_scan(b, &mut db).unwrap();
    let summary = finish(&mut p, &mut db, &scan.token).scan.unwrap();
    assert_eq!(summary.removed, 2);
    assert_eq!(page(&p, &mut db).rows[0].source.key, "/manual.wav");
    let scan = p.begin_scan(b, &mut db).unwrap();
    p.stage_scan(&scan.token, vec![input("/a.wav")], &mut db)
        .unwrap();
    finish(&mut p, &mut db, &scan.token);
    let restored = p
        .catalog_query(
            &CatalogQuery {
                root: Some(b),
                ..Default::default()
            },
            &mut db,
        )
        .unwrap();
    assert_eq!(restored.rows[0].id, a_id);
    assert!(restored.rows[0].facts.favorite);
}

struct Fault<'a> {
    db: &'a mut NativeDatabase,
    at: &'static str,
}
impl SqlBridge for Fault<'_> {
    fn statement(&mut self, sql: &str, args: &[Value]) -> libzci::Result<Vec<Vec<Value>>> {
        if sql.starts_with(self.at) {
            Err(libzci::storage::failure("io", "injected"))
        } else {
            self.db.statement(sql, args)
        }
    }
}

#[test]
fn partial_cancelled_superseded_changed_denied_and_reopened_scans_cannot_erase_catalog() {
    let dir = Temp::new();
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let a = root(&mut p, &mut db, "/a");
    let initial = p.begin_scan(a, &mut db).unwrap();
    p.stage_scan(&initial.token, vec![input("/kept.wav")], &mut db)
        .unwrap();
    finish(&mut p, &mut db, &initial.token);
    let before = page(&p, &mut db);
    let denied = p.begin_scan(a, &mut db).unwrap(); // adapter permission failure -> cancel, never FinishScan
    p.cancel_scan(&denied.token, &mut db).unwrap();
    assert!(p
        .catalog_request(
            CatalogCommand::FinishScan {
                token: denied.token
            },
            None,
            &mut db
        )
        .is_err());
    assert_eq!(page(&p, &mut db), before);
    let cancelled = p.begin_scan(a, &mut db).unwrap();
    p.stage_scan(&cancelled.token, vec![input("/partial.wav")], &mut db)
        .unwrap();
    p.cancel_scan(&cancelled.token, &mut db).unwrap();
    assert_eq!(page(&p, &mut db), before);
    let stale = p.begin_scan(a, &mut db).unwrap();
    let current = p.begin_scan(a, &mut db).unwrap();
    assert!(p
        .stage_scan(&stale.token, vec![input("/stale.wav")], &mut db)
        .is_err());
    assert!(p
        .catalog_request(
            CatalogCommand::FinishScan { token: stale.token },
            None,
            &mut db
        )
        .is_err());
    assert_eq!(root(&mut p, &mut db, "/a"), a); // even same settings get a new root revision
    assert!(p
        .catalog_request(
            CatalogCommand::FinishScan {
                token: current.token
            },
            None,
            &mut db
        )
        .is_err());
    let partial = p.begin_scan(a, &mut db).unwrap();
    p.stage_scan(&partial.token, vec![input("/partial.wav")], &mut db)
        .unwrap();
    drop(db);
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    assert!(p
        .catalog_request(
            CatalogCommand::FinishScan {
                token: partial.token
            },
            None,
            &mut db
        )
        .is_err());
    let after = page(&p, &mut db);
    assert_eq!(after.rows, before.rows);
    assert_eq!(after.total, 1);
    let scan = p.begin_scan(a, &mut db).unwrap();
    p.stage_scan(&scan.token, vec![input("/replacement.wav")], &mut db)
        .unwrap();
    let before = page(&p, &mut db);
    let revision = p.snapshot().clone();
    for at in [
        "INSERT INTO media",
        "DELETE FROM root_memberships",
        "INSERT INTO root_memberships",
        "INSERT INTO request_receipts",
        "COMMIT",
    ] {
        let mut fault = Fault { db: &mut db, at };
        assert!(p
            .catalog_request(
                CatalogCommand::FinishScan {
                    token: scan.token.clone()
                },
                Some("finish-request"),
                &mut fault
            )
            .is_err());
        assert_eq!(p.snapshot(), &revision);
        assert_eq!(page(&p, &mut db), before);
    }
    let result = p
        .catalog_request(
            CatalogCommand::FinishScan {
                token: scan.token.clone(),
            },
            Some("finish-request"),
            &mut db,
        )
        .unwrap();
    assert_eq!(result.scan.unwrap().removed, 1);
    assert!(
        p.catalog_request(
            CatalogCommand::FinishScan { token: scan.token },
            Some("finish-request"),
            &mut db
        )
        .unwrap()
        .duplicate
    );
    assert_eq!(
        db.statement("SELECT count(*) FROM scan_stage", &[])
            .unwrap(),
        vec![vec![json!(0)]]
    );
}

#[test]
fn scan_budgets_bound_jobs_and_batches_and_root_settings_persist() {
    let dir = Temp::new();
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let roots = (0..9)
        .map(|n| root(&mut p, &mut db, &format!("/{n}")))
        .collect::<Vec<_>>();
    let mut scans = vec![];
    for n in &roots[..8] {
        scans.push(p.begin_scan(*n, &mut db).unwrap());
    }
    assert!(p.begin_scan(roots[8], &mut db).is_err());
    assert!(p
        .stage_scan(&scans[0].token, vec![input("/a"); MAX_BATCH + 1], &mut db)
        .is_err());
    p.cancel_scan(&scans[0].token, &mut db).unwrap();
    assert!(p.begin_scan(roots[8], &mut db).is_ok());
    let saved = p.managed_roots(&mut db).unwrap();
    assert_eq!(saved.len(), 9);
    assert!(!saved[0].config.settings.scan_on_launch);
    drop(db);
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let p = Profile::open(&mut db).unwrap();
    assert_eq!(p.managed_roots(&mut db).unwrap(), saved);
    // TEMP jobs did not survive the connection. All eight slots are free.
    for n in &roots[..8] {
        p.begin_scan(*n, &mut db).unwrap();
    }
}

#[test]
fn staging_byte_budgets_rollback_batches_and_replacement_releases_accounted_space() {
    let dir = Temp::new();
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let a = root(&mut p, &mut db, "/a");
    let b = root(&mut p, &mut db, "/b");
    let c = root(&mut p, &mut db, "/c");
    let first = p.begin_scan(a, &mut db).unwrap();
    p.stage_scan(&first.token, vec![input("/one")], &mut db)
        .unwrap();
    let before = p.snapshot().clone();
    // Inject accounting high-water marks instead of allocating hundreds of MiB
    // in the regression. The real SQL transaction must reject/rollback writes.
    db.statement(
        "UPDATE scan_stage SET byte_cost=? WHERE token=?",
        &[json!(first.max_bytes), json!(first.token)],
    )
    .unwrap();
    assert!(matches!(
        p.stage_scan(&first.token, vec![input("/two")], &mut db),
        Err(libzci::LibzciError::ResourceExhausted { .. })
    ));
    assert_eq!(
        db.statement("SELECT count(*) FROM scan_stage", &[])
            .unwrap(),
        vec![vec![json!(1)]]
    );
    assert_eq!(p.snapshot(), &before);
    p.stage_scan(&first.token, vec![input("/one")], &mut db)
        .unwrap(); // replacement uses its new cost, not another retained copy
    let second = p.begin_scan(b, &mut db).unwrap();
    p.stage_scan(&second.token, vec![input("/two")], &mut db)
        .unwrap();
    db.statement(
        "UPDATE scan_stage SET byte_cost=?",
        &[json!(first.max_bytes)],
    )
    .unwrap();
    let third = p.begin_scan(c, &mut db).unwrap();
    assert_eq!(third.max_total_bytes, first.max_bytes * 2);
    assert!(matches!(
        p.stage_scan(&third.token, vec![input("/three")], &mut db),
        Err(libzci::LibzciError::ResourceExhausted { .. })
    ));
    assert_eq!(
        db.statement(
            "SELECT count(*) FROM scan_stage WHERE token=?",
            &[json!(third.token)]
        )
        .unwrap(),
        vec![vec![json!(0)]]
    );
    p.cancel_scan(&first.token, &mut db).unwrap();
    assert_eq!(
        p.stage_scan(&third.token, vec![input("/three")], &mut db)
            .unwrap(),
        1
    );
    assert_eq!(
        page(&p, &mut db).total,
        0,
        "staging/failure never publishes partial membership"
    );
}
