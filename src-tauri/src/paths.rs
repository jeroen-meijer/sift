use std::fs;
use std::path::PathBuf;

use directories::ProjectDirs;

use crate::error::{AppError, AppResult};

#[derive(Clone, Debug)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    #[allow(dead_code, reason = "resolved for completeness; not read yet")]
    pub cache_dir: PathBuf,
    pub clips_dir: PathBuf,
    pub peaks_dir: PathBuf,
}

impl AppPaths {
    pub fn resolve() -> AppResult<Self> {
        let dirs = ProjectDirs::from("dev", "jfk", "Sift")
            .ok_or_else(|| AppError::msg("could not resolve app data directories"))?;
        let data_dir = dirs.data_dir().to_path_buf();
        let cache_dir = dirs.cache_dir().to_path_buf();
        let clips_dir = cache_dir.join("clips");
        let peaks_dir = cache_dir.join("peaks");
        let db_path = data_dir.join("library.sqlite3");

        fs::create_dir_all(&data_dir)?;
        fs::create_dir_all(&clips_dir)?;
        fs::create_dir_all(&peaks_dir)?;

        Ok(Self {
            data_dir,
            db_path,
            cache_dir,
            clips_dir,
            peaks_dir,
        })
    }

    /// Layout under `root` for unit tests (data + cache/clips + cache/peaks).
    #[cfg(test)]
    pub fn for_test(root: &std::path::Path) -> Self {
        let data_dir = root.join("data");
        let cache_dir = root.join("cache");
        let clips_dir = cache_dir.join("clips");
        let peaks_dir = cache_dir.join("peaks");
        let db_path = data_dir.join("library.sqlite3");
        fs::create_dir_all(&data_dir).expect("test data dir");
        fs::create_dir_all(&clips_dir).expect("test clips dir");
        fs::create_dir_all(&peaks_dir).expect("test peaks dir");
        Self {
            data_dir,
            db_path,
            cache_dir,
            clips_dir,
            peaks_dir,
        }
    }
}
