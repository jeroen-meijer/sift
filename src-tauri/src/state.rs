use std::sync::Arc;

use crate::db::Db;
use crate::error::AppResult;
use crate::paths::AppPaths;

pub struct AppState {
    pub paths: AppPaths,
    pub db: Arc<Db>,
}

impl AppState {
    pub fn init() -> AppResult<Self> {
        let paths = AppPaths::resolve()?;
        let db = Arc::new(Db::open(&paths)?);
        Ok(Self { paths, db })
    }
}
