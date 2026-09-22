//! Peakfile cache for waveform drawing.
//!
//! Binary layout (`{sample_id}.peaks`):
//! - magic: `SFTP` (4 bytes)
//! - version: u32 LE (= 2)
//! - channels: u32 LE
//! - `sample_rate`: u32 LE
//! - `duration_ms`: f64 LE
//! - `bucket_count`: u32 LE
//! - peaks: `bucket_count * channels * 2` f32 LE values
//!   per bucket, per channel: min, max
//! - colors: `bucket_count * 3` u8 RGB values (bass→R, mid→G, treble→B)

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use moodbar_analysis::{GenerateOptions, Theme, analyze_pcm_mono};
use serde::Serialize;

use crate::audio::decode::{DecodedAudio, decode_file};
use crate::error::{AppError, AppResult};
use crate::paths::AppPaths;

const MAGIC: &[u8; 4] = b"SFTP";
const VERSION: u32 = 2;

/// Peak buffer ready for IPC / Canvas drawing.
#[derive(Debug, Clone, Serialize)]
pub struct PeakData {
    pub channels: u16,
    pub sample_rate: u32,
    pub duration_ms: f64,
    /// Flat array: for each bucket, for each channel: min, max.
    pub peaks: Vec<f32>,
    pub bucket_count: usize,
    /// Flat RGB triples, one per bucket (`bucket_count * 3` bytes).
    /// Classic moodbar mapping: bass → red, mid → green, treble → blue.
    pub colors: Vec<u8>,
}

fn peak_path(peaks_dir: &Path, sample_id: i64) -> PathBuf {
    peaks_dir.join(format!("{sample_id}.peaks"))
}

fn write_peakfile(path: &Path, data: &PeakData) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = File::create(path)?;
    f.write_all(MAGIC)?;
    f.write_all(&VERSION.to_le_bytes())?;
    f.write_all(&(u32::from(data.channels)).to_le_bytes())?;
    f.write_all(&data.sample_rate.to_le_bytes())?;
    f.write_all(&data.duration_ms.to_le_bytes())?;
    let bucket_count =
        u32::try_from(data.bucket_count).map_err(|_| AppError::msg("bucket count out of range"))?;
    f.write_all(&bucket_count.to_le_bytes())?;
    for v in &data.peaks {
        f.write_all(&v.to_le_bytes())?;
    }
    if data.colors.len() != data.bucket_count.saturating_mul(3) {
        return Err(AppError::msg("spectral color length mismatch"));
    }
    f.write_all(&data.colors)?;
    Ok(())
}

fn read_peakfile(path: &Path, expected_buckets: Option<usize>) -> AppResult<Option<PeakData>> {
    if !path.exists() {
        return Ok(None);
    }
    let mut f = File::open(path)?;
    let mut magic = [0u8; 4];
    f.read_exact(&mut magic)?;
    if &magic != MAGIC {
        return Ok(None);
    }
    let mut buf4 = [0u8; 4];
    f.read_exact(&mut buf4)?;
    let version = u32::from_le_bytes(buf4);
    if version != VERSION {
        return Ok(None);
    }
    f.read_exact(&mut buf4)?;
    let channels = u16::try_from(u32::from_le_bytes(buf4)).unwrap_or(1);
    f.read_exact(&mut buf4)?;
    let sample_rate = u32::from_le_bytes(buf4);
    let mut buf8 = [0u8; 8];
    f.read_exact(&mut buf8)?;
    let duration_ms = f64::from_le_bytes(buf8);
    f.read_exact(&mut buf4)?;
    let bucket_count = usize::try_from(u32::from_le_bytes(buf4))
        .map_err(|_| AppError::msg("bucket count out of range"))?;

    if let Some(expected) = expected_buckets
        && bucket_count != expected
    {
        return Ok(None);
    }

    let n = bucket_count
        .checked_mul(usize::from(channels))
        .and_then(|x| x.checked_mul(2))
        .ok_or_else(|| AppError::msg("peakfile size overflow"))?;
    let mut peaks = Vec::with_capacity(n);
    let mut f32buf = [0u8; 4];
    for _ in 0..n {
        f.read_exact(&mut f32buf)?;
        peaks.push(f32::from_le_bytes(f32buf));
    }

    let color_len = bucket_count
        .checked_mul(3)
        .ok_or_else(|| AppError::msg("peakfile color size overflow"))?;
    let mut colors = vec![0u8; color_len];
    f.read_exact(&mut colors)?;

    Ok(Some(PeakData {
        channels,
        sample_rate,
        duration_ms,
        peaks,
        bucket_count,
        colors,
    }))
}

fn peak_index_overflow() -> AppError {
    AppError::msg("peak index overflow")
}

/// Downmix interleaved PCM to mono for spectral analysis.
fn mix_to_mono(decoded: &DecodedAudio) -> Vec<f32> {
    let ch = usize::from(decoded.channels.max(1));
    if ch == 1 {
        return decoded.samples.clone();
    }
    let frames = decoded.frame_count();
    let mut mono = Vec::with_capacity(frames);
    #[allow(
        clippy::as_conversions,
        clippy::cast_precision_loss,
        reason = "channel count is a tiny u16"
    )]
    let inv = 1.0f32 / ch as f32;
    for frame in 0..frames {
        let mut sum = 0.0f32;
        for c in 0..ch {
            let idx = frame.saturating_mul(ch).saturating_add(c);
            sum += decoded.samples.get(idx).copied().unwrap_or(0.0);
        }
        mono.push(sum * inv);
    }
    mono
}

/// Keep hue ratios, lift brightness so dark spectral frames stay visible on a dark UI.
#[allow(
    clippy::as_conversions,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::suboptimal_flops,
    reason = "RGB bytes from clamped floats; flops precision is irrelevant for display"
)]
fn boost_rgb(rgb: [u8; 3]) -> [u8; 3] {
    let r = f32::from(rgb[0]) / 255.0;
    let g = f32::from(rgb[1]) / 255.0;
    let b = f32::from(rgb[2]) / 255.0;
    let peak = r.max(g).max(b);
    if peak <= 1e-6 {
        return [0, 0, 0];
    }
    let brightness = (0.32 + 0.68 * peak).clamp(0.0, 1.0);
    [
        ((r / peak) * brightness * 255.0).round() as u8,
        ((g / peak) * brightness * 255.0).round() as u8,
        ((b / peak) * brightness * 255.0).round() as u8,
    ]
}

/// Resample moodbar color frames onto exactly `buckets` RGB triples.
fn resample_colors(frames: &[[u8; 3]], buckets: usize) -> Vec<u8> {
    let mut out = vec![0u8; buckets.saturating_mul(3)];
    if buckets == 0 {
        return out;
    }
    if frames.is_empty() {
        return out;
    }
    let last_src = frames.len().saturating_sub(1);
    let last_dst = buckets.saturating_sub(1).max(1);
    for b in 0..buckets {
        let src = if last_src == 0 {
            0
        } else {
            b.saturating_mul(last_src)
                .checked_div(last_dst)
                .unwrap_or(0)
        };
        let rgb = boost_rgb(frames.get(src).copied().unwrap_or([0, 0, 0]));
        let base = b.saturating_mul(3);
        if let Some(r) = out.get_mut(base) {
            *r = rgb[0];
        }
        if let Some(g) = out.get_mut(base.saturating_add(1)) {
            *g = rgb[1];
        }
        if let Some(bl) = out.get_mut(base.saturating_add(2)) {
            *bl = rgb[2];
        }
    }
    out
}

/// Bass / mid / treble energy → RGB via moodbar Classic (R/G/B).
fn generate_spectral_colors(decoded: &DecodedAudio, buckets: usize) -> Vec<u8> {
    if buckets == 0 || decoded.sample_rate == 0 || decoded.frame_count() == 0 {
        return vec![0u8; buckets.saturating_mul(3)];
    }
    let mono = mix_to_mono(decoded);
    let options = GenerateOptions {
        theme: Theme::Classic,
        max_target_frames: Some(buckets.max(1)),
        ..GenerateOptions::default()
    };
    let analysis = analyze_pcm_mono(decoded.sample_rate, &mono, &options);
    resample_colors(&analysis.colors, buckets)
}

/// Build min/max peaks from decoded PCM, with per-bucket spectral RGB.
pub fn generate_peaks(decoded: &DecodedAudio, buckets: usize) -> AppResult<PeakData> {
    let channels = decoded.channels.max(1);
    let frames = decoded.frame_count();
    if frames == 0 || buckets == 0 {
        return Err(AppError::msg("cannot generate peaks from empty audio"));
    }

    let ch = usize::from(channels);
    let total = buckets
        .checked_mul(ch)
        .and_then(|n| n.checked_mul(2))
        .ok_or_else(peak_index_overflow)?;
    let mut peaks = vec![0.0f32; total];

    for b in 0..buckets {
        let start = b
            .checked_mul(frames)
            .and_then(|n| n.checked_div(buckets))
            .ok_or_else(peak_index_overflow)?;
        let end = b
            .checked_add(1)
            .and_then(|n| n.checked_mul(frames))
            .and_then(|n| n.checked_div(buckets))
            .ok_or_else(peak_index_overflow)?
            .max(start.saturating_add(1))
            .min(frames);

        for c in 0..ch {
            let mut min_v = f32::INFINITY;
            let mut max_v = f32::NEG_INFINITY;
            for frame in start..end {
                let idx = frame
                    .checked_mul(ch)
                    .and_then(|n| n.checked_add(c))
                    .ok_or_else(peak_index_overflow)?;
                let s = *decoded.samples.get(idx).ok_or_else(peak_index_overflow)?;
                min_v = min_v.min(s);
                max_v = max_v.max(s);
            }
            if !min_v.is_finite() {
                min_v = 0.0;
            }
            if !max_v.is_finite() {
                max_v = 0.0;
            }
            let base = b
                .checked_mul(ch)
                .and_then(|n| n.checked_add(c))
                .and_then(|n| n.checked_mul(2))
                .ok_or_else(peak_index_overflow)?;
            let hi = base.checked_add(1).ok_or_else(peak_index_overflow)?;
            *peaks.get_mut(base).ok_or_else(peak_index_overflow)? = min_v;
            *peaks.get_mut(hi).ok_or_else(peak_index_overflow)? = max_v;
        }
    }

    let colors = generate_spectral_colors(decoded, buckets);

    Ok(PeakData {
        channels,
        sample_rate: decoded.sample_rate,
        duration_ms: decoded.duration_ms(),
        peaks,
        bucket_count: buckets,
        colors,
    })
}

/// Return cached peaks or decode + generate + write `{sample_id}.peaks`.
pub fn ensure_peaks(
    paths: &AppPaths,
    sample_id: i64,
    path: &Path,
    buckets_row: usize,
) -> AppResult<PeakData> {
    let cache = peak_path(&paths.peaks_dir, sample_id);
    if let Some(cached) = read_peakfile(&cache, Some(buckets_row))? {
        return Ok(cached);
    }

    let decoded = decode_file(path)?;
    let data = generate_peaks(&decoded, buckets_row)?;
    write_peakfile(&cache, &data)?;
    Ok(data)
}

/// Default bucket count for row / generic peaks IPC.
pub const DEFAULT_BUCKETS: usize = 1024;

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(rate: u32, secs: f32, hz: f32) -> DecodedAudio {
        #[allow(
            clippy::as_conversions,
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "test fixture sizes"
        )]
        let n = (rate as f32 * secs) as usize;
        let samples: Vec<f32> = (0..n)
            .map(|i| {
                #[allow(clippy::as_conversions, clippy::cast_precision_loss)]
                let t = i as f32 / rate as f32;
                (2.0 * std::f32::consts::PI * hz * t).sin() * 0.8
            })
            .collect();
        DecodedAudio {
            sample_rate: rate,
            channels: 1,
            bit_depth_hint: None,
            samples,
        }
    }

    fn avg_rgb(colors: &[u8], start: usize, end: usize) -> [f32; 3] {
        let mut sum = [0.0f32; 3];
        let mut count = 0.0f32;
        for i in start..end {
            let base = i.saturating_mul(3);
            sum[0] += f32::from(colors.get(base).copied().unwrap_or(0));
            sum[1] += f32::from(colors.get(base.saturating_add(1)).copied().unwrap_or(0));
            sum[2] += f32::from(colors.get(base.saturating_add(2)).copied().unwrap_or(0));
            count += 1.0;
        }
        [sum[0] / count, sum[1] / count, sum[2] / count]
    }

    #[test]
    fn bass_mid_treble_map_to_rgb_channels() {
        let rate = 44_100;
        let mut samples = Vec::new();
        samples.extend(sine(rate, 0.4, 80.0).samples);
        samples.extend(sine(rate, 0.4, 1000.0).samples);
        samples.extend(sine(rate, 0.4, 6000.0).samples);
        let audio = DecodedAudio {
            sample_rate: rate,
            channels: 1,
            bit_depth_hint: None,
            samples,
        };
        let peaks = generate_peaks(&audio, 96).expect("peaks");
        assert_eq!(peaks.colors.len(), 96 * 3);
        let third = peaks.bucket_count / 3;
        let low = avg_rgb(&peaks.colors, 0, third);
        let mid = avg_rgb(&peaks.colors, third, third * 2);
        let high = avg_rgb(&peaks.colors, third * 2, peaks.bucket_count);
        assert!(low[0] > low[1] && low[0] > low[2], "bass should be red-dominant: {low:?}");
        assert!(mid[1] > mid[0] && mid[1] > mid[2], "mids should be green-dominant: {mid:?}");
        assert!(high[2] > high[0] && high[2] > high[1], "treble should be blue-dominant: {high:?}");
    }

    #[test]
    fn peakfile_roundtrip_keeps_colors() {
        let dir = tempfile::tempdir().expect("temp");
        let audio = sine(22_050, 0.2, 440.0);
        let data = generate_peaks(&audio, 64).expect("peaks");
        let path = dir.path().join("1.peaks");
        write_peakfile(&path, &data).expect("write");
        let loaded = read_peakfile(&path, Some(64)).expect("read").expect("present");
        assert_eq!(loaded.bucket_count, 64);
        assert_eq!(loaded.colors, data.colors);
        assert_eq!(loaded.peaks.len(), data.peaks.len());
    }
}
