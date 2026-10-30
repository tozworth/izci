//! Fixed-slot control -> output handoff. Only the control side may lock/allocate;
//! callback refresh/recycle/select never locks, allocates or frees schedules.
use libzci::{GainPoint, GainSchedule, Generation, NormalizationPoint, Result, MAX_GAIN_POINTS};
use rtrb::{Consumer, Producer, RingBuffer};
use std::{
    cell::UnsafeCell,
    sync::{Arc, Mutex},
};
const SLOTS: usize = 3;
struct Slot {
    generation: Generation,
    schedule: GainSchedule,
}
struct Pool {
    slots: Box<[UnsafeCell<Slot>]>,
}
// SAFETY: each index belongs to exactly one control publisher, ready queue,
// callback consumer or recycle queue. Only its owner accesses the slot. rtrb's
// release/acquire handoff orders writes; neither endpoint is cloneable and the
// publisher mutex serializes all control callers. No slot reference escapes its
// owner. Holding the active callback index prevents producer reuse.
unsafe impl Sync for Pool {}
struct Publisher {
    ready: Producer<usize>,
    recycle: Consumer<usize>,
    last: Option<(Generation, u64)>,
}
pub(crate) struct GainPublisher {
    pool: Arc<Pool>,
    owner: Mutex<Publisher>,
}
pub(crate) struct GainConsumer {
    pool: Arc<Pool>,
    ready: Consumer<usize>,
    recycle: Producer<usize>,
    active: Option<usize>,
}
pub(crate) fn gain_transport() -> (GainPublisher, GainConsumer) {
    let (ready_tx, ready_rx) = RingBuffer::new(SLOTS);
    let (mut recycle_tx, recycle_rx) = RingBuffer::new(SLOTS);
    let pool = Arc::new(Pool {
        slots: (0..SLOTS)
            .map(|i| {
                recycle_tx.push(i).unwrap();
                UnsafeCell::new(Slot {
                    generation: Generation(0),
                    schedule: GainSchedule::default(),
                })
            })
            .collect(),
    });
    (
        GainPublisher {
            pool: pool.clone(),
            owner: Mutex::new(Publisher {
                ready: ready_tx,
                recycle: recycle_rx,
                last: None,
            }),
        },
        GainConsumer {
            pool,
            ready: ready_rx,
            recycle: recycle_tx,
            active: None,
        },
    )
}
impl GainPublisher {
    /// False means output is suspended/full. The authoritative session retains
    /// the latest program; its next refresh retries without dropping that state.
    pub fn publish(
        &self,
        generation: Generation,
        revision: u64,
        program: &[NormalizationPoint],
    ) -> Result<bool> {
        let mut owner = self.owner.lock().unwrap();
        if owner.last == Some((generation, revision)) {
            return Ok(true);
        }
        if program.len() > MAX_GAIN_POINTS {
            return Err(libzci::LibzciError::ResourceExhausted {
                detail: "gain schedule budget exceeded".into(),
            });
        }
        if owner.recycle.is_empty() {
            return Ok(false);
        }
        let points = program
            .iter()
            .map(|p| GainPoint {
                source_frame: p.source_frame,
                linear: p.normalization.linear,
            })
            .collect::<Vec<_>>();
        GainSchedule::validate(&points)?;
        let Ok(index) = owner.recycle.pop() else {
            return Ok(false);
        };
        // SAFETY: exclusive ownership was acquired from the recycle queue.
        let slot = unsafe { &mut *self.pool.slots[index].get() };
        slot.schedule.replace(&points)?;
        slot.generation = generation;
        owner.ready.push(index).expect("gain slot conservation");
        owner.last = Some((generation, revision));
        Ok(true)
    }
    pub fn retained_bytes(&self) -> usize {
        SLOTS * (size_of::<Slot>() + 2 * size_of::<usize>())
    }
}
impl GainConsumer {
    pub fn refresh(&mut self) {
        // At most three publications can be pending at callback entry.
        for _ in 0..SLOTS {
            let Ok(index) = self.ready.pop() else {
                break;
            };
            if let Some(old) = self.active.replace(index) {
                self.recycle.push(old).expect("gain slot conservation");
            }
        }
    }
    pub fn points(&self, generation: Generation) -> Option<&[GainPoint]> {
        let index = self.active?;
        // SAFETY: this consumer retains the index until its next &mut refresh;
        // the returned borrow cannot overlap that call or producer ownership.
        let slot = unsafe { &*self.pool.slots[index].get() };
        (slot.generation == generation).then(|| slot.schedule.points())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn program(gain: f32) -> [NormalizationPoint; 1] {
        [NormalizationPoint {
            source_frame: 0,
            normalization: libzci::Normalization {
                linear: gain,
                ..Default::default()
            },
        }]
    }
    #[test]
    fn bounded_handoff_preserves_active_ownership_latest_revision_and_generation() {
        let (p, mut c) = gain_transport();
        for i in 1..=3 {
            assert!(p.publish(Generation(1), i, &program(i as f32)).unwrap());
        }
        assert!(!p.publish(Generation(1), 4, &program(4.0)).unwrap());
        c.refresh();
        assert_eq!(c.points(Generation(1)).unwrap()[0].linear, 3.0);
        assert!(c.points(Generation(2)).is_none());
        assert!(p.publish(Generation(1), 4, &program(4.0)).unwrap());
        assert_eq!(c.points(Generation(1)).unwrap()[0].linear, 3.0); // new writer cannot mutate held slot
        c.refresh();
        assert_eq!(c.points(Generation(1)).unwrap()[0].linear, 4.0);
        assert!(p.publish(Generation(2), 1, &program(0.5)).unwrap());
        c.refresh();
        assert!(c.points(Generation(1)).is_none());
        assert_eq!(c.points(Generation(2)).unwrap()[0].linear, 0.5);
    }
}
