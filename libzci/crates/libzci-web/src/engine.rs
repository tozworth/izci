//! Browser control owner. All transport decisions are the native Session's.
//! Workers return tagged facts; no decoder, File or PCM is owned here.
use libzci::*;
use serde_json::{json, Value};

pub struct Engine {
    pub session: Session,
}
impl Default for Engine {
    fn default() -> Self {
        Self {
            session: Session::new(SessionId::fresh()),
        }
    }
}
fn tag(t: JobTag) -> Value {
    json!({"session":t.session.0,"instance":t.instance.0,"operation":t.operation.0,"generation":t.generation.0})
}
impl Engine {
    pub fn command(&mut self, kind: &str, value: f64) -> Result<Value> {
        // The registered reference provider's normalized rate is 48 kHz.
        // Keep public seconds -> provider frames conversion in shared Rust.
        if kind == "seek" {
            MediaTime(value).frames(48_000)?;
        }
        let session = self.session.id();
        let request_id = RequestId::fresh();
        let command = match kind {
            "load" => Command::Load {
                session,
                request_id,
                source: SourceId::fresh(),
                extension_hint: Some("opus".into()),
                options: LoadOptions::default(),
            },
            "play" => Command::Play {
                session,
                request_id,
            },
            "pause" => Command::Pause {
                session,
                request_id,
            },
            "stop" => Command::Stop {
                session,
                request_id,
            },
            "seek" => Command::Seek {
                session,
                request_id,
                time: MediaTime(value),
            },
            "volume" => Command::SetVolume {
                session,
                request_id,
                volume: value as f32,
            },
            "mute" => Command::SetMute {
                session,
                request_id,
                mute: value != 0.0,
            },
            "dispose" => Command::Dispose {
                session,
                request_id,
            },
            _ => {
                return Err(LibzciError::InvalidArgument {
                    detail: format!("unknown command {kind}"),
                })
            }
        };
        let (receipt, actions) = self.session.accept(&command)?;
        let actions: Vec<Value> = actions
            .into_iter()
            .map(|a| match a {
                SessionAction::Open { tag: t, .. } => json!({"kind":"open","tag":tag(t)}),
                SessionAction::Seek { tag: t, time } => {
                    json!({"kind":"seek","tag":tag(t),"frame":time.frames(48_000).expect("validated seek")})
                }
                SessionAction::Close => json!({"kind":"close"}),
                SessionAction::Output => json!({"kind":"output"}),
                SessionAction::Module { .. } => unreachable!(),
            })
            .collect();
        Ok(
            json!({"request":receipt.request_id.0,"generation":receipt.generation.0,"actions":actions,"snapshot":self.snapshot()}),
        )
    }
    pub fn tag(&self) -> Value {
        tag(self.session.tag())
    }
    pub fn snapshot(&self) -> Value {
        let s = self.session.snapshot();
        json!({"session":s.session.0,"revision":s.revision.0,"generation":s.generation.0,
            "state":format!("{:?}",s.state),"requested":format!("{:?}",s.requested),"running":format!("{:?}",s.running),
            "position_frames":s.position_frames,"total_frames":s.total_frames,"sample_rate":s.layout.map(|l|l.sample_rate),
            "provider":s.provider.map(|p|json!({"id":p.id.0,"version":p.version,"name":p.display_name})),
            "volume":s.volume,"mute":s.mute,"decoding_eof":s.decoding_eof,"pending_operation":s.pending_operation,
            "error":s.error.map(|e|e.to_string()),"tag":self.tag()})
    }
    pub fn opened(&mut self, t: JobTag, total: u64, position: u64) -> bool {
        self.session.opened(
            t,
            ProviderMetadata {
                info: ProviderInfo {
                    id: ProviderId::OPUS,
                    version: "libopusfile-0.12/libopus-1.5.2/r4",
                    display_name: "Reference Opus (libopusfile)",
                },
                layout: PcmLayout::stereo48k(),
                total_frames: Some(total),
                declared_channels: 2,
                comments: vec![],
                applied: AppliedAdjustments {
                    trimmed_preskip: true,
                    trimmed_end: true,
                    applied_header_gain: true,
                },
            },
            ModuleCapabilities::default(),
            position,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_uses_native_transport_and_consumption_not_decode_progress() {
        let mut e = Engine::default();
        e.command("load", 0.0).unwrap();
        let old = e.session.tag();
        e.opened(old, 480000, 0);
        e.command("play", 0.0).unwrap();
        e.session.eof(old);
        assert_eq!(e.session.state(), TransportState::Playing);
        e.session.consumed(old.generation, 128, false);
        assert_eq!(e.session.position_frames(), 128);
        e.command("seek", 3.0).unwrap();
        assert!(!e.opened(old, 480000, 0));
        let new = e.session.tag();
        e.session.landed(new, 144000);
        e.session.consumed(old.generation, 480000, true);
        assert_eq!(e.session.position_frames(), 144000);
        e.session.eof(new);
        e.session.consumed(new.generation, 480000, true);
        assert_eq!(e.session.state(), TransportState::Ended);
    }
}
