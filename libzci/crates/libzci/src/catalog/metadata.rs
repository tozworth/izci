use super::Metadata;

fn bounded(value: &str) -> String {
    let value = value.trim();
    value[..value.floor_char_boundary(4096)].replace('\0', "")
}
fn ordinal(value: &str) -> Option<u32> {
    value.split('/').next()?.trim().parse().ok()
}
impl Metadata {
    /// Provider/container fields are ordered by precedence, first nonempty
    /// recognized value wins. Raw aliases do not escape into catalog consumers.
    /// No embedded lyrics/artwork/message payload is copied into durable facts.
    pub fn from_comments(
        comments: &[(String, String)],
        duration_seconds: Option<f64>,
        display_path: &str,
    ) -> Self {
        let mut result = Self::default();
        for (key, value) in comments.iter().take(256) {
            let value = bounded(value);
            if value.is_empty() {
                continue;
            }
            match key.trim().to_ascii_lowercase().as_str() {
                "title" | "tit2" | "tracktitle" | "inam" if result.title.is_empty() => {
                    result.title = value
                }
                "artist" | "tpe1" | "performer" | "iart" if result.artist.is_empty() => {
                    result.artist = value
                }
                "album" | "talb" | "iprd" if result.album.is_empty() => result.album = value,
                "genre" | "tcon" | "ignr" if result.genre.is_empty() => result.genre = value,
                "tracknumber" | "track_number" | "track" | "trck" | "itrk"
                    if result.track.is_none() =>
                {
                    result.track = ordinal(&value)
                }
                "discnumber" | "disc_number" | "disc" | "tpos" if result.disc.is_none() => {
                    result.disc = ordinal(&value)
                }
                "date" | "year" | "tdrc" | "tyer" | "icrd" if result.year.is_none() => {
                    result.year = value.get(..4).and_then(|s| s.parse().ok())
                }
                _ => {}
            }
        }
        if result.title.is_empty() {
            let file = display_path
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or(display_path);
            let title =
                file.rsplit_once('.')
                    .map_or(file, |(stem, _)| if stem.is_empty() { file } else { stem });
            result.title = bounded(title);
        }
        result.duration_seconds = duration_seconds.filter(|n| n.is_finite() && *n >= 0.);
        result
    }
    pub fn from_provider(facts: &crate::ProviderMetadata, display_path: &str) -> Self {
        Self::from_comments(&facts.comments, facts.duration_secs(), display_path)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_precedence_aliases_numbers_bounds_and_basename_without_embedded_payloads() {
        let comments = [
            ("TITLE", " "),
            ("TIT2", " First "),
            ("title", "Second"),
            ("TPE1", "Artist"),
            ("TRCK", "3/12"),
            ("TPOS", "2/2"),
            ("DATE", "2026-10-30"),
            ("lyrics", "private embedded payload"),
            ("genre", "Jazz\0"),
        ]
        .map(|(k, v)| (k.into(), v.into()));
        let m = Metadata::from_comments(&comments, Some(3.), "/ignored.wav");
        assert_eq!(m.title, "First");
        assert_eq!(m.artist, "Artist");
        assert_eq!(m.track, Some(3));
        assert_eq!(m.disc, Some(2));
        assert_eq!(m.year, Some(2026));
        assert_eq!(m.genre, "Jazz");
        let m = Metadata::from_comments(
            &[("artist".into(), "ü".repeat(5000))],
            Some(f64::NAN),
            "C:\\Music\\曲.wav",
        );
        assert_eq!(m.title, "曲");
        assert_eq!(m.artist.len(), 4096);
        assert_eq!(m.duration_seconds, None);
        assert!(m.validate().is_ok());
    }
}
