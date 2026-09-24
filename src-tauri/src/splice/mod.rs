//! Read-only access to Splice Desktop's local `sounds.db`.

mod catalog;
mod detect;
mod map;

pub use catalog::{CatalogStatus, SpliceHit, lookup, refresh_catalog_status};
