//! Sequential decoder job owner. The control mutex never encloses provider work.
use crate::pcm_transport::OutputMonitor;
use libzci::*;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

pub(crate) const DECODE_SAMPLES: usize = 4096;
#[derive(Clone)]
pub(crate) struct Plan {
    pub tag: JobTag,
    pub source: Arc<dyn RuntimeSource>,
    pub registry: ProviderRegistry,
    pub hint: Option<String>,
    pub options: LoadOptions,
    pub controls: Vec<ModuleControl>,
    pub cancel: CancelFlag,
}
pub(crate) struct Decoded {
    pub tag: JobTag,
    pub layout: PcmLayout,
    pub start: u64,
    pub samples: Vec<f32>,
    pub status: DecodeStatus,
}
pub(crate) struct Control {
    pub owner: Session,
    pub plan: Option<Plan>,
    pub result: Option<Result<Decoded>>,
    pub demand: bool,
    pub closed: bool,
    pub output: Option<Arc<OutputMonitor>>,
    pub output_reserved: bool,
    pub events: EventQueue,
}
impl Control {
    pub fn refresh_output(&self) {
        if let Some(output) = &self.output {
            let s = self.owner.snapshot();
            output.request_generation(s.generation);
            output.set_held(
                s.requested == RequestedState::Held
                    || s.pending_operation
                    || self.closed
                    || s.state == TransportState::Failed
                    || s.running == RunningState::Suspended,
            );
            output.set_volume(s.volume);
            output.set_mute(s.mute);
            if self.closed {
                output.stop();
            }
        }
    }
}
pub(crate) struct SessionEntry {
    pub control: Mutex<Control>,
    pub wake: Condvar,
}
impl SessionEntry {
    pub fn new(id: SessionId) -> Arc<Self> {
        let entry = Arc::new(Self {
            control: Mutex::new(Control {
                owner: Session::new(id),
                plan: None,
                result: None,
                demand: false,
                closed: false,
                output: None,
                output_reserved: false,
                events: EventQueue::new(128),
            }),
            wake: Condvar::new(),
        });
        let worker = entry.clone();
        std::thread::Builder::new()
            .name(format!("libzci-decode-{}", id.0))
            .spawn(move || worker.run())
            .expect("decode worker");
        entry
    }
    pub fn close(&self) {
        let mut c = self.control.lock().unwrap();
        c.closed = true;
        if let Some(p) = &c.plan {
            p.cancel.cancel();
        }
        if let Some(o) = &c.output {
            o.set_held(true);
            o.stop();
        }
        c.result = None;
        self.wake.notify_all();
    }
    pub fn snapshot(&self) -> Snapshot {
        self.control.lock().unwrap().owner.snapshot()
    }
    pub fn decode(&self, cancel: &CancelFlag) -> Result<Decoded> {
        let mut c = self.control.lock().unwrap();
        loop {
            cancel.check()?;
            if c.closed {
                return Err(LibzciError::Cancelled);
            }
            if let Some(error) = c.owner.snapshot().error {
                return Err(error);
            }
            if let Some(result) = c.result.take() {
                self.wake.notify_all();
                return result;
            }
            c.demand = true;
            self.wake.notify_all();
            c = self
                .wake
                .wait_timeout(c, Duration::from_millis(10))
                .unwrap()
                .0;
        }
    }
    pub fn consumed(&self, generation: Generation, position: u64, final_consumed: bool) {
        let mut c = self.control.lock().unwrap();
        let before = c.owner.revision();
        c.owner.consumed(generation, position, final_consumed);
        if c.owner.revision() != before {
            let snapshot = c.owner.snapshot();
            let event = if final_consumed {
                Event::StateChanged {
                    session: snapshot.session,
                    generation,
                    revision: snapshot.revision,
                }
            } else {
                Event::Progress {
                    session: snapshot.session,
                    generation,
                    position_frames: snapshot.position_frames,
                }
            };
            c.events.push(event);
        }
    }
    fn run(self: Arc<Self>) {
        let mut decoder: Option<Box<dyn DecoderInstance>> = None;
        let mut applied: Option<JobTag> = None;
        loop {
            let (plan, demand) = {
                let mut c = self.control.lock().unwrap();
                loop {
                    if c.closed {
                        return;
                    }
                    if let Some(p) = &c.plan {
                        if applied != Some(p.tag) || c.demand && c.result.is_none() {
                            break;
                        }
                    }
                    c = self.wake.wait(c).unwrap();
                }
                let p = c.plan.as_ref().unwrap().clone();
                let demand = c.demand && c.result.is_none();
                (p, demand)
            };
            if applied != Some(plan.tag) {
                let new_instance = applied.is_none_or(|old| old.instance != plan.tag.instance);
                let result = (|| -> Result<()> {
                    plan.cancel.check()?;
                    if new_instance || decoder.is_none() {
                        decoder = None;
                        decoder = Some(
                            plan.registry
                                .open_best(plan.source.clone(), plan.hint.as_deref(), &plan.cancel)?
                                .1,
                        );
                    }
                    let d = decoder.as_mut().unwrap();
                    if let Some(subsong) = plan.options.subsong {
                        d.module_control(ModuleControl::Subsong(subsong), &plan.cancel)?;
                    }
                    for control in &plan.controls {
                        d.module_control(*control, &plan.cancel)?;
                    }
                    let frame = plan.options.start_time.frames(d.layout().sample_rate)?;
                    d.seek_to_frame(frame, &plan.cancel)?;
                    plan.cancel.check()
                })();
                // Even cancelled work has touched the sequential instance. The next
                // plan must seek it again, or reopen when instance identity changes.
                applied = Some(plan.tag);
                let mut c = self.control.lock().unwrap();
                if !c.owner.accepts(plan.tag) {
                    continue;
                }
                let event = match result {
                    Ok(()) => {
                        let d = decoder.as_ref().unwrap();
                        c.owner.opened(
                            plan.tag,
                            d.metadata(),
                            d.capabilities(),
                            d.position_frames(),
                        );
                        Event::Completed {
                            session: plan.tag.session,
                            request_id: plan.tag.operation,
                            generation: plan.tag.generation,
                        }
                    }
                    Err(e) => {
                        c.owner.failed(plan.tag, e.clone());
                        Event::Failed {
                            session: plan.tag.session,
                            request_id: Some(plan.tag.operation),
                            generation: plan.tag.generation,
                            error: e,
                        }
                    }
                };
                c.events.push(event);
                c.refresh_output();
                self.wake.notify_all();
                continue;
            }
            if !demand {
                continue;
            }
            let result = (|| -> Result<Decoded> {
                plan.cancel.check()?;
                let d = decoder.as_mut().ok_or(LibzciError::Cancelled)?;
                let layout = d.layout();
                let start = d.position_frames();
                let mut samples = vec![0.0; DECODE_SAMPLES];
                let status = d.decode(&mut samples, &plan.cancel)?;
                plan.cancel.check()?;
                match status {
                    DecodeStatus::Data(n) => {
                        if n == 0
                            || n > samples.len()
                            || n % layout.layout.channels() as usize != 0
                            || samples[..n].iter().any(|v| !v.is_finite())
                        {
                            return Err(LibzciError::DecoderFailure {
                                detail: "invalid decoded PCM block".into(),
                            });
                        }
                        samples.truncate(n);
                    }
                    _ => samples.clear(),
                }
                Ok(Decoded {
                    tag: plan.tag,
                    layout,
                    start,
                    samples,
                    status,
                })
            })();
            let pending = matches!(&result, Ok(d) if d.status == DecodeStatus::Pending);
            let mut c = self.control.lock().unwrap();
            if !c.owner.accepts(plan.tag) {
                continue;
            }
            match &result {
                Ok(d) if d.status == DecodeStatus::EndOfStream => c.owner.eof(plan.tag),
                Err(e) => {
                    c.owner.failed(plan.tag, e.clone());
                    c.events.push(Event::Failed {
                        session: plan.tag.session,
                        request_id: Some(plan.tag.operation),
                        generation: plan.tag.generation,
                        error: e.clone(),
                    });
                }
                _ => (),
            }
            c.result = Some(result);
            c.demand = false;
            c.refresh_output();
            self.wake.notify_all();
            if pending {
                // A worker-local empty feed yields; commands still use the same
                // capacity-independent control mutex and cancellation flag.
                drop(self.wake.wait_timeout(c, Duration::from_millis(2)).unwrap());
            }
        }
    }
}
