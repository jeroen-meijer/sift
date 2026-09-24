//! Map Splice catalog fields into Sift's BPM / key / type shapes.

#![allow(
    clippy::indexing_slicing,
    clippy::string_slice,
    reason = "root parser walks short ASCII key stems by construction"
)]

/// Confidence written when a creative field comes from Splice.
pub const SPLICE_CONFIDENCE: f64 = 0.98;

/// Map `audio_key` + `chord_type` to a Sift key (`D`, `Dm`, `F#`, `F#m`).
/// Empty / missing mode is treated as major (same as bare filename roots).
pub fn map_key(audio_key: Option<&str>, chord_type: Option<&str>) -> Option<String> {
    let raw = audio_key?.trim();
    if raw.is_empty() {
        return None;
    }
    let root = normalize_root(raw)?;
    let mode = chord_type.map_or("", str::trim);
    let minor = matches!(mode, "minor" | "min" | "m");
    Some(if minor {
        format!("{root}m")
    } else {
        root
    })
}

fn normalize_root(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    let mut chars = lower.chars();
    let letter = chars.next()?;
    if !('a'..='g').contains(&letter) {
        return None;
    }
    let upper = letter.to_ascii_uppercase();
        match chars.next() {
            Some('#' | 's') => Some(format!("{upper}#")),
            Some('b') => flat_to_sharp(upper).map(str::to_string),
            _ => Some(upper.to_string()),
        }
}

const fn flat_to_sharp(flat_root: char) -> Option<&'static str> {
    match flat_root {
        'D' => Some("C#"),
        'E' => Some("D#"),
        'G' => Some("F#"),
        'A' => Some("G#"),
        'B' => Some("A#"),
        // C flat / F flat are rare; reject rather than invent.
        _ => None,
    }
}

/// `loop` / `oneshot` → Sift `loop` / `one-shot`.
pub fn map_sample_type(raw: Option<&str>) -> Option<String> {
    match raw?.trim().to_ascii_lowercase().as_str() {
        "loop" => Some("loop".to_string()),
        "oneshot" | "one-shot" | "one_shot" => Some("one-shot".to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_major_minor_and_empty_mode() {
        assert_eq!(map_key(Some("d"), Some("minor")).as_deref(), Some("Dm"));
        assert_eq!(map_key(Some("d"), Some("major")).as_deref(), Some("D"));
        assert_eq!(map_key(Some("d"), Some("")).as_deref(), Some("D"));
        assert_eq!(map_key(Some("d"), None).as_deref(), Some("D"));
        assert_eq!(map_key(Some("f#"), Some("minor")).as_deref(), Some("F#m"));
        assert_eq!(map_key(Some("d#"), Some("")).as_deref(), Some("D#"));
    }

    #[test]
    fn sample_type_mapping() {
        assert_eq!(map_sample_type(Some("loop")).as_deref(), Some("loop"));
        assert_eq!(
            map_sample_type(Some("oneshot")).as_deref(),
            Some("one-shot")
        );
        assert_eq!(map_sample_type(Some("other")), None);
    }
}
