use libzci::images::*;
fn facts() -> ImageFacts {
    ImageFacts {
        mime: "image/png".into(),
        width: 2,
        height: 3,
        display_width: 3,
        display_height: 2,
        orientation: 6,
        bits_per_pixel: 32,
        alpha: true,
        icc_bytes: 0,
        icc_sha256: None,
    }
}
#[test]
fn captured_order_boundaries_wrapping_and_generation_fences_are_independent() {
    let mut view = ImageSession::default();
    let initial = view
        .open(
            ImageSequence {
                revision: 12,
                media: vec![9, 2, 7],
            },
            2,
        )
        .unwrap();
    assert_eq!(
        (initial.media, initial.index, initial.count),
        (Some(2), Some(1), 3)
    );
    assert!(view
        .complete(initial.session, initial.generation, 2, facts())
        .unwrap());
    let last = view.navigate(ImageNavigation::Next, false).unwrap();
    assert_eq!(last.media, Some(7));
    assert!(last.facts.is_none());
    assert!(!view
        .complete(initial.session, initial.generation, 2, facts())
        .unwrap());
    assert_eq!(view.navigate(ImageNavigation::Next, false).unwrap(), last);
    assert_eq!(
        view.navigate(ImageNavigation::Next, true).unwrap().media,
        Some(9)
    );
    assert_eq!(
        view.navigate(ImageNavigation::Previous, true)
            .unwrap()
            .media,
        Some(7)
    );
    assert_eq!(
        view.navigate(ImageNavigation::First, false).unwrap().media,
        Some(9)
    );
    assert_eq!(
        view.navigate(ImageNavigation::Select { media: 2 }, false)
            .unwrap()
            .media,
        Some(2)
    );
    let before = view.snapshot();
    assert!(view
        .navigate(ImageNavigation::Select { media: 3 }, false)
        .is_err());
    assert_eq!(view.snapshot(), before);
    let refreshed = view.navigate(ImageNavigation::Refresh, false).unwrap();
    assert_ne!(refreshed.generation, before.generation);
    assert_eq!(refreshed.media, before.media);
    assert!(!view
        .complete(before.session, before.generation, 2, facts())
        .unwrap());
    let closed = view.close().unwrap();
    assert_eq!((closed.media, closed.count, closed.facts), (None, 0, None));
    assert!(!view
        .complete(before.session, before.generation, 2, facts())
        .unwrap());
    assert!(view.navigate(ImageNavigation::First, false).is_err());
    assert_eq!(view.close().unwrap(), view.snapshot());
}
#[test]
fn invalid_sequences_and_other_sessions_never_replace_current_state() {
    let mut view = ImageSession::default();
    let current = view
        .open(
            ImageSequence {
                revision: 1,
                media: vec![1],
            },
            1,
        )
        .unwrap();
    for ids in [
        vec![],
        vec![1, 1],
        vec![0],
        vec![9007199254740992],
        vec![1; MAX_IMAGE_SEQUENCE + 1],
    ] {
        assert!(view
            .open(
                ImageSequence {
                    revision: 1,
                    media: ids
                },
                1
            )
            .is_err());
        assert_eq!(view.snapshot(), current);
    }
    assert!(view
        .open(
            ImageSequence {
                revision: 1,
                media: vec![3]
            },
            1
        )
        .is_err());
    assert_eq!(view.snapshot(), current);
    let mut other = ImageSession::default();
    let other = other
        .open(
            ImageSequence {
                revision: 1,
                media: vec![1],
            },
            1,
        )
        .unwrap();
    assert!(!view
        .complete(other.session, other.generation, 1, facts())
        .unwrap());
    let mut invalid = facts();
    invalid.orientation = 0;
    assert!(view
        .complete(current.session, current.generation, 1, invalid)
        .is_err());
    assert_eq!(view.snapshot(), current);
}
