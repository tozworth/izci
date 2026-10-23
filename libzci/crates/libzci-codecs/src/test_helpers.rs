//! Shared module test helpers: ports of the existing TS fixtures.
//!
//! `tone_module` ports `toneModule()` from
//! `src/lib/services/openmpt/test-fixtures.ts` byte-for-byte;
//! `blank_ahx`/`blank_hvl` port the blank-tune construction from
//! `src/lib/services/ahx-worklet.test.ts`. Blank Hively tunes prove
//! lifecycle only; audible M1 AHX/HVL and XM/S3M/IT/MO3 inputs are generated
//! separately by `tests/generate-m1-media.py`.

/// Minimal ProTracker MOD: 1 pattern (or 2 disconnected orders for the
/// two-subsong variant) plus a 1 KiB sine sample.
pub fn tone_module(two_subsongs: bool) -> Vec<u8> {
    let patterns = if two_subsongs { 2 } else { 1 };
    let mut bytes = vec![0u8; 1084 + patterns * 1024 + 1024];
    bytes[..14].copy_from_slice(b"izci WASM test");
    // DataView.setUint16 is big-endian.
    bytes[42] = 2;
    bytes[43] = 0;
    bytes[45] = 64;
    bytes[48] = 2;
    bytes[49] = 0;
    bytes[950] = patterns as u8;
    bytes[953] = 1;
    bytes[1080..1084].copy_from_slice(b"M.K.");
    for pattern in 0..patterns {
        let base = 1084 + pattern * 1024;
        bytes[base..base + 4].copy_from_slice(&[1, 172, 0x10, 0]);
        // Each disconnected order loops back to itself, producing
        // separate subsongs.
        if two_subsongs {
            bytes[base + 16..base + 20].copy_from_slice(&[0, 0, 0x0b, pattern as u8]);
        }
    }
    for (index, slot) in bytes[1084 + patterns * 1024..]
        .iter_mut()
        .enumerate()
        .take(1024)
    {
        let sample = ((index as f64 * std::f64::consts::PI / 16.0).sin() * 96.0).round() as i32;
        *slot = (sample & 0xff) as u8;
    }
    bytes
}

/// Blank AHX tune: one row, four channels, no instruments.
pub fn blank_ahx() -> Vec<u8> {
    blank_hively_tune(false)
}

/// Blank HVL tune: one row, four channels, no instruments.
pub fn blank_hvl() -> Vec<u8> {
    blank_hively_tune(true)
}

fn blank_hively_tune(hvl: bool) -> Vec<u8> {
    let header_length = if hvl { 16 } else { 14 };
    let names_offset = header_length + 8;
    let mut module = vec![0u8; names_offset + 5];
    module[..3].copy_from_slice(if hvl { b"HVL" } else { b"THX" });
    module[3] = 1;
    // DataView.setUint16 is big-endian.
    module[4] = (names_offset >> 8) as u8;
    module[5] = (names_offset & 0xff) as u8;
    module[6] = 0x80;
    module[7] = 1;
    module[10] = 1;
    module[names_offset..names_offset + 4].copy_from_slice(b"End\0");
    module
}
