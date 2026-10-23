use libzci::{profile::Profile, queue::*, storage::SqlBridge};
use libzci_native::profile::{NativeDatabase, NativeProfile};
use serde_json::{json, Value};
fn dir() -> std::path::PathBuf {
    let p = std::env::temp_dir().join(format!(
        "libzci-m2-{}-{}",
        std::process::id(),
        libzci::RequestId::fresh().0
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}
fn source() -> SourceReference {
    SourceReference {
        key: "a".into(),
        kind: SourceKind::NativePath,
        locator: "/a.wav".into(),
        display_path: "a.wav".into(),
    }
}
#[test]
fn durable_duplicates_order_settings_reopen_and_lock() {
    let path = dir();
    {
        let mut p = NativeProfile::open(&path).unwrap();
        assert!(NativeProfile::open(&path).is_err());
        p.command(QueueCommand::Append {
            sources: vec![source(), source(), source()],
        })
        .unwrap();
        p.command(QueueCommand::Move { id: 3, index: 0 }).unwrap();
        p.command(QueueCommand::Play { id: 2 }).unwrap();
        p.command(QueueCommand::Settings {
            settings: QueueSettings {
                volume: 0.42,
                repeat: Repeat::All,
                ..Default::default()
            },
        })
        .unwrap();
        p.command(QueueCommand::Checkpoint {
            position_seconds: 1.25,
            subsong: Some(2),
        })
        .unwrap();
    }
    let p = NativeProfile::open(&path).unwrap();
    let s = p.core.snapshot();
    assert_eq!(
        s.queue.items.iter().map(|i| i.id).collect::<Vec<_>>(),
        vec![3, 1, 2]
    );
    assert_eq!(s.settings.volume, 0.42);
    assert_eq!(s.sources.len(), 1);
    let restore = s.restore().unwrap();
    assert_eq!(restore.position_seconds, 1.25);
    assert!(!restore.autoplay);
    assert_eq!(restore.subsong, Some(2));
    drop(p);
    std::fs::remove_dir_all(path).unwrap();
}
struct Fault<'a> {
    db: &'a mut NativeDatabase,
    at: &'static str,
    code: &'static str,
}
impl SqlBridge for Fault<'_> {
    fn statement(&mut self, sql: &str, bind: &[Value]) -> libzci::Result<Vec<Vec<Value>>> {
        if sql.starts_with(self.at) {
            Err(libzci::storage::failure(self.code, "injected"))
        } else {
            self.db.statement(sql, bind)
        }
    }
}
#[test]
fn failed_writes_and_commit_publish_nothing_and_preserve_data() {
    let path = dir();
    let mut db = NativeDatabase::open(&path).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    p.command(
        QueueCommand::Append {
            sources: vec![source()],
        },
        Some(&mut db),
    )
    .unwrap();
    let before = p.snapshot().clone();
    for (at, code) in [
        ("BEGIN", "busy"),
        ("INSERT INTO queue", "quota"),
        ("COMMIT", "io"),
    ] {
        let mut fault = Fault {
            db: &mut db,
            at,
            code,
        };
        assert!(p
            .command(
                QueueCommand::Append {
                    sources: vec![source()]
                },
                Some(&mut fault)
            )
            .is_err());
        assert_eq!(p.snapshot(), &before);
        assert_eq!(Profile::open(&mut db).unwrap().snapshot(), &before);
    }
    db.statement("PRAGMA user_version=999", &[]).unwrap();
    assert!(Profile::open(&mut db).is_err());
    assert_eq!(
        db.statement("SELECT count(*) FROM queue_occurrences", &[])
            .unwrap(),
        vec![vec![json!(1)]]
    );
    drop(db);
    std::fs::remove_dir_all(path).unwrap();
}
#[test]
fn transient_navigation_handles_duplicate_identity_history_up_next_and_shuffle_cycles() {
    let mut p = Profile::transient();
    let run = |p: &mut Profile, c| p.command(c, None).unwrap();
    run(
        &mut p,
        QueueCommand::Append {
            sources: vec![source(); 4],
        },
    );
    run(&mut p, QueueCommand::Play { id: 2 });
    run(&mut p, QueueCommand::UpNext { id: 4 });
    assert_eq!(
        run(&mut p, QueueCommand::Next { ended: true })
            .load
            .unwrap()
            .occurrence,
        4
    );
    assert_eq!(
        run(
            &mut p,
            QueueCommand::Previous {
                position_seconds: 4.
            }
        )
        .load
        .unwrap()
        .occurrence,
        4
    );
    assert_eq!(
        run(
            &mut p,
            QueueCommand::Previous {
                position_seconds: 0.
            }
        )
        .load
        .unwrap()
        .occurrence,
        2
    );
    run(
        &mut p,
        QueueCommand::Settings {
            settings: QueueSettings {
                shuffle: true,
                ..Default::default()
            },
        },
    );
    let mut seen = vec![2];
    for _ in 0..3 {
        seen.push(
            run(&mut p, QueueCommand::Next { ended: true })
                .load
                .unwrap()
                .occurrence,
        );
    }
    seen.sort();
    assert_eq!(seen, vec![1, 2, 3, 4]);
    let end = run(&mut p, QueueCommand::Next { ended: true });
    assert!(!end.stop && end.load.is_none());
    run(&mut p, QueueCommand::Remove { id: 2 });
    assert_eq!(p.snapshot().queue.items.len(), 3);
}

#[test]
fn durable_request_retries_do_not_append_or_publish_twice_after_reopen() {
    let path = dir();
    let command = QueueCommand::Append {
        sources: vec![source()],
    };
    {
        let mut db = NativeDatabase::open(&path).unwrap();
        let mut p = Profile::open(&mut db).unwrap();
        let a = p
            .request(command.clone(), Some("0:request-1"), Some(&mut db))
            .unwrap();
        assert_eq!(a.appended, vec![1]);
    }
    let mut db = NativeDatabase::open(&path).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let a = p
        .request(command.clone(), Some("0:request-1"), Some(&mut db))
        .unwrap();
    assert!(a.duplicate);
    assert_eq!(a.appended, vec![1]);
    assert_eq!(p.snapshot().revision, 1);
    assert_eq!(p.snapshot().queue.items.len(), 1);
    assert!(p
        .request(
            QueueCommand::Remove { id: 1 },
            Some("0:request-1"),
            Some(&mut db)
        )
        .is_err());
    for n in 0..160 {
        p.request(
            QueueCommand::Mute { mute: n % 2 == 0 },
            Some(&format!("mute-{n}")),
            Some(&mut db),
        )
        .unwrap();
    }
    assert_eq!(
        db.statement("SELECT count(*) FROM request_receipts", &[])
            .unwrap(),
        vec![vec![json!(128)]]
    );
    assert!(p
        .request(command, Some("0:request-1"), Some(&mut db))
        .is_err());
    assert_eq!(p.snapshot().queue.items.len(), 1);
    drop(db);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn navigation_preserves_existing_one_item_repeat_and_shuffle_history_outcomes() {
    let mut p = Profile::transient();
    let run = |p: &mut Profile, c| p.command(c, None).unwrap();
    run(
        &mut p,
        QueueCommand::Append {
            sources: vec![source()],
        },
    );
    run(&mut p, QueueCommand::Play { id: 1 });
    assert_eq!(
        run(&mut p, QueueCommand::Next { ended: false })
            .load
            .unwrap()
            .occurrence,
        1
    );
    assert!(run(&mut p, QueueCommand::Next { ended: true })
        .load
        .is_none());
    run(
        &mut p,
        QueueCommand::Settings {
            settings: QueueSettings {
                repeat: Repeat::One,
                ..Default::default()
            },
        },
    );
    assert_eq!(
        run(&mut p, QueueCommand::Next { ended: true })
            .load
            .unwrap()
            .occurrence,
        1
    );
    run(
        &mut p,
        QueueCommand::Append {
            sources: vec![source(); 2],
        },
    );
    run(
        &mut p,
        QueueCommand::Settings {
            settings: QueueSettings {
                shuffle: true,
                ..Default::default()
            },
        },
    );
    let second = run(&mut p, QueueCommand::Next { ended: false })
        .load
        .unwrap()
        .occurrence;
    let third = run(&mut p, QueueCommand::Next { ended: false })
        .load
        .unwrap()
        .occurrence;
    assert_eq!(
        run(
            &mut p,
            QueueCommand::Previous {
                position_seconds: 0.
            }
        )
        .load
        .unwrap()
        .occurrence,
        second
    );
    assert_eq!(
        run(
            &mut p,
            QueueCommand::Previous {
                position_seconds: 0.
            }
        )
        .load
        .unwrap()
        .occurrence,
        1
    );
    assert_eq!(
        run(&mut p, QueueCommand::Next { ended: false })
            .load
            .unwrap()
            .occurrence,
        second
    );
    assert_eq!(
        run(&mut p, QueueCommand::Next { ended: false })
            .load
            .unwrap()
            .occurrence,
        third
    );
}
