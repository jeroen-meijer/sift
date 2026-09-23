//! BPM and musical key guessed from sample filenames / path stems.
//!
//! Pack vendors put tempo and key in names (`_174_`, `140BPM`, `F#min`, `(D)`).
//! Prefer these over weak audio heuristics when present. Biased toward labeling
//! (a wrong BPM is better than none) but avoids glued IDs like `EQ-TRU287`.

#![allow(
    clippy::arithmetic_side_effects,
    clippy::indexing_slicing,
    clippy::string_slice,
    reason = "stem scanners walk ASCII bytes/indices by construction"
)]

use std::path::Path;

const BPM_MIN: i32 = 60;
const BPM_MAX: i32 = 200;

/// Common tempi get a score bump when several numbers compete.
const COMMON_BPM: &[i32] = &[
    60, 70, 72, 74, 75, 76, 78, 80, 82, 84, 85, 86, 87, 88, 90, 92, 94, 95, 96, 98, 100, 102, 105,
    108, 110, 112, 115, 116, 118, 120, 122, 124, 125, 126, 128, 130, 132, 134, 135, 136, 138, 140,
    142, 144, 145, 148, 150, 152, 155, 160, 165, 168, 170, 172, 173, 174, 175, 176, 178, 180, 190,
    200,
];

/// Confidence written when BPM/key come from the filename.
pub const NAME_BPM_CONFIDENCE: f64 = 0.92;
pub const NAME_KEY_CONFIDENCE: f64 = 0.88;

#[derive(Debug, Clone, PartialEq)]
pub struct NameMeta {
    pub bpm: Option<f64>,
    pub key_name: Option<String>,
}

/// Parse BPM / key from a full path (uses the file stem only).
pub fn from_path(path: &Path) -> NameMeta {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    from_stem(stem)
}

pub fn from_stem(stem: &str) -> NameMeta {
    NameMeta {
        bpm: parse_bpm(stem),
        key_name: parse_key(stem),
    }
}

fn parse_bpm(stem: &str) -> Option<f64> {
    if let Some(v) = explicit_bpm(stem) {
        return Some(f64::from(v));
    }

    /* Frequency markers: "70 - 30 Hz" is not tempo. Only trust explicit Nbpm. */
    if stem.to_ascii_lowercase().contains("hz") {
        return None;
    }

    let tokens = split_tokens(stem);

    let mut best: Option<(i32, i32, usize)> = None; // score, value, index
    for (i, tok) in tokens.iter().enumerate() {
        let Some(v) = parse_bpm_token(tok) else {
            continue;
        };
        if !(BPM_MIN..=BPM_MAX).contains(&v) {
            continue;
        }

        let mut score = 0_i32;
        if COMMON_BPM.contains(&v) {
            score += 3;
        }
        if (70..=180).contains(&v) {
            score += 1;
        }
        if i * 10 >= tokens.len() * 3 {
            score += 1;
        }
        if i == 0 && tokens.len() > 3 {
            score -= 1;
        }
        // Leading zero pads like 080 / 088 are usually tempo in pack names.
        if tok.len() == 3 && tok.starts_with('0') {
            score += 1;
        }

        let cand = (score, v, i);
        if best.is_none_or(|b| cand.0 > b.0 || (cand.0 == b.0 && cand.2 >= b.2)) {
            best = Some(cand);
        }
    }
    best.map(|(_, v, _)| f64::from(v))
}

fn explicit_bpm(stem: &str) -> Option<i32> {
    let lower = stem.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut last: Option<i32> = None;
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        if i > 0 && bytes[i - 1].is_ascii_alphanumeric() {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        let digits = &lower[start..i];
        if digits.len() < 2 || digits.len() > 3 {
            continue;
        }
        // skip spaces
        let mut j = i;
        while j < bytes.len() && bytes[j] == b' ' {
            j += 1;
        }
        if lower[j..].starts_with("bpm") {
            let after = j + 3;
            if after < bytes.len() && bytes[after].is_ascii_alphanumeric() {
                continue;
            }
            if let Ok(v) = digits.parse::<i32>()
                && (BPM_MIN..=BPM_MAX).contains(&v)
            {
                last = Some(v);
            }
        }
    }
    last
}

fn parse_bpm_token(tok: &str) -> Option<i32> {
    if tok.len() < 2 || tok.len() > 3 {
        return None;
    }
    if !tok.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    tok.parse().ok()
}

fn parse_key(stem: &str) -> Option<String> {
    let tokens = split_tokens(stem);
    let mut best: Option<(i32, usize, String)> = None;

    // Parenthetical: (D) (F#) (A min)
    for (cap, start) in scan_parens(stem) {
        if let Some((score, key)) = key_from_fragment(&cap, 5) {
            consider(&mut best, score, start, key);
        }
    }

    for (i, tok) in tokens.iter().enumerate() {
        let lower = tok.to_ascii_lowercase();
        // Skip FM (radio / synth brand token), EBM (genre).
        if matches!(lower.as_str(), "fm" | "ebm" | "edm" | "dub" | "sub") {
            continue;
        }
        if let Some((score, key)) = key_from_token(tok, i, tokens.len()) {
            // EQ pack "A-LINE" style: bare A before LINE
            if score < 4 && stem.to_ascii_lowercase().contains("line") && key.len() <= 2 {
                continue;
            }
            consider(&mut best, score, i, key);
        }
    }

    best.filter(|(score, _, _)| *score >= 2).map(|(_, _, k)| k)
}

fn consider(best: &mut Option<(i32, usize, String)>, score: i32, idx: usize, key: String) {
    let better = best
        .as_ref()
        .is_none_or(|b| score > b.0 || (score == b.0 && idx >= b.1));
    if better {
        *best = Some((score, idx, key));
    }
}

fn key_from_token(tok: &str, index: usize, n_tokens: usize) -> Option<(i32, String)> {
    let (root, mode) = split_root_mode(tok)?;
    let score = match mode {
        KeyMode::MajorExplicit | KeyMode::MinorExplicit | KeyMode::MinorM => 4,
        KeyMode::Bare => {
            let mut s = 1;
            if index * 10 >= n_tokens * 6 {
                s += 2;
            }
            if n_tokens >= 2 {
                s += 1;
            }
            s
        }
    };
    Some((score, format_key(&root, mode.is_minor())))
}

fn key_from_fragment(frag: &str, base: i32) -> Option<(i32, String)> {
    let cleaned: String = frag.chars().filter(|c| !c.is_whitespace()).collect();
    let (root, mode) = split_root_mode(&cleaned)?;
    Some((base, format_key(&root, mode.is_minor())))
}

#[derive(Clone, Copy)]
enum KeyMode {
    Bare,
    MajorExplicit,
    MinorExplicit,
    MinorM,
}

impl KeyMode {
    const fn is_minor(self) -> bool {
        matches!(self, Self::MinorExplicit | Self::MinorM)
    }
}

fn split_root_mode(tok: &str) -> Option<(String, KeyMode)> {
    let t = tok.to_ascii_lowercase().replace('♯', "#").replace('♭', "b");
    if t.is_empty() {
        return None;
    }

    // Strip explicit quality suffixes (longest first).
    for (suf, mode) in [
        ("major", KeyMode::MajorExplicit),
        ("minor", KeyMode::MinorExplicit),
        ("maj", KeyMode::MajorExplicit),
        ("min", KeyMode::MinorExplicit),
        ("mi", KeyMode::MinorExplicit),
    ] {
        if let Some(root) = t.strip_suffix(suf)
            && !root.is_empty()
            && parse_root(root).is_some()
        {
            return Some((parse_root(root)?, mode));
        }
    }

    // Trailing `m` → minor (`Am`, `F#m`, `Bbm`) but not bare roots ending oddly.
    if let Some(root) = t.strip_suffix('m')
        && !root.is_empty()
        && parse_root(root).is_some()
    {
        // Single letter + m only (or with accidental).
        return Some((parse_root(root)?, KeyMode::MinorM));
    }

    let root = parse_root(&t)?;
    Some((root, KeyMode::Bare))
}

fn parse_root(raw: &str) -> Option<String> {
    let r = raw.to_ascii_lowercase();
    let (letter, acc) = match r.as_str() {
        "c" | "c#" | "db" | "d" | "d#" | "eb" | "e" | "e#" | "fb" | "f" | "f#" | "gb" | "g"
        | "g#" | "ab" | "a" | "a#" | "bb" | "b" | "b#" | "cb" => {
            if r.len() == 1 {
                (r.clone(), String::new())
            } else {
                (r[..1].to_string(), r[1..].to_string())
            }
        }
        _ => return None,
    };
    // Normalize to sharp-side spellings used by the picker.
    let sharp = match (letter.as_str(), acc.as_str()) {
        ("c", "") | ("b", "#") => "C",
        ("c", "#") | ("d", "b") => "C#",
        ("d", "") => "D",
        ("d", "#") | ("e", "b") => "D#",
        ("e", "") | ("f", "b") => "E",
        ("e", "#") | ("f", "") => "F",
        ("f", "#") | ("g", "b") => "F#",
        ("g", "") => "G",
        ("g", "#") | ("a", "b") => "G#",
        ("a", "") => "A",
        ("a", "#") | ("b", "b") => "A#",
        ("b", "") | ("c", "b") => "B",
        _ => return None,
    };
    Some(sharp.to_string())
}

fn format_key(root: &str, minor: bool) -> String {
    if minor {
        format!("{root}m")
    } else {
        root.to_string()
    }
}

fn scan_parens(stem: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let bytes = stem.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'(' {
            i += 1;
            continue;
        }
        let start = i;
        i += 1;
        let content_start = i;
        while i < bytes.len() && bytes[i] != b')' {
            i += 1;
        }
        if i < bytes.len() {
            let content = stem[content_start..i].trim();
            if !content.is_empty() {
                out.push((content.to_string(), start));
            }
            i += 1;
        }
    }
    out
}

fn split_tokens(stem: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in stem.chars() {
        if ch.is_ascii_alphanumeric() || ch == '#' || ch == '♯' || ch == '♭' {
            cur.push(ch);
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bpm_explicit_suffix() {
        assert_eq!(from_stem("FRAGMENTS2 Drum Fill 14 140BPM").bpm, Some(140.0));
        assert_eq!(from_stem("Vocal - Roses - Cmin - 140 BPM").bpm, Some(140.0));
        assert_eq!(
            from_stem("mantle_clock_ticking (1) 128bpm").bpm,
            Some(128.0)
        );
        assert_eq!(
            from_stem("ECLIPSE Synth Loop 05 - F#min 174BPM (Bass)").bpm,
            Some(174.0)
        );
    }

    #[test]
    fn bpm_delimited_tokens() {
        assert_eq!(from_stem("91V_UKB_140_drum_loop_heavy").bpm, Some(140.0));
        assert_eq!(from_stem("140_TopRollers_01_TL").bpm, Some(140.0));
        assert_eq!(
            from_stem("RARE_Rebolo_drum_tough_percussion_128_loop").bpm,
            Some(128.0)
        );
        assert_eq!(from_stem("XOW_174_Eb_Atmos_MoodBoard_2").bpm, Some(174.0));
        assert_eq!(
            from_stem("Avant - D&B 01 Bass One Shot 87 (D)").bpm,
            Some(87.0)
        );
        assert_eq!(
            from_stem("FOUSHEE_vocal_run_clean_jazzy_harmony_87_Bmaj").bpm,
            Some(87.0)
        );
        assert_eq!(from_stem("bones 103").bpm, Some(103.0));
        assert_eq!(from_stem("EQ-Lp616 DubTamb Rollin 080").bpm, Some(80.0));
    }

    #[test]
    fn bpm_rejects_glued_ids_and_hz() {
        assert_eq!(from_stem("EQ-TRU287 TRUMPET").bpm, None);
        assert_eq!(from_stem("EQ-SAX287 TENOR").bpm, None);
        assert_eq!(from_stem("OpenHat ( 1400 )").bpm, None);
        assert_eq!(from_stem("70 - 30 Hz Bass Sweep").bpm, None);
    }

    #[test]
    fn bpm_prefers_trailing_pack_tempo() {
        assert_eq!(from_stem("EQ-FX087 CHRD EMSJAZ 100").bpm, Some(100.0));
        assert_eq!(
            from_stem("EQ-Mu487 EPI CHORDS FURNITZ 100").bpm,
            Some(100.0)
        );
    }

    #[test]
    fn key_explicit_modes() {
        assert_eq!(
            from_stem("Vocal - Roses - Cmin - 140 BPM")
                .key_name
                .as_deref(),
            Some("Cm")
        );
        assert_eq!(
            from_stem("FOUSHEE_vocal_run_clean_jazzy_harmony_87_Bmaj")
                .key_name
                .as_deref(),
            Some("B")
        );
        assert_eq!(
            from_stem("ECLIPSE Synth Loop 05 - F#min 174BPM (Bass)")
                .key_name
                .as_deref(),
            Some("F#m")
        );
        assert_eq!(
            from_stem("kln_128_vocal_loop_tripped_Amin")
                .key_name
                .as_deref(),
            Some("Am")
        );
        assert_eq!(
            from_stem("SDAM_128_Cm_Grumbla_Syn_Bass")
                .key_name
                .as_deref(),
            Some("Cm")
        );
        assert_eq!(
            from_stem("EQ-Mu209 Chrd Cm JzPian 100").key_name.as_deref(),
            Some("Cm")
        );
        assert_eq!(
            from_stem("MRO_174_Bbm_Cheese_Trance_Arp")
                .key_name
                .as_deref(),
            Some("A#m")
        );
    }

    #[test]
    fn key_paren_and_bare() {
        assert_eq!(
            from_stem("Avant - D&B 01 Bass One Shot 87 (D)")
                .key_name
                .as_deref(),
            Some("D")
        );
        assert_eq!(
            from_stem("mau5_soft_stab_long_rev_128_G")
                .key_name
                .as_deref(),
            Some("G")
        );
        assert_eq!(
            from_stem("XOW_174_Eb_Atmos_MoodBoard_2")
                .key_name
                .as_deref(),
            Some("D#")
        );
        assert_eq!(
            from_stem("TAURUS Bass Shot 15 F# 174BPM")
                .key_name
                .as_deref(),
            Some("F#")
        );
    }

    #[test]
    fn key_skips_fm_ebm_genre_tokens() {
        assert!(
            from_stem("Novation Peak EBM 120").key_name.is_none()
                || from_stem("Novation Peak EBM 120").key_name.as_deref() != Some("EBm")
        );
        // FM scream files: key is the D/E part, not FM
        let k = from_stem("FLINT_FM_scream_150_D-E_clean_1").key_name;
        assert_ne!(k.as_deref(), Some("Fm"));
    }
}
