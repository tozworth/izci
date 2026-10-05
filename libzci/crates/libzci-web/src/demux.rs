//! WASM Ogg demux helper for the decode worker.
//!
//! The same core reader the native provider uses, exposed with a
//! worker-friendly shape: the decode worker feeds page headers as it
//! scans the File with bounded synchronous reads, then splits page
//! bodies into transferable packets with carry threaded across pages.
//! No DOM, `File`, or codec APIs here — the JS glue owns those.

use libzci::{PageEntry, Result};

/// Incremental Ogg demuxer: header scan first, packet splits after.
#[derive(Debug, Default)]
pub struct OggDemux {
    pages: Vec<PageEntry>,
    carry: Vec<u8>,
}

impl OggDemux {
    /// Create an empty demuxer.
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one page header (the 27 + segment-count bytes at `offset`).
    /// Returns the entry; the worker reads bodies separately so header
    /// scans stay small.
    pub fn feed_header(&mut self, fixed27: &[u8], lacing: &[u8], offset: u64) -> Result<PageEntry> {
        if fixed27.len() < 27 || &fixed27[0..4] != b"OggS" || fixed27[4] != 0 {
            return Err(libzci::LibzciError::Corrupt {
                detail: format!("not an Ogg page at {offset}"),
            });
        }
        let header_type = fixed27[5];
        let granule = u64::from_le_bytes(fixed27[6..14].try_into().unwrap());
        let serial = u32::from_le_bytes(fixed27[14..18].try_into().unwrap());
        let seq = u32::from_le_bytes(fixed27[18..22].try_into().unwrap());
        let body_len: u64 = lacing.iter().map(|&s| s as u64).sum();
        let entry = PageEntry {
            offset,
            granule,
            serial,
            seq,
            header_type,
            header_len: (27 + lacing.len()) as u64,
            body_len,
        };
        self.pages.push(entry);
        Ok(entry)
    }

    /// Scanned entries (for the index report to the engine).
    pub fn pages(&self) -> &[PageEntry] {
        &self.pages
    }

    /// Validate the scanned index with the shared core rule.
    pub fn validate(&self) -> Result<libzci::IndexFacts> {
        libzci::validate_ogg_index(&self.pages)
    }

    /// Split one page body into packets, threading continued-packet
    /// carry. Returns owned packets; the bindings transfer their
    /// buffers without copying through JSON.
    pub fn split_page(&mut self, body: &[u8], lacing: &[u8], header_type: u8) -> Result<Vec<Vec<u8>>> {
        libzci::split_packets_with_carry(body, lacing, &mut self.carry, header_type)
    }

    /// Clear continued-packet carry (seek repositioning).
    pub fn reset_carry(&mut self) {
        self.carry.clear();
    }

    /// Pending carry length (diagnostics).
    pub fn carry_len(&self) -> usize {
        self.carry.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_scan_then_split() {
        let mut demux = OggDemux::new();
        // BOS page: OpusHead (19 bytes) alone.
        let mut head = vec![0u8; 19];
        head[0..8].copy_from_slice(b"OpusHead");
        head[8] = 1;
        head[9] = 1;
        let mut fixed = vec![0u8; 27];
        fixed[0..4].copy_from_slice(b"OggS");
        fixed[5] = 0x02;
        fixed[26] = 1;
        let entry = demux.feed_header(&fixed, &[19], 0).unwrap();
        assert_eq!(entry.body_len, 19);
        let packets = demux.split_page(&head, &[19], 0x02).unwrap();
        assert_eq!(packets.len(), 1);
        assert!(demux.validate().is_ok());
    }
}
