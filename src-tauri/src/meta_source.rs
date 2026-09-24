//! Provenance ranks for creative sample fields.
//!
//! Write when the field is unknown (empty value, no source), or when the
//! incoming source ranks strictly higher than the stored `*_source`. Same rank
//! does not rewrite. A user-cleared field (empty value, `source = user`) is a
//! real choice and only Custom / nuclear force may overwrite it.

#![allow(
    clippy::module_name_repetitions,
    reason = "MetaSource is the public name for this module's type"
)]

/// Origin of a BPM / key / `sample_type` value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MetaSource {
    Audio = 0,
    Filename = 1,
    Splice = 2,
    User = 3,
}

impl MetaSource {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Audio => "audio",
            Self::Filename => "filename",
            Self::Splice => "splice",
            Self::User => "user",
        }
    }

    pub fn parse(value: Option<&str>) -> Option<Self> {
        match value? {
            "audio" => Some(Self::Audio),
            "filename" => Some(Self::Filename),
            "splice" => Some(Self::Splice),
            "user" => Some(Self::User),
            _ => None,
        }
    }

    /// Rank stored source; unknown / null is below every known source.
    pub fn rank(value: Option<&str>) -> i8 {
        match Self::parse(value) {
            Some(Self::Audio) => 0,
            Some(Self::Filename) => 1,
            Some(Self::Splice) => 2,
            Some(Self::User) => 3,
            None => -1,
        }
    }

    const fn rank_self(self) -> i8 {
        match self {
            Self::Audio => 0,
            Self::Filename => 1,
            Self::Splice => 2,
            Self::User => 3,
        }
    }
}

/// Whether `incoming` may overwrite the current field.
///
/// `current_value_empty` means no usable value (null, or BPM ≤ 0). An empty
/// field with no source is unknown and anyone may fill it. An empty field with
/// a source (for example user cleared BPM) follows normal precedence.
pub fn should_write(
    current_value_empty: bool,
    current_source: Option<&str>,
    incoming: MetaSource,
    force: bool,
) -> bool {
    if force {
        return true;
    }
    if current_value_empty && current_source.is_none() {
        return true;
    }
    incoming.rank_self() > MetaSource::rank(current_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_empty_always_writes() {
        assert!(should_write(true, None, MetaSource::Audio, false));
    }

    #[test]
    fn user_cleared_empty_blocks_lower_sources() {
        assert!(!should_write(true, Some("user"), MetaSource::Audio, false));
        assert!(!should_write(true, Some("user"), MetaSource::Splice, false));
    }

    #[test]
    fn higher_source_wins() {
        assert!(should_write(
            false,
            Some("audio"),
            MetaSource::Filename,
            false
        ));
        assert!(should_write(
            false,
            Some("filename"),
            MetaSource::Splice,
            false
        ));
        assert!(should_write(false, Some("splice"), MetaSource::User, false));
    }

    #[test]
    fn same_or_lower_does_not_rewrite() {
        assert!(!should_write(
            false,
            Some("splice"),
            MetaSource::Splice,
            false
        ));
        assert!(!should_write(
            false,
            Some("splice"),
            MetaSource::Filename,
            false
        ));
        assert!(!should_write(
            false,
            Some("user"),
            MetaSource::Splice,
            false
        ));
    }

    #[test]
    fn force_overrides() {
        assert!(should_write(false, Some("user"), MetaSource::Audio, true));
        assert!(should_write(true, Some("user"), MetaSource::Audio, true));
    }

    #[test]
    fn null_source_is_lowest() {
        assert!(should_write(false, None, MetaSource::Audio, false));
    }
}
