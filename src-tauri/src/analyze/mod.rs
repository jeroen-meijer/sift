//! Background sample analysis: path auto-tags, BPM/key, loop vs one-shot, row peakfiles.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::audio::peaks::{self, DEFAULT_BUCKETS};
use crate::audio::{DecodedAudio, decode_file, write_technical_fields};
use crate::db::models::SampleTag;
use crate::db::schema::sample_tags::dsl as sample_tags_dsl;
use crate::db::schema::samples::dsl as samples_dsl;
use crate::db::schema::tag_rejects::dsl as rejects_dsl;
use crate::db::schema::tags::dsl as tags_dsl;
use crate::db::{Db, settings, utc_now};
use crate::error::{AppError, AppResult};
use crate::fs_ready::Availability;
use crate::ids::{f64_to_f32, id_from_i64, id_to_i64};

const BPM_CONF_MIN: f64 = 0.08;
const KEY_CONF_MIN: f64 = 0.25;
const LOOP_MIN_DURATION_SECS: f64 = 1.5;

/// Every Nth sample gets decode/heuristic/db breakdown marks (all samples still
/// get a single `analyze.sample` total when profiling).
const ANALYZE_DETAIL_EVERY: u64 = 25;
static ANALYZE_SEQ: AtomicU64 = AtomicU64::new(0);

/// BPM, key, type, and tag suggestions from one analyzer pass.
#[derive(Debug, Clone, Default)]
pub struct AnalysisResult {
    pub bpm: Option<f64>,
    pub bpm_confidence: Option<f64>,
    pub key_name: Option<String>,
    pub key_confidence: Option<f64>,
    /// `"loop"` or `"one-shot"`.
    pub sample_type: Option<String>,
    pub suggested_tag_paths: Vec<String>,
}

pub trait Analyzer {
    fn analyze(
        &self,
        path: &Path,
        pcm: &DecodedAudio,
        bpm_min: f64,
        bpm_max: f64,
    ) -> AnalysisResult;
}

/// Filename / path token matching into `DEFAULT_TAXONOMY`. Primary auto-tag source.
pub struct PathTokenAnalyzer;

impl Analyzer for PathTokenAnalyzer {
    fn analyze(
        &self,
        path: &Path,
        _pcm: &DecodedAudio,
        _bpm_min: f64,
        _bpm_max: f64,
    ) -> AnalysisResult {
        let haystack = path.to_string_lossy().to_lowercase();
        let tokens = tokenize(&haystack);
        let mut tags: Vec<String> = Vec::new();
        let mut sample_type: Option<String> = None;

        let mut push_tag = |p: &str| {
            if !tags.iter().any(|t| t == p) {
                tags.push(p.to_string());
            }
        };

        for tok in &tokens {
            match tok.as_str() {
                "kick" | "kicks" | "bd" | "bassdrum" => push_tag("Drums/Kick"),
                "snare" | "snares" | "sd" => push_tag("Drums/Snare"),
                "clap" | "claps" | "clp" => push_tag("Drums/Clap"),
                "hat" | "hats" | "hh" | "hihat" | "hihats" => push_tag("Drums/Hats"),
                "closed" | "chh" | "closedhat" => push_tag("Drums/Hats/Closed"),
                "open" | "ohh" | "openhat" => push_tag("Drums/Hats/Open"),
                "perc" | "percussion" | "percs" => push_tag("Drums/Perc"),
                "tom" | "toms" => push_tag("Drums/Toms"),
                "cymbal" | "cymbals" | "crash" | "ride" => push_tag("Drums/Cymbals"),
                "break" | "breaks" | "breakbeat" => push_tag("Drums/Breaks"),
                "808" => {
                    if tokens.iter().any(|t| t == "bass") {
                        push_tag("Bass/808");
                    } else {
                        push_tag("Drums/Kick/808");
                    }
                }
                "bass" | "basses" | "sub" => push_tag("Bass"),
                "synthbass" => push_tag("Bass/Synth"),
                "vocal" | "vocals" | "vox" | "voice" => push_tag("Vocals"),
                "choir" => push_tag("Vocals/Choir"),
                "fx" | "sfx" | "effect" | "effects" => push_tag("FX"),
                "impact" | "impacts" | "hit" => push_tag("FX/Impact"),
                "riser" | "risers" => push_tag("FX/Riser"),
                "sweep" | "sweeps" | "whoosh" => push_tag("FX/Sweep"),
                "noise" => push_tag("FX/Noise"),
                "glitch" => push_tag("FX/Glitch"),
                "synth" | "synths" | "synthesizer" => push_tag("Synths"),
                "lead" | "leads" => push_tag("Synths/Lead"),
                "pad" | "pads" => push_tag("Synths/Pad"),
                "keys" | "key" => push_tag("Synths/Keys"),
                "pluck" | "plucks" => push_tag("Synths/Pluck"),
                "arp" | "arpeggio" => push_tag("Synths/Arp"),
                "piano" => push_tag("Piano"),
                "guitar" | "gtr" => push_tag("Guitar"),
                "electric" if tokens.iter().any(|t| t == "guitar" || t == "gtr") => {
                    push_tag("Guitar/Electric");
                }
                "acoustic"
                    if tokens
                        .iter()
                        .any(|t| t == "guitar" || t == "gtr" || t == "bass") =>
                {
                    if tokens.iter().any(|t| t == "bass") {
                        push_tag("Bass/Acoustic");
                    } else {
                        push_tag("Guitar/Acoustic");
                    }
                }
                "ambient" | "ambience" | "atmosphere" => push_tag("Ambience"),
                "drone" => push_tag("Ambience/Drone"),
                "texture" | "textures" => push_tag("Ambience/Texture"),
                "field" => push_tag("Field"),
                "nature" => push_tag("Field/Nature"),
                "city" | "urban" => push_tag("Field/City"),
                "strings" | "string" => push_tag("Strings"),
                "brass" => push_tag("Brass"),
                "woodwind" | "woodwinds" | "flute" | "sax" => push_tag("Woodwinds"),
                "house" => push_tag("Genre/House"),
                "techno" => push_tag("Genre/Techno"),
                "trap" => push_tag("Genre/Trap"),
                "dnb" | "drumandbass" | "drummbass" => push_tag("Genre/DnB"),
                "hiphop" => push_tag("Genre/Hip-Hop"),
                "funk" => push_tag("Genre/Funk"),
                "loop" | "loops" | "looped" => {
                    sample_type = Some("loop".into());
                }
                "oneshot" | "shot" if sample_type.is_none() => {
                    sample_type = Some("one-shot".into());
                }
                _ => {}
            }
        }

        AnalysisResult {
            sample_type,
            suggested_tag_paths: prune_parent_tags(tags),
            ..Default::default()
        }
    }
}

fn prune_parent_tags(mut tags: Vec<String>) -> Vec<String> {
    tags.sort();
    tags.dedup();
    let copy = tags.clone();
    tags.retain(|t| {
        let prefix = format!("{t}/");
        !copy.iter().any(|other| other.starts_with(&prefix))
    });
    tags
}

fn tokenize(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
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

/// BPM/key via `stratum-dsp` when possible; loop/one-shot heuristic always.
pub struct HeuristicAnalyzer;

impl Analyzer for HeuristicAnalyzer {
    fn analyze(
        &self,
        _path: &Path,
        pcm: &DecodedAudio,
        bpm_min: f64,
        bpm_max: f64,
    ) -> AnalysisResult {
        let mut result = AnalysisResult {
            sample_type: Some(detect_loop_or_oneshot(pcm)),
            ..Default::default()
        };

        let mono = to_mono(pcm);
        if mono.len() < 1024 {
            return result;
        }

        // Keep analysis cheap for short one-shots / pack browsing.
        let config = stratum_dsp::AnalysisConfig {
            min_bpm: f64_to_f32(bpm_min),
            max_bpm: f64_to_f32(bpm_max),
            enable_tempogram_multi_resolution: false,
            enable_tempogram_percussive_fallback: false,
            enable_hpss_onsets: false,
            enable_key_hpss_harmonic: false,
            ..stratum_dsp::AnalysisConfig::default()
        };

        match stratum_dsp::analyze_audio(&mono, pcm.sample_rate, config) {
            Ok(r) => {
                let bpm_conf = f64::from(r.bpm_confidence);
                if r.bpm > 0.0 && bpm_conf >= BPM_CONF_MIN {
                    let bpm = clamp_bpm_to_range(f64::from(r.bpm), bpm_min, bpm_max);
                    result.bpm = Some(bpm);
                    result.bpm_confidence = Some(bpm_conf);
                }
                let key_conf = f64::from(r.key_confidence);
                if key_conf >= KEY_CONF_MIN {
                    result.key_name = Some(r.key.name());
                    result.key_confidence = Some(key_conf);
                }
            }
            Err(_) => {
                if let Some((bpm, conf)) =
                    estimate_bpm_envelope(&mono, pcm.sample_rate, bpm_min, bpm_max)
                {
                    result.bpm = Some(bpm);
                    result.bpm_confidence = Some(conf);
                }
            }
        }

        result
    }
}

#[allow(
    clippy::arithmetic_side_effects,
    clippy::as_conversions,
    clippy::cast_precision_loss,
    reason = "channel downmix: float average over a fixed-size frame"
)]
fn frame_mean(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    frame.iter().sum::<f32>() / frame.len() as f32
}

fn to_mono(pcm: &DecodedAudio) -> Vec<f32> {
    let ch = usize::from(pcm.channels.max(1));
    if ch == 1 {
        return pcm.samples.clone();
    }
    pcm.samples.chunks_exact(ch).map(frame_mean).collect()
}

#[allow(
    clippy::arithmetic_side_effects,
    reason = "tempo octave folding: bounded float doubling/halving"
)]
fn clamp_bpm_to_range(mut bpm: f64, min: f64, max: f64) -> f64 {
    if bpm <= 0.0 {
        return bpm;
    }
    while bpm < min && bpm * 2.0 <= max * 1.05 {
        bpm *= 2.0;
    }
    while bpm > max && bpm / 2.0 >= min * 0.95 {
        bpm /= 2.0;
    }
    bpm.clamp(min, max)
}

fn detect_loop_or_oneshot(pcm: &DecodedAudio) -> String {
    let duration_secs = pcm.duration_ms() / 1000.0;
    if duration_secs <= LOOP_MIN_DURATION_SECS {
        return "one-shot".into();
    }
    let mono = to_mono(pcm);
    if has_repeating_energy(&mono, pcm.sample_rate) {
        "loop".into()
    } else {
        "one-shot".into()
    }
}

/// Cheap check: envelope autocorrelation peak suggests periodic energy.
#[allow(
    clippy::arithmetic_side_effects,
    clippy::as_conversions,
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "envelope autocorrelation: float DSP over bounded, non-empty windows"
)]
fn has_repeating_energy(mono: &[f32], sample_rate: u32) -> bool {
    if mono.len() < sample_rate as usize {
        return false;
    }
    let hop = (sample_rate as usize / 50).max(1);
    let env: Vec<f32> = mono.chunks(hop).map(frame_mean_abs).collect();
    if env.len() < 16 {
        return false;
    }
    let min_lag = (0.25 * f64::from(sample_rate) / hop as f64) as usize;
    let max_lag = ((2.0 * f64::from(sample_rate) / hop as f64) as usize).min(env.len() / 2);
    if max_lag <= min_lag {
        return false;
    }
    let mean: f32 = env.iter().sum::<f32>() / env.len() as f32;
    let mut best = 0.0f32;
    for lag in min_lag..=max_lag {
        let mut num = 0.0f32;
        let mut den_a = 0.0f32;
        let mut den_b = 0.0f32;
        for (x, y) in env.iter().zip(env.iter().skip(lag)) {
            let a = x - mean;
            let b = y - mean;
            num = a.mul_add(b, num);
            den_a = a.mul_add(a, den_a);
            den_b = b.mul_add(b, den_b);
        }
        let den = (den_a * den_b).sqrt();
        if den > 1e-9 {
            best = best.max(num / den);
        }
    }
    best > 0.35
}

#[allow(
    clippy::arithmetic_side_effects,
    clippy::as_conversions,
    clippy::cast_precision_loss,
    reason = "envelope magnitude: float average over a non-empty chunk"
)]
fn frame_mean_abs(chunk: &[f32]) -> f32 {
    if chunk.is_empty() {
        return 0.0;
    }
    chunk.iter().map(|x| x.abs()).sum::<f32>() / chunk.len() as f32
}

#[allow(
    clippy::arithmetic_side_effects,
    clippy::as_conversions,
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "fallback tempo estimation: float DSP over bounded, non-empty windows"
)]
fn estimate_bpm_envelope(
    mono: &[f32],
    sample_rate: u32,
    bpm_min: f64,
    bpm_max: f64,
) -> Option<(f64, f64)> {
    let hop = (sample_rate as usize / 100).max(1);
    let env: Vec<f32> = mono.chunks(hop).map(frame_rms).collect();
    if env.len() < 32 {
        return None;
    }
    let min_lag = ((60.0 / bpm_max) * f64::from(sample_rate) / hop as f64) as usize;
    let max_lag = ((60.0 / bpm_min) * f64::from(sample_rate) / hop as f64) as usize;
    if max_lag <= min_lag || max_lag >= env.len() {
        return None;
    }
    let mean: f32 = env.iter().sum::<f32>() / env.len() as f32;
    let mut best_lag = min_lag;
    let mut best_corr = 0.0f32;
    for lag in min_lag..=max_lag {
        let mut num = 0.0f32;
        for (x, y) in env.iter().zip(env.iter().skip(lag)) {
            num = (x - mean).mul_add(y - mean, num);
        }
        if num > best_corr {
            best_corr = num;
            best_lag = lag;
        }
    }
    if best_corr <= 0.0 {
        return None;
    }
    let period_secs = best_lag as f64 * hop as f64 / f64::from(sample_rate);
    if period_secs <= 0.0 {
        return None;
    }
    let bpm = clamp_bpm_to_range(60.0 / period_secs, bpm_min, bpm_max);
    Some((bpm, 0.15))
}

#[allow(
    clippy::arithmetic_side_effects,
    clippy::as_conversions,
    clippy::cast_precision_loss,
    reason = "envelope RMS: float average over a non-empty chunk"
)]
fn frame_rms(chunk: &[f32]) -> f32 {
    if chunk.is_empty() {
        return 0.0;
    }
    (chunk.iter().map(|x| x * x).sum::<f32>() / chunk.len() as f32).sqrt()
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "IPC options payload: one independent flag per analysis step"
)]
pub struct CustomOpts {
    #[serde(default)]
    pub overwrite_tags: bool,
    #[serde(default)]
    pub rerun_bpm: bool,
    #[serde(default)]
    pub rerun_key: bool,
    #[serde(default)]
    pub rerun_type: bool,
}

#[derive(Debug, Clone)]
pub enum AnalyzeMode {
    Normal,
    Custom(CustomOpts),
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalysisQueuePayload {
    pub total: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalysisProgress {
    pub sample_id: i64,
    pub done: u64,
    pub remaining: u64,
    pub total: u64,
}

#[derive(Debug, Clone)]
struct SampleRow {
    path: String,
    missing: bool,
    availability: String,
    bpm: Option<f64>,
    key_name: Option<String>,
    sample_type: Option<String>,
}

/// Analyze one sample. Decode outside the DB mutex; only short writes hold the lock.
/// Also writes the row peakfile from the same PCM (analysis includes waveforms).
pub fn analyze_sample(
    db: &Db,
    peaks_dir: &Path,
    sample_id: i64,
    mode: &AnalyzeMode,
    bpm_range: (f64, f64),
) -> AppResult<()> {
    let total = Instant::now();
    let seq = ANALYZE_SEQ.fetch_add(1, Ordering::Relaxed);
    let detail = seq.is_multiple_of(ANALYZE_DETAIL_EVERY);

    let row = db
        .with_conn(|conn| load_sample_row(conn, sample_id))?
        .ok_or_else(|| AppError::msg("sample not found"))?;
    if row.missing || Availability::parse(&row.availability) != Availability::Local {
        return Ok(());
    }
    let path = Path::new(&row.path);

    let stat_start = Instant::now();
    let exists = path.exists();
    if detail {
        crate::profile_log::event(
            "analyze.stat",
            stat_start.elapsed(),
            &format!("id={sample_id} exists={exists}"),
        );
    }
    if !exists {
        return Ok(());
    }

    // Decode off the DB lock (Dropbox may hydrate here when the file is local).
    let decode_start = Instant::now();
    let Ok(pcm) = decode_file(path) else {
        return Ok(());
    };
    if detail {
        crate::profile_log::event(
            "analyze.decode",
            decode_start.elapsed(),
            &format!(
                "id={sample_id} frames={} ch={}",
                pcm.frame_count(),
                pcm.channels
            ),
        );
    }

    // Peakfile from the same buffer so browse/scroll does not decode again.
    let peaks_start = Instant::now();
    match peaks::cache_peaks_from_decoded(peaks_dir, sample_id, &pcm, DEFAULT_BUCKETS) {
        Ok(_) => {
            if detail {
                crate::profile_log::event(
                    "analyze.peaks",
                    peaks_start.elapsed(),
                    &format!("id={sample_id}"),
                );
            }
        }
        Err(e) => {
            crate::profile_log::event(
                "analyze.peaks_err",
                peaks_start.elapsed(),
                &format!("id={sample_id} err={e}"),
            );
        }
    }

    let (bpm_min, bpm_max) = bpm_range;
    let heur_start = Instant::now();
    let path_result = PathTokenAnalyzer.analyze(path, &pcm, bpm_min, bpm_max);
    let audio_result = HeuristicAnalyzer.analyze(path, &pcm, bpm_min, bpm_max);
    if detail {
        crate::profile_log::event(
            "analyze.heuristic",
            heur_start.elapsed(),
            &format!("id={sample_id}"),
        );
    }

    let (overwrite_tags, rerun_bpm, rerun_key, rerun_type) = match mode {
        AnalyzeMode::Normal => (false, false, false, false),
        AnalyzeMode::Custom(c) => (c.overwrite_tags, c.rerun_bpm, c.rerun_key, c.rerun_type),
    };

    let detected_type = path_result
        .sample_type
        .clone()
        .or_else(|| audio_result.sample_type.clone());

    let write_bpm = row.bpm.is_none() || rerun_bpm;
    let write_key = row.key_name.is_none() || rerun_key;
    let write_type = row.sample_type.is_none() || rerun_type;

    let db_start = Instant::now();
    db.with_conn(|conn| {
        write_technical_fields(conn, sample_id, path, &pcm)?;

        let now = utc_now();
        let id = id_from_i64(sample_id)?;

        if write_bpm {
            if let Some(v) = audio_result.bpm {
                diesel::update(samples_dsl::samples.find(id))
                    .set(samples_dsl::bpm.eq(v))
                    .execute(conn)?;
            }
            if let Some(v) = audio_result.bpm_confidence {
                diesel::update(samples_dsl::samples.find(id))
                    .set(samples_dsl::bpm_confidence.eq(v))
                    .execute(conn)?;
            }
        }
        if write_key {
            if let Some(ref v) = audio_result.key_name {
                diesel::update(samples_dsl::samples.find(id))
                    .set(samples_dsl::key_name.eq(v))
                    .execute(conn)?;
            }
            if let Some(v) = audio_result.key_confidence {
                diesel::update(samples_dsl::samples.find(id))
                    .set(samples_dsl::key_confidence.eq(v))
                    .execute(conn)?;
            }
        }
        if write_type && let Some(ref v) = detected_type {
            diesel::update(samples_dsl::samples.find(id))
                .set(samples_dsl::sample_type.eq(v))
                .execute(conn)?;
        }

        diesel::update(samples_dsl::samples.find(id))
            .set((
                samples_dsl::analyzed_at.eq(&now),
                samples_dsl::updated_at.eq(&now),
            ))
            .execute(conn)?;

        apply_suggested_tags(
            conn,
            sample_id,
            &path_result.suggested_tag_paths,
            overwrite_tags,
        )?;
        Ok(())
    })?;
    if detail {
        crate::profile_log::event(
            "analyze.db_write",
            db_start.elapsed(),
            &format!("id={sample_id}"),
        );
    }

    crate::profile_log::event(
        "analyze.sample",
        total.elapsed(),
        &format!("id={sample_id}"),
    );

    Ok(())
}

fn apply_suggested_tags(
    conn: &mut SqliteConnection,
    sample_id: i64,
    suggested: &[String],
    overwrite_tags: bool,
) -> AppResult<()> {
    if suggested.is_empty() && !overwrite_tags {
        return Ok(());
    }

    let sample_id_i32 = id_from_i64(sample_id)?;

    if overwrite_tags {
        // Drop previous auto tags; keep user tags. Clear rejects so suggestions can return.
        diesel::delete(
            sample_tags_dsl::sample_tags
                .filter(sample_tags_dsl::sample_id.eq(sample_id_i32))
                .filter(sample_tags_dsl::source.eq("auto")),
        )
        .execute(conn)?;
        diesel::delete(rejects_dsl::tag_rejects.filter(rejects_dsl::sample_id.eq(sample_id_i32)))
            .execute(conn)?;
    }

    let rejects: Vec<i32> = if overwrite_tags {
        Vec::new()
    } else {
        rejects_dsl::tag_rejects
            .filter(rejects_dsl::sample_id.eq(sample_id_i32))
            .select(rejects_dsl::tag_id)
            .load(conn)?
    };

    for path in suggested {
        let Some(tag_id) = tag_id_by_path(conn, path)? else {
            continue;
        };
        if rejects.contains(&tag_id) {
            continue;
        }
        let exists: Option<i32> = sample_tags_dsl::sample_tags
            .filter(sample_tags_dsl::sample_id.eq(sample_id_i32))
            .filter(sample_tags_dsl::tag_id.eq(tag_id))
            .select(sample_tags_dsl::sample_id)
            .first(conn)
            .optional()?;
        if exists.is_some() {
            continue;
        }
        diesel::insert_into(sample_tags_dsl::sample_tags)
            .values(SampleTag {
                sample_id: sample_id_i32,
                tag_id,
                source: "auto".into(),
            })
            .execute(conn)?;
    }
    Ok(())
}

fn tag_id_by_path(conn: &mut SqliteConnection, path: &str) -> AppResult<Option<i32>> {
    Ok(tags_dsl::tags
        .filter(tags_dsl::path.eq(path))
        .select(tags_dsl::id)
        .first(conn)
        .optional()?)
}

type SampleRowTuple = (
    String,
    i32,
    String,
    Option<f64>,
    Option<String>,
    Option<String>,
);

fn load_sample_row(conn: &mut SqliteConnection, id: i64) -> AppResult<Option<SampleRow>> {
    let row: Option<SampleRowTuple> = samples_dsl::samples
        .find(id_from_i64(id)?)
        .select((
            samples_dsl::path,
            samples_dsl::missing,
            samples_dsl::availability,
            samples_dsl::bpm,
            samples_dsl::key_name,
            samples_dsl::sample_type,
        ))
        .first(conn)
        .optional()?;
    Ok(row.map(
        |(path, missing, availability, bpm, key_name, sample_type)| SampleRow {
            path,
            missing: missing != 0,
            availability,
            bpm,
            key_name,
            sample_type,
        },
    ))
}

pub fn bpm_range_from_settings(conn: &mut SqliteConnection) -> AppResult<(f64, f64)> {
    let min = settings::get(conn, "bpm_range_min")?
        .and_then(|v| v.as_f64())
        .unwrap_or(70.0);
    let max = settings::get(conn, "bpm_range_max")?
        .and_then(|v| v.as_f64())
        .unwrap_or(180.0);
    Ok((min, max))
}

/// Local samples that still need analysis work: never analyzed, or peakfile missing.
pub fn list_analysis_queue_ids(
    conn: &mut SqliteConnection,
    peaks_dir: &Path,
) -> AppResult<Vec<i64>> {
    let rows: Vec<(i32, Option<String>)> = samples_dsl::samples
        .filter(samples_dsl::missing.eq(0))
        .filter(samples_dsl::availability.eq(Availability::Local.as_str()))
        .select((samples_dsl::id, samples_dsl::analyzed_at))
        .order(samples_dsl::id.asc())
        .load(conn)?;
    let mut ids = Vec::new();
    for (id, analyzed_at) in rows {
        if analyzed_at.is_none() {
            ids.push(id_to_i64(id));
            continue;
        }
        let peak = peaks_dir.join(format!("{id}.peaks"));
        if !peak.exists() {
            ids.push(id_to_i64(id));
        }
    }
    Ok(ids)
}

const ANALYZE_WORKERS: usize = 4;
const PROGRESS_EVERY: u64 = 25;

struct AnalysisJob {
    sample_id: i64,
    mode: AnalyzeMode,
}

#[derive(Default)]
struct QueueProgress {
    /// Completed since the queue last went idle.
    done: u64,
    pending: u64,
    in_flight: u64,
    /// Pending or running ids (dedupe; released when idle).
    active: std::collections::HashSet<i64>,
    last_emit: Option<Instant>,
}

impl QueueProgress {
    const fn remaining(&self) -> u64 {
        self.pending.saturating_add(self.in_flight)
    }

    const fn total(&self) -> u64 {
        self.done.saturating_add(self.remaining())
    }

    const fn is_idle(&self) -> bool {
        self.pending == 0 && self.in_flight == 0
    }
}

struct AnalysisRuntime {
    tx: std::sync::mpsc::Sender<AnalysisJob>,
    progress: Arc<std::sync::Mutex<QueueProgress>>,
}

fn analysis_runtime(app: AppHandle, db: Arc<Db>, peaks_dir: PathBuf) -> &'static AnalysisRuntime {
    use std::sync::OnceLock;
    static RUNTIME: OnceLock<AnalysisRuntime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel::<AnalysisJob>();
        let rx = Arc::new(std::sync::Mutex::new(rx));
        let progress = Arc::new(std::sync::Mutex::new(QueueProgress::default()));
        for _ in 0..ANALYZE_WORKERS {
            let rx = Arc::clone(&rx);
            let db = Arc::clone(&db);
            let peaks_dir = peaks_dir.clone();
            let app = app.clone();
            let progress = Arc::clone(&progress);
            std::thread::spawn(move || analysis_worker(app, db, peaks_dir, rx, progress));
        }
        AnalysisRuntime { tx, progress }
    })
}

fn analysis_worker(
    app: AppHandle,
    db: Arc<Db>,
    peaks_dir: PathBuf,
    rx: Arc<std::sync::Mutex<std::sync::mpsc::Receiver<AnalysisJob>>>,
    progress: Arc<std::sync::Mutex<QueueProgress>>,
) {
    loop {
        let job = {
            let guard = rx
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard.recv()
        };
        let Ok(job) = job else {
            break;
        };

        {
            let mut st = progress
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            st.pending = st.pending.saturating_sub(1);
            st.in_flight = st.in_flight.saturating_add(1);
        }

        let bpm_range = db
            .with_conn(bpm_range_from_settings)
            .unwrap_or((70.0, 180.0));
        let _ = analyze_sample(&db, &peaks_dir, job.sample_id, &job.mode, bpm_range);

        // Emit under the progress lock so a concurrent enqueue cannot race a
        // "remaining=0" clear past newly queued work.
        let mut st = progress
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        st.in_flight = st.in_flight.saturating_sub(1);
        st.done = st.done.saturating_add(1);
        st.active.remove(&job.sample_id);
        let remaining = st.remaining();
        let total = st.total();
        let done = st.done;
        let finished_idle = st.is_idle();
        let should_emit = finished_idle
            || done.is_multiple_of(PROGRESS_EVERY)
            || st
                .last_emit
                .is_none_or(|t| t.elapsed() >= std::time::Duration::from_millis(250));
        if should_emit {
            st.last_emit = Some(Instant::now());
            let _ = app.emit(
                "analysis-progress",
                &AnalysisProgress {
                    sample_id: job.sample_id,
                    done,
                    remaining,
                    total,
                },
            );
        }
        if finished_idle {
            crate::profile_log::event(
                "analyze.queue_done",
                std::time::Duration::ZERO,
                &format!("n={done}"),
            );
            st.done = 0;
            st.active.clear();
            st.last_emit = None;
        }
    }
}

/// Push work onto the single shared analyze queue (fixed worker pool, one status bar).
pub fn spawn_analysis_batch(
    app: AppHandle,
    db: Arc<Db>,
    peaks_dir: PathBuf,
    sample_ids: Vec<i64>,
    mode: AnalyzeMode,
) {
    if sample_ids.is_empty() {
        return;
    }
    let rt = analysis_runtime(app.clone(), db, peaks_dir);
    let mut st = rt
        .progress
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let was_idle = st.is_idle() && st.done == 0;
    let mut added = 0u64;
    for sample_id in sample_ids {
        if !st.active.insert(sample_id) {
            continue;
        }
        st.pending = st.pending.saturating_add(1);
        if rt
            .tx
            .send(AnalysisJob {
                sample_id,
                mode: mode.clone(),
            })
            .is_err()
        {
            st.pending = st.pending.saturating_sub(1);
            st.active.remove(&sample_id);
            break;
        }
        added = added.saturating_add(1);
    }
    if added == 0 {
        return;
    }
    if was_idle {
        crate::profile_log::event(
            "analyze.queue_start",
            std::time::Duration::ZERO,
            &format!("n={}", st.total()),
        );
        let _ = app.emit(
            "analysis-queue",
            &AnalysisQueuePayload { total: st.total() },
        );
    }
    st.last_emit = Some(Instant::now());
    let _ = app.emit(
        "analysis-progress",
        &AnalysisProgress {
            sample_id: 0,
            done: st.done,
            remaining: st.remaining(),
            total: st.total(),
        },
    );
}

/// After indexing (or on launch): analyze local samples that need metadata and/or peakfiles.
pub fn enqueue_unanalyzed(app: AppHandle, db: Arc<Db>, peaks_dir: PathBuf) {
    let peaks = peaks_dir.clone();
    let ids = db
        .with_conn(|conn| list_analysis_queue_ids(conn, &peaks))
        .unwrap_or_default();
    spawn_analysis_batch(app, db, peaks_dir, ids, AnalyzeMode::Normal);
}

/// Enqueue specific samples that just became local (hydrate / availability refresh).
pub fn enqueue_ids(app: AppHandle, db: Arc<Db>, peaks_dir: PathBuf, sample_ids: Vec<i64>) {
    if sample_ids.is_empty() {
        return;
    }
    let peaks = peaks_dir.clone();
    let ids = db
        .with_conn(|conn| filter_analysis_queue_ids(conn, &peaks, &sample_ids))
        .unwrap_or_default();
    spawn_analysis_batch(app, db, peaks_dir, ids, AnalyzeMode::Normal);
}

/// Keep only ids that are local and still need analysis or a peakfile.
fn filter_analysis_queue_ids(
    conn: &mut SqliteConnection,
    peaks_dir: &Path,
    sample_ids: &[i64],
) -> AppResult<Vec<i64>> {
    let mut out = Vec::new();
    for &sample_id in sample_ids {
        let Ok(id) = id_from_i64(sample_id) else {
            continue;
        };
        let row: Option<(i32, String, Option<String>)> = samples_dsl::samples
            .find(id)
            .select((
                samples_dsl::missing,
                samples_dsl::availability,
                samples_dsl::analyzed_at,
            ))
            .first(conn)
            .optional()?;
        let Some((missing, availability, analyzed_at)) = row else {
            continue;
        };
        if missing != 0 || availability != Availability::Local.as_str() {
            continue;
        }
        if analyzed_at.is_none() {
            out.push(sample_id);
            continue;
        }
        let peak = peaks_dir.join(format!("{sample_id}.peaks"));
        if !peak.exists() {
            out.push(sample_id);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_kick_maps() {
        let pcm = DecodedAudio {
            sample_rate: 44100,
            channels: 1,
            bit_depth_hint: Some(16),
            samples: vec![0.0; 100],
        };
        let r = PathTokenAnalyzer.analyze(
            Path::new("/packs/Drums/Kick_Hard_01.wav"),
            &pcm,
            70.0,
            180.0,
        );
        assert!(r.suggested_tag_paths.iter().any(|t| t == "Drums/Kick"));
    }

    #[test]
    fn token_loop_sets_type() {
        let pcm = DecodedAudio {
            sample_rate: 44100,
            channels: 1,
            bit_depth_hint: Some(16),
            samples: vec![0.0; 100],
        };
        let r =
            PathTokenAnalyzer.analyze(Path::new("/loops/melody_loop_120.wav"), &pcm, 70.0, 180.0);
        assert_eq!(r.sample_type.as_deref(), Some("loop"));
    }

    #[test]
    fn prune_parents() {
        let tags = prune_parent_tags(vec![
            "Drums".into(),
            "Drums/Kick".into(),
            "Drums/Kick/808".into(),
        ]);
        assert_eq!(tags, vec!["Drums/Kick/808".to_string()]);
    }

    #[test]
    fn analysis_queue_payload_shape() {
        let q = AnalysisQueuePayload { total: 42 };
        let v = serde_json::to_value(&q).expect("serialize");
        assert_eq!(v.get("total").and_then(serde_json::Value::as_u64), Some(42));
        assert!(v.get("ids").is_none());
    }

    #[test]
    fn analysis_progress_payload_shape() {
        let p = AnalysisProgress {
            sample_id: 7,
            done: 3,
            remaining: 9,
            total: 12,
        };
        let v = serde_json::to_value(&p).expect("serialize");
        assert_eq!(v["sample_id"], 7);
        assert_eq!(v["done"], 3);
        assert_eq!(v["remaining"], 9);
        assert_eq!(v["total"], 12);
    }

    #[test]
    fn cloud_availability_is_not_local() {
        assert_ne!(Availability::parse("cloud"), Availability::Local);
        assert_eq!(Availability::parse("cloud"), Availability::Cloud);
    }
}
