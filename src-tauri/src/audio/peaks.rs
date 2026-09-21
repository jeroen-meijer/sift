//! Peakfile cache for waveform drawing.
//!
//! Binary layout (`{sample_id}.peaks`):
//! - magic: `SFTP` (4 bytes)
//! - version: u32 LE (= 1)
//! - channels: u32 LE
//! - sample_rate: u32 LE
//! - duration_ms: f64 LE
//! - bucket_count: u32 LE
//! - peaks: `bucket_count * channels * 2` f32 LE values
//!   per bucket, per channel: min, max

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::audio::decode::{decode_file, DecodedAudio};
use crate::error::{AppError, AppResult};
use crate::paths::AppPaths;

const MAGIC: &[u8; 4] = b"SFTP";
const VERSION: u32 = 1;

/// Peak buffer ready for IPC / Canvas drawing.
#[derive(Debug, Clone, Serialize)]
pub struct PeakData {
    pub channels: u16,
    pub sample_rate: u32,
    pub duration_ms: f64,
    /// Flat array: for each bucket, for each channel: min, max.
    pub peaks: Vec<f32>,
    pub bucket_count: usize,
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
    f.write_all(&(data.bucket_count as u32).to_le_bytes())?;
    for v in &data.peaks {
        f.write_all(&v.to_le_bytes())?;
    }
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
    let channels = u32::from_le_bytes(buf4) as u16;
    f.read_exact(&mut buf4)?;
    let sample_rate = u32::from_le_bytes(buf4);
    let mut buf8 = [0u8; 8];
    f.read_exact(&mut buf8)?;
    let duration_ms = f64::from_le_bytes(buf8);
    f.read_exact(&mut buf4)?;
    let bucket_count = u32::from_le_bytes(buf4) as usize;

    if let Some(expected) = expected_buckets {
        if bucket_count != expected {
            return Ok(None);
        }
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

    Ok(Some(PeakData {
        channels,
        sample_rate,
        duration_ms,
        peaks,
        bucket_count,
    }))
}

/// Build min/max peaks from decoded PCM.
pub fn generate_peaks(decoded: &DecodedAudio, buckets: usize) -> AppResult<PeakData> {
    let channels = decoded.channels.max(1);
    let frames = decoded.frame_count();
    if frames == 0 || buckets == 0 {
        return Err(AppError::msg("cannot generate peaks from empty audio"));
    }

    let ch = usize::from(channels);
    let mut peaks = vec![0.0f32; buckets * ch * 2];

    for b in 0..buckets {
        let start = b * frames / buckets;
        let end = ((b + 1) * frames / buckets).max(start + 1).min(frames);
        for c in 0..ch {
            let mut min_v = f32::INFINITY;
            let mut max_v = f32::NEG_INFINITY;
            for frame in start..end {
                let s = decoded.samples[frame * ch + c];
                min_v = min_v.min(s);
                max_v = max_v.max(s);
            }
            if !min_v.is_finite() {
                min_v = 0.0;
            }
            if !max_v.is_finite() {
                max_v = 0.0;
            }
            let base = (b * ch + c) * 2;
            peaks[base] = min_v;
            peaks[base + 1] = max_v;
        }
    }

    Ok(PeakData {
        channels,
        sample_rate: decoded.sample_rate,
        duration_ms: decoded.duration_ms(),
        peaks,
        bucket_count: buckets,
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
