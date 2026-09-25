use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::NewTag;
use crate::db::schema::tags::dsl as tags_dsl;
use crate::error::{AppError, AppResult};

/// Default taxonomy from `docs/reference/default-taxonomy.md`.
const TAXONOMY: &[(&str, Option<&str>)] = &[
    ("Drums", Some("#8B7CF6")),
    ("Drums/Kick", None),
    ("Drums/Kick/808", None),
    ("Drums/Snare", None),
    ("Drums/Clap", None),
    ("Drums/Hats", None),
    ("Drums/Hats/Closed", None),
    ("Drums/Hats/Open", None),
    ("Drums/Perc", None),
    ("Drums/Breaks", None),
    ("Drums/Toms", None),
    ("Drums/Cymbals", None),
    ("Bass", Some("#4ADE80")),
    ("Bass/Synth", None),
    ("Bass/Acoustic", None),
    ("Bass/808", None),
    ("Synths", Some("#38BDF8")),
    ("Synths/Lead", None),
    ("Synths/Pad", None),
    ("Synths/Keys", None),
    ("Synths/Pluck", None),
    ("Synths/Arp", None),
    ("Vocals", Some("#F472B6")),
    ("Vocals/Phrase", None),
    ("Vocals/One-shot", None),
    ("Vocals/Choir", None),
    ("FX", Some("#FBBF24")),
    ("FX/Impact", None),
    ("FX/Riser", None),
    ("FX/Sweep", None),
    ("FX/Noise", None),
    ("FX/Glitch", None),
    ("Ambience", Some("#94A3B8")),
    ("Ambience/Drone", None),
    ("Ambience/Texture", None),
    ("Field", Some("#A78BFA")),
    ("Field/City", None),
    ("Field/Nature", None),
    ("Guitar", Some("#FB923C")),
    ("Guitar/Electric", None),
    ("Guitar/Acoustic", None),
    ("Strings", Some("#C4B5FD")),
    ("Brass", Some("#FCD34D")),
    ("Woodwinds", Some("#6EE7B7")),
    ("Piano", Some("#E2E8F0")),
    ("Genre", Some("#64748B")),
    ("Genre/House", None),
    ("Genre/Techno", None),
    ("Genre/Hip-Hop", None),
    ("Genre/Trap", None),
    ("Genre/DnB", None),
    ("Genre/Ambient", None),
    ("Genre/Funk", None),
];

pub fn seed_if_empty(conn: &mut SqliteConnection) -> AppResult<()> {
    let count: i64 = tags_dsl::tags
        .count()
        .get_result(conn)
        .map_err(AppError::from)?;
    if count > 0 {
        return Ok(());
    }

    let mut id_by_path = std::collections::HashMap::<String, i32>::new();

    for (path, color) in TAXONOMY {
        let name = path.rsplit('/').next().unwrap_or(path);
        let parent_id = path
            .rsplit_once('/')
            .and_then(|(parent, _)| id_by_path.get(parent).copied());

        diesel::insert_into(tags_dsl::tags)
            .values(NewTag {
                path,
                name,
                parent_id,
                color: *color,
            })
            .execute(conn)
            .map_err(AppError::from)?;

        let id: i32 = tags_dsl::tags
            .filter(tags_dsl::path.eq(path))
            .select(tags_dsl::id)
            .first(conn)
            .map_err(AppError::from)?;
        id_by_path.insert((*path).to_string(), id);
    }
    Ok(())
}
