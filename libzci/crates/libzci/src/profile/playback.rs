//! Shared profile/session coordination. Prepare performs SQL on an observation;
//! adapters release the session lock before calling it, then apply the returned
//! commands/acknowledgements through their normal runtime. No SQL in audio/control
//! critical sections, and no duplicated count/settings policy in each shell.
use super::Profile;
use crate::{
    catalog::{PlayCountAcknowledgement, PlayCountOutcome},
    storage::SqlBridge,
    Command, QualifiedPlay, RequestId, Result, SessionId, Snapshot,
};
pub struct PlaybackObservation {
    pub snapshot: Snapshot,
    pub qualified: Vec<QualifiedPlay>,
}
pub struct PlaybackSync {
    pub commands: Vec<Command>,
    pub acknowledged: Vec<PlayCountAcknowledgement>,
    pub counts: Option<PlayCountOutcome>,
}
pub struct ProfilePlayback {
    session: SessionId,
    binding: String,
    bound: bool,
    closed: bool,
    membership: Option<(u64, RequestId, Option<u64>)>,
}
impl ProfilePlayback {
    pub fn attach(profile: &Profile, snapshot: &Snapshot, db: &mut dyn SqlBridge) -> Result<Self> {
        if snapshot.play_counts.settings.is_some() {
            return Err(crate::queue::invalid(
                "playback session already bound to a profile",
            ));
        }
        Ok(Self {
            session: snapshot.session,
            binding: profile.begin_play_counting(db)?,
            bound: false,
            closed: false,
            membership: None,
        })
    }
    pub fn prepare(
        &mut self,
        profile: &mut Profile,
        observation: PlaybackObservation,
        db: &mut dyn SqlBridge,
    ) -> Result<PlaybackSync> {
        let s = observation.snapshot;
        if self.closed || s.session != self.session {
            return Err(crate::queue::invalid(
                "closed or mismatched playback profile binding",
            ));
        }
        let counts = if observation.qualified.is_empty() {
            None
        } else {
            Some(profile.commit_qualified_plays(&observation.qualified, db)?)
        };
        let acknowledged = counts
            .as_ref()
            .map_or_else(Vec::new, |c| c.acknowledged.clone());
        let settings = &profile.snapshot().settings;
        let mut commands = vec![];
        let session = self.session;
        if s.volume != settings.volume {
            commands.push(Command::SetVolume {
                session,
                request_id: RequestId::fresh(),
                volume: settings.volume,
            });
        }
        if s.mute != settings.mute {
            commands.push(Command::SetMute {
                session,
                request_id: RequestId::fresh(),
                mute: settings.mute,
            });
        }
        if s.replay_gain != settings.replay_gain {
            commands.push(Command::SetReplayGain {
                session,
                request_id: RequestId::fresh(),
                settings: settings.replay_gain,
            });
        }
        if !self.bound || s.play_counts.settings != Some(settings.play_counts) {
            commands.push(Command::BindPlayCounts {
                session,
                request_id: RequestId::fresh(),
                binding: self.binding.clone(),
                settings: settings.play_counts,
            });
            self.bound = true;
        }
        if let Some(context) = s.context {
            let revision = profile.snapshot().catalog_revision;
            if self.membership.is_none_or(|(r, i, media)| {
                r != revision || i != s.source_instance || media != context.library_media
            }) {
                let media = profile.play_count_eligibility(&context.reference.key, db)?;
                if media != context.library_media {
                    commands.push(Command::CountEligibility {
                        session,
                        request_id: RequestId::fresh(),
                        instance: s.source_instance,
                        source_key: context.reference.key.clone(),
                        media,
                    });
                }
                self.membership = Some((revision, s.source_instance, media));
            }
        } else {
            self.membership = None;
        }
        Ok(PlaybackSync {
            commands,
            acknowledged,
            counts,
        })
    }
    /// Stop output and synchronize pending plays before closing this binding.
    pub fn close(&mut self, profile: &Profile, db: &mut dyn SqlBridge) -> Result<()> {
        if !self.closed {
            profile.close_play_counting(&self.binding, db)?;
            self.closed = true;
        }
        Ok(())
    }
}
