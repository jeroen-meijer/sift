// @generated automatically by Diesel CLI.

diesel::table! {
    favorite_folders (path) {
        path -> Text,
        created_at -> Text,
    }
}

diesel::table! {
    meta (key) {
        key -> Text,
        value -> Text,
    }
}

diesel::table! {
    redo_stack (id) {
        id -> Integer,
        created_at -> Text,
        action_json -> Text,
    }
}

diesel::table! {
    roots (id) {
        id -> Integer,
        path -> Text,
        label -> Nullable<Text>,
        created_at -> Text,
    }
}

diesel::table! {
    sample_tags (sample_id, tag_id) {
        sample_id -> Integer,
        tag_id -> Integer,
        source -> Text,
    }
}

diesel::table! {
    samples (id) {
        id -> Integer,
        root_id -> Integer,
        path -> Text,
        filename -> Text,
        parent_path -> Text,
        extension -> Text,
        size_bytes -> Nullable<BigInt>,
        mtime_ms -> Nullable<BigInt>,
        inode -> Nullable<BigInt>,
        missing -> Integer,
        sample_rate -> Nullable<Integer>,
        bit_depth -> Nullable<Integer>,
        channels -> Nullable<Integer>,
        duration_ms -> Nullable<Double>,
        format -> Nullable<Text>,
        bpm -> Nullable<Double>,
        bpm_confidence -> Nullable<Double>,
        key_name -> Nullable<Text>,
        key_confidence -> Nullable<Double>,
        sample_type -> Nullable<Text>,
        favorite -> Integer,
        analyzed_at -> Nullable<Text>,
        created_at -> Text,
        updated_at -> Text,
    }
}

diesel::table! {
    settings (key) {
        key -> Text,
        value -> Text,
    }
}

diesel::table! {
    tag_rejects (sample_id, tag_id) {
        sample_id -> Integer,
        tag_id -> Integer,
    }
}

diesel::table! {
    tags (id) {
        id -> Integer,
        path -> Text,
        name -> Text,
        parent_id -> Nullable<Integer>,
        color -> Nullable<Text>,
        created_at -> Text,
    }
}

diesel::table! {
    undo_stack (id) {
        id -> Integer,
        created_at -> Text,
        action_json -> Text,
    }
}

diesel::joinable!(sample_tags -> samples (sample_id));
diesel::joinable!(sample_tags -> tags (tag_id));
diesel::joinable!(samples -> roots (root_id));
diesel::joinable!(tag_rejects -> samples (sample_id));
diesel::joinable!(tag_rejects -> tags (tag_id));

diesel::allow_tables_to_appear_in_same_query!(
    favorite_folders,
    meta,
    redo_stack,
    roots,
    sample_tags,
    samples,
    settings,
    tag_rejects,
    tags,
    undo_stack,
);
