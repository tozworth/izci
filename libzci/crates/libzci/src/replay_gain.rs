//! Optional pre-Raf normalization. Providers already apply mandatory codec gain
//! (including OpusHead output gain); this policy never applies it again.
//!
//! R128 comments are signed Q7.8 gains relative to decoded Opus output at
//! -23 LUFS (RFC 7845 §5.2.1). Their target adjustment is explicit and defaults
//! to +5 dB for -18 LUFS. ReplayGain tags use their own reference and receive
//! only the user's preamp. Conflicting R128/ReplayGain tags are not added.
use crate::{LibzciError, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ReplayGainMetadata {
    pub track_gain_db: Option<f32>,
    pub album_gain_db: Option<f32>,
    pub track_peak: Option<f32>,
    pub album_peak: Option<f32>,
    pub r128_track_gain_q8: Option<i16>,
    pub r128_album_gain_q8: Option<i16>,
}
/// A logical stream/link's optional tags, located on the provider's normalized
/// source timeline. These are transient provider facts, never decoder read-ahead.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayGainPoint {
    pub source_frame: u64,
    pub tags: ReplayGainMetadata,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct NormalizationPoint {
    pub source_frame: u64,
    pub normalization: Normalization,
}
fn invalid(detail: &str) -> LibzciError {
    LibzciError::InvalidArgument {
        detail: detail.into(),
    }
}
fn gain(value: &str) -> Option<f32> {
    let mut value = value.trim();
    if value
        .get(value.len().saturating_sub(2)..)
        .is_some_and(|s| s.eq_ignore_ascii_case("db"))
    {
        value = value[..value.len() - 2].trim_end();
    }
    value
        .parse::<f32>()
        .ok()
        .filter(|n| n.is_finite() && (-60.0..=60.0).contains(n))
}
fn peak(value: &str) -> Option<f32> {
    value
        .trim()
        .parse::<f32>()
        .ok()
        .filter(|n| n.is_finite() && *n > 0.0 && *n <= 100.0)
}
fn r128(value: &str) -> Option<i16> {
    // Unlike free-form ReplayGain gains, the RFC integer has no whitespace,
    // units, fractional component, exponent, or more than six ASCII chars.
    let digits = value.strip_prefix(['+', '-']).unwrap_or(value);
    if value.len() > 6 || digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}
impl ReplayGainMetadata {
    pub fn from_comments(comments: &[(String, String)]) -> Self {
        let mut result = Self::default();
        let (mut track_r128, mut album_r128) = (0, 0);
        for (key, value) in comments.iter().take(256) {
            match crate::provider::metadata_comment_key(key)
                .to_ascii_uppercase()
                .as_str()
            {
                "REPLAYGAIN_TRACK_GAIN" if result.track_gain_db.is_none() => {
                    result.track_gain_db = gain(value)
                }
                "REPLAYGAIN_ALBUM_GAIN" if result.album_gain_db.is_none() => {
                    result.album_gain_db = gain(value)
                }
                "REPLAYGAIN_TRACK_PEAK" if result.track_peak.is_none() => {
                    result.track_peak = peak(value)
                }
                "REPLAYGAIN_ALBUM_PEAK" if result.album_peak.is_none() => {
                    result.album_peak = peak(value)
                }
                "R128_TRACK_GAIN" => {
                    track_r128 += 1;
                    result.r128_track_gain_q8 = r128(value);
                }
                "R128_ALBUM_GAIN" => {
                    album_r128 += 1;
                    result.r128_album_gain_q8 = r128(value);
                }
                _ => {}
            }
        }
        // Duplicate R128 fields are invalid even if their text agrees.
        if track_r128 > 1 {
            result.r128_track_gain_q8 = None;
        }
        if album_r128 > 1 {
            result.r128_album_gain_q8 = None;
        }
        result
    }
    pub fn validate(&self) -> Result<()> {
        if [self.track_gain_db, self.album_gain_db]
            .into_iter()
            .flatten()
            .any(|n| !n.is_finite() || !(-60.0..=60.0).contains(&n))
            || [self.track_peak, self.album_peak]
                .into_iter()
                .flatten()
                .any(|n| !n.is_finite() || n <= 0.0 || n > 100.0)
        {
            return Err(invalid("invalid ReplayGain metadata"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayGainMode {
    #[default]
    Off,
    Track,
    Album,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ReplayGainSettings {
    pub mode: ReplayGainMode,
    pub fallback: bool,
    pub preamp_db: f32,
    pub missing_gain_db: f32,
    pub r128_target_lufs: f32,
    pub prevent_clipping: bool,
}
impl Default for ReplayGainSettings {
    fn default() -> Self {
        Self {
            mode: ReplayGainMode::Off,
            fallback: true,
            preamp_db: 0.0,
            missing_gain_db: 0.0,
            r128_target_lufs: -18.0,
            prevent_clipping: true,
        }
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GainOrigin {
    #[default]
    Off,
    Missing,
    Track,
    Album,
    R128Track,
    R128Album,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Normalization {
    pub origin: GainOrigin,
    pub gain_db: f32,
    pub linear: f32,
    pub clipping_limited: bool,
}
impl Default for Normalization {
    fn default() -> Self {
        Self {
            origin: GainOrigin::Off,
            gain_db: 0.0,
            linear: 1.0,
            clipping_limited: false,
        }
    }
}
impl ReplayGainSettings {
    pub fn validate(&self) -> Result<()> {
        if !self.preamp_db.is_finite()
            || !(-24.0..=24.0).contains(&self.preamp_db)
            || !self.missing_gain_db.is_finite()
            || !(-60.0..=24.0).contains(&self.missing_gain_db)
            || !self.r128_target_lufs.is_finite()
            || !(-30.0..=-5.0).contains(&self.r128_target_lufs)
        {
            return Err(invalid("ReplayGain setting out of range"));
        }
        Ok(())
    }
    pub fn resolve(&self, tags: &ReplayGainMetadata) -> Result<Normalization> {
        self.validate()?;
        tags.validate()?;
        if self.mode == ReplayGainMode::Off {
            return Ok(Normalization::default());
        }
        let select = |album: bool| {
            let (r128, rg, peak, origin, r128_origin) = if album {
                (
                    tags.r128_album_gain_q8,
                    tags.album_gain_db,
                    tags.album_peak,
                    GainOrigin::Album,
                    GainOrigin::R128Album,
                )
            } else {
                (
                    tags.r128_track_gain_q8,
                    tags.track_gain_db,
                    tags.track_peak,
                    GainOrigin::Track,
                    GainOrigin::R128Track,
                )
            };
            if let Some(q8) = r128 {
                Some((
                    r128_origin,
                    q8 as f32 / 256.0 + (self.r128_target_lufs + 23.0),
                    None,
                ))
            } else {
                rg.map(|gain| (origin, gain, peak))
            }
        };
        let album = self.mode == ReplayGainMode::Album;
        let selected = select(album).or_else(|| self.fallback.then(|| select(!album)).flatten());
        let (origin, db, peak) = selected.map_or(
            (GainOrigin::Missing, self.missing_gain_db, None),
            |(o, g, p)| (o, g + self.preamp_db, p),
        );
        let mut gain_db = db.clamp(-120.0, 60.0);
        let mut clipping_limited = false;
        if let Some(peak) = peak.filter(|_| self.prevent_clipping) {
            let ceiling = -20.0 * peak.log10();
            if gain_db > ceiling {
                gain_db = ceiling;
                clipping_limited = true;
            }
        }
        Ok(Normalization {
            origin,
            gain_db,
            linear: 10.0_f32.powf(gain_db / 20.0),
            clipping_limited,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tags(values: &[(&str, &str)]) -> ReplayGainMetadata {
        ReplayGainMetadata::from_comments(
            &values
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect::<Vec<_>>(),
        )
    }
    #[test]
    fn strict_tags_first_valid_rg_and_duplicate_r128_policy() {
        let t = tags(&[
            ("replaygain_track_gain", "oops -3"),
            ("REPLAYGAIN_TRACK_GAIN", " -3 dB "),
            ("REPLAYGAIN_TRACK_GAIN", "4"),
            ("REPLAYGAIN_TRACK_PEAK", "NaN"),
            ("REPLAYGAIN_TRACK_PEAK", "0.75"),
            ("R128_TRACK_GAIN", "+00256"),
            ("R128_ALBUM_GAIN", "-32768"),
        ]);
        assert_eq!(t.track_gain_db, Some(-3.0));
        assert_eq!(
            tags(&[("TXXX:replaygain_track_gain", "-6 dB")]).track_gain_db,
            Some(-6.0)
        );
        assert_eq!(
            tags(&[("txx:R128_TRACK_GAIN", "256")]).r128_track_gain_q8,
            Some(256)
        );
        assert_eq!(t.track_peak, Some(0.75));
        assert_eq!(t.r128_track_gain_q8, Some(256));
        assert_eq!(t.r128_album_gain_q8, Some(-32768));
        for invalid in [
            "256 ",
            " 256",
            "256dB",
            "256.0",
            "2e2",
            "32768",
            "-32769",
            "+000256",
            "+",
            "--1",
            "２５６",
        ] {
            assert_eq!(r128(invalid), None, "{invalid}");
        }
        assert_eq!(
            tags(&[("R128_TRACK_GAIN", "256"), ("r128_track_gain", "256")]).r128_track_gain_q8,
            None
        );
        for invalid in ["NaN", "inf", "-61", "61", "1 dB junk", "prefix -3 dB"] {
            assert_eq!(gain(invalid), None);
        }
    }
    #[test]
    fn chooses_one_family_with_explicit_r128_reference_and_fallback() {
        let t = tags(&[
            ("R128_TRACK_GAIN", "256"),
            ("REPLAYGAIN_TRACK_GAIN", "-3 dB"),
            ("REPLAYGAIN_ALBUM_GAIN", "-7 dB"),
        ]);
        let mut s = ReplayGainSettings::default();
        assert_eq!(s.resolve(&t).unwrap(), Normalization::default());
        s.mode = ReplayGainMode::Track;
        let n = s.resolve(&t).unwrap();
        assert_eq!(n.origin, GainOrigin::R128Track);
        assert_eq!(n.gain_db, 6.0);
        s.r128_target_lufs = -23.0;
        assert_eq!(s.resolve(&t).unwrap().gain_db, 1.0);
        s.mode = ReplayGainMode::Album;
        assert_eq!(s.resolve(&t).unwrap().gain_db, -7.0);
        let t = tags(&[("R128_TRACK_GAIN", "-256")]);
        assert_eq!(s.resolve(&t).unwrap().origin, GainOrigin::R128Track);
        s.fallback = false;
        s.missing_gain_db = -2.0;
        s.preamp_db = 12.0;
        let n = s.resolve(&t).unwrap();
        assert_eq!(n.origin, GainOrigin::Missing);
        assert_eq!(n.gain_db, -2.0);
    }
    #[test]
    fn peak_ceiling_precedes_master_and_invalid_parameters_are_rejected() {
        let t = tags(&[
            ("REPLAYGAIN_TRACK_GAIN", "12 dB"),
            ("REPLAYGAIN_TRACK_PEAK", "2"),
        ]);
        let mut s = ReplayGainSettings {
            mode: ReplayGainMode::Track,
            ..Default::default()
        };
        let n = s.resolve(&t).unwrap();
        assert!(n.clipping_limited);
        assert!((n.linear - 0.5).abs() < 1e-6);
        s.prevent_clipping = false;
        assert!((s.resolve(&t).unwrap().linear - 3.9810717).abs() < 1e-5);
        for value in [f32::NAN, f32::INFINITY, -100.0, 100.0] {
            assert!(ReplayGainSettings {
                preamp_db: value,
                ..s
            }
            .validate()
            .is_err());
            assert!(ReplayGainSettings {
                r128_target_lufs: value,
                ..s
            }
            .validate()
            .is_err());
        }
        assert!(ReplayGainMetadata {
            track_peak: Some(0.0),
            ..Default::default()
        }
        .validate()
        .is_err());
        assert_eq!(
            ReplayGainSettings {
                mode: ReplayGainMode::Track,
                ..Default::default()
            }
            .resolve(&tags(&[("R128_TRACK_GAIN", "32767")]))
            .unwrap()
            .gain_db,
            60.0
        );
    }
}
