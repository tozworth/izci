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
            MediaTime(value).frames(
                self.session
                    .snapshot()
                    .layout
                    .map_or(48000, |l| l.sample_rate),
            )?;
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
            _ => Command::Module {
                session,
                request_id,
                control: crate::wire::control(kind, value)?,
            },
        };
        let (receipt, actions) = self.session.accept(&command)?;
        let rate = self
            .session
            .snapshot()
            .layout
            .map_or(48000, |l| l.sample_rate);
        let actions: Vec<Value> = actions
            .into_iter()
            .map(|a| match a {
                SessionAction::Open { tag: t, .. } => json!({"kind":"open","tag":tag(t)}),
                SessionAction::Seek { tag: t, time } => {
                    json!({"kind":"seek","tag":tag(t),"frame":time.frames(rate).expect("validated seek")})
                }
                SessionAction::Close => json!({"kind":"close"}),
                SessionAction::Output => json!({"kind":"output"}),
                SessionAction::Module { tag:t,control } => json!({"kind":"module","tag":tag(t),"control":crate::wire::control_value(control),"frame":self.session.snapshot().position_frames}),
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
            "capabilities":crate::wire::capabilities(s.capabilities),"module":crate::wire::module(s.module.as_deref().cloned()),
            "metadata":s.metadata.as_ref().map(|m|&m.comments),
            "error":s.error.map(|e|e.to_string()),"tag":self.tag()})
    }
    pub fn opened_facts(&mut self, t: JobTag, f: &Value, position: u64) -> Result<bool> {
        let id = f["provider"]["id"].as_str().unwrap_or("");
        let info = match id {
            "org.xiph.opus" => ProviderInfo {
                id: ProviderId::OPUS,
                version: "libopusfile-0.12/libopus-1.5.2/r4",
                display_name: "Reference Opus (libopusfile)",
            },
            "org.symphonia.audio" => libzci_symphonia::INFO,
            "browser.webcodecs.opus" => ProviderInfo {
                id: ProviderId("browser.webcodecs.opus"),
                version: "single-link-family0/m1",
                display_name: "WebCodecs Opus (optional)",
            },
            "org.openmpt.libopenmpt" => ProviderInfo {
                id: ProviderId::OPENMPT,
                version: "libopenmpt-0.8.4/m1",
                display_name: "libopenmpt",
            },
            "hivelytracker.replay" => ProviderInfo {
                id: ProviderId::HIVELY,
                version: "hivelytracker-f393ca7/m1",
                display_name: "HivelyTracker",
            },
            _ => {
                return Err(LibzciError::Unsupported {
                    detail: "unregistered browser provider".into(),
                })
            }
        };
        let rate = f["rate"].as_u64().unwrap_or(0) as u32;
        let channels = f["channels"].as_u64().unwrap_or(0) as u16;
        let layout = PcmLayout::new(
            match channels {
                1 => ChannelLayout::Mono,
                2 => ChannelLayout::Stereo,
                _ => {
                    return Err(LibzciError::Unsupported {
                        detail: "browser channel layout".into(),
                    })
                }
            },
            rate,
        )?;
        let c = &f["capabilities"];
        let caps = ModuleCapabilities {
            subsongs: c["subsongs"].as_u64().unwrap_or(0) as u32,
            channels: c["channels"].as_u64().unwrap_or(0) as u32,
            interpolation: c["interpolation"].as_bool().unwrap_or(false),
            channel_mute: c["channel_mute"].as_bool().unwrap_or(false),
            ramping: c["ramping"].as_bool().unwrap_or(false),
            speed: c["speed"].as_bool().unwrap_or(false),
            pitch: c["pitch"].as_bool().unwrap_or(false),
            loop_limit: c["loop_limit"].as_bool().unwrap_or(false),
            patterns: c["patterns"].as_bool().unwrap_or(false),
        };
        let comments = f["comments"]
            .as_array()
            .map(|a| {
                a.iter()
                    .take(128)
                    .filter_map(|v| {
                        Some((
                            v[0].as_str()?.chars().take(256).collect(),
                            v[1].as_str()?.chars().take(4096).collect(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let a = &f["applied"];
        let accepted = self.session.opened(
            t,
            ProviderMetadata {
                info,
                layout,
                total_frames: f["total"].as_u64(),
                declared_channels: channels,
                comments,
                applied: AppliedAdjustments {
                    trimmed_preskip: a["trimmed_preskip"].as_bool().unwrap_or(false),
                    trimmed_end: a["trimmed_end"].as_bool().unwrap_or(false),
                    applied_header_gain: a["applied_header_gain"].as_bool().unwrap_or(false),
                },
            },
            caps,
            position,
        );
        self.observed(t, &f["module"]);
        Ok(accepted)
    }
    pub fn observed(&mut self, t: JobTag, m: &Value) {
        let observation = (!m.is_null()).then(|| {
            let channels = m["channels"].as_u64().unwrap_or(0).min(32) as u32;
            let rows = m["rows"].as_u64().unwrap_or(0).min(16) as u32;
            ModuleObservation {
                selected_subsong: m["selected_subsong"].as_u64().unwrap_or(0) as u32,
                order: m["order"].as_u64().unwrap_or(0) as u32,
                pattern: m["pattern"].as_u64().unwrap_or(0) as u32,
                row: m["row"].as_u64().unwrap_or(0) as u32,
                first_row: m["first_row"].as_u64().unwrap_or(0) as u32,
                rows,
                channels,
                cells: m["cells"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .take((rows * channels) as usize)
                            .map(|v| std::array::from_fn(|i| v[i].as_u64().unwrap_or(0) as u8))
                            .collect()
                    })
                    .unwrap_or_default(),
            }
        });
        self.session.observed(t, observation);
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
