//! Persist shared search/sort keys instead of relying on SQLite's ASCII-only
//! lower()/NOCASE or on the adapter's locale. Original labels and platform
//! source identities remain exact. Keys use canonical normalization and Unicode
//! default full case folding; this is deterministic scalar ordering, not a
//! language-specific collation (in particular, not Turkish I tailoring).
use caseless::Caseless;
use unicode_normalization::UnicodeNormalization;

pub(super) fn key(text: &str) -> String {
    text.nfd().default_case_fold().nfc().collect()
}

pub(super) struct Keys {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub path: String,
}
impl Keys {
    pub fn new(input: &super::MediaInput) -> Self {
        Self {
            title: key(&input.metadata.title),
            artist: key(&input.metadata.artist),
            album: key(&input.metadata.album),
            genre: key(&input.metadata.genre),
            path: key(&input.source.display_path),
        }
    }
    pub fn bytes(&self) -> usize {
        self.title.len() + self.artist.len() + self.album.len() + self.genre.len() + self.path.len()
    }
}

#[cfg(test)]
mod tests {
    use super::key;

    #[test]
    fn canonical_full_folding_preserves_accents_and_uses_default_not_locale_case_rules() {
        for (a, b) in [
            ("Çığ", "çığ"),
            ("Straße", "STRASSE"),
            ("ΟΣ", "ος"),
            ("ÉTÉ", "e\u{301}te\u{301}"),
            ("ᾃ", "ἋΙ"),
            ("ﬃ", "FFI"),
        ] {
            assert_eq!(key(a), key(b), "{a} / {b}");
        }
        assert_ne!(key("cafe"), key("café"));
        assert_eq!(key("I"), "i");
        assert_ne!(key("I"), key("ı"));
        assert_eq!(key("İ"), "i\u{307}");
    }
}
