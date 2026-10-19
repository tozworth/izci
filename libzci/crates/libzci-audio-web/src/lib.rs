//! Audio-only WASM ABI. No JS imports, control machine, codecs, SQL or DOM.
//! Storage is allocated at construction; process/enqueue/reset never allocate.
use libzci::*;
const SLOTS: usize = 8;
const FRAMES: usize = 4096;
const QUANTUM: usize = 128;
struct Slot {
    samples: Box<[f32]>,
    block: Option<OutputBlock>,
    offset: usize,
    id: i32,
}
pub struct Renderer {
    slots: Vec<Slot>,
    head: usize,
    len: usize,
    generation: Generation,
    processor: AudioProcessor,
    clock: MediaClock,
    running: bool,
    eof: bool,
    output: [f32; QUANTUM * 2],
    input: [f32; FRAMES * 2],
    recycled: [i32; SLOTS],
    recycled_len: usize,
    position: u64,
    media: u64,
    silence: u64,
    finished: bool,
    latency: u64,
}
impl Renderer {
    fn new() -> Self {
        Self {
            slots: (0..SLOTS)
                .map(|_| Slot {
                    samples: vec![0.; FRAMES * 2].into_boxed_slice(),
                    block: None,
                    offset: 0,
                    id: 0,
                })
                .collect(),
            head: 0,
            len: 0,
            generation: Generation(0),
            processor: AudioProcessor::new(),
            clock: MediaClock::default(),
            running: false,
            eof: false,
            output: [0.; QUANTUM * 2],
            input: [0.; FRAMES * 2],
            recycled: [0; SLOTS],
            recycled_len: 0,
            position: 0,
            media: 0,
            silence: 0,
            finished: false,
            latency: 0,
        }
    }
    fn reset(&mut self, generation: Generation, position: u64) {
        self.generation = generation;
        self.head = 0;
        self.len = 0;
        self.eof = false;
        self.finished = false;
        self.position = position;
        self.clock.reset();
        self.recycled_len = 0;
        self.media = 0;
        self.silence = 0;
        for s in &mut self.slots {
            s.block = None;
            s.offset = 0;
        }
    }
    fn enqueue(&mut self, id: i32, block: OutputBlock) -> bool {
        if block.generation != self.generation
            || self.len == SLOTS
            || block.valid_frames > FRAMES
            || block.valid_frames == 0
        {
            return false;
        }
        let slot = &mut self.slots[(self.head + self.len) % SLOTS];
        slot.samples[..block.valid_frames * 2]
            .copy_from_slice(&self.input[..block.valid_frames * 2]);
        slot.block = Some(block);
        slot.offset = 0;
        slot.id = id;
        self.len += 1;
        true
    }
    fn process(&mut self) {
        self.output.fill(0.);
        self.recycled_len = 0;
        if !self.running || self.finished {
            return;
        }
        let mut at = 0;
        while at < QUANTUM && self.len > 0 {
            let slot = &mut self.slots[self.head];
            let b = slot.block.unwrap();
            let n = (b.valid_frames - slot.offset).min(QUANTUM - at);
            self.output[at * 2..(at + n) * 2]
                .copy_from_slice(&slot.samples[slot.offset * 2..(slot.offset + n) * 2]);
            assert!(self.clock.submit(b.slice(slot.offset, n), at as u64));
            at += n;
            slot.offset += n;
            if slot.offset == b.valid_frames {
                self.recycled[self.recycled_len] = slot.id;
                self.recycled_len += 1;
                slot.block = None;
                self.head = (self.head + 1) % SLOTS;
                self.len -= 1;
            }
        }
        self.processor.process_stereo_in_place(&mut self.output);
        self.media += at as u64;
        self.silence += (QUANTUM - at) as u64;
        if let Some(p) = self.clock.advance(QUANTUM as u64, self.latency) {
            self.position = p;
        }
        self.finished = self.eof && self.len == 0 && self.clock.drained();
    }
}
// The instance pointer is exclusively owned by one AudioWorkletProcessor.
#[no_mangle]
pub extern "C" fn renderer_new() -> *mut Renderer {
    Box::into_raw(Box::new(Renderer::new()))
}
#[no_mangle]
pub unsafe extern "C" fn renderer_free(p: *mut Renderer) {
    drop(Box::from_raw(p));
}
#[no_mangle]
pub unsafe extern "C" fn renderer_input(p: *mut Renderer) -> *mut f32 {
    (*p).input.as_mut_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn renderer_output(p: *mut Renderer) -> *const f32 {
    (*p).output.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn renderer_reset(p: *mut Renderer, g: f64, position: f64) {
    (*p).reset(Generation(g as u64), position as u64);
}
#[no_mangle]
pub unsafe extern "C" fn renderer_settings(
    p: *mut Renderer,
    running: i32,
    volume: f32,
    mute: i32,
    latency: f64,
) {
    (*p).running = running != 0;
    (*p).processor.set_volume(volume);
    (*p).processor.set_mute(mute != 0);
    (*p).latency = latency as u64;
}
#[no_mangle]
pub unsafe extern "C" fn renderer_enqueue(
    p: *mut Renderer,
    id: i32,
    g: f64,
    start: f64,
    end: f64,
    output_start: f64,
    rate: u32,
    frames: usize,
) -> i32 {
    (*p).enqueue(
        id,
        OutputBlock {
            generation: Generation(g as u64),
            source_start: start as u64,
            source_end: end as u64,
            source_rate: 48000,
            output_start: output_start as u64,
            layout: PcmLayout {
                layout: ChannelLayout::Stereo,
                sample_rate: rate,
            },
            valid_frames: frames,
        },
    ) as i32
}
#[no_mangle]
pub unsafe extern "C" fn renderer_eof(p: *mut Renderer, g: f64) {
    if (*p).generation == Generation(g as u64) {
        (*p).eof = true;
    }
}
#[no_mangle]
pub unsafe extern "C" fn renderer_process(p: *mut Renderer) {
    (*p).process();
}
#[no_mangle]
pub unsafe extern "C" fn renderer_recycled_count(p: *mut Renderer) -> usize {
    (*p).recycled_len
}
#[no_mangle]
pub unsafe extern "C" fn renderer_recycled(p: *mut Renderer, n: usize) -> i32 {
    (&(*p).recycled)[n]
}
#[no_mangle]
pub unsafe extern "C" fn renderer_position(p: *mut Renderer) -> f64 {
    (*p).position as f64
}
#[no_mangle]
pub unsafe extern "C" fn renderer_media(p: *mut Renderer) -> f64 {
    (*p).media as f64
}
#[no_mangle]
pub unsafe extern "C" fn renderer_silence(p: *mut Renderer) -> f64 {
    (*p).silence as f64
}
#[no_mangle]
pub unsafe extern "C" fn renderer_finished(p: *mut Renderer) -> i32 {
    (*p).finished as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_partial_tail_pause_starvation_and_generation() {
        let mut r = Renderer::new();
        r.reset(Generation(1), 0);
        r.running = true;
        for i in 0..8192 {
            r.input[i] = i as f32;
        }
        let b = OutputBlock {
            generation: Generation(1),
            source_start: 0,
            source_end: 4096,
            source_rate: 48000,
            output_start: 0,
            layout: PcmLayout::stereo48k(),
            valid_frames: 4096,
        };
        assert!(r.enqueue(0, b));
        let mut out = vec![];
        for _ in 0..32 {
            r.process();
            out.extend(r.output);
        }
        assert_eq!(out, (0..8192).map(|n| n as f32).collect::<Vec<_>>());
        r.process();
        assert_eq!(r.position, 4096);
        assert!(!r.finished);
        r.running = false;
        r.process();
        assert_eq!(r.position, 4096);
        r.running = true;
        r.eof = true;
        r.process();
        assert!(r.finished);
        r.reset(Generation(2), 10000);
        assert!(!r.enqueue(1, b));
        r.process();
        assert!(r.output.iter().all(|v| *v == 0.));
        assert_eq!(r.position, 10000);
    }
}
