//! Debug helper: dump Opus page index and per-packet decode counts.
use libzci::{CancelFlag, MemSource, ProviderFactory};
use libzci_codecs::OpusFactory;
use std::sync::Arc;

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: opus-dump <file.opus>");
    let bytes = std::fs::read(&path).expect("read file");
    println!("file bytes: {}", bytes.len());
    // Raw page scan.
    let mut off = 0usize;
    let mut idx = 0;
    while off + 27 <= bytes.len() {
        if &bytes[off..off + 4] != b"OggS" {
            println!("page {idx}: NOT OggS at {off}");
            break;
        }
        let granule = u64::from_le_bytes(bytes[off + 6..off + 14].try_into().unwrap());
        let htype = bytes[off + 5];
        let seq = u32::from_le_bytes(bytes[off + 18..off + 22].try_into().unwrap());
        let nseg = bytes[off + 26] as usize;
        let body: usize = bytes[off + 27..off + 27 + nseg]
            .iter()
            .map(|&s| s as usize)
            .sum();
        let first_packet: Vec<u8> = {
            let mut len = 0;
            for &s in &bytes[off + 27..off + 27 + nseg] {
                len += s as usize;
                if s < 255 {
                    break;
                }
            }
            bytes[off + 27 + nseg..off + 27 + nseg + len.min(body)].to_vec()
        };
        let tag = if first_packet.starts_with(b"OpusHead") {
            "OpusHead"
        } else if first_packet.starts_with(b"OpusTags") {
            "OpusTags"
        } else {
            "audio"
        };
        println!(
            "page {idx}: off={off} granule={g} htype={htype:#04x} seq={seq} segs={nseg} body={body} first={tag}",
            g = if granule == u64::MAX { -1 } else { granule as i64 },
        );
        if nseg > 0 {
            println!("  lacing: {:?}", &bytes[off + 27..off + 27 + nseg]);
        }
        if idx == 0 {
            let p = &bytes[off + 27 + nseg..];
            println!(
                "  head: ch={} preskip={} gain_q8={} family={}",
                p[9],
                u16::from_le_bytes([p[10], p[11]]),
                i16::from_le_bytes([p[16], p[17]]),
                p[18]
            );
        }
        off += 27 + nseg + body;
        idx += 1;
    }
    // Provider decode accounting.
    let factory = OpusFactory::default();
    let cancel = CancelFlag::default();
    let mut inst = factory
        .open(Arc::new(MemSource::new(bytes)), &cancel)
        .expect("open");
    println!(
        "total_frames={:?} layout={:?}",
        inst.total_frames(),
        inst.layout()
    );
    let mut buf = vec![0.0f32; 480];
    let mut total = 0u64;
    let mut calls = 0;
    loop {
        let n = inst.decode_into(&mut buf, &cancel).expect("decode");
        if n == 0 {
            break;
        }
        total += n as u64;
        calls += 1;
    }
    println!(
        "decoded={total} calls={calls} position={}",
        inst.position_frames()
    );
}
