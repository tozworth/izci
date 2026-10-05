//! Debug helper: dump module duration estimate vs actual render.
use std::sync::Arc;
use libzci::{CancelFlag, DecoderInstance, MemSource};
use libzci_codecs::{OpenmptInstance, OpenmptLimits};

fn main() {
    let path = std::env::args().nth(1).expect("usage: mod-dump <file>");
    let bytes = std::fs::read(&path).expect("read file");
    let cancel = CancelFlag::default();
    let mut inst = OpenmptInstance::open(
        Arc::new(MemSource::new(bytes)),
        OpenmptLimits::default(),
        &cancel,
    )
    .expect("open");
    let info = inst.inspect();
    println!("type={} title={:?} channels={} subsongs={}", info.tracker_type, info.title, info.channels, info.subsongs);
    println!("total_estimate={:?}", inst.total_frames());
    let mut buf = vec![0.0f32; 8192];
    let mut total = 0u64;
    let mut peak_tail = 0.0f32;
    let mut tail_buf = Vec::new();
    loop {
        let n = inst.decode_into(&mut buf, &cancel).expect("decode");
        if n == 0 {
            break;
        }
        total += n as u64 / 2;
        tail_buf.clear();
        tail_buf.extend_from_slice(&buf[..n]);
    }
    for s in tail_buf.iter().rev().take(9600) {
        peak_tail = peak_tail.max(s.abs());
    }
    println!("rendered_frames={total} position={} tail_peak_last_9600={peak_tail}", inst.position_frames());
}
