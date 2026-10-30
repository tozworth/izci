use libzci::{catalog::*, profile::Profile, queue::*, storage::SqlBridge, *};
use libzci_native::profile::NativeDatabase;
use serde_json::{json, Value};
struct Temp(std::path::PathBuf);
impl Temp {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!(
            "libzci-counts-{}-{}",
            std::process::id(),
            RequestId::fresh().0
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
fn add(p: &mut Profile, db: &mut dyn SqlBridge, key: &str, kind: MediaKind) -> u64 {
    p.catalog_request(
        CatalogCommand::Add {
            media: vec![MediaInput {
                source: source(key),
                kind,
                source_revision: "1".into(),
                metadata: Metadata {
                    title: key.into(),
                    ..Default::default()
                },
            }],
        },
        None,
        db,
    )
    .unwrap()
    .media[0]
}
fn event(
    binding: &str,
    sequence: u64,
    media: u64,
    key: &str,
    subsong: Option<u32>,
) -> QualifiedPlay {
    QualifiedPlay {
        binding: binding.into(),
        sequence,
        media,
        source_key: key.into(),
        subsong,
        played_at_ms: sequence * 1000,
    }
}
fn row(p: &Profile, db: &mut dyn SqlBridge, media: u64, subsong: Option<u32>) -> CatalogRow {
    p.catalog_query(
        &CatalogQuery {
            collection: Collection::All,
            media: Some(media),
            subsong,
            ..Default::default()
        },
        db,
    )
    .unwrap()
    .rows
    .remove(0)
}
#[test]
fn counts_are_atomic_library_facts_with_exact_subsong_scope_retries_and_reopen() {
    let dir = Temp::new();
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let media = add(&mut p, &mut db, "/module.it", MediaKind::Module);
    let image = add(&mut p, &mut db, "/cover.png", MediaKind::Image);
    assert_eq!(
        p.play_count_eligibility("/module.it", &mut db).unwrap(),
        Some(media)
    );
    assert_eq!(
        p.play_count_eligibility("/queue-only.wav", &mut db)
            .unwrap(),
        None
    );
    assert_eq!(
        p.play_count_eligibility("/cover.png", &mut db).unwrap(),
        None
    );
    p.catalog_request(
        CatalogCommand::Favorite {
            media,
            subsong: None,
            favorite: true,
        },
        None,
        &mut db,
    )
    .unwrap();
    p.catalog_request(
        CatalogCommand::Rate {
            media,
            subsong: Some(0),
            rating: 7,
        },
        None,
        &mut db,
    )
    .unwrap();
    let binding = p.begin_play_counting(&mut db).unwrap();
    let first = event(&binding, 1, media, "/module.it", Some(0));
    let outcome = p.commit_qualified_plays(&[first.clone()], &mut db).unwrap();
    assert_eq!(outcome.counted, 1);
    assert_eq!(row(&p, &mut db, media, None).facts.play_count, 1);
    assert_eq!(row(&p, &mut db, media, Some(0)).facts.play_count, 1);
    assert_eq!(row(&p, &mut db, media, Some(1)).facts.play_count, 0);
    assert!(row(&p, &mut db, media, None).facts.favorite);
    assert_eq!(row(&p, &mut db, media, Some(0)).facts.rating, 7);
    let before = p.snapshot().clone();
    let duplicate = p.commit_qualified_plays(&[first.clone()], &mut db).unwrap();
    assert_eq!(duplicate.duplicates, 1);
    assert_eq!(p.snapshot(), &before);
    let mut altered = first.clone();
    altered.played_at_ms = 9;
    assert!(p.commit_qualified_plays(&[altered], &mut db).is_err());
    let second = event(&binding, 2, media, "/module.it", Some(1));
    assert_eq!(
        p.commit_qualified_plays(&[first.clone(), second.clone()], &mut db)
            .unwrap()
            .counted,
        1
    );
    assert_eq!(row(&p, &mut db, media, None).facts.play_count, 2);
    assert_eq!(row(&p, &mut db, media, Some(1)).facts.play_count, 1);
    p = Profile::open(&mut db).unwrap();
    assert_eq!(
        p.commit_qualified_plays(&[second], &mut db)
            .unwrap()
            .duplicates,
        1
    );
    p.catalog_request(CatalogCommand::Remove { media: vec![media] }, None, &mut db)
        .unwrap();
    let removed = event(&binding, 3, media, "/module.it", None);
    let before = p.snapshot().clone();
    assert_eq!(
        p.commit_qualified_plays(&[removed.clone()], &mut db)
            .unwrap()
            .ignored,
        1
    );
    assert_eq!(p.snapshot(), &before);
    assert_eq!(add(&mut p, &mut db, "/module.it", MediaKind::Module), media);
    assert_eq!(
        p.commit_qualified_plays(&[removed], &mut db)
            .unwrap()
            .duplicates,
        1
    );
    assert_eq!(row(&p, &mut db, media, None).facts.play_count, 2);
    assert_eq!(
        p.commit_qualified_plays(&[event(&binding, 4, image, "/cover.png", None)], &mut db)
            .unwrap()
            .ignored,
        1
    );
    assert_eq!(row(&p, &mut db, image, None).facts.play_count, 0);
    let fresh = p.begin_play_counting(&mut db).unwrap();
    let mut earlier = event(&fresh, 1, media, "/module.it", None);
    earlier.played_at_ms = 1;
    p.commit_qualified_plays(&[earlier], &mut db).unwrap();
    assert_eq!(
        row(&p, &mut db, media, None).facts.last_played_ms,
        Some(2000)
    );
    drop(p);
    drop(db);
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    assert_eq!(row(&p, &mut db, media, None).facts.play_count, 3);
    assert!(p.commit_qualified_plays(&[first], &mut db).is_err());
}
struct Fault<'a> {
    db: &'a mut NativeDatabase,
    at: &'static str,
}
impl SqlBridge for Fault<'_> {
    fn statement(&mut self, sql: &str, bind: &[Value]) -> Result<Vec<Vec<Value>>> {
        if sql.starts_with(self.at) {
            Err(storage::failure("quota", "injected"))
        } else {
            self.db.statement(sql, bind)
        }
    }
}
#[test]
fn failed_transactions_rollback_facts_revisions_receipts_and_binding_high_water() {
    let dir = Temp::new();
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let media = add(&mut p, &mut db, "/a.wav", MediaKind::Audio);
    let binding = p.begin_play_counting(&mut db).unwrap();
    let play = event(&binding, 1, media, "/a.wav", None);
    let before = p.snapshot().clone();
    for at in [
        "INSERT INTO user_facts",
        "INSERT INTO play_count_receipts",
        "UPDATE play_count_bindings",
        "INSERT OR REPLACE INTO sessions",
        "COMMIT",
    ] {
        assert!(
            p.commit_qualified_plays(&[play.clone()], &mut Fault { db: &mut db, at })
                .is_err(),
            "{at}"
        );
        assert_eq!(p.snapshot(), &before);
        assert_eq!(row(&p, &mut db, media, None).facts.play_count, 0);
        assert_eq!(
            db.statement(
                "SELECT last_sequence FROM play_count_bindings WHERE token=?",
                &[json!(binding)]
            )
            .unwrap(),
            vec![vec![json!(0)]]
        );
        assert_eq!(
            db.statement("SELECT count(*) FROM play_count_receipts", &[])
                .unwrap(),
            vec![vec![json!(0)]]
        );
    }
    let mut bad = event(&binding, 2, media, "/wrong.wav", None);
    assert!(p
        .commit_qualified_plays(&[play.clone(), bad.clone()], &mut db)
        .is_err());
    assert_eq!(row(&p, &mut db, media, None).facts.play_count, 0);
    bad.source_key = "/a.wav".into();
    assert_eq!(
        p.commit_qualified_plays(&[play, bad], &mut db)
            .unwrap()
            .counted,
        2
    );
    db.statement(
        "UPDATE user_facts SET play_count=9007199254740991 WHERE media_id=?",
        &[json!(media)],
    )
    .unwrap();
    let before = p.snapshot().clone();
    assert!(p
        .commit_qualified_plays(&[event(&binding, 3, media, "/a.wav", None)], &mut db)
        .is_err());
    assert_eq!(p.snapshot(), &before);
}
#[test]
fn binding_and_receipt_budgets_refuse_stale_or_out_of_order_replays_without_double_counts() {
    let dir = Temp::new();
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let media = add(&mut p, &mut db, "/a.wav", MediaKind::Audio);
    let binding = p.begin_play_counting(&mut db).unwrap();
    for seq in 1..=70 {
        p.commit_qualified_plays(&[event(&binding, seq, media, "/a.wav", None)], &mut db)
            .unwrap();
    }
    assert_eq!(
        db.statement("SELECT count(*) FROM play_count_receipts", &[])
            .unwrap(),
        vec![vec![json!(64)]]
    );
    assert_eq!(row(&p, &mut db, media, None).facts.play_count, 70);
    let retained = (7..=70)
        .map(|seq| event(&binding, seq, media, "/a.wav", None))
        .collect::<Vec<_>>();
    assert_eq!(
        p.commit_qualified_plays(&retained, &mut db)
            .unwrap()
            .duplicates,
        64
    );
    assert!(p
        .commit_qualified_plays(
            &[
                event(&binding, 71, media, "/a.wav", None),
                event(&binding, 1, media, "/a.wav", None)
            ],
            &mut db
        )
        .is_err());
    assert_eq!(row(&p, &mut db, media, None).facts.play_count, 70);
    assert!(p
        .commit_qualified_plays(&[event(&binding, 72, media, "/a.wav", None)], &mut db)
        .is_err());
    assert_eq!(
        p.commit_qualified_plays(&[event(&binding, 71, media, "/a.wav", None)], &mut db)
            .unwrap()
            .counted,
        1
    );
    let mut bindings = vec![binding.clone()];
    for _ in 1..256 {
        bindings.push(p.begin_play_counting(&mut db).unwrap());
    }
    assert!(p.begin_play_counting(&mut db).is_err());
    p.close_play_counting(&binding, &mut db).unwrap();
    assert_eq!(
        db.statement("SELECT count(*) FROM play_count_receipts", &[])
            .unwrap(),
        vec![vec![json!(0)]]
    );
    assert!(p
        .commit_qualified_plays(&[event(&binding, 71, media, "/a.wav", None)], &mut db)
        .is_err());
    assert!(p.begin_play_counting(&mut db).is_ok());
}

fn sync(
    p: &mut Profile,
    db: &mut dyn SqlBridge,
    binding: &mut libzci::profile::ProfilePlayback,
    s: &mut Session,
) -> libzci::profile::PlaybackSync {
    let plan = binding
        .prepare(
            p,
            libzci::profile::PlaybackObservation {
                snapshot: s.snapshot(),
                qualified: s.qualified_plays(),
            },
            db,
        )
        .unwrap();
    for ack in &plan.acknowledged {
        s.acknowledge_plays(&ack.binding, ack.sequence).unwrap();
    }
    for command in &plan.commands {
        s.accept(command).unwrap();
    }
    plan
}
#[test]
fn profile_coordinator_counts_consumption_and_reconciles_membership_without_shell_policy() {
    let dir = Temp::new();
    let mut db = NativeDatabase::open(&dir.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let media = add(&mut p, &mut db, "/song.wav", MediaKind::Audio);
    let mut settings = p.snapshot().settings.clone();
    settings.volume = 0.02;
    settings.play_counts.threshold_seconds = 1;
    p.command(QueueCommand::Settings { settings }, Some(&mut db))
        .unwrap();
    let mut s = Session::new(SessionId::fresh());
    let mut binding = libzci::profile::ProfilePlayback::attach(&p, &s.snapshot(), &mut db).unwrap();
    sync(&mut p, &mut db, &mut binding, &mut s);
    assert_eq!(s.snapshot().volume, 0.02);
    let load = |s: &mut Session| {
        s.accept(&Command::Load {
            session: s.id(),
            request_id: RequestId::fresh(),
            source: SourceId::fresh(),
            extension_hint: Some("wav".into()),
            options: LoadOptions {
                context: Some(PlaybackContext {
                    reference: source("/song.wav"),
                    library_media: None,
                }),
                ..Default::default()
            },
        })
        .unwrap();
        let metadata = libzci::provider::FakeFactory::new(480000, PcmLayout::mono48k())
            .open(
                std::sync::Arc::new(MemSource::new(b"FAKE".to_vec())),
                &CancelFlag::default(),
            )
            .unwrap()
            .metadata();
        assert!(s.opened(s.tag(), metadata, ModuleCapabilities::default(), 0));
    };
    load(&mut s);
    sync(&mut p, &mut db, &mut binding, &mut s);
    assert_eq!(
        s.snapshot().context.as_ref().unwrap().library_media,
        Some(media)
    );
    s.output_state(RunningState::Running);
    s.accept(&Command::Play {
        session: s.id(),
        request_id: RequestId::fresh(),
    })
    .unwrap();
    let consume = |s: &mut Session, frames: u64| {
        s.consumed(
            s.generation(),
            PlaybackProgress {
                position_frames: frames,
                consumed_frames: frames,
                output_rate: 48000,
                observed_at_ms: 1000 + frames / 48,
            },
            false,
        )
        .unwrap();
    };
    consume(&mut s, 4800);
    consume(&mut s, 52800);
    assert_eq!(s.qualified_plays().len(), 1);
    // Persisting an observation twice is safe even if acknowledgement was lost.
    let observation = || libzci::profile::PlaybackObservation {
        snapshot: s.snapshot(),
        qualified: s.qualified_plays(),
    };
    let plan = binding.prepare(&mut p, observation(), &mut db).unwrap();
    assert_eq!(plan.counts.unwrap().counted, 1);
    assert_eq!(
        binding
            .prepare(&mut p, observation(), &mut db)
            .unwrap()
            .counts
            .unwrap()
            .duplicates,
        1
    );
    sync(&mut p, &mut db, &mut binding, &mut s);
    assert!(s.qualified_plays().is_empty());
    assert_eq!(row(&p, &mut db, media, None).facts.play_count, 1);
    // Removing then re-adding membership starts a fresh segment, without reloading audio.
    p.catalog_request(CatalogCommand::Remove { media: vec![media] }, None, &mut db)
        .unwrap();
    sync(&mut p, &mut db, &mut binding, &mut s);
    assert_eq!(s.snapshot().context.as_ref().unwrap().library_media, None);
    consume(&mut s, 148800);
    assert!(s.qualified_plays().is_empty());
    add(&mut p, &mut db, "/song.wav", MediaKind::Audio);
    sync(&mut p, &mut db, &mut binding, &mut s);
    consume(&mut s, 153600);
    consume(&mut s, 201600);
    sync(&mut p, &mut db, &mut binding, &mut s);
    assert_eq!(row(&p, &mut db, media, None).facts.play_count, 2);
    // A prepared command for a replaced load must not change its eligibility.
    let old_instance = s.snapshot().source_instance;
    load(&mut s);
    s.accept(&Command::CountEligibility {
        session: s.id(),
        request_id: RequestId::fresh(),
        instance: old_instance,
        source_key: "/song.wav".into(),
        media: Some(media),
    })
    .unwrap();
    assert_eq!(s.snapshot().context.as_ref().unwrap().library_media, None);
    sync(&mut p, &mut db, &mut binding, &mut s);
    binding.close(&p, &mut db).unwrap();
    assert!(binding
        .prepare(
            &mut p,
            libzci::profile::PlaybackObservation {
                snapshot: s.snapshot(),
                qualified: vec![]
            },
            &mut db
        )
        .is_err());
}
