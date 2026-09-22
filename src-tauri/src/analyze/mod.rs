//! Background sample analysis: path auto-tags, BPM/key, loop vs one-shot.

use std::path::Path;
use std::sync::Arc;

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::audio::{DecodedAudio, decode_file, probe_and_update_sample};
use crate::db::models::SampleTag;
use crate::db::schema::sample_tags::dsl as sample_tags_dsl;
use crate::db::schema::samples::dsl as samples_dsl;
use crate::db::schema::tag_rejects::dsl as rejects_dsl;
use crate::db::schema::tags::dsl as tags_dsl;
use crate::db::{Db, settings, utc_now};
use crate::error::{AppError, AppResult};
use crate::ids::{f64_to_f32, id_from_i64, id_to_i64};

const BPM_CONF_MIN: f64 = 0.08;
const KEY_CONF_MIN: f64 = 0.25;
const LOOP_MIN_DURATION_SECS: f64 = 1.5;

/// Creative / tag result from one analyzer pass.
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
pub struct AnalysisProgress {
    pub sample_id: i64,
    pub done: u64,
    pub remaining: u64,
}

#[derive(Debug, Clone)]
struct SampleRow {
    path: String,
    missing: bool,
    bpm: Option<f64>,
    key_name: Option<String>,
    sample_type: Option<String>,
}

/// Analyze one sample and write results respecting overrides / rejects.
pub fn analyze_sample(
    conn: &mut SqliteConnection,
    sample_id: i64,
    mode: &AnalyzeMode,
    bpm_range: (f64, f64),
) -> AppResult<()> {
    let row = load_sample_row(conn, sample_id)?.ok_or_else(|| AppError::msg("sample not found"))?;
    if row.missing {
        return Ok(());
    }
    let path = Path::new(&row.path);
    if !path.exists() {
        return Ok(());
    }

    // Always refresh technical info (and get PCM).
    let pcm = match probe_and_update_sample(conn, sample_id, path) {
        Ok(p) => p,
        Err(_) => match decode_file(path) {
            Ok(p) => p,
            Err(_) => return Ok(()),
        },
    };

    let (bpm_min, bpm_max) = bpm_range;
    let path_result = PathTokenAnalyzer.analyze(path, &pcm, bpm_min, bpm_max);
    let audio_result = HeuristicAnalyzer.analyze(path, &pcm, bpm_min, bpm_max);

    let (overwrite_tags, rerun_bpm, rerun_key, rerun_type) = match mode {
        AnalyzeMode::Normal => (false, false, false, false),
        AnalyzeMode::Custom(c) => (c.overwrite_tags, c.rerun_bpm, c.rerun_key, c.rerun_type),
    };

    // Path tokens win for type when present; else audio heuristic.
    let detected_type = path_result
        .sample_type
        .clone()
        .or_else(|| audio_result.sample_type.clone());

    let write_bpm = row.bpm.is_none() || rerun_bpm;
    let write_key = row.key_name.is_none() || rerun_key;
    let write_type = row.sample_type.is_none() || rerun_type;

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

type SampleRowTuple = (String, i32, Option<f64>, Option<String>, Option<String>);

fn load_sample_row(conn: &mut SqliteConnection, id: i64) -> AppResult<Option<SampleRow>> {
    let row: Option<SampleRowTuple> = samples_dsl::samples
        .find(id_from_i64(id)?)
        .select((
            samples_dsl::path,
            samples_dsl::missing,
            samples_dsl::bpm,
            samples_dsl::key_name,
            samples_dsl::sample_type,
        ))
        .first(conn)
        .optional()?;
    Ok(
        row.map(|(path, missing, bpm, key_name, sample_type)| SampleRow {
            path,
            missing: missing != 0,
            bpm,
            key_name,
            sample_type,
        }),
    )
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

pub fn list_unanalyzed_ids(conn: &mut SqliteConnection) -> AppResult<Vec<i64>> {
    let ids: Vec<i32> = samples_dsl::samples
        .filter(samples_dsl::analyzed_at.is_null())
        .filter(samples_dsl::missing.eq(0))
        .select(samples_dsl::id)
        .order(samples_dsl::id.asc())
        .load(conn)?;
    Ok(ids.into_iter().map(id_to_i64).collect())
}

/// Fire-and-forget batch on a background thread.
pub fn spawn_analysis_batch(app: AppHandle, db: Arc<Db>, sample_ids: Vec<i64>, mode: AnalyzeMode) {
    if sample_ids.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        let total = u64::try_from(sample_ids.len()).unwrap_or(u64::MAX);
        let _ = app.emit("analysis-queue", &sample_ids);
        let mut done = 0u64;
        for sample_id in sample_ids {
            let bpm_range = db
                .with_conn(bpm_range_from_settings)
                .unwrap_or((70.0, 180.0));
            let _ = db.with_conn(|conn| analyze_sample(conn, sample_id, &mode, bpm_range));
            done = done.saturating_add(1);
            let remaining = total.saturating_sub(done);
            let _ = app.emit(
                "analysis-progress",
                &AnalysisProgress {
                    sample_id,
                    done,
                    remaining,
                },
            );
        }
    });
}

/// After indexing finishes: analyze samples that have never been analyzed.
///
/// Phase 14 hook: on file-modify watch events, call `probe_and_update_sample` only
/// (keep BPM/key/type/tags overrides). Do not enqueue Normal analysis for already
/// analyzed rows; that would still skip non-null fields but would re-apply auto tags.
pub fn enqueue_unanalyzed(app: AppHandle, db: Arc<Db>) {
    let ids = db.with_conn(list_unanalyzed_ids).unwrap_or_default();
    spawn_analysis_batch(app, db, ids, AnalyzeMode::Normal);
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
}
