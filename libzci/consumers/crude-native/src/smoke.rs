//! Explicit hidden-window integration driver. Uses the same controller and
//! device as the GUI, with master mute set before Play. No ordinary profile.
use crate::controller::Controller;
use libzci::*;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
pub type Outcome = Arc<Mutex<Option<std::result::Result<(), String>>>>;
pub struct Smoke {
    phase: u8,
    deadline: Instant,
    pub outcome: Outcome,
}
impl Smoke {
    pub fn new(outcome: Outcome) -> Self {
        Self {
            phase: 0,
            deadline: Instant::now() + Duration::from_secs(15),
            outcome,
        }
    }
    pub fn step(&mut self, c: &mut Controller) -> bool {
        let s = c.snapshot();
        let error = if Instant::now() > self.deadline {
            Some("hidden native smoke timed out".into())
        } else if let Some(e) = &s.error {
            Some(e.to_string())
        } else if !c.error.is_empty() {
            Some(c.error.clone())
        } else {
            None
        };
        if let Some(e) = error {
            *self.outcome.lock().unwrap() = Some(Err(e));
            return true;
        }
        match self.phase {
            0 if s.state == TransportState::Ready && c.output().is_some() => {
                c.command(|session, request_id| Command::SetMute {
                    session,
                    request_id,
                    mute: true,
                });
                c.command(|session, request_id| Command::Play {
                    session,
                    request_id,
                });
                self.phase = 1;
            }
            1 if s.position_frames > 1000 => {
                c.command(|session, request_id| Command::Pause {
                    session,
                    request_id,
                });
                self.phase = 2;
            }
            2 if s.requested == RequestedState::Held => {
                c.command(|session, request_id| Command::Seek {
                    session,
                    request_id,
                    time: MediaTime(0.1),
                });
                self.phase = 3;
            }
            3 if !s.pending_operation => {
                if s.capabilities.interpolation {
                    c.module(ModuleControl::Interpolation(2));
                }
                self.phase = 4;
            }
            4 if !s.pending_operation => {
                c.inspect(false);
                self.phase = 5;
            }
            5 if c.inspection.is_some() => {
                c.command(|session, request_id| Command::Stop {
                    session,
                    request_id,
                });
                self.phase = 6;
            }
            6 if !s.pending_operation && s.position_frames == 0 => {
                c.dispose();
                *self.outcome.lock().unwrap() = Some(Ok(()));
                return true;
            }
            _ => (),
        }
        false
    }
}
