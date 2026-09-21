//! JIT WAV clip rendering for drag-to-DAW.
//!
//! Decodes via Symphonia, slices by time, writes with `hound` at the source
//! rate / bit depth / channels. Preview gain is never applied.

use std::fs;
use std::path::{Path, PathBuf};

use hound::{SampleFormat, WavSpec, WavWriter};

use crate::audio::decode::decode_file;
use crate::error::{AppError, AppResult};

/// Render `[start_secs, end_secs)` from `path` into a WAV at `out_path`.
///
/// Matches source sample rate, channel count, and bit depth as closely as
/// possible (16/24/32 PCM or 32-bit float). No cue/BPM/key chunks.
pub fn render_clip(
    path: &Path,
    start_secs: f64,
    end_secs: f64,
    out_path: &Path,
) -> AppResult<()> {
    if !(end_secs > start_secs) {
        return Err(AppError::msg("clip end must be after start"));
    }

    let decoded = decode_file(path)?;
    let channels = usize::from(decoded.channels.max(1));
    let rate = decoded.sample_rate.max(1);
    let total_frames = decoded.frame_count();

    let start_frame = ((start_secs.max(0.0) * f64::from(rate)).floor() as usize).min(total_frames);
    let end_frame = ((end_secs * f64::from(rate)).ceil() as usize).min(total_frames);
    if end_frame <= start_frame {
        return Err(AppError::msg("clip region is empty"));
    }

    let start_i = start_frame * channels;
    let end_i = end_frame * channels;
    let slice = &decoded.samples[start_i..end_i];

    let spec = wav_spec_for_source(path, decoded.sample_rate, decoded.channels, decoded.bit_depth_hint);

    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)?;
    }

    write_wav(out_path, spec, slice)?;
    Ok(())
}

/// Build `{stem}_clip_{start}-{end}.wav` under `clips_dir`, with `_2`, `_3`, …
/// if the name already exists.
pub fn allocate_clip_path(
    clips_dir: &Path,
    original_filename: &str,
    start_secs: f64,
    end_secs: f64,
) -> PathBuf {
    let stem = Path::new(original_filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("clip");
    let stem = sanitize_filename(stem);
    let start_label = format_secs(start_secs);
    let end_label = format_secs(end_secs);
    let base = format!("{stem}_clip_{start_label}-{end_label}");

    fs::create_dir_all(clips_dir).ok();

    let mut candidate = clips_dir.join(format!("{base}.wav"));
    let mut n = 2u32;
    while candidate.exists() {
        candidate = clips_dir.join(format!("{base}_{n}.wav"));
        n += 1;
    }
    candidate
}

/// Delete all files in the JIT clips directory (keeps the directory).
pub fn clear_cache(clips_dir: &Path) -> AppResult<()> {
    if !clips_dir.exists() {
        fs::create_dir_all(clips_dir)?;
        return Ok(());
    }
    for entry in fs::read_dir(clips_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            fs::remove_file(&path)?;
        } else if path.is_dir() {
            fs::remove_dir_all(&path)?;
        }
    }
    Ok(())
}

fn format_secs(secs: f64) -> String {
    format!("{secs:.3}")
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    if cleaned.is_empty() {
        "clip".into()
    } else {
        cleaned
    }
}

fn wav_spec_for_source(
    path: &Path,
    sample_rate: u32,
    channels: u16,
    bit_depth_hint: Option<u32>,
) -> WavSpec {
    if let Ok(reader) = hound::WavReader::open(path) {
        let mut spec = reader.spec();
        // Keep source format; force rate/channels from decode in case of mismatch.
        spec.sample_rate = sample_rate;
        spec.channels = channels;
        return normalize_spec(spec);
    }

    let bits = bit_depth_hint.unwrap_or(16);
    match bits {
        32 => WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        },
        24 => WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 24,
            sample_format: SampleFormat::Int,
        },
        8 => WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 8,
            sample_format: SampleFormat::Int,
        },
        _ => WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        },
    }
}

fn normalize_spec(spec: WavSpec) -> WavSpec {
    match (spec.sample_format, spec.bits_per_sample) {
        (SampleFormat::Float, _) => WavSpec {
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
            ..spec
        },
        (SampleFormat::Int, b) if b <= 8 => WavSpec {
            bits_per_sample: 8,
            sample_format: SampleFormat::Int,
            ..spec
        },
        (SampleFormat::Int, b) if b <= 16 => WavSpec {
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
            ..spec
        },
        (SampleFormat::Int, b) if b <= 24 => WavSpec {
            bits_per_sample: 24,
            sample_format: SampleFormat::Int,
            ..spec
        },
        (SampleFormat::Int, _) => WavSpec {
            bits_per_sample: 32,
            sample_format: SampleFormat::Int,
            ..spec
        },
    }
}

fn write_wav(out_path: &Path, spec: WavSpec, samples: &[f32]) -> AppResult<()> {
    let mut writer = WavWriter::create(out_path, spec)
        .map_err(|e| AppError::msg(format!("wav create failed: {e}")))?;

    match (spec.sample_format, spec.bits_per_sample) {
        (SampleFormat::Float, _) => {
            for &s in samples {
                writer
                    .write_sample(s.clamp(-1.0, 1.0))
                    .map_err(|e| AppError::msg(format!("wav write failed: {e}")))?;
            }
        }
        (SampleFormat::Int, 8) => {
            for &s in samples {
                let v = (s.clamp(-1.0, 1.0) * 127.0).round() as i8;
                writer
                    .write_sample(v)
                    .map_err(|e| AppError::msg(format!("wav write failed: {e}")))?;
            }
        }
        (SampleFormat::Int, 16) => {
            for &s in samples {
                let v = (s.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16;
                writer
                    .write_sample(v)
                    .map_err(|e| AppError::msg(format!("wav write failed: {e}")))?;
            }
        }
        (SampleFormat::Int, 24) => {
            let max = (1_i32 << 23) as f32;
            for &s in samples {
                let v = (s.clamp(-1.0, 1.0) * (max - 1.0)).round() as i32;
                writer
                    .write_sample(v)
                    .map_err(|e| AppError::msg(format!("wav write failed: {e}")))?;
            }
        }
        (SampleFormat::Int, _) => {
            for &s in samples {
                let v = (s.clamp(-1.0, 1.0) * (i32::MAX as f32)).round() as i32;
                writer
                    .write_sample(v)
                    .map_err(|e| AppError::msg(format!("wav write failed: {e}")))?;
            }
        }
    }

    writer
        .finalize()
        .map_err(|e| AppError::msg(format!("wav finalize failed: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn render_clip_from_example() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../example_samples");
        let path = root.join("heatwave/Moods/mood-hopeful.wav");
        if !path.exists() {
            eprintln!("skip: missing {}", path.display());
            return;
        }
        let out = std::env::temp_dir().join("sift_jit_test_clip.wav");
        render_clip(&path, 0.1, 0.5, &out).expect("render");
        assert!(out.exists());
        let reader = hound::WavReader::open(&out).expect("read back");
        assert!(reader.duration() > 0);
        let _ = fs::remove_file(&out);
    }

    #[test]
    fn allocate_disambiguates() {
        let dir = std::env::temp_dir().join("sift_jit_alloc_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let a = allocate_clip_path(&dir, "kick.wav", 1.25, 3.0);
        assert_eq!(a.file_name().unwrap(), "kick_clip_1.250-3.000.wav");
        fs::write(&a, b"x").unwrap();
        let b = allocate_clip_path(&dir, "kick.wav", 1.25, 3.0);
        assert_eq!(b.file_name().unwrap(), "kick_clip_1.250-3.000_2.wav");
        let _ = fs::remove_dir_all(&dir);
    }
}
