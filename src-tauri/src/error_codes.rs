//! Stable dotted error codes for IPC and UI locale mapping.

/// One registry entry: code + short English log line.
#[derive(Debug, Clone, Copy)]
pub struct ErrorCode {
    pub code: &'static str,
    pub log: &'static str,
}

pub const LIBRARY_MIGRATE_FAILED: ErrorCode = ErrorCode {
    code: "library.migrate_failed",
    log: "library migrate failed",
};
pub const LIBRARY_ADD_REFUSED: ErrorCode = ErrorCode {
    code: "library.add_refused",
    log: "add library refused",
};
pub const SAMPLE_NOT_FOUND: ErrorCode = ErrorCode {
    code: "sample.not_found",
    log: "sample not found",
};
pub const SAMPLE_MISSING_FILE: ErrorCode = ErrorCode {
    code: "sample.missing_file",
    log: "sample file is missing",
};
pub const PLAY_FAILED: ErrorCode = ErrorCode {
    code: "play.failed",
    log: "playback failed",
};
pub const SETTINGS_SAVE_FAILED: ErrorCode = ErrorCode {
    code: "settings.save_failed",
    log: "failed to save setting",
};
pub const DRAG_FAILED: ErrorCode = ErrorCode {
    code: "drag.failed",
    log: "drag export failed",
};
pub const GENERIC: ErrorCode = ErrorCode {
    code: "error.generic",
    log: "something went wrong",
};

pub const ALL_CODES: &[ErrorCode] = &[
    LIBRARY_MIGRATE_FAILED,
    LIBRARY_ADD_REFUSED,
    SAMPLE_NOT_FOUND,
    SAMPLE_MISSING_FILE,
    PLAY_FAILED,
    SETTINGS_SAVE_FAILED,
    DRAG_FAILED,
    GENERIC,
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn error_codes_are_unique() {
        let mut seen = HashSet::new();
        for entry in ALL_CODES {
            assert!(
                seen.insert(entry.code),
                "duplicate error code: {}",
                entry.code
            );
        }
    }
}
