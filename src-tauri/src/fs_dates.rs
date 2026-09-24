//! Filesystem Date added / Date created for the sample table.
//!
//! - `date_created_ms`: birth / creation on this volume when the OS exposes it.
//! - `date_added_ms`: Finder "Date Added" on macOS only (`ATTR_CMN_ADDEDTIME`).
//!   Always null on Windows / Linux (never copy creation into Added).

use std::fs::Metadata;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

fn system_time_ms(t: SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
}

/// Birth / creation time in unix ms, when available.
pub fn date_created_ms(meta: &Metadata) -> Option<i64> {
    meta.created().ok().and_then(system_time_ms)
}

#[cfg(target_os = "macos")]
#[allow(
    unsafe_code,
    reason = "getattrlist is the supported way to read ATTR_CMN_ADDEDTIME"
)]
mod macos_added {
    use std::ffi::CString;
    use std::mem;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    #[repr(C)]
    struct AttrList {
        bitmapcount: u16,
        reserved: u16,
        commonattr: u32,
        volattr: u32,
        dirattr: u32,
        fileattr: u32,
        forkattr: u32,
    }

    #[repr(C)]
    struct TimeSpec {
        tv_sec: i64,
        tv_nsec: i64,
    }

    const ATTR_BIT_MAP_COUNT: u16 = 5;
    const ATTR_CMN_ADDEDTIME: u32 = 0x1000_0000;

    unsafe extern "C" {
        fn getattrlist(
            path: *const std::ffi::c_char,
            attr_list: *mut std::ffi::c_void,
            attr_buf: *mut std::ffi::c_void,
            attr_buf_size: usize,
            options: u64,
        ) -> i32;
    }

    pub fn date_added_ms(path: &Path) -> Option<i64> {
        let c_path = CString::new(path.as_os_str().as_bytes()).ok()?;
        let mut attrlist = AttrList {
            bitmapcount: ATTR_BIT_MAP_COUNT,
            reserved: 0,
            commonattr: ATTR_CMN_ADDEDTIME,
            volattr: 0,
            dirattr: 0,
            fileattr: 0,
            forkattr: 0,
        };

        let mut buf = [0_u8; 4 + mem::size_of::<TimeSpec>()];
        // SAFETY: path is a valid C string; attrlist and buf sizes match Apple's ABI.
        let rc = unsafe {
            getattrlist(
                c_path.as_ptr(),
                (&raw mut attrlist).cast(),
                buf.as_mut_ptr().cast(),
                buf.len(),
                0,
            )
        };
        if rc != 0 {
            return None;
        }
        // Copy the timespec after the u32 length prefix without an unaligned cast.
        let mut ts_bytes = [0_u8; mem::size_of::<TimeSpec>()];
        let ts_len = mem::size_of::<TimeSpec>();
        let end = 4usize.checked_add(ts_len)?;
        ts_bytes.copy_from_slice(buf.get(4..end)?);
        let ts: TimeSpec = unsafe { mem::transmute_copy(&ts_bytes) };
        let secs = ts.tv_sec;
        if secs <= 0 {
            return None;
        }
        secs.checked_mul(1000)?.checked_add(ts.tv_nsec / 1_000_000)
    }
}

/// Parent-folder "Date Added" in unix ms. macOS only; elsewhere always `None`.
#[cfg(target_os = "macos")]
pub fn date_added_ms(path: &Path) -> Option<i64> {
    macos_added::date_added_ms(path)
}

#[cfg(not(target_os = "macos"))]
pub fn date_added_ms(_path: &Path) -> Option<i64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn created_from_temp_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("a.wav");
        fs::write(&path, b"x").expect("write");
        let meta = fs::metadata(&path).expect("meta");
        // Created may be missing on some Linux FS; when present it is sane.
        if let Some(ms) = date_created_ms(&meta) {
            assert!(ms > 0);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn added_from_temp_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("b.wav");
        fs::write(&path, b"x").expect("write");
        // Date Added is usually set for new local files.
        let added = date_added_ms(&path);
        assert!(added.is_none() || added.expect("checked") > 0);
    }
}
