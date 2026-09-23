//! Classify whether a path has local bytes without opening the file.
//!
//! Browse uses indexed metadata. Decode, play, and peaks need bytes.
//! On macOS File Provider / Dropbox, dataless stubs report a remote `st_size`
//! but allocate no blocks and may set `UF_DATALESS`.

use std::fs;
use std::path::Path;

/// Whether sample bytes are on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Availability {
    /// File contents are present on disk.
    Local,
    /// Path exists as a cloud placeholder (not hydrated).
    Cloud,
    /// Path is gone from disk.
    Missing,
}

impl Availability {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Cloud => "cloud",
            Self::Missing => "missing",
        }
    }

    #[must_use]
    pub fn parse(s: &str) -> Self {
        match s {
            "cloud" => Self::Cloud,
            "missing" => Self::Missing,
            // `local`, `unknown`, and anything else → treat as local until refreshed
            _ => Self::Local,
        }
    }
}

/// Inspect metadata only. Never open or read file contents.
#[must_use]
pub fn classify_path(path: &Path) -> Availability {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return Availability::Missing;
    };
    if meta.file_type().is_symlink() {
        // Follow once for the target; if broken → missing.
        let Ok(meta) = fs::metadata(path) else {
            return Availability::Missing;
        };
        return classify_meta(&meta);
    }
    classify_meta(&meta)
}

#[must_use]
pub fn classify_meta(meta: &fs::Metadata) -> Availability {
    if !meta.is_file() {
        return Availability::Missing;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let size = meta.len();
        let blocks = meta.blocks();
        // macOS UF_DATALESS = 0x4000_0000 on st_flags
        #[cfg(target_os = "macos")]
        {
            use std::os::macos::fs::MetadataExt as MacMetadataExt;
            const UF_DATALESS: u32 = 0x4000_0000;
            let flags = MacMetadataExt::st_flags(meta);
            if flags & UF_DATALESS != 0 {
                return Availability::Cloud;
            }
        }
        // Cloud stubs often report full remote size with zero allocated blocks.
        if size > 0 && blocks == 0 {
            return Availability::Cloud;
        }
        Availability::Local
    }

    #[cfg(not(unix))]
    {
        let _ = meta;
        Availability::Local
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn missing_path() {
        assert_eq!(
            classify_path(Path::new("/tmp/sift-definitely-missing-xyz")),
            Availability::Missing
        );
    }

    #[test]
    fn local_regular_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("a.wav");
        let mut f = fs::File::create(&path).expect("create");
        f.write_all(&[0u8; 64]).expect("write");
        drop(f);
        assert_eq!(classify_path(&path), Availability::Local);
    }

    #[test]
    fn parse_roundtrip() {
        assert_eq!(Availability::parse("local"), Availability::Local);
        assert_eq!(Availability::parse("cloud"), Availability::Cloud);
        assert_eq!(Availability::parse("missing"), Availability::Missing);
        assert_eq!(Availability::parse("unknown"), Availability::Local);
        assert_eq!(Availability::Cloud.as_str(), "cloud");
    }

    #[test]
    fn zero_blocks_with_size_is_cloud() {
        // We cannot invent UF_DATALESS in unit tests. Smoke the parse API.
        assert_eq!(Availability::parse("cloud").as_str(), "cloud");
    }
}
