//! Bounded, transient plain/LRC documents. Rendering and persistence are not
//! involved; callers load embedded/sidecar text on demand and retain this job's
//! result only while needed. Equal timestamps form one simultaneous cue group.
use crate::{queue::invalid, LibzciError, Result};
use serde::{Deserialize, Serialize};
use std::ops::Range;
mod reader;
pub use reader::read_embedded_lyrics;
pub const MAX_LYRICS_BYTES: usize = 256 * 1024;
const MAX_CUES: usize = 8192;
const MAX_CUE_TEXT: usize = 1024 * 1024;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricLine {
    pub time_ms: u64,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LyricsDocument {
    pub raw: String,
    pub plain: String,
    pub lines: Vec<LyricLine>,
    /// LRC clock offset: positive values advance the lyrics relative to audio.
    pub offset_ms: i64,
}
fn exhausted(detail: &str) -> LibzciError {
    LibzciError::ResourceExhausted {
        detail: detail.into(),
    }
}
fn timestamp(token: &str) -> Option<u64> {
    let (minutes, rest) = token.split_once(':')?;
    if !(1..=3).contains(&minutes.len()) || !minutes.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (seconds, fraction) = rest
        .split_once(['.', ':'])
        .map_or((rest, None), |(s, f)| (s, Some(f)));
    if seconds.len() != 2 || !seconds.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let seconds = seconds.parse::<u64>().ok()?;
    if seconds > 59 {
        return None;
    }
    let fraction = match fraction {
        None => 0,
        Some(f) if (1..=3).contains(&f.len()) && f.bytes().all(|b| b.is_ascii_digit()) => {
            f.parse::<u64>().ok()? * 10u64.pow(3 - f.len() as u32)
        }
        _ => return None,
    };
    Some(minutes.parse::<u64>().ok()? * 60_000 + seconds * 1000 + fraction)
}
impl LyricsDocument {
    pub fn parse(raw: &str) -> Result<Self> {
        if raw.len() > MAX_LYRICS_BYTES {
            return Err(exhausted("lyrics exceed 256 KiB"));
        }
        if raw.contains('\0') {
            return Err(invalid("lyrics contain NUL"));
        }
        let raw = raw
            .strip_prefix('\u{feff}')
            .unwrap_or(raw)
            .replace("\r\n", "\n")
            .replace('\r', "\n");
        let mut lines = vec![];
        let mut plain = vec![];
        let mut offset_ms = 0;
        let mut cue_text = 0;
        for source in raw.lines() {
            if source.len() > 4096 {
                return Err(exhausted("lyric line exceeds 4096 bytes"));
            }
            let trimmed = source.trim();
            if let Some(token) = trimmed.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
                if let Some((key, value)) = token.split_once(':') {
                    if key.eq_ignore_ascii_case("offset") {
                        if let Ok(offset) = value.trim().parse::<i64>() {
                            if offset.unsigned_abs() > 86_400_000 {
                                return Err(invalid("lyrics offset exceeds 24 hours"));
                            }
                            offset_ms = offset;
                        }
                        continue;
                    }
                    if ["ar", "al", "ti", "au", "by", "re", "ve", "length"]
                        .iter()
                        .any(|k| key.eq_ignore_ascii_case(k))
                    {
                        continue;
                    }
                }
            }
            let mut times = vec![];
            let mut text = String::new();
            let mut cursor = 0;
            while let Some(start) = source[cursor..].find('[').map(|n| n + cursor) {
                text.push_str(&source[cursor..start]);
                let Some(end) = source[start..].find(']').map(|n| n + start) else {
                    cursor = start;
                    break;
                };
                if let Some(time) = timestamp(&source[start + 1..end]) {
                    times.push(time);
                } else {
                    text.push_str(&source[start..=end]);
                }
                cursor = end + 1;
            }
            text.push_str(&source[cursor..]);
            let text = text.trim();
            plain.push(text.to_owned());
            for time_ms in times {
                cue_text += text.len();
                if lines.len() >= MAX_CUES || cue_text > MAX_CUE_TEXT {
                    return Err(exhausted("expanded lyric cue budget exceeded"));
                }
                lines.push(LyricLine {
                    time_ms,
                    text: text.into(),
                });
            }
        }
        for line in &mut lines {
            line.time_ms = (line.time_ms as i128 - offset_ms as i128).max(0) as u64;
        }
        lines.sort_by_key(|line| line.time_ms);
        Ok(Self {
            raw,
            plain: plain.join("\n").trim().into(),
            lines,
            offset_ms,
        })
    }
    pub fn active(&self, seconds: f64) -> Option<Range<usize>> {
        if !seconds.is_finite() || seconds < 0. {
            return None;
        }
        let time = (seconds * 1000.).floor() as u64;
        let end = self.lines.partition_point(|line| line.time_ms <= time);
        if end == 0 {
            return None;
        }
        let stamp = self.lines[end - 1].time_ms;
        Some(self.lines[..end].partition_point(|line| line.time_ms < stamp)..end)
    }
    pub fn from_comments(comments: &[(String, String)]) -> Result<Option<Self>> {
        let mut plain = None;
        for (key, value) in comments.iter().take(256) {
            if ![
                "lyrics",
                "unsyncedlyrics",
                "unsynced lyrics",
                "syncedlyrics",
                "uslt",
            ]
            .iter()
            .any(|k| key.eq_ignore_ascii_case(k))
            {
                continue;
            }
            let document = Self::parse(value)?;
            if !document.lines.is_empty() {
                return Ok(Some(document));
            }
            if !document.plain.is_empty() && plain.is_none() {
                plain = Some(document);
            }
        }
        Ok(plain)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handles_plain_lrc_duplicates_out_of_order_offsets_and_explicit_clear_cues() {
        let doc=LyricsDocument::parse("\u{feff}[ar:Artist]\r\n[offset:100]\r\nIntro\n[00:02.50][00:01:250] Çığ\n[00:01.250] 曲\n[00:03]\n[00:99]invalid").unwrap();
        assert_eq!(doc.offset_ms, 100);
        assert_eq!(
            doc.lines.iter().map(|l| l.time_ms).collect::<Vec<_>>(),
            vec![1150, 1150, 2400, 2900]
        );
        assert_eq!(doc.active(1.149), None);
        assert_eq!(doc.active(1.15), Some(0..2));
        assert_eq!(doc.active(2.5), Some(2..3));
        assert_eq!(doc.active(3.), Some(3..4));
        assert!(doc.lines[3].text.is_empty());
        assert!(doc.plain.contains("[00:99]invalid"));
        assert!(!doc.plain.contains("[ar:"));
        assert_eq!(doc.active(f64::NAN), None);
        assert!(LyricsDocument::parse("plain\ntext")
            .unwrap()
            .lines
            .is_empty());
    }
    #[test]
    fn rejects_expansion_and_input_budgets_and_prefers_timed_embedded_text() {
        assert!(LyricsDocument::parse(&"x".repeat(MAX_LYRICS_BYTES + 1)).is_err());
        assert!(LyricsDocument::parse("bad\0text").is_err());
        let stamps = "[00:01]".repeat(200);
        let raw = (stamps + &"text".repeat(500) + "\n").repeat(50);
        assert!(raw.len() < MAX_LYRICS_BYTES);
        assert!(LyricsDocument::parse(&raw).is_err());
        let comments = vec![
            ("LYRICS".into(), "plain".into()),
            ("USLT".into(), "[00:01]timed".into()),
        ];
        assert_eq!(
            LyricsDocument::from_comments(&comments)
                .unwrap()
                .unwrap()
                .lines[0]
                .text,
            "timed"
        );
        assert_eq!(
            LyricsDocument::parse("[offset:-500]\n[00:00.1]later")
                .unwrap()
                .lines[0]
                .time_ms,
            600
        );
    }
}
