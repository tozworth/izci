//! Ordinary audio decoding on native and WASM, through the same range source.
//! Packet storage is bounded; accurate seeks reset and discard on the audible
//! timeline, including codec delay/end padding exactly once.
use libzci::*;
use std::{io::{self, Read, Seek, SeekFrom}, sync::{Arc, Mutex}};
use symphonia::core::{
    audio::SampleBuffer, codecs::{Decoder, DecoderOptions},
    errors::Error, formats::{FormatOptions, FormatReader},
    io::{MediaSource, MediaSourceStream}, meta::MetadataOptions, probe::Hint,
};

pub const INFO: ProviderInfo = ProviderInfo {
    id: ProviderId("org.symphonia.audio"), version: "0.5.5", display_name: "Symphonia",
};
#[derive(Default)]
pub struct SymphoniaFactory;
impl ProviderFactory for SymphoniaFactory {
    fn info(&self) -> ProviderInfo { INFO }
    fn probe(&self, input: &ProbeInput<'_>) -> ProbeScore {
        if libzci::format::sniff_ordinary_audio(input.header) { ProbeScore::Magic } else { ProbeScore::No }
    }
    fn open(&self, source: Arc<dyn RuntimeSource>, cancel: &CancelFlag) -> Result<Box<dyn DecoderInstance>> {
        Ok(Box::new(SymphoniaInstance::open(source, cancel)?))
    }
}

struct Input {
    source: Arc<dyn RuntimeSource>, position: u64, cancel: Arc<Mutex<CancelFlag>>,
    error: Arc<Mutex<Option<LibzciError>>>,
}
impl Read for Input {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let len = out.len().min(32768);
        match self.source.read_at(self.position, &mut out[..len], &self.cancel.lock().unwrap()) {
            Ok(n) => { self.position += n as u64; Ok(n) }
            Err(e) => { *self.error.lock().unwrap() = Some(e); Err(io::Error::other("source read failed")) }
        }
    }
}
impl Seek for Input {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        let p = match from {
            SeekFrom::Start(p) => p as i128,
            SeekFrom::Current(p) => self.position as i128 + p as i128,
            SeekFrom::End(p) => self.source.len().ok_or_else(|| io::Error::other("unknown source length"))? as i128 + p as i128,
        };
        if p < 0 || p > u64::MAX as i128 { return Err(io::Error::other("invalid seek")); }
        self.position = p as u64; Ok(self.position)
    }
}
impl MediaSource for Input {
    fn is_seekable(&self) -> bool { self.source.caps().seekable }
    fn byte_len(&self) -> Option<u64> { self.source.len() }
}

pub struct SymphoniaInstance {
    source: Arc<dyn RuntimeSource>, format: Box<dyn FormatReader>, decoder: Box<dyn Decoder>,
    track: u32, layout: PcmLayout, total: Option<u64>, position: u64,
    pending: Vec<f32>, offset: usize, comments: Vec<(String,String)>,
    read_error: Arc<Mutex<Option<LibzciError>>>,
    cancel: Arc<Mutex<CancelFlag>>,
}
impl SymphoniaInstance {
    pub fn open(source: Arc<dyn RuntimeSource>, cancel: &CancelFlag) -> Result<Self> {
        cancel.check()?;
        let error = Arc::new(Mutex::new(None));
        let token = Arc::new(Mutex::new(cancel.clone()));
        let input = Input { source: source.clone(), position: 0, cancel: token.clone(), error: error.clone() };
        let stream = MediaSourceStream::new(Box::new(input), Default::default());
        let mut probed = symphonia::default::get_probe().format(&Hint::new(), stream,
            &FormatOptions { enable_gapless: true, ..Default::default() }, &MetadataOptions::default())
            .map_err(|e| map_error(e, &error))?;
        let track = probed.format.default_track().ok_or_else(|| LibzciError::Unsupported { detail: "no audio track".into() })?;
        let params = &track.codec_params;
        let channels = params.channels.ok_or_else(|| LibzciError::Unsupported { detail: "unknown channel layout".into() })?.count();
        let layout = PcmLayout::new(match channels { 1 => ChannelLayout::Mono, 2 => ChannelLayout::Stereo,
            _ => return Err(LibzciError::Unsupported { detail: "ordinary audio supports mono/stereo".into() }) },
            params.sample_rate.ok_or_else(|| LibzciError::Corrupt { detail: "missing sample rate".into() })?)?;
        let decoder = symphonia::default::get_codecs().make(params, &DecoderOptions::default()).map_err(|e| map_error(e, &error))?;
        let total = params.n_frames;
        let track_id = track.id;
        let mut comments = Vec::new();
        if let Some(rev) = probed.metadata.get().as_ref().and_then(|m| m.current()) {
            comments.extend(rev.tags().iter().take(128).map(|t| (t.key.clone(), t.value.to_string())));
        }
        if let Some(rev) = probed.format.metadata().current() {
            comments.extend(rev.tags().iter().take(128).map(|t| (t.key.clone(), t.value.to_string())));
        }
        for (key,value) in &mut comments { key.truncate(key.floor_char_boundary(256)); value.truncate(value.floor_char_boundary(4096)); }
        Ok(Self { source, format: probed.format, decoder, track: track_id, layout, total,
            position: 0, pending: Vec::new(), offset: 0, comments, read_error: error, cancel: token })
    }
    fn packet(&mut self, cancel: &CancelFlag) -> Result<bool> {
        loop {
            cancel.check()?;
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(Error::IoError(e)) if e.kind() == io::ErrorKind::UnexpectedEof => {
                    if let Some(e) = self.read_error.lock().unwrap().take() { return Err(e); }
                    if self.total.is_some_and(|n| self.position < n) {
                        return Err(LibzciError::Corrupt { detail: "audio ended before declared duration".into() });
                    }
                    return Ok(false);
                }
                Err(e) => return Err(map_error(e, &self.read_error)),
            };
            if packet.track_id() != self.track { continue; }
            let decoded = self.decoder.decode(&packet).map_err(|e| map_error(e, &self.read_error))?;
            if decoded.spec().rate != self.layout.sample_rate || decoded.spec().channels.count() != self.layout.layout.channels() as usize {
                return Err(LibzciError::Unsupported { detail: "changing audio layout".into() });
            }
            if decoded.capacity() > 1 << 20 { return Err(LibzciError::ResourceExhausted { detail: "audio packet exceeds sample budget".into() }); }
            let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
            samples.copy_interleaved_ref(decoded);
            self.pending.clear(); self.pending.extend_from_slice(samples.samples()); self.offset = 0;
            if self.pending.iter().any(|v| !v.is_finite()) { return Err(LibzciError::Corrupt { detail: "nonfinite audio".into() }); }
            if !self.pending.is_empty() { return Ok(true); }
        }
    }
}
fn map_error(e: Error, read_error: &Mutex<Option<LibzciError>>) -> LibzciError {
    if let Some(e) = read_error.lock().unwrap().take() { return e; }
    match e {
        Error::Unsupported(s) => LibzciError::Unsupported { detail: s.into() },
        _ => LibzciError::Corrupt { detail: e.to_string() },
    }
}
impl DecoderInstance for SymphoniaInstance {
    fn info(&self) -> ProviderInfo { INFO }
    fn layout(&self) -> PcmLayout { self.layout }
    fn total_frames(&self) -> Option<u64> { self.total }
    fn position_frames(&self) -> u64 { self.position }
    fn metadata(&self) -> ProviderMetadata { ProviderMetadata { info: INFO, layout: self.layout, total_frames: self.total,
        applied: AppliedAdjustments { trimmed_preskip: true, trimmed_end: true, applied_header_gain: false },
        declared_channels: self.layout.layout.channels(), comments: self.comments.clone() } }
    fn decode_into(&mut self, out: &mut [f32], cancel: &CancelFlag) -> Result<usize> {
        cancel.check()?;
        *self.cancel.lock().unwrap() = cancel.clone();
        let ch = self.layout.layout.channels() as usize;
        let len = out.len() / ch * ch;
        if len == 0 { return Err(LibzciError::InvalidArgument { detail: "decode buffer holds no frame".into() }); }
        if self.offset == self.pending.len() && !self.packet(cancel)? { return Ok(0); }
        let n = len.min(self.pending.len() - self.offset);
        out[..n].copy_from_slice(&self.pending[self.offset..self.offset+n]);
        self.offset += n; self.position += (n/ch) as u64;
        Ok(n)
    }
    fn seek_to_frame(&mut self, frame: u64, cancel: &CancelFlag) -> Result<u64> {
        cancel.check()?;
        let frame = self.total.map_or(frame, |n| frame.min(n));
        // Restart/discard is deliberately exact across formats, including Vorbis
        // preroll and MP3 delay. No competing approximate seek timeline.
        if frame < self.position { *self = Self::open(self.source.clone(), cancel)?; }
        let ch = self.layout.layout.channels() as usize;
        let mut scratch = [0.; 8192];
        while self.position < frame {
            cancel.check()?;
            let count = ((frame-self.position).min((scratch.len()/ch) as u64) as usize)*ch;
            if self.decode_into(&mut scratch[..count], cancel)? == 0 { break; }
        }
        Ok(self.position)
    }
}
