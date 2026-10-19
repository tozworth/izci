use libzci::*;
use std::{path::PathBuf, sync::Arc};
fn source(ext: &str) -> Arc<dyn RuntimeSource> {
    Arc::new(MemSource::new(
        std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../.local/libzci/media/m1")
                .join(format!("tone.{ext}")),
        )
        .unwrap(),
    ))
}
fn render(d: &mut dyn DecoderInstance) -> Vec<f32> {
    let mut all = Vec::new();
    let mut b = [0.; 8192];
    loop {
        let n = d.decode_into(&mut b, &CancelFlag::default()).unwrap();
        if n == 0 {
            return all;
        }
        all.extend_from_slice(&b[..n]);
        assert!(all.len() < 5_000_000);
    }
}
#[test]
fn audible_channel_mutes_interpolation_and_two_contexts() {
    let mut r = ProviderRegistry::new();
    r.register(Arc::new(libzci_codecs::OpenmptFactory::default()))
        .unwrap();
    r.register(Arc::new(libzci_codecs::HivelyFactory::default()))
        .unwrap();
    for ext in ["mod", "xm", "s3m", "it", "mo3", "ahx", "hvl"] {
        let c = CancelFlag::default();
        let src = source(ext);
        let mut a = r.open_best(src.clone(), Some(ext), &c).unwrap().1;
        let mut b = r.open_best(src, Some(ext), &c).unwrap().1;
        let normal = render(b.as_mut());
        assert!(normal.iter().any(|x| x.abs() > 0.05));
        a.module_control(
            ModuleControl::ChannelMute {
                channel: 0,
                mute: true,
            },
            &c,
        )
        .unwrap();
        assert!(
            render(a.as_mut()).iter().all(|x| x.abs() < 1e-6),
            "{ext} mute must be audible"
        );
        a.module_control(
            ModuleControl::ChannelMute {
                channel: 0,
                mute: false,
            },
            &c,
        )
        .unwrap();
        a.seek_to_frame(0, &c).unwrap();
        a.module_control(ModuleControl::Interpolation(8), &c)
            .unwrap();
        assert!(render(a.as_mut()).iter().any(|x| x.abs() > 0.05));
        assert_eq!(
            b.position_frames(),
            (normal.len() / 2) as u64,
            "other context moved"
        );
    }
}
#[test]
fn repeat_limit_is_finite_and_speed_changes_audible_length() {
    let c = CancelFlag::default();
    let mut d = libzci_codecs::OpenmptFactory::default()
        .open(source("mod"), &c)
        .unwrap();
    let original = d.total_frames().unwrap();
    d.module_control(ModuleControl::Speed(2.), &c).unwrap();
    assert_eq!(d.total_frames(), Some(original / 2));
    d.module_control(ModuleControl::LoopLimit(1), &c).unwrap();
    assert_eq!(d.total_frames(), Some(original));
    let all = render(d.as_mut());
    assert_eq!(all.len() / 2, original as usize);
    assert!(all[(original as usize)..].iter().any(|x| x.abs() > 0.05));
}
